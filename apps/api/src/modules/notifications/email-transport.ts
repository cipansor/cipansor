/**
 * How an e-mail actually leaves the building.
 *
 * Three transports, chosen in this order by what is configured:
 *
 *   1. `gmail_api` — a Google Cloud service account with domain-wide
 *      delegation, impersonating the sending mailbox and calling
 *      `gmail.users.messages.send`. **Preferred.** There is no password: the
 *      credential is an RSA key scoped to `gmail.send` alone, revocable from the
 *      Admin console, and useless for reading mail or signing in.
 *   2. `smtp` — smtp.gmail.com with an app password or OAuth2. Kept as a
 *      fallback because it needs no Cloud project, but an app password is a
 *      bearer credential that grants the whole mailbox.
 *   3. `log` — nothing is sent. What an unconfigured deployment does.
 *
 * WHY THIS IS A SEPARATE FILE. The old code decided "can we send?" inline in
 * `sendEmail`, and the answer was invisible everywhere else: with SMTP_HOST
 * unset it logged the mail, returned `{ success: true }`, and the settings
 * screen went on reporting "Channel Email Aktif". Nobody could tell a delivered
 * e-mail from a discarded one. `describeEmailTransport()` now answers that
 * question for the API, the logs and the UI from one place, and
 * `deliverEmail()` reports `delivered: false` rather than pretending.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { ServiceAccountTokenSource } from '../../lib/google-service-account';

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Largest derived e-mail body this module will process, in UTF-16 code units.
 *
 * A backstop on what reaches the transport, **not** an equality with the API's
 * request limit. `sendEmail` HTML-escapes a notification's body and wraps it in
 * a template before calling here, and escaping turns one character into as many
 * as six (`"` → `&quot;`, `'` → `&#039;`); the generated HTML is therefore
 * neither the same string nor the same size as the request that produced it,
 * and the two limits do not even share a unit (the request limit counts bytes
 * of raw JSON, this counts code units of generated HTML). The request edge caps
 * raw content so its worst-case expansion stays under this bound
 * (`MAX_NOTIFICATION_CONTENT_LENGTH` in `notifications.schema.ts`), which is
 * what keeps every accepted body deliverable.
 *
 * What is left for this bound to stop is the pathological body an internal
 * caller could still hand over: the scanners that strip hidden markup are
 * linear, but a caller-supplied string is not something this module controls —
 * the bound `js/loop-bound-injection` (code scanning alert 54) asks for. A body
 * past it is refused, never silently truncated: a truncated HTML part would no
 * longer match the plain-text part derived from it (see `htmlToText`).
 */
export const MAX_EMAIL_BODY_LENGTH = 10 * 1024 * 1024;

export type EmailTransportKind = 'gmail_api' | 'smtp' | 'log';

export interface EmailTransportStatus {
  kind: EmailTransportKind;
  /** False only for `log`: nothing will be delivered. */
  configured: boolean;
  /** The From header recipients will see. */
  from: string;
  /** Where a reply goes. Deliberately not the From mailbox. */
  replyTo: string;
  /** Gmail API only: the impersonated mailbox. */
  sender?: string;
  /** SMTP only: host:port. */
  host?: string;
}

export interface DeliverEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text part. Derived from `html` when omitted. */
  text?: string;
  /**
   * Alamat yang dituju ketika penerima menekan Balas. Bawaannya
   * `config.mail.replyTo` (halo@), yang benar untuk hampir semua surat kita.
   *
   * Yang membutuhkan penggantinya: surat yang KAMI kirim ke halo@ atas nama
   * orang lain — penerusan pertanyaan dari asisten AI. Di sana balasan harus
   * jatuh ke penanyanya, bukan kembali ke kotak masuk yang sama; tanpa ini,
   * petugas yang menekan Balas mengirim surat kepada dirinya sendiri dan orang
   * yang bertanya tidak pernah mendapat jawaban.
   */
  replyTo?: string;
  /**
   * Inline parts the HTML refers to by `cid:`.
   *
   * The lambang travels this way rather than as a hosted URL: Outlook and
   * Gmail's "ask before displaying" mode block remote images by default, and a
   * `data:` URI is stripped outright — so an attached part is the only form
   * that renders for everyone without them having to click anything.
   */
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
    cid?: string;
  }>;
}

