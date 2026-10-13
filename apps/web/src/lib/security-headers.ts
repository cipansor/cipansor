/**
 * Security response headers for the web host.
 *
 * Split out of `next.config.ts` and `middleware.ts` so both can share one
 * definition and a unit test can read it: a header set that lives only inside
 * a config file is a header set nothing verifies.
 *
 * The static list is applied by `next.config.ts` `headers()` to every path. The
 * Content-Security-Policy is not in it — it carries a per-request nonce, so it
 * is built by `contentSecurityPolicy()` and applied in `middleware.ts`, which
 * sees every document request.
 */

/**
 * The API origin the browser talks to.
 *
 * In production the API is a separate host (`api.cipansor.or.id`), so it is a
 * cross-origin `fetch` and must be named in `connect-src` or every call — the
 * login POST, every React Query read — is blocked. Derived from the same
 * `NEXT_PUBLIC_API_URL` the axios instance uses (`lib/api.ts`), so the two
 * cannot drift; the localhost default matches it for `pnpm dev`.
 */
export function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  // Empty is how staging and production build the image: the API is served
  // from the portal's own origin (`/api`), which `'self'` already covers. It
  // used to fall through to the localhost default, so the deployed policy
  // named `http://localhost:3001` in `connect-src` and `media-src`.
  if (configured === "") return "";
  try {
    return new URL(configured ?? "http://localhost:3001").origin;
  } catch {
    return "http://localhost:3001";
  }
}

/** A source list without the empty entries a same-origin API leaves behind. */
const sources = (...list: string[]) => list.filter(Boolean).join(" ");

/**
 * The Content-Security-Policy for a document response.
 *
 * Built per request because `script-src` carries a nonce. Next reads the CSP
 * off the request's headers and stamps it on the inline scripts it emits (the
 * RSC bootstrap); the app's own executable inline script reads the nonce back
 * off the request header (see the root layout). Without the nonce, `script-src
 * 'self'` alone would refuse those inline scripts and the app would not hydrate
 * — the header would break the site rather than protect it.
 *
 * `script-src` deliberately lists no `'unsafe-inline'`: a script injected
 * through a rendered announcement body cannot execute, which is the stored-XSS
 * class this app's `dangerouslySetInnerHTML` surfaces carry.
 */
export function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Next injects inline styles and React sets `style` attributes; styles are
    // a lower risk than script.
    "style-src 'self' 'unsafe-inline'",
    // Cloudflare Turnstile (the login/reset widget) and any image a sanitised
    // announcement may embed.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Audio/video: the E-Simaan setoran recorder previews a just-recorded blob
    // (`AudioRecorder`, a `blob:` URL) and the tahfidz record page plays a saved
    // recording served from the API host (`/uploads/**`, an absolute URL, so a
    // different origin than the portal). Without both, the preview is silent and
    // playback is blocked.
    `media-src ${sources("'self'", "blob:", apiOrigin())}`,
    `connect-src ${sources("'self'", apiOrigin(), "https://challenges.cloudflare.com")}`,
    // `blob:`/`data:` are the app's own local PDF previews (an uploaded file
    // shown in an `<iframe>` before it is saved); `challenges.cloudflare.com`
    // is the Turnstile widget.
    "frame-src 'self' blob: data: https://challenges.cloudflare.com",
    // `'unsafe-eval'` only in dev: React's development build uses `eval` for
    // enhanced debugging; the production build does not.
    //
    // `'strict-dynamic'` lets a script that already carries the nonce load
    // further scripts (Next's lazily-imported chunks, Cloudflare Turnstile's
    // injected `<script>`), so the host allowlist below is only a fallback for
    // browsers that predate `'strict-dynamic'`. An injected inline script still
    // cannot run: it never carries the nonce.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    // No `upgrade-insecure-requests`. Every host this app loads from is https
    // and HSTS covers navigation, so on the real site it rewrote nothing; but
    // WebKit applies it to http://localhost as well (WebKit bugs 171934,
    // 250776), unlike Chromium and Firefox. A production build served over
    // plain http — CI's e2e, a local rig — then fetched its own `/_next`
    // chunks from https://localhost, never hydrated, and main's WebKit e2e
    // failed almost every test after #626.
  ].join("; ");
}

/**
 * Headers applied to every response from the web host, statically.
 *
 * The Content-Security-Policy is not here: it needs the per-request nonce and
 * is applied by `middleware.ts` instead.
 */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  // HSTS. The API host already gets this from `helmet()`, but the web host
  // serves no such header, and every PWA guarantee (a secure service-worker
  // scope, Web Push, the session cookie) depends on HTTPS never being
  // downgraded. `preload` is deliberately omitted: submitting to the preload
  // list is a one-way commitment across every subdomain and should be a
  // separate, deliberate decision.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Cross-origin isolation. The app opens its own certificates and uploads in a
  // new tab and never reads `window.opener`, so no OAuth popup depends on it;
  // `same-origin` closes the reverse-tabnabbing and cross-origin-window-
  // reference surface.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // "0", not "1; mode=block": the browsers' XSS auditor is gone, and where it
  // survives its blocking mode was itself a cross-site leak. The CSP above is
  // the protection now (OWASP HTTP Headers Cheat Sheet: "X-XSS-Protection: 0").
  { key: "X-XSS-Protection", value: "0" },
  // DENY, to say the same as the CSP's `frame-ancestors 'none'` (which modern
  // browsers obey instead). SAMEORIGIN contradicted it for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Three powerful features are used, each scoped to our own origin:
  // - microphone: the E-Simaan setoran recorder (`AudioRecorder` calls
  //   `getUserMedia({ audio: true })`);
  // - camera and geolocation: Absen Saya (`SelfieCapture` takes the selfie
  //   with `getUserMedia({ video })` and reads `navigator.geolocation`).
  // They are allowed site-wide, not on `/hr/attendance/me` alone, because the
  // policy belongs to the document: a client-side navigation into that page
  // keeps the policy of whichever page the session was loaded on. `()` here
  // made the browser refuse both without a prompt, so every selfie fell back to
  // a file and no punch ever had a location. The payment request API is not
  // used, so naming it denies the prompt to any injected script. Web Push is
  // not a Permissions-Policy feature (its permission is the Notifications
  // prompt); listing `push` only made Chromium log "Unrecognized feature".
  {
    key: "Permissions-Policy",
    value:
      "fullscreen=(self), camera=(self), microphone=(self), geolocation=(self), payment=()",
  },
];