export interface DeliverEmailResult {
  kind: EmailTransportKind;
  /** False when the transport is `log` — the message was written, not sent. */
  delivered: boolean;
  messageId: string;
}

// With outbound messages switched off (staging), neither transport counts as
// configured even when its credentials are present, so every path below lands on
// the log-only transport — the same one an unconfigured deployment uses.
function gmailApiConfigured(): boolean {
  if (!config.outboundMessages.enabled) return false;
  return Boolean(config.gmail.serviceAccountEmail && config.gmail.serviceAccountKey);
}

function smtpConfigured(): boolean {
  if (!config.outboundMessages.enabled) return false;
  return Boolean(config.smtp.host);
}

/**
 * Which transport is in force, and the identity it sends under.
 *
 * Read by `GET /api/notifications/email-status` so the settings screen can
 * state what is actually configured instead of repeating hardcoded strings.
 */
export function describeEmailTransport(): EmailTransportStatus {
  const from = config.mail.from;
  const replyTo = config.mail.replyTo;

  if (gmailApiConfigured()) {
    return { kind: 'gmail_api', configured: true, from, replyTo, sender: config.gmail.sender };
  }

  if (smtpConfigured()) {
    return {
      kind: 'smtp',
      configured: true,
      from,
      replyTo,
      host: `${config.smtp.host}:${config.smtp.port}`,
    };
  }

  return { kind: 'log', configured: false, from, replyTo };
}

/**
 * Rough plain-text alternative for an HTML mail.
 *
 * Not a full converter and not trying to be. A message with no text/plain part
 * scores worse with spam filters and is unreadable in text-only clients, and
 * every template here is a table of labelled facts, so dropping the tags and
 * collapsing whitespace gives a usable fallback.
 *
 * Markup is stripped BEFORE entities are decoded, and nothing strips tags
 * afterwards. That ordering is the whole point:
 *
 *   - Real `<script>`/`<style>`/tags are removed while still markup, so they
 *     can never survive into the result. Decoding first would turn an escaped
 *     `&lt;script&gt;` into a `<script>` the tag regex is then expected to
 *     remove — an inherently incomplete second pass that leaves an injection
 *     aperture.
 *   - Entities are decoded once, on a string that is already markup-free, so
 *     `&lt;code&gt;` becomes the literal text `<code>` rather than being
 *     mistaken for a tag and deleted.
 *
 * A single tag-strip pass over `<<script>script>` leaves `<script>` behind,
 * because the inner tag is consumed and the two halves join into a new one.
 * Re-applying the pass to a fixed point closes that hole, but a fixed-point
 * loop is not free: a tag split across many layers (closing an inner `</style>`
 * re-fuses an outer `<sty…` into `<style`) peels one layer per round, so O(n)
 * rounds of an O(n) scan is quadratic. Both strip passes below build the same
 * fixed point in a single left-to-right stack scan instead, which is O(n).
 *
 * The destructive passes are NOT independent, so applying them one after the
 * other is not enough. Removing a `<head>` fragment can fuse `<sty` with a
 * later `le>` into a fresh `<style>` opener, and vice versa; if the `style` pass
 * has already run, that new element is never processed and its contents leak
 * into the plain-text body (`<sty<head>h</head>le>css</style>` -> `css`). The
 * two element patterns are therefore stripped by a SINGLE interleaved scan
 * (`stripHiddenElements`) that reaches the joint fixed point of both passes at
 * once, rather than a local fixed point per pass. The generic tag strip that
 * follows cannot re-introduce `<` or `>` — it only deletes — so no later pass
 * can re-open the hole the element scan just closed.
 *
 * HTML comments are handled by the SAME joint scan, not by a separate
 * pre-pass. A comment body may contain `<` and `>`, so the generic tag strip
 * below — which bounds a run at the next `>` — cannot tell
 * `<!-- note > hidden -->` from a tag and would stop at the first `>` and leak
 * the rest of the comment (code scanning alert 27's class). A separate
 * `comment-strip` pass would itself be vulnerable to the same fusion this
 * function exists to close: deleting a comment can glue a stray `<!-` and a
 * `-` into a fresh `<!--`, and deleting a `<style>`/`<head>` element can glue
 * a comment's own `<!--` back together, so the newly formed comment (with a
 * `>` in its body) would survive every later pass. Folding the pattern into
 * the joint scan lets a fusion re-fire in the same pass, so the fixed point is
 * reached without rescanning.
 *
 * Every pass is a hand-written left-to-right scan, not a regex: a `<...>` body
 * is bounded by the next `<`, and each character is visited a constant number
 * of times. The `<style>`/`<head>` and generic patterns used to be regexes that
 * backtracked quadratically on input such as `<a` repeated (code scanning
 * alert 49's class), so the whole function is linear in the input length.
 *
 * The result is plain text, NOT HTML-safe markup. A decoded entity can produce
 * a literal `<script>` in the output (e.g. from `&lt;script&gt;`), which is
 * inert only while the consumer does not re-embed it as HTML without escaping.
 */
export function htmlToText(html: string): string {
  let text = stripHiddenElements(html);
  text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n');
  text = stripTags(text);

  return decodeBasicEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * True when `out` ends with `pattern`, compared case-insensitively.
 *
 * `out` is a plain array of single characters, so a character is a single
 * UTF-16 code unit and its length equals the number of appended elements.
 */
function endsWith(out: string[], pattern: string): boolean {
  if (out.length < pattern.length) return false;
  const base = out.length - pattern.length;
  for (let k = 0; k < pattern.length; k++) {
    if (out[base + k].toLowerCase() !== pattern[k]) return false;
  }
  return true;
}

/** True for the ASCII letters HTML tag and attribute names are built from. */
function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** True for HTML whitespace (space, tab, LF, FF, CR). */
function isHtmlWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

/**
 * Mark, per source position, whether it sits inside a quoted attribute value of
 * a tag (`Uint8Array`, `1` for yes).
 *
 * `stripHiddenElements` recognises its patterns from the current output tail, so
 * a `<!--` that is merely the text of a quoted attribute (`<a title="<!--">`)
 * looks exactly like a real comment opener there. This mask tells them apart: a
 * `<` inside a quoted value starts no markup, so the tail scan ignores any
 * candidate opener whose `<` is masked.
 *
 * One left-to-right pass. A tag starts at `<` followed by a name character
 * (optionally after `/`) and runs to the first `>` outside a `'…'`/`"…"` value;
 * everything from an opening quote to its match is marked. A quote opens a
 * value only directly after `=` (whitespace allowed around it), so a stray quote
 * in a tag name or between attributes cannot mask later markup. A quote that is
 * never closed masks nothing (see below). Comments carry no attributes, so they are
 * skipped whole to their `-->` (or EOF) — a quote in a comment body is not a
 * value and must not mask later markup — while doctypes and processing
 * instructions (`<!…`/`<?…`) run to the next `>`. Each character is visited a
 * constant number of times, so the mask is O(n).
 */
function quotedAttributeMask(text: string): Uint8Array {
  const quoted = new Uint8Array(text.length);
  let i = 0;

  while (i < text.length) {
    if (text.charCodeAt(i) !== 0x3c /* < */) {
      i++;
      continue;
    }

    const next = text.charCodeAt(i + 1);
    if (next === 0x21 /* ! */ || next === 0x3f /* ? */) {
      // A comment runs to its `-->` (or EOF), not the first `>`; a quote in the
      // body after a `>` must not be read as a value and mask later markup.
      let skip: number;
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        skip = end === -1 ? text.length : end + 3;
      } else {
        const gt = text.indexOf('>', i + 2);
        skip = gt === -1 ? text.length : gt + 1;
      }
      i = skip;
      continue;
    }

    const afterSlash = text.charCodeAt(i + 2);
    if (!isAsciiLetter(next) && !(next === 0x2f /* / */ && isAsciiLetter(afterSlash))) {
      i++;
      continue;
    }

    let j = i + 1;
    let quote = 0;
    let quoteStart = -1;
    let canOpenQuote = false;
    for (; j < text.length; j++) {
      const code = text.charCodeAt(j);
      if (quote !== 0) {
        if (code === quote) {
          for (let k = quoteStart; k <= j; k++) quoted[k] = 1;
          quote = 0;
          canOpenQuote = false;
        }
        continue;
      }
      if (code === 0x3e /* > */) break;
      if (code === 0x22 /* " */ || code === 0x27 /* ' */) {
        if (canOpenQuote) {
          quote = code;
          quoteStart = j;
        }
        continue;
      }
      if (!isHtmlWhitespace(code)) canOpenQuote = code === 0x3d; /* = */
    }
    // A quote that is never closed quotes nothing. Masking it to end-of-input
    // would hide every later `<!--`/`<style`/`<head` from the element scan and
    // let `stripTags` keep the whole tail verbatim — `<a title="<script>…`
    // survived untouched that way (2,189 of 300k random inputs leaked live
    // markup). Leaving it unmasked matches `stripTags`, which re-reads such a
    // tail without quote handling.
    i = j + 1;
  }

  return quoted;
}

/**
 * Remove `<style>`/`<head>` elements (contents included) and HTML comments to
 * the JOINT fixed point of all three, in one linear interleaved scan.
 *
 * The passes are not independent. A `</head>` removal can fuse an earlier
 * `<sty` with a later `le>` into a fresh `<style` opener, and a `</style>`
 * removal can do the mirror image for `head`; a sequential
 * `stripElement(x,'style')` then `stripElement(x,'head')` leaves that freshly
 * formed element — and the text it hides — in the output. Comments fuse the
 * same way: deleting a `<style>` element can glue a comment's own `<!--` back
 * together, and deleting a comment can glue a stray `<!-` and `-` into a fresh
 * `<!--`. A comment processed by a separate pass would carry its body's `>`
 * past every later pass.
 *
 * One scan sees every such fusion as it happens, because it only ever looks at
 * the *current tail* of the growing output. Detection and deletion are each
 * pattern's own greedy rule:
 *
 *   - An opener is tracked by that pattern's earliest still-unmatched position.
 *     For `style`/`head` the opener is the literal `<name` (no `>` needed); for
 *     comments it is the full `<!--`, since the terminator is `-->` and the
 *     body must not be split on `>`.
 *   - When a close arrives while its pattern has an unmatched opener, delete
 *     from that earliest opener through the close. Every opener at or after it
 *     — of ANY pattern, since all sit inside the deleted span — is retired
 *     too. Because each pattern's earliest unmatched opener is always the one
 *     that would fire next, this is exactly what re-applying the three passes
 *     to a shared fixed point would do, but without rescanning: a character is
 *     appended once and dropped at most once, so the scan is O(n).
 *
 * This is order-independent by construction: the earliest pending opener across
 * the live tail determines each truncation regardless of which pass you imagine
 * running. A `style`/`head` opener with no close is left for the generic tag
 * strip, and input stutters near an already-deleted prefix (detection is
 * tail-based, deletion is global) are normalised by that strip, which cannot
 * re-create `<` or `>`.
 *
 * A tail match alone does not make an opener real: `<!--` (and `<style`/`<head`)
 * can appear *as text* inside a quoted attribute value — `<a title="<!--">` —
 * where it opens nothing, and a `>` inside such a value ends no tag. The
 * scanner therefore consults `quotedAttributeMask` and refuses an opener whose
 * `<` is masked, and refuses a `>` that is masked as a close. Treating the
 * masked `<!--` as a real comment made the unclosed-comment rule below truncate
 * the whole output at the attribute, deleting the visible `link</a>…` that
 * followed (code scanning alert 27 regression). A masked `<` is copied through
 * untouched; the mask is computed from the raw input up front so a fusion later
 * in the scan can never move a boundary.
 *
 * A comment opener that is still pending when the input ends has no `-->`, so
 * per HTML's comment parsing rule it runs to end-of-input: everything from
 * `<!--` onward is dropped. This applies only to a `<!--` that the mask does
 * NOT consider attribute text; leaving an unmasked one to the generic tag
 * strip instead would bound it at the first `>` and leak the rest of the body,
 * which is the incomplete-sanitization class this scan exists to close.
 */
function stripHiddenElements(text: string): string {
  const normalizedText = typeof text === 'string' ? text : String(text ?? '');
  // Refuse an oversized body instead of truncating it: an early exit is what
  // bounds every loop below (CodeQL's `js/loop-bound-injection` query, whose
  // only string barrier is a length check that exits the function), and it also
  // keeps the plain-text part `htmlToText` derives consistent with the HTML
  // part it was derived from — a silently truncated prefix would not be.
  if (normalizedText.length > MAX_EMAIL_BODY_LENGTH) {
    throw new Error(
      `Email body is ${normalizedText.length} characters, over the ${MAX_EMAIL_BODY_LENGTH} limit`
    );
  }
  const safeText = normalizedText;

  const patterns = [
    { open: '<!--', close: '-->' },
    { open: '<style', close: '</style>' },
    { open: '<head', close: '</head>' },
  ].map((p) => ({ open: p.open.toLowerCase(), close: p.close.toLowerCase() }));
  const quoted = quotedAttributeMask(safeText);
  const isLiveOpen = (start: number) => !quoted[start];
  const out: string[] = [];
  const outPos: number[] = [];
  const openStart: number[] = patterns.map(() => -1);

  for (let i = 0; i < safeText.length; i++) {
    out.push(safeText[i]);
    outPos.push(i);

    for (let p = 0; p < patterns.length; p++) {
      if (openStart[p] === -1 && endsWith(out, patterns[p].open)) {
        const start = out.length - patterns[p].open.length;
        if (isLiveOpen(outPos[start])) openStart[p] = start;
      }
    }

    for (let p = 0; p < patterns.length; p++) {
      if (openStart[p] === -1 || !endsWith(out, patterns[p].close)) continue;
      // A `>` inside a quoted attribute value ends no tag; a masked close must
      // not be allowed to terminate a real element.
      if (quoted[outPos[out.length - 1]]) continue;
      const start = openStart[p];
      out.length = start;
      outPos.length = start;
      for (let q = 0; q < patterns.length; q++) {
        if (openStart[q] >= start) openStart[q] = -1;
      }
      break;
    }
  }

  // patterns[0] is the comment; an unclosed one swallows the rest of the input.
  if (openStart[0] !== -1) {
    out.length = openStart[0];
    outPos.length = openStart[0];
  }

  return out.join('');
}

/**
 * Remove every `<…>` run to a fixed point, in one linear stack scan.
 *
 * The run regex is `<[^>]*>`'s committed shape: a `<` runs to the next `>` even
 * across other `<`. Re-applying it deletes the earliest open plus the first
 * close after it, then repeats; that fixed point is the greedy rule, so
 * whenever a `>` is seen with a `<` still unmatched, delete from the *earliest*
 * unmatched `<` through the `>`. Retiring the whole run at once is what makes
 * one scan suffice, and a `<` with no following `>` is left as literal text,
 * exactly as the regex'd single pass did.
 *
 * Comments are NOT handled here — a `<!-- … > … -->` body would break the
 * "next `>`" rule — so `stripHiddenElements` removes every comment first; this
 * pass cannot re-create a comment either, since it only deletes.
 *
 * A `>` inside a quoted attribute value (`<a title="a > b">`) ends no tag, so a
 * quote opens inside an unmatched run and only its matching quote lets a later
 * `>` close the run; this mirrors the mask `stripHiddenElements` uses and keeps
 * the two passes consistent on the same input.
 */
function stripTags(text: string, quoteAware = true): string {
  const out: string[] = [];
  let openStart = -1;
  let openSource = -1;
  let quote = '';
  let canOpenQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out.push(ch);
    if (openStart === -1) {
      if (ch === '<') {
        openStart = out.length - 1;
        openSource = i;
      }
      continue;
    }
    if (quote !== '') {
      if (ch === quote) {
        quote = '';
        canOpenQuote = false;
      }
      continue;
    }
    if (ch === '>') {
      out.length = openStart;
      openStart = -1;
      canOpenQuote = false;
    } else if (quoteAware && (ch === '"' || ch === "'")) {
      if (canOpenQuote) quote = ch;
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\f' && ch !== '\r') {
      canOpenQuote = ch === '=';
    }
  }

  // A run still open at end-of-input never became a tag, so its quotes were
  // never attribute values: honouring them kept every `<…>` after the first
  // quote verbatim (`<a title="<script>x</script>` survived untouched, and so
  // did `<a x="-x>y="` once its quotes happened to pair up). Nothing was deleted
  // since the run opened, so `out` from `openStart` equals the source from
  // `openSource`; re-read that tail once without quote handling. The second
  // pass cannot recurse, so the whole strip stays linear.
  if (quoteAware && openStart !== -1) {
    return out.slice(0, openStart).join('') + stripTags(text.slice(openSource), false);
  }

  return out.join('');
}

/**
 * Decode the handful of entities the mail templates use, in a single pass that
 * runs each entity exactly once.
 *
 * The one-pass walk is what keeps a nested escape literal: `&amp;quot;` yields
 * `&quot;`, not `"`. A sequential `.replace()` chain cannot do that, because
 * after `&amp;` decodes to `&` the remainder is then decoded a second time by
 * whichever specific-entity replacement runs later in the chain.
 */
function decodeBasicEntities(text: string): string {
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&',
  };

  return text.replace(
    /&#0*(39|38);|&(?:nbsp|lt|gt|quot|apos|amp);/g,
    (match, numericCode?: string) => {
      if (numericCode === '39') return "'";
      if (numericCode === '38') return '&';
      return named[match] ?? match;
    }
  );
}

/**
 * Compose the RFC 5322 message.
 *
 * Uses nodemailer's stream transport purely as a builder, so the Gmail API path
 * produces byte-identical MIME to the SMTP path — same headers, same encoding,
 * same multipart structure. Writing the message by hand here is where UTF-8
 * subjects and long-header folding go wrong.
 */
async function composeRawMessage(input: DeliverEmailInput): Promise<Buffer> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });

  const info = await composer.sendMail({
    from: config.mail.from,
    replyTo: input.replyTo ?? config.mail.replyTo,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? htmlToText(input.html),
    attachments: input.attachments,
  });

  return info.message as Buffer;
}

let tokenSource: ServiceAccountTokenSource | null = null;

function getTokenSource(): ServiceAccountTokenSource {
  if (!tokenSource) {
    tokenSource = new ServiceAccountTokenSource({
      clientEmail: config.gmail.serviceAccountEmail,
      privateKey: config.gmail.serviceAccountKey,
      subject: config.gmail.sender,
      scopes: [GMAIL_SEND_SCOPE],
    });
  }
  return tokenSource;
}

type SmtpAuthOptions =
  | { user: string; pass: string }
  | {
      type: 'OAuth2';
      user: string;
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    };

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  // nodemailer's own union for this is wide enough that describing it here adds
  // nothing; what matters is that `auth` is omitted entirely when nothing is
  // configured. Passing `{ user: undefined, pass: undefined }` — which the
  // previous code did unconditionally — makes nodemailer attempt AUTH with
  // empty credentials against a relay that may not want authentication at all.
  let auth: SmtpAuthOptions | undefined;

  if (
    config.smtp.oauth2.clientId &&
    config.smtp.oauth2.clientSecret &&
    config.smtp.oauth2.refreshToken
  ) {
    auth = {
      type: 'OAuth2',
      user: config.smtp.user || config.gmail.sender,
      clientId: config.smtp.oauth2.clientId,
      clientSecret: config.smtp.oauth2.clientSecret,
      refreshToken: config.smtp.oauth2.refreshToken,
    };
  } else if (config.smtp.user && config.smtp.pass) {
    auth = { user: config.smtp.user, pass: config.smtp.pass };
  }

  smtpTransporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    // An announcement fans out to every user at once. Without pooling each
    // message opens its own connection, and Gmail refuses well before the
    // hundredth — so the blast half-delivers and the failures look random.
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    // Gmail also rate-limits per connection; 10 messages/second is comfortably
    // inside it and still clears a whole-school announcement in seconds.
    rateDelta: 1000,
    rateLimit: 10,
    ...(auth ? { auth } : {}),
  });

  return smtpTransporter;
}

/** Drop cached transports. Used by tests and after a configuration change. */
export function resetEmailTransport(): void {
  smtpTransporter?.close?.();
  smtpTransporter = null;
  tokenSource?.reset();
  tokenSource = null;
}

/**
 * Bound a provider HTTP call so it cannot outlive the delivery claim that
 * guards it. Well under the claim lease (`CHANNEL_CLAIM_LEASE_MS`), so a slow
 * send fails cleanly and the channel is retried rather than being reclaimed
 * while the original request is still in flight (review finding on #804).
 */
const PROVIDER_TIMEOUT_MS = 60_000;

async function sendViaGmailApi(input: DeliverEmailInput): Promise<DeliverEmailResult> {
  const accessToken = await getTokenSource().getAccessToken();
  const raw = (await composeRawMessage(input)).toString('base64url');

  const response = await fetch(GMAIL_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string; status?: string };
  } | null;

  if (!response.ok || !body?.id) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gmail API send failed: ${detail}`);
  }

  return { kind: 'gmail_api', delivered: true, messageId: body.id };
}

async function sendViaSmtp(input: DeliverEmailInput): Promise<DeliverEmailResult> {
  const info = await getSmtpTransporter().sendMail({
    from: config.mail.from,
    replyTo: input.replyTo ?? config.mail.replyTo,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? htmlToText(input.html),
    attachments: input.attachments,
  });

  return { kind: 'smtp', delivered: true, messageId: info.messageId };
}

/**
 * Send one message through whichever transport is configured.
 *
 * Throws on a real delivery failure. Returns `delivered: false` only for the
 * `log` transport, which is a configuration state rather than an error — the
 * caller decides whether that counts as success for its own purposes.
 */
export async function deliverEmail(input: DeliverEmailInput): Promise<DeliverEmailResult> {
  // Reject at the boundary, before any transport composes or sends anything.
  // The Gmail/SMTP paths derive a `text/plain` part from `html` when `text` is
  // omitted, but a caller may pass both, and then nothing below would inspect
  // the HTML at all — the size limit has to be enforced here to be enforced.
  // Both parts are checked: a caller can also supply an oversized `text`.
  if (input.html.length > MAX_EMAIL_BODY_LENGTH) {
    throw new Error(
      `Email HTML is ${input.html.length} characters, over the ${MAX_EMAIL_BODY_LENGTH} limit`
    );
  }
  if (input.text !== undefined && input.text.length > MAX_EMAIL_BODY_LENGTH) {
    throw new Error(
      `Email text is ${input.text.length} characters, over the ${MAX_EMAIL_BODY_LENGTH} limit`
    );
  }

  if (gmailApiConfigured()) {
    return sendViaGmailApi(input);
  }

  if (smtpConfigured()) {
    return sendViaSmtp(input);
  }

  logger.warn(
    'Email transport not configured (no Gmail service account, no SMTP_HOST) — message logged only.',
    { to: input.to, subject: input.subject }
  );

  return { kind: 'log', delivered: false, messageId: `log_${Date.now()}` };
}
