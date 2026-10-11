# E-Office & electronic signature — audit findings and the plan

Written 2026-09-02, after auditing PR #414, the e-signature key lifecycle, and
the incoming/outgoing letter flow. This is the durable copy of a plan that is
too large to carry in a conversation.

Read [`roadmap.md`](../.claude/memory/roadmap.md) §6 for where this sits against everything
else outstanding.

> **How the feature works today is the [`naskah-dinas`](../.claude/skills/naskah-dinas/SKILL.md)
> skill.** This file is the record behind it: what the audit found, why each
> PR was shaped as it was, and the sources. §0 and §2 describe the state on
> 2026-09-02 and are history; the "SHIPPED" marks say which PRs have landed.

---

## 0. Read this first — where the code actually is

**The work is not in PR #414. It is in commit `e93a7cf2`, and nothing on any
branch points at it any more.**

The sequence, from the git history:

| When (UTC) | What |
|---|---|
| 2026-09-02 01:40:12 | PR **#421** — *"Fix E-Office correspondence verification, workflow, and recipient pickers"*, **+5,112 lines**, nine rounds of review fixes — squash-merged into `feature/e-office-enhancements-9779766552483489576` as `e93a7cf2`. GitHub marks #421 **MERGED**. |
| 2026-09-02 01:57:28 | Commit `dfc2ad43` by `google-labs-jules[bot]`, titled *"fix(e2e): update status assertion in public-verification spec and add mysql2 override"*, **deleted almost all of it**: `correspondence.service.ts` −912, `tests/service.test.ts` −1,112, `tests/public.test.ts` −125, `generate-letter-pdf.ts` −297, `letter-verification.ts` −95, `captcha.ts` −50, `esign.service.ts` −199, and 6 lines from `schema.prisma`. |

Verified by blob hash: on the PR branch today, `correspondence.service.ts`,
`correspondence.controller.ts`, `correspondence.routes.ts`, `navigation.ts`,
`rbac.ts` and `types/correspondence.ts` are **byte-identical to `main`**. The
feature contributes nothing.

A trial merge of #414 into `main` conflicts (`pnpm-lock.yaml`,
`forecast.test.ts`) and, excluding the lockfile, yields
**26 files, 236 insertions, 776 deletions** — a dependency and CI **downgrade**
that reverts #424/#425, drops `framer-motion` a major version, unpins `turbo`
and `typescript` back to floating `"latest"`, loosens the `nodemailer` security
pin, reverts Zod-4 idioms, and deletes two test suites (158 + 502 lines) whose
replacement covers fewer cases. GitHub reports it `CONFLICTING` / `DIRTY`; its
green checks are from 01:57–02:08 UTC against an older base.

> **#414 must be closed, not merged.** Recover `e93a7cf2` onto `main` instead,
> taking `main`'s side for every dependency, CI and Zod hunk.

The salvage diff — `git diff origin/main e93a7cf2` restricted to the feature
paths — is **33 files, +4,178 / −1,526**.

---

## 1. The design decision behind public verification

**Verification is by uploading the PDF, not by scanning the QR.** This is
deliberate and must not be "fixed" back.

A token only attests *"a letter with this token was signed"* — never *"the
document in your hand is that letter."* An attacker keeps a genuine QR and edits
the body: *"paling lambat tanggal 30 November"* becomes *"1 November"*. The old
`/verifikasi/[token]` page would still answer **valid**, and because it withheld
the subject for non-`PUBLIC` letters, nothing on screen contradicted the forged
text.

So: `/verifikasi/[token]` was removed on purpose, `/public/verify-letter` takes
an uploaded PDF plus a captcha, and the QR carries the **verification page
address with no token in the link** — a tokenised link could only answer *"some
letter with this token was signed"*, the oracle this section removes. Scanning
it opens the upload form, which is the one place the document in your hand can
be checked.

> **Corrected 2026-09-29.** This paragraph said the QR "now carries the **raw
> token string** … scanning it opens nothing, by design". That was the state
> before #446, not after: the generator builds the QR from
> `letterVerificationUrl()` (`generate-letter-pdf.ts`), and #446's own note
> below records the change. The stale sentence contradicted the shipped code and
> the entry three sections down.

The upload path is implemented well: a dedicated public rate limiter
(`PUBLIC_VERIFY_RATE_LIMIT_MAX`, default 30 per 15 min), multer in memory only
with a 10 MB cap and a PDF filter.

**Correction, 2026-09-03.** This paragraph used to add "captcha issued
server-side and verified before the file is touched", and called it well
implemented. It was neither. The challenge was arithmetic (`3 + 4`) and its
token was `base64url("num1:num2:answer:expiresAt")` plus an HMAC. The HMAC
stopped a token being *forged*; it did nothing to stop one being *read*. A bot
fetched `/esign/captcha`, base64-decoded the token it had just been handed, and
submitted the answer — and could replay the same pair for five minutes, because
nothing marked a token as spent. It was a speed bump for scripts that did not
decode, and no obstacle at all to any that did. Replaced by Cloudflare
Turnstile, whose answer is held by Cloudflare rather than shipped to the
browser, and whose tokens are single-use server-side.

---

## 2. What the audit found

### 2.1 The PDF is rasterised in production today

`apps/web/src/app/e-office/letter/[id]/page.tsx:126` runs `html2canvas(...)` →
`toDataURL("image/png")` → `jsPDF.addImage(...)`. **The entire naskah dinas
becomes one PNG.** `assessment/raport-merdeka/page.tsx` does the same.

Unselectable, unsearchable, unindexable by the archive, hostile to screen
readers, needlessly large — and, decisively for everything below, **a raster PDF
cannot carry a meaningful PAdES signature**.

`e93a7cf2` fixes this with a server-side `pdf-lib` generator: 21 `drawText`
calls with embedded fonts, and the QR as an image via `embedPng`/`drawImage`.
That is the right shape — text stays text, images stay images — but it ships
four defects (§2.2).

### 2.2 Defects in the server-side PDF generator

| # | Defect | Consequence |
|---|---|---|
| a | `addPage` is called once (line 45) and content stops at `if (y < 120) break;` | **Letters longer than one page are silently truncated — and the truncated PDF is what gets hashed and signed.** A multi-article SK is cut off mid-way and still verifies as valid. |
| b | The header is text-only; no logo is embedded | The web letterhead uses `unit.logoUrl` with a fallback. Moving to the server generator **drops the lambang from every letter** — the one element that genuinely should be an image. |
| c | `StandardFonts.TimesRoman` is WinAnsi-only | Arabic on a pesantren letterhead (bismillah, the name in Arabic) makes `pdf-lib` **throw** — and that throw lands in the swallowed `try/catch` of §2.3, so the letter silently becomes unverifiable. Needs `@pdf-lib/fontkit` and an embedded Unicode face. |
| d | `y = Math.min(y - 20, 220)` for the signature block | Can overlap body content. |

### 2.3 The PDF hash is written outside the transaction, and its errors are swallowed

`apps/api/src/modules/esign/esign.service.ts:531`. Signing commits in a
transaction; the hash is computed *after* it, wrapped in a `try/catch` whose
body is only `console.error`.

If PDF generation fails for any reason, the letter is **SIGNED** with
`pdfHash = NULL`. Since upload is the only supported verification path, that
letter can never be proven genuine — and the public page does not say "our
system had a problem", it says:

> *"Dokumen PDF tidak terdaftar dalam sistem resmi Yayasan Pesantren Cipansor
> atau telah mengalami perubahan."*

**A genuine letter is publicly accused of being forged, silently.**

### 2.4 The signed PDF bytes are not stored

There is no blob field on `LetterSignature`;
`correspondence.controller.ts:67` regenerates the PDF on every download. So
verification depends on `generateLetterPdfBuffer` emitting identical bytes
forever.

The author understood the risk — `setCreationDate(new Date(0))`,
`setModificationDate(...)`, and a determinism test exist. But that test compares
two calls **in the same process and version**. It cannot catch the real hazard:
bump `pdf-lib`, edit the letterhead, change a date format, or land on a
different ICU build, and **every previously signed letter fails verification at
once**, all of them publicly reported as altered.

This repo takes dependabot bumps weekly (#424 and #425 inside one week), so this
is not hypothetical. **Archive the signed bytes and serve downloads from the
archive.**

### 2.5 Revocation exists in the schema and in the UI, but nothing can perform it

Two separate holes:

- **Signing keys.** `POST /esign/keys/:userId/revoke` exists, guarded by
  `isSuperAdmin` with its own schema — and **no frontend code calls it**. A
  leaked passphrase or a departing official cannot be revoked through the app.
  This is the one lifecycle operation that is urgent by nature.
- **Letter signatures.** `LetterSignature.revokedAt` / `revokedReason` /
  `revokedById` exist; `letter-verification.ts` branches on them; the public
  page is ready to report *"Surat telah dicabut: …"*; the naskah template
  filters revoked signatures out. But the only `letterSignature.update` in the
  entire tree writes `{ pdfHash, pdfSignature }`. **No route, no controller, no
  service method ever writes `revokedAt`.** The feature is display-only: the
  system advertises a capability it does not have. Withdrawing a wrongly issued
  SK is a real administrative need.

### 2.6 The token oracle survives the redesign

`GET /api/esign/verify/:token` and `GET /api/correspondence/public/verify/:token`
are still public and still answer `valid: true` from the database row alone —
precisely the assertion §1 exists to retire. No UI drives them, but anyone can
call them directly or build a convincing lookalike verification page on top.
Remove them, or change the response so it no longer asserts document validity.

**Minor, same area:** ✅ *Hardened in `f045be2`.* `verifyByPdfBuffer` verified `signature.pdfHash` using `signature.publicKey` — both read from the row just fetched — instead of binding `uploadedHash`. Outcome-equivalent, because the lookup keyed on equality, but it read back the field it searched on rather than the bytes uploaded. It now names `uploadedHash`, so the Ed25519 step visibly checks the caller's document.

### 2.7 Letter flow — four things that are wired to nothing

The flow is otherwise strong (§3.2). These are the gaps:

| # | Gap | Detail |
|---|---|---|
| a | ✅ *Fixed in PR-4.* **`SENT` is never used for outgoing letters** | `correspondence.service.ts:755` sets `SENT` only for **INCOMING** letters whose review finished with no disposition recipients — semantically inverted. Outgoing runs `DRAFT → PENDING_REVIEW → READY_TO_SIGN → SIGNED → ARCHIVED`, skipping it. There is no `sentAt` field and no dispatch record (date, channel, tanda terima), which is exactly what a buku agenda surat keluar records. Any "surat terkirim" statistic is therefore wrong. |
| b | ✅ *Fixed in PR-4.* **Tembusan is modelled but dead** | `isCC` exists on the recipient model and is written exactly once in the codebase: a hardcoded `isCC: false` at `correspondence.service.ts:350`. Nothing sets it true; no UI offers it. Tembusan is a standard element of naskah dinas. |
| c | ✅ *Fixed in `1513317`.* **Signing authority is unstructured** | `senderTitle` is free text. Naskah dinas distinguishes **a.n.**, **u.b.**, **Plt.**, **Plh.**, and that determines both who may sign and how the signature block prints. Today it is a typist's convention, not a rule the system can enforce. |
| d | ✅ *Fixed in PR-4.* **No attachment list for outgoing letters** | `fileUrl` is a single field for the scanned original. There is no list of lampiran and no "Lampiran: N berkas" line. |

| e | ✅ *Fixed after PR-4.* **A letter cannot be edited after it is created** | Found while building PR-4, not fixed by it. There is no `PATCH /letters/:id` — the only `router.patch` in the module is `/dispositions/:id/status`, and `UpdateLetterInput` is a DTO with no endpoint behind it. So the flow PR-2 completed has no middle step: a reviewer returns a draft, the page says *"Surat dikembalikan untuk diperbaiki"*, and the author's only available move is to resubmit the identical text. It also means lampiran and tembusan can only be attached at creation. Fixing it is a surface of its own — an edit form, a rule for which statuses and which fields are editable by whom, and re-clearing every paraf on save, since a paraf approves a specific text. |

**Minor:** urgency has three levels (`NORMAL`/`IMMEDIATE`/`URGENT`), which is
what the pedoman tata naskah dinas defines: **Amat Segera/Kilat** (24 jam),
**Segera** (2 × 24 jam), **Biasa** (Permenpan 80/2012, "Kecepatan
Penyampaian"). A `KILAT` value proposed in #628 would have relabelled every
existing "Amat Segera" letter one tier lower; the user decided (2026-10-09) on
three degrees labelled **Sangat Segera / Segera / Biasa** —
`decisions/derajat-kecepatan-naskah.md`.

### 2.8 Access control — a cross-unit service role read the whole letter book

Found on the round-2 follow-up, after the Devin findings F1–F12 were closed. It
is not one of them.

`letterScopeWhere`, `assertLetterAccess` and `choosesUnit` keyed their "sees
everything" branch on `seesAllUnits`. That helper exists for the shared services
— the asrama houses santri from three schools, and the klinik, perpustakaan,
keamanan and laboratorium serve the whole campus, so their staff must see across
units. That is right for *student* data and wrong for *correspondence*: the rule
is a property of the data, not of the person.

The consequence was that every cross-unit service account — pustakawan,
perawat, keamanan, musyrif, ustadz, laboran, and the Pesantren office
(`PESANTREN_PENGASUH`, `PESANTREN_TATA_USAHA`) — was handed the entire yayasan's
letter book, unclassified letters included, and could pass `?unitId=` to read
another school's agenda. The retention review list came with it, because it
applies the same clause. These are the very roles the letter-creation guard
already refuses (`service.test.ts`), so the read side contradicted the write
side.

The three now key on `isFoundationScopedRole` (the board plus super admin) — the
same line `admissions.access.ts` draws for SPMB: the foundation board reads
across units, service staff do not. Those roles keep their legitimate access
through the chain (addressee, reviewer, disposition recipient, non-classified
tembusan). Regression tests pin the list clause, the direct read, and
`choosesUnit`.

The standard this restores is Perka ANRI 7/2016, Pasal 5(d): *setiap pegawai
hanya dapat mengakses arsip yang berada pada tanggung jawab tugas dan
kewenangannya* — access follows the task, not the org chart. It is also why the
`RESTRICTED_NATURES` exclusion exists at all; without the unit boundary, the
exclusion only stopped the classification a role had no business seeing, not the
letter book itself.

### 2.9 `canonicalVersion` — a signature must be verified by the rule it was made under

Found on the round-2 follow-up, and it is the reason the signing-authority forms
of §2.7(c) could not be added safely.

`canonicalPayload` builds the exact bytes a signature is computed over. Adding
the a.n./u.b./Plt./Plh. fields extended that payload — so a letter signed
*before* the change was signed over `v1` bytes, and reconstructing those bytes
with the new `v2` shape (two more newline-separated fields, even when empty)
produces a **different message**, which the correct key then rejects. Every
signature made before the authority feature would have been reported as forged
the moment the feature shipped.

The fix is versioning, not a flag day: `canonicalPayload(payload, version)`
keeps `v1` and `v2` side by side, `CURRENT_CANONICAL_VERSION` is what signing
uses, `LetterSignature.canonicalVersion` stores which rule was used, and
`canonicalVersionOf(stored)` maps the pre-column `NULL` rows to `v1` — the only
shape that existed when they were made. Verification reads the stored version
and never guesses. Migration `20261009010400_letter_signature_canonical_version`.

Pinned by `esign.test.ts` (a `v1` payload and a `v2` payload differ; a `v1`
signature verifies only under `v1`) and by `letter-verification.ts` reading the
column on the public path.

### 2.10 An uploaded naskah could be someone else's file (CWE-639)

Found on the round-2 follow-up while tracing what the signing path actually
reads.

For an `UPLOADED` letter (§5b(a)) the signing path reads the drafter's file
bytes and signs them. It read `Letter.fileUrl` and handed the bytes to the
signer — but `fileUrl` is a URL, and a URL can be copied. A drafter who knew (or
guessed) another user's upload URL could paste it as their own `fileUrl`, and
the system would sign, hash and archive **someone else's document** as that
drafter's naskah. `readUploadedPdfBytes` only proves the file exists and is a
PDF; it has no idea who uploaded it, and `/uploads` is served by `uploadsAuth`,
which is authentication rather than authorisation (§5b(a), and the same
`/uploads` gap the KTP discussion turns on).

`LetterUpload` is the ownership index the upload endpoint never had: every
authenticated upload records `filename → userId`, and `assertLetterUploadOwnedBy`
refuses a file whose owner is not in the letter's own chain (drafter and
assigned reviewers — the people who may legitimately supply a letter's bytes).
A file with no ownership row is **refused**, not waved through: uploads made
before the table existed cannot be proven anyone's, and guessing re-opens the
hole. The drafter re-uploads. Migration `20261009010500_letter_upload_ownership`.

### 2.11 A revoked download was answered with the forgery sentence

The row in §PR-2 claimed "copies already in circulation still verify" — true —
and implied the system's own post-revocation download would too. It did not.

`stampRevoked` marks a download of a withdrawn naskah with `DICABUT`; that
changes the bytes, so their hash no longer equals the signed `pdfHash`, and
`verifyByPdfBuffer` — which looks an upload up **by** that hash — answered the
system's own stamped copy with the sentence a forgery gets. The sentence the
plan predicted is exactly the one it received.

`utils/letter-revoked-copy.ts` closes it, and the second version changed how.
The first recomputed the stamp on every request against the 200 most recent
revocations — two costs: `stampRevoked` on every upload, and, worse, once
revocations passed 200 an older official copy was answered "tidak terdaftar".
Now `LetterSignedDocument.revokedSha256` stores the stamped copy's hash when the
revocation is recorded, so the match is one exact, unbounded comparison; rows
without it (older revocations) fall back to the bounded recompute, exactly as
before, so nothing stops being recognised. Nothing in the uploaded file is
trusted: a hand-stamped "DICABUT" recomputes to a different hash and still gets
the forgery sentence. Migration
`20261009010600_letter_signed_document_revoked_hash`.

### 2.12 The retention job must never destroy — a guard, not a promise

The user's hard constraint is that retention **lists and warns, it never
deletes**. The reasoning is in §2.13; the enforcement is a test.

`letter-retention.no-destroy.guard.test.ts` reads the retention job and its CLI
and fails if either grows a Prisma `delete`/`deleteMany`/`drop`/`truncate`, a
raw `$executeRaw`/`$queryRaw` carrying `DELETE FROM` / `DROP TABLE` / `TRUNCATE`,
or a `DISPOSED`/`destroyed` write. It also walks the whole API source and fails
if any non-test module deletes a `Letter` or `LetterSignature` — so "the system
never destroys a naskah" is checked across the tree, not only in the retention
job. The tree scan matches the delete by the **receiver's absence**, not the
literal name `prisma`: `tx.letter.deleteMany(` (a transaction client) and
`prisma.letter.delete(` both match, and a raw
`$executeRaw\`DELETE FROM letters …\`` matches too. The patterns are themselves
asserted against positive examples — including a read-only
`['SIGNED', 'SENT', 'ARCHIVED', 'DISPOSED']` list that must *not* be flagged — so
the guard cannot quietly narrow again. The job already only reads and proposes,
but a future edit that "cleans up" past-retention rows would silently turn a
review tool into a shredder — and the deletion would be of archive records, which
**UU 43/2009 Pasal 51–52** and its implementing **PP 28/2012** require a lawful
procedure and a berita acara for. The guard makes that an error rather than a
review comment.

### 2.13 Why retention stops at a list — what the regulations actually require

The constraint was the user's, and the sources agree with it, so it is recorded
rather than assumed.

- **UU 43/2009 Pasal 51–52** is the operative rule: pemusnahan is allowed only
  for archives that *tidak memiliki nilai guna* **and** *telah habis retensinya
  dan berketerangan dimusnahkan berdasarkan JRA* **and** are not barred by other
  law **and** are not tied to a pending case; it "wajib dilaksanakan sesuai
  dengan prosedur yang benar", and Pasal 52(1) forbids destroying archives
  *without* the correct procedure. The procedure — panitia penilai, an
  assessment, the berita acara — is set by **PP 28/2012** (Pasal 55 delegates
  it there). A scheduled job cannot produce a berita acara, and a retention date
  passing is not the same event as a retention date being *assessed*.
- **Peraturan ANRI 5/2021** is *Pedoman Umum Tata Naskah Dinas* — it governs
  how a naskah dinas is written, secured and controlled, **not** how an archive
  is destroyed. It is the source for the classification levels the system
  already models (Pasal 104: sangat rahasia / rahasia / terbatas / biasa) and
  for the *pengendalian naskah dinas keluar* the dispatch feature fills in
  (Pasal 132–138: registration, a buku agenda/kartu kendali carrying at least
  nomor urut, tanggal pengiriman, tanggal dan nomor naskah, tujuan, isi ringkas,
  keterangan; and, for the electronic application, "fitur pencatatan riwayat,
  pengiriman dan penyimpanan").
- **Perka ANRI 7/2016** is the same posture for the *access* side: an archive's
  classification decides who may see it, and Pasal 5(d) — *setiap pegawai hanya
  dapat mengakses arsip yang berada pada tanggung jawab tugas dan
  kewenangannya* — is the rule §2.8 restores.

So the job (`letter-retention.job.ts`, `db:retention-review`, Mon 05:00 WIB) and
the screen (`/e-office/retention`) answer exactly one question — **which naskah
are past their JRA-derived retention** — and hand it to the people who may act
on it. There is no destroy button on the page, deliberately; the page's own
comment says why. The one action is an export for the assessment meeting.

Two things the *code* must not do, and the guard in §2.12 enforces: delete a
row, or write a `DISPOSED`/`destroyed` state. Disposition is a human decision
with a berita acara behind it; the system's job ends at "here is the list".

> **Citation corrected 2026-09-29.** This section and six source files cited
> "Peraturan ANRI 5/2021 Pasal 6" for the destruction rule. Both halves were
> wrong: **Peraturan ANRI 5/2021 is Pedoman Umum Tata Naskah Dinas**, and its
> **Pasal 6** lists the types of *Naskah Dinas pengaturan* (peraturan,
> instruksi, surat edaran, SOP) — nothing to do with retention. The destruction
> rule is **UU 43/2009 Pasal 51–52 jo. PP 28/2012**. The citations were
> corrected at the source (`letter-retention.job.ts`,
> `letter-retention.no-destroy.guard.test.ts`, `correspondence.service.ts`,
> `letter-access.ts`, the shared DTO, the retention page and its e2e spec).

---

## 3. What is already good — do not rebuild these

### 3.1 The signing crypto and key lifecycle

`apps/api/src/utils/esign.ts` and `esign-lifecycle.ts` are carefully built:

- Ed25519 keypair per signer; private key sealed with AES-256-GCM under a KEK
  derived by scrypt (N=2¹⁵, r=8, p=1), parameters stored per key so they can be
  raised later without breaking old keys.
- **The passphrase is never stored, not even hashed.** Proof of correctness is
  that AES-GCM authenticates. There is no extra material to steal and grind
  offline.
- The signing passphrase is deliberately distinct from the account password, so
  a hijacked session cannot sign.
- The public key is copied into every signature, so rotating or revoking a key
  never makes an already-valid letter look forged.
- Request kind (`ENROLLMENT` vs `RENEWAL`) is decided **server-side** from key
  state, so a client cannot pass off an expired key as a renewal and skip the
  re-check that the expiry exists to force.
- `grantedDays` is chosen by the approver per request, not a global constant.
- `assertCanSign` refuses: no key, locked, revoked, pending approval, expired.
- Failed-attempt lockout with a countdown surfaced to the user.
- Owner UI is complete: request, renew, activate, change passphrase, days
  remaining, lock state. Super-admin approve/reject UI exists.
- Dedicated migrations exist (`20260723090000_letter_esign`,
  `20260723100000_esign_lifecycle`).

### 3.2 The letter flow

Well aligned with ANRI's tata naskah dinas:

- Four-level security classification (Biasa / Terbatas / Rahasia / Sangat
  Rahasia) and an archive classification code (`FilingClassification`).
- Separate incoming/outgoing agendas, per unit, per academic year, Roman-numeral
  month format.
- **Drafts do not burn a letter number** — a number is issued only when the
  status is not `DRAFT`, which keeps the buku agenda gapless. The number is
  generated *inside* the transaction, so a rollback cancels the increment.
- Tiered paraf with turn order enforced; every non-signer reviewer must approve
  before the signer may sign.
- `SELECT … FOR UPDATE` row locking with re-verification inside the transaction.
- Append-only `LetterFlowEvent` audit trail.
- Multi-recipient disposition with instruction, deadline, result notes,
  `completedAt`, and **hierarchical disposition** via `parentDispositionId`.
- Archiving closes the chain, with authority checks.

---

## 4. Where the signature stands against law and standards

Not legal advice — confirm with the yayasan's counsel before ijazah are signed
electronically. This mapping is for the engineering decision.

### 4.1 UU ITE Pasal 11 ayat (1)

| Condition | Status |
|---|---|
| a. creation data linked only to the signatory | ✅ |
| b. creation data solely under the signatory's control | ⚠️ the key lives on our server, opened by a passphrase. Defensible — commercial PSrE sign server-side too — but weaker than an HSM |
| c. alterations to the signature detectable | ✅ |
| d. alterations to the signed information detectable | ✅ content digest |
| e. a means to identify the signatory | ⚠️ internal only; no certificate binds the key to a verified identity |
| f. a means to show the signatory consented | ✅ passphrase entry |

Under **PP 71/2019 Pasal 60** this is a **Tanda Tangan Elektronik Tidak
Tersertifikasi**: valid and admissible, but the burden of proving validity falls
on whoever relies on it. A **Tersertifikasi** signature — one using a
certificate from an Indonesian PSrE — carries a much stronger presumption.

### 4.2 International practice

What DocuSign, Adobe Sign, and the Indonesian PSrE (BSrE, Privy, VIDA, Peruri,
Digisign) all do, and where we stand:

| Element | Standard | Cipansor today |
|---|---|---|
| Signature **inside** the PDF (signature dictionary, ByteRange, PKCS#7/CMS) | PAdES — ETSI EN 319 142, ISO 32000-2 | ❌ stored in the database |
| X.509 certificate from a trusted CA | RFC 5280 | ❌ raw keys, no certificate |
| Trusted timestamp | RFC 3161 | ❌ `signedAt` is issuer-controlled |
| Offline verification in any PDF reader | PAdES B-B | ❌ requires uploading to our site |
| Long-term validation data | PAdES B-LT / B-LTA | ❌ |

**The practical consequence:** when a santri presents a surat keterangan to a
bank, a receiving school, or a Kemenag office, the recipient cannot verify it
themselves. Adobe shows nothing. They must trust us and visit cipansor.or.id.

### 4.3 The tiers, and the recommendation

- **Tier 1 — make the PDF prove itself.** Fix §2.2–§2.4, then embed the
  signature as **PAdES B-B** plus an **RFC 3161** timestamp. *Deferred
  2026-09-29 (option b) pending a TSA provider — see PR-5.* This requires one
  crypto change: **Ed25519 must give way to RSA-3072 or ECDSA P-256** for the
  PDF layer, because EdDSA in CMS (RFC 8419) is effectively unsupported by
  Acrobat. A self-signed certificate is fine at this tier.
  > **Corrected 2026-09-29:** the premise is half wrong. ETSI TS 119 312
  > V2.1.1 (2026-06) Table A.1 lists EdDSA as *shall support* for AdES users, so
  > **Ed25519 is a conformant PAdES algorithm**; it is **AATL** that omits it.
  > The switch is for Acrobat/AATL interoperability, not a PAdES requirement.
  > See `decisions/esign-standards-ceiling.md`.
- **Tier 2 — certification.** Obtain certificates from **BSrE (BSSN)**, the
  standard route for naskah dinas at institutions under Kemenag, or from a
  commercial PSrE via API. Once the signature is *inside* the PDF, swapping a
  self-signed certificate for a BSrE one is a credential change, not an
  architectural one — **so Tier 1 is not throwaway work.**
- **Tier 3 — PAdES B-LT/B-LTA**, for ijazah and syahadah that must still verify
  in twenty years.

Upload verification behind an anti-bot gate (§1) **stays at every tier**: it
closes the content-substitution hole, which PAdES alone does not.

---

## 5. The plan

Six pull requests, each reviewable on its own. Order is deliberate.

### PR-1 — Recover the feature, and make the PDF honest
Move `e93a7cf2` onto `main`, taking `main`'s side for every dependency, CI and
Zod hunk. Then fix §2.2 (multi-page, logo, Unicode font, signature-block
overlap) and §2.3 (move the hash inside the transaction or fail the signing),
and remove the token endpoints of §2.6. Keep `complaints.controller.test.ts`.

*Done when:* a two-page letter renders in full with selectable text and the
lambang; an Arabic letterhead does not throw; no path produces a `SIGNED` letter
with `pdfHash = NULL`; the deleted test suites are still present and green.

### PR-2 — Revocation (§2.5) — **SHIPPED** (PR #436)
Route and UI to revoke a signing key; endpoint, service, authority rule and UI
to revoke a letter signature, with the reason surfaced on the public page.

*Done when:* a super admin can revoke a key and a signed letter from the app,
and the public verification page reports the revocation and its reason.

*Security-operational — bring this forward if anything is ever compromised.*

**What shipped, and the decisions inside it:**

| Decision | Why |
|---|---|
| `GET /esign/keys` + a key-holder card on `/settings/esign` | The revoke route already existed and nothing called it. It could not be called from a UI because no page listed the holders — so the inventory is not a nicety, it is the precondition. |
| Revoking a key reports the letters signed with it | Mercifully, revoking a key does **not** invalidate letters already signed — each signature stores its own copy of the public key. That is right for a departing official and wrong for a leaked passphrase, so the count and the list come back with the response and the admin is told to revoke those signatures one by one. Matched on `publicKey`, not just `signerId`: the same person may have held an earlier key. |
| `POST /esign/letters/:id/revoke` is **not** `isSuperAdmin` | A signer withdraws their own signature. Authority is checked in the service against the signature row, which is the only place that knows who signed *this* letter. `esign.routes.test.ts` pins both halves — that the route exists without the Super-Admin guard, and that it is still behind `authenticate`. |
| No passphrase to revoke | Revoking produces no new cryptographic assertion; it withdraws an old one. Demanding the passphrase would block exactly the case the feature exists for — a passphrase that leaked, or an official who has gone. |
| The letter's `status` is left alone | It really was signed and really did circulate; sending it back to DRAFT erases that from the buku agenda. Validity lives on the signature, and `LetterFlowAction.SIGNATURE_REVOKED` records the act in the letter's own history. |
| Reason ≥ 10 characters, trimmed before storing | It is **public text** — shown as written to anyone who uploads the PDF. Zod's `min()` passes ten spaces, so the length is re-checked after trimming in `utils/esign-revocation.ts`, and both dialogs warn the writer before they type. |
| A revoked letter can no longer be printed | The generator drops the signature block once revoked, so a fresh download is a *different* file with a hash the database has never seen — and the public page would answer it with the sentence a forgery gets. Copies already in circulation still verify and still report the revocation, because they carry the bytes that were hashed. |
| Neither key nor signature can be revoked twice | The second revocation would overwrite the first date and reason — and the first is the one that answers "since when". |

**Correction, 2026-09-29 — the row above was half wrong.** "Copies already in
circulation still verify" held; *downloads made after revocation* did not. The
download path stamps the archived copy with `stampRevoked`, so its bytes differ
from the signed `pdfHash`, and `verifyByPdfBuffer` — which looks the upload up
by that hash — answered the system's own stamped copy with the forgery
sentence. The sentence the row describes is exactly what it got. Closed by
`utils/letter-revoked-copy.ts`: when the hash matches no signature, the stamped
copy is **recomputed** from the archived bytes (`stampRevoked` is deterministic
— the archive, reason, date and revoker name are all fixed once recorded) and
matched against the upload; a hit routes through `verifyByToken`, so the page
reports *"dicabut"*, not *"tidak terdaftar"*. Nothing in the uploaded file is
trusted: a hand-stamped "DICABUT" recomputes to a different hash and still gets
the forgery sentence. A no-archive revoked letter (archived before
`db:archive-letters`) is still not recognised here — the archived path is what
makes the match exact.

Schema, additive only: `UserSigningKey.revokedById` (accountability parity with
`LetterSignature`, which already had it) and `LetterFlowAction.SIGNATURE_REVOKED`.

### PR-2b — Authority, proof, and the AATL read

Revised 2026-09-02 after the yayasan pushed back on the authority rule and sent
the **Adobe AATL Technical Requirements v2.0**. Three sources were checked
against each other; they agree, and they all disagreed with what PR-2 first
shipped.

**Who may revoke.** Authority to revoke follows authority to *issue*.

| Source | Rule |
|---|---|
| ANRI, tata naskah dinas | *"Pejabat yang berhak menetapkan perubahan, pencabutan, dan pembatalan adalah pejabat yang berwenang menetapkan naskah dinas tersebut."* A regulatory naskah must be withdrawn by one of equal or higher level. |
| RFC 5280 / BSrE | Only the issuer revokes. The certificate owner *requests*, in writing with a reason; the issuer decides. |
| DocuSign / Acrobat Sign | Only the sender may void. The **signer specifically cannot** — they may only decline to sign. |

So `signer OR SUPER_ADMIN` was wrong in both directions. Super Admin is a
*technical* role; an IT administrator annulling the Ketua's SK is what none of
the three permits. And signer-only would leave a wrongly issued SK valid forever
once its signer stops holding office.

The rule now, in `packages/shared/src/types/letter-revocation-authority.ts`:

| Actor | May revoke |
|---|---|
| Anyone | their own signature |
| **Pengawas Yayasan** | own + Pengurus + every unit office |
| **Pembina** | own + any naskah signed by a Pembina (succession in office) |
| Ketua / Sekretaris / Bendahara | own only |
| **Super Admin** | **nothing** — keys and certificates only |

Annulling what the Pengurus issued is a *supervisory* act, not an executive one,
so it sits with the Pengawas. Putting it on the Ketua would have the executing
organ annul its own work — the separation UU 16/2001 jo. UU 28/2004 Pasal 29
exists to prevent. Pembina succeeds its own office because there is no organ
above it to appeal to.

**Everyone else gets a channel, not a wall.** `LetterRevocationRequest`: anyone
who may read the letter may ask, with a reason and an optional attachment; the
authorised officer decides on the letter's own page. The clerk who spots the
duplicate number is rarely the officer who may annul it.

**Revoking now takes a passphrase, and is signed.** The first version reasoned
that "revoking makes no new cryptographic assertion". That is wrong: a CRL is a
signed, timestamped data structure (RFC 5280). The revoker signs the statement —
binding signature, letter, revoker, office, time and reason — with **their own**
key, so a leaked passphrase or a departed official blocks nothing, a live session
alone cannot withdraw an official letter, and the public page *proves* the
revocation instead of asserting it. Editing the reason afterwards invalidates it.

**A revoked naskah is stamped, not withheld.** DocuSign watermarks a voided
document and keeps it downloadable; refusing the download left the office unable
to file a copy. The naskah is rebuilt as it stood when signed, re-hashed, and
stamped only once the hash matches `pdfHash` — so circulated copies keep
verifying and keep reporting the revocation. A mismatch means the bytes have
drifted since signing (§2.4) and printing is refused, honestly.

**Reason codes (RFC 5280 §5.3.1), on key revocation.** AATL ICA6(a) enumerates
three different situations with three different consequences, and only
`KEY_COMPROMISE` makes previously signed letters doubtful. Without the
distinction an operator has two equally wrong options: revoke a dozen sound
letters, or leave letters signed with a leaked key standing. Not applied to
letters: withdrawing a naskah is an administrative act, and ANRI's form for it is
the written reason.

### What AATL asks that we cannot meet, and should not pretend to

AATL is a programme for **certificate authorities**, not for signing
applications. Membership needs a WebTrust or ETSI EN 319 411 audit every two
years (G2), FIPS 140-2 Level 3 HSMs for the ICA key (ICA4), face-to-face
identity proofing (ICA5a), and a contract with Adobe. The yayasan is not going
to be an AATL member, and building toward that is the wrong goal.

What the document is genuinely useful for is as a checklist of what a serious
deployment looks like:

| AATL | Here | Verdict |
|---|---|---|
| **EE1/EE2** X.509 v3 per RFC 5280, KeyUsage + EKU | no certificate at all, just a raw public key | Needed before any PAdES signature Acrobat will trust |
| **EE4(b)** RSA ≥ 2048 or EC ≥ 256 | **Ed25519** | ⚠️ **Ed25519 is not on AATL's list** (AATL is a CA programme, not PAdES). It *is* a conformant PAdES algorithm — ETSI TS 119 312 V2.1.1 Table A.1 lists EdDSA as *shall support*; what is thin is RFC 8419 EdDSA-in-CMS support in *Acrobat*, a validator gap. A migration only for Acrobat/AATL interoperability, not a PAdES requirement. See §4.3 correction. |
| **EE3** RFC 3161 timestamp; embedded revocation info for LTV | none | **The highest-value single item.** Without a timestamp there is no answer to "was the key valid *at the time of signing*", which is exactly what revocation semantics need. Already PR-5. |
| **EE4(c)** private key in FIPS 140-2 L2 hardware | scrypt + AES-GCM in the application database | Out of reach; state it plainly rather than imply otherwise |
| **ICA5(a)** identity proofing before issuance | Super Admin approves a request in the app | **Cheap and worth doing**: record *how* identity was verified at approval. It is the difference between "an admin clicked approve" and "the Ketua checked the KTP in person on this date" — and that difference is what PP 71/2019 weighs when distinguishing *tersertifikasi* from *tidak tersertifikasi*. |
| **ICA6(a)** immediate revocation on suspected compromise | key revocation, now with reason codes | Met |
| **ICA7** published status for enquiring about validity | ~~a database column~~ **met** — `GET /esign/public/key-status?fingerprint=…` answers the state of a *key* (active / expired / revoked with its reason code) from the fingerprint printed on every verification page. Deliberately about the *key*, never the document, so it cannot become the token oracle §1 exists to retire |

**Standing conclusion:** the signature here is *tanda tangan elektronik tidak
tersertifikasi* under PP 71/2019, and every improvement above still leaves it
that way. Becoming *tersertifikasi* means using a PSrE (BSrE, Privy, VIDA,
Peruri, Digisign) — a procurement decision, not an engineering one. What the
work above buys is a system that behaves correctly at its own tier, and one that
a PSrE could be dropped into later without redesigning the flow around it.

### PR-3 — Archive the signed PDF bytes (§2.4) — **SHIPPED** (PR #437)

`LetterSignedDocument` holds the exact buffer that was hashed, written inside
the signing transaction alongside `pdfHash` — for the same reason the hash is
written there: a letter that is SIGNED but whose bytes were never stored cannot
be reprinted as itself, and that is not a state to let through quietly.

A **separate table, not a `Bytes` column on `LetterSignature`.** A blob column
is pulled in by every query that omits `select`, and sits on the same pages as
the columns the letter list reads. The archive is read only when the file is
actually asked for.

`resolveLetterPdf` (`modules/correspondence/signed-pdf.ts`) is now the single
answer to "what bytes are this letter's PDF":

- **Signed and archived** → the archived bytes, verbatim. The naskah is never
  re-rendered. The archive checks itself first (`sha256` against both its own
  column and the signature's `pdfHash`) and refuses rather than hand out a
  corrupted file that the public page would then report as a forgery.
- **Signed before the archive existed** → the old regenerate path, with the old
  guard intact: a DICABUT copy is printed only if today's bytes still match
  `pdfHash`.
- **Unsigned draft** → rendered, as before.

`prisma/scripts/archive-signed-letters.ts` (`pnpm --filter api db:archive-letters`,
`--dry-run` supported) backfills the historical letters — but only those whose
bytes still reproduce exactly. Letters that have already drifted are reported,
not archived with the wrong bytes: those bytes are not what was signed, and
storing them as if they were would forge the archive.

`LETTER_PDF_GENERATOR` travels with every archived row, so bytes that can no
longer be reproduced can still be attributed to the build that made them. **Bump
it in the same commit as any change to the PDF output.**

*Done when:* a `pdf-lib` upgrade no longer invalidates historical letters.
`signed-pdf.test.ts` proves both halves in one test — that a change to what the
generator emits really does break the hash, and that the archive keeps serving
the bytes that were signed regardless.

### PR-4 — Flow completeness (§2.7 a, b, d) — **SHIPPED**

Three gaps, one theme: the schema described a letter's life more completely than
any code ever filled in.

**a. Dispatch.** `LetterDispatch` is a buku ekspedisi, not a flag — date,
channel (diantar / kurir / pos / surel / WhatsApp), who received it, nomor resi,
tanda terima. When the addressee says the letter never arrived, those are the
five answers, and a boolean gives none of them. `POST /letters/:id/dispatch`
writes one, moves the letter to `SENT`, and sets `Letter.sentAt` — **on the
first dispatch only**, because a letter leaves the office once even when it is
carried to three addresses or re-sent after going astray; every attempt keeps
its own row.

`assertMayDispatch` refuses three things, each for its own reason: an incoming
letter (received, never sent — that inversion is what this PR removes), an
unsigned naskah (nothing to hand over yet), and a withdrawn one (the copies
already circulating are history and still print stamped, but sending a fresh
copy of a retracted letter is a new act).

And the inversion itself: review completion on an **incoming** letter with no
disposition recipients set `SENT`. It now archives the letter, which is what
actually happens to a surat masuk that has been read and needs no follow-up —
recorded as its own flow event so the history says who closed it and why.

**b. Tembusan.** `isCC` had exactly one writer in the entire codebase, the
hardcoded `isCC: false` at letter creation. A column that is never true is not a
column. Tembusan can now be chosen on the form, is stored, is listed on the
letter page, and prints as a numbered `Tembusan:` block at the foot of the last
page — below the signature block, because it describes circulation, not content.
Anyone already a primary recipient is not also recorded as a copy recipient.

**c. Lampiran.** There was no attachment table, so the naskah's "Lampiran" line
was permanently `-` and was accidentally correct. `LetterAttachment` keeps name,
URL, type, size and order; the header line prints `Lampiran : 2 (dua) berkas`,
with the count in figures *and* words for the same reason a kuitansi does it.

**The byte-stability constraint, and how it was kept.** Changing the generator's
output invalidates every letter signed before the change. Both additions are
therefore conditional: a naskah with no lampiran and no tembusan emits exactly
the bytes it emitted before. `generate-letter-pdf.test.ts` pins that SHA-256 —
captured from the pre-change build — so the guarantee is checked rather than
asserted. `LETTER_PDF_RELATIONS` is the second half of the same problem: the
signing path, the download path and the backfill script now read the letter's
relations from one shared constant, because a path that forgot `attachments`
would render a different document from the same letter and report a valid letter
as altered.

**Also fixed here:** a `WorkflowError` reached the client as a **500 "Internal
server error"** in production. Every one of these rules was written to explain
itself — "belum giliran Anda, menunggu verifikator urutan 2" — and the
explanation was discarded one step before it was read. They now answer 409 with
their own message.

*Done when:* an outgoing letter can be recorded as dispatched with a tanda
terima, a letter can carry tembusan and lampiran end-to-end, no incoming letter
is ever labelled "Terkirim", and a letter signed before the change still
verifies. ✅

### PR-5 — PAdES B-B + RFC 3161 (§4.3 Tier 1)

**Deferred 2026-09-29 (option b).** The yayasan weighed doing it now (a),
deferring (b), and a local-timestamp PAdES B-T (c), and chose **(b)**. Without
an **RFC 3161 TSA endpoint** — which the yayasan must procure — embedding the
signature adds dependencies (a CMS/PKCS#7 builder, an X.509 certificate, the
byte-range plumbing) but no evidential value, because it is the timestamp that
answers "was the key valid *at the time of signing*", the whole point of
revocation semantics. The current form (detached Ed25519 over the PDF byte
hash, signed bytes archived, verification by upload) is valid under **UU 11/2008
jo. UU 19/2016 (UU ITE) Pasal 11** and proven end to end. Revisit when the
yayasan picks a TSA provider
(BSrE/Privy/VIDA/Peruri/Digisign) or decides on PSrE certification — and then
Ed25519 may stay, since the algorithm swap is an Acrobat interoperability
choice, not a PAdES requirement. See
`decisions/esign-standards-ceiling.md`.

**What it would take (for the record).** Embed the signature in the PDF
(PAdES B-B, ETSI EN 319 142-1) and bind a trusted time (RFC 3161). Requires a
CMS/PKCS#7 SignedData container over the byte range and a TSA client; it does
**not** require the RSA/ECDSA switch (ETSI TS 119 312 V2.1.1 Table A.1 lists
EdDSA as *shall support* — see the correction in `decisions/esign-standards-ceiling.md`).

> **Scoped, not built.** `pdf-lib` can embed a signature dictionary, but it does
> not build CMS, and the repo has no PKCS#7 or ASN.1 library. A real B-B needs
> that dependency, the byte-range digest plumbing, and a TSA endpoint the
> yayasan must obtain. The RSA/ECDSA switch is an *interoperability* choice
> (Acrobat validation), not a PAdES requirement.

### Also fixed while walking the flow (PR #436)

Rendering every page at every stage found defects no diff review would:

- `DispositionTimeline` read `disposition.senderName[0]`; the API sends
  `sender: { name }`. The DTO declared the flat field, so TypeScript passed and
  `undefined[0]` blanked the **whole letter page for every disposed letter**.
- `LetterReviewerDetail.reviewerName` — same defect, silent: the "Status Review"
  panel printed no name at all.
- `/e-office/outbox` re-rendered the inbox component, whose direction is
  internal state starting at INCOMING → **the outbox showed the inbox**.
- Urgency named three different ways; the dashboard shifted every letter one
  step (IMMEDIATE→"Penting"). One `LETTER_URGENCY_LABELS` now.
- A column headed "Sifat" displayed urgency.
- `REVISION_NEEDED` was terminal in the UI: `resubmit` existed in the API and
  nothing called it.
- `/e-office/archive` 404'd from the module's own landing tile; `dead-links.test.ts`
  scanned `href=` only. Widened to `router.push` → 27 more pre-existing dead
  targets recorded as backlog (13 are `/paud/…` pushed from `/tk/…`).
- `limit: 10` with no pagination controls: letter 11 was unreachable.
- The naskah's letterhead printed the yayasan name **twice** for its own letters,
  and single newlines inside a paragraph were collapsed — so the
  `Nama : … / Nomor Induk : … / Kelas : …` block of every surat keterangan
  printed as one run-on paragraph. Both only visible once the PDF was rendered
  and read; `generate-letter-pdf.test.ts` now reads the text layer (inflating
  Flate streams and decoding hex strings) instead of only hashing bytes.

### PR-7 — Arabic and Unicode in the naskah

**Requested 2026-09-02. Not a patch — it needs a font, a shaping engine and a
build change, which is why PR-1 refused the input instead of half-rendering it.**

Today `generateLetterPdfBuffer` uses `StandardFonts.TimesRoman` and friends,
whose repertoire is WinAnsi. PR-1 added `assertRenderable`, which rejects a
naskah containing anything outside it and names the offending characters. That
is the honest floor — before it, `pdf-lib` threw from deep inside, the throw was
swallowed, and the letter was signed but permanently unverifiable — but it means
a pesantren cannot put a Qur'anic quotation or an Arabic bismillah in a letter
body, which is a real limitation for this institution.

What full support actually requires, in order:

1. **An embedded Unicode font.** `@pdf-lib/fontkit` plus a TTF/OTF. Two faces are
   needed: a Times-metric Latin face (Tinos or Liberation Serif, both
   open-licensed) and an Arabic face (Noto Naskh Arabic). Subset them — a full
   Noto Naskh is ~500 KB and every letter would carry it.
2. **A shaping engine, which pdf-lib does not have.** Embedding the glyphs is not
   enough: Arabic needs contextual joining (a letter's form depends on its
   neighbours) and bidirectional reordering. Without it the text renders as
   isolated letters in left-to-right order — wrong in a way that looks like
   nonsense to a reader of Arabic, and worse than refusing. The realistic
   options are `harfbuzzjs` (WASM, does real shaping) feeding positioned glyphs
   to pdf-lib, or replacing pdf-lib for this document with a renderer that
   shapes natively.
3. **A build change.** The API image stages only `dist` and `node_modules`, so a
   font file needs either a Dockerfile step or the base64-in-source treatment
   used for the lambang (`apps/api/src/assets/logo-cipansor.ts`). At subset
   sizes the latter stays viable and keeps the bytes frozen, which matters —
   see below.
4. **A hash-stability decision.** Changing the font changes every rendered byte,
   so every letter signed before the change fails public verification and is
   reported as altered. This must land *after* PR-3 archives the signed PDF
   bytes, or it silently invalidates the archive. **PR-7 is blocked on PR-3.**

Scope note: the letterhead itself is Latin-only today, so this is about letter
*bodies*. If the yayasan wants an Arabic kop surat, the cheaper answer is to put
the calligraphy in the lambang image — it is an image by nature, and needs no
shaping at all.

*Done when:* a letter whose body contains an Arabic sentence renders with correct
joining and right-to-left order, verifies after upload, and a letter signed
before the change still verifies.

### PR-6 — Structured signing authority (§2.7 c)
a.n. / u.b. / Plt. / Plh. as a modelled rule.

**Blocked on a governance decision, not on engineering:** who may sign on whose
behalf, and under which of those forms. Needs the yayasan's answer first.

### PR-4b — Tembusan that can actually be composed — **SHIPPED**

PR-4 shipped tembusan as a checkbox list of system users. Two things were wrong
with that and both came from the same mistake — treating a printed, numbered
list as a set membership question.

**Most tembusan are not system users.** A naskah dinas routinely copies the
Kepala KUA, the Ketua RW, a dinas — parties with no account here and no reason
to have one. `LetterRecipient.externalName` holds those; a row now carries a
`userId` **or** an `externalName`, never both. The distinction is real, not
cosmetic: an internal tembusan is genuinely delivered (the recipient is
notified and can open the letter, since a CC row already grants read access),
while an external one is only printed and carried by hand. The form says so
rather than leaving the drafter to assume.

**A checkbox list has no order.** Tembusan prints as a numbered list, and the
numbering conventionally descends by seniority with internal and external
parties interleaved — an order no checkbox list can express, since it follows
whatever the participant search returned. `LetterRecipient.order` stores the
drafter's order, and `TembusanEditor` lets them add, remove and move rows.

`PUT /letters/:id/tembusan` replaces the whole list — because the order *is*
part of the content, and per-row add/remove endpoints still could not reorder.
It refuses once the letter carries a signature: the tembusan is printed at the
foot of the naskah and those bytes are archived (PR-3), so a list that could
change afterwards would name copies that do not appear on the sheet people are
holding.

**Found while rendering the editor:** `LetterRecipient.unitId` was commented
*"Penerima Unit"*, and it has never held one. Its only writer fills it with the
letter's **issuing** unit, so a name-resolution fallback of
`user.name || externalName || unit.name` could only ever print *the yayasan's
own name as a recipient of its own tembusan*. The fallback is gone from both the
generator and the shared helper, the relation is no longer fetched for the PDF,
and the column's comment now says what it actually holds. A screenshot found
this; no diff review would have.

---

## 5b. Three questions asked on 2026-09-03, and what the standards say

These were asked as *"consider whether this is a good idea"*, so the answers are
recommendations with their reasoning, not a work order.

### (a) Two authoring tracks — **worth building, with conditions** — **step 1 SHIPPED (#454)**

The proposal: let the drafter choose between (1) downloading a pre-filled DOCX
template, editing it in Word, exporting to PDF and uploading that, or (2) typing
into the form and letting the system generate the PDF, previewable before it is
sent.

**This is what ANRI's own national application does.** SRIKANDI accepts **DOCX**
for naskah keluar and PDF for naskah masuk, and its Admin Unit Kearsipan uploads
DOCX templates matching the institution's tata naskah. Its roles — penerima
utama, penerima tembusan, verifikator, penandatangan — are the same four this
system already has.

What track 1 buys, beyond convenience:

- **It solves PR-7 for most cases, for free.** A drafter who needs an Arabic
  quotation writes it in Word and exports. That removes the need for harfbuzzjs
  shaping and an embedded Noto Naskh subset from the critical path — weeks of
  work, avoided by a track that has other reasons to exist. PR-7 stops being a
  blocker and becomes an optimisation for track 2.
- Real layout freedom: tables, multi-column lampiran, the elaborate diktum of a
  long SK — things the generator would otherwise have to grow into a word
  processor to support.
- **No LibreOffice in the API image.** The drafter converts to PDF themselves,
  as proposed. Server-side DOCX→PDF would add ~400 MB and a whole class of
  rendering drift.

What it costs, stated plainly:

- **The buku agenda's metadata can disagree with the document.** Nothing can
  detect a form that says *Perihal: Undangan Rapat* above an uploaded PDF that
  says something else. This is not a cryptographic problem — the bytes are still
  hashed, signed and archived — it is a records problem, and the only control is
  that every reviewer in the ladder and the signer see the actual PDF before
  they act. They already do. Say this out loud in the UI rather than implying
  the two are linked.
- **The letter number.** A number is issued only when the letter leaves DRAFT,
  so a template downloaded from a draft cannot carry one. Offer the template
  download only after submission, or mark it `[NOMOR DIISI SISTEM]` — do not
  stamp a number onto an arbitrary uploaded layout, which is fragile in exactly
  the way that matters.

Therefore: build it, but **record the track on the letter** (`GENERATED` vs
`UPLOADED`) and show it on the public verification page. "This naskah was
produced by the system" and "this naskah was uploaded by its drafter and sealed
on receipt" are different assurances, and a verification page that blurs them is
worse than one that admits the difference.

#### What #454 shipped, and the defect it found on the way

`Letter.authoringTrack` exists, defaults to `GENERATED`, and is returned by
public verification and printed on the verification page with the sentence that
belongs to it — the `UPLOADED` sentence says outright that the agenda metadata
is vouched for by the reviewers and the signer, not by any automatic check.
Every existing row is `GENERATED`, and that is a demonstrable statement rather
than an assumption: `generateLetterPdfBuffer` is the only source of signed
bytes anywhere in the system.

The enum now exists twice — once in `schema.prisma`, once in `@cipansor/shared`
so the browser bundle need not import Prisma — with nothing in the type system
tying them together. `letter-authoring-track.test.ts` ties them instead, and it
was proved red by deleting `UPLOADED` from the shared copy before it was
trusted. The failure it prevents is not a compile error but a public page that
falls over on a value the database considers ordinary.

**The defect.** The create-letter form offers *"Upload File Naskah (PDF)"* with
no direction condition, so it appears on surat keluar. The letter page rendered
that file as **"Berkas naskah"** and previewed it under **"Pratinjau Naskah"**.
The signing path has never read it. So an outgoing letter could carry two
documents — the drafter's upload and the system's rendering — presented with
equal weight, where only the second is hashed, signed, archived, and matched
when someone verifies a copy. Nothing said which was which.

This is the same records problem the section above predicted, arriving through a
door nobody was watching: not "the metadata may disagree with the uploaded PDF"
but "the uploaded PDF is not the letter at all". Renaming it to *Berkas unggahan
penyusun*, with a line saying plainly that the signed naskah is the one behind
*Cetak Surat*, costs nothing and removes the ambiguity today. The label
disappears by itself once the track is real — an `UPLOADED` letter's file *is*
its naskah, so the condition stops matching.

**Signed bytes (shipped).** The signing path now reads the drafter's file for an
`UPLOADED` letter and signs **those** bytes, not a system rendering of the same
metadata. The TTE visualisation is stamped onto the drafter's own layout —
QR code, "Ditandatangani secara elektronik", the signer's name and jabatan, on
the last page's right margin — because we do not know where the signature block
stands on someone else's page, and guessing would print it across a sentence.
The stamp is part of the hashed bytes, so removing it voids the signature. The
line-authority block (a.n./u.b./Plt./Plh.) and the tembusan are **not** stamped:
they belong to the drafter's layout, and their values are still signed and still
read on the public verification page.

Serving follows the same track: a signed `UPLOADED` letter is served from its
archive, never re-rendered; a signed `UPLOADED` letter whose archive is missing
is refused rather than re-rendered (the signed bytes cannot be reproduced); and
an unsigned `UPLOADED` letter previews the drafter's file as-is. The archive's
`generator` marker records `+unggahan` so the origin is legible without opening
the PDF. What is left of this line of work is the **pre-filled DOCX template** to
start from — the letter is still composed outside the system.

### (b) Replacing the QR with an e-sign logo — **do not replace it; improve it**

The Indonesian rule runs the other way. Guidance derived from BSSN/BSrE states
the visualisation is **minimally a QR code plus the signer's name and jabatan**,
and Salatiga's Perwal 55/2021 puts it flatly: *"bentuk visualisasi TTE adalah
dengan QRCODE"*. Marks like Kejaksaan's `#KEJAKSAANDIGITAL` are programme
branding that sits *with* the QR, not instead of it. Dropping the QR would move
away from the standard while looking more official.

Three changes that are worth making, though:

1. ~~Our QR encodes a bare token, so scanning it opens nothing.~~ ✅ **Shipped
   (#446).** It now encodes the verification page address, with **no token in
   the link** — a tokenised link could only say "some letter was signed", which
   is the oracle §1 removed. Proved by decoding a 250 dpi render with jsQR
   rather than by looking at it.
2. ~~Put the yayasan lambang in the centre of the QR.~~ ✅ **Shipped (#446)**,
   at error-correction H, on a white pad.
3. ~~Reconsider printing `NIP.` in the signature block.~~ **Decided
   2026-09-03: removed.** NIP no longer prints on the naskah and is no longer
   returned by public verification — it is internal information, and every
   circulating sheet that carried it was one more copy of someone's employment
   number. It stays on the authenticated letter page, which is what "internal"
   means. This changes the bytes for any letter whose signer had a NIP, so
   `db:archive-letters` must run **before** the change reaches production.

And the footnote. Official practice prints something like *"Dokumen ini telah
ditandatangani secara elektronik menggunakan sertifikat elektronik yang
diterbitkan oleh Balai Sertifikasi Elektronik (BSrE), BSSN"*. **We must not copy
that wording**, because it would be false: these keys are the yayasan's own, not
a PSrE's. Ours has to name what it actually is — see §4.3 on the tier we are on.

### (c) Segel elektronik (e-seal) — **right idea, wrong moment; but respect its ordering now**

PP 71/2019 defines a Segel Elektronik as an electronic signature used by a
**badan usaha or instansi** to guarantee the authenticity and integrity of a
document. Where a signature carries a person's assent, a seal carries the
organisation's origin — and it can be applied automatically, with no human in
the loop.

Three facts from BSrE's *Petunjuk Teknis Manajemen Segel Elektronik* v2.0 change
the architecture, so they are worth writing down even though we will not
implement it yet:

- **One seal per document**, with zero, one or many signatures.
- **The seal must be applied first, then the signatures**, if the result is to
  validate as a seal under Adobe's rules — and if the seal is invisible, the
  signatures must be invisible too.
- A seal is only usable inside an integrated application, precisely because
  nobody presses a button for it.

Why not now:

- BSrE's issuance path runs through a **Verifikator Instansi** with an
  `email dinas`. A yayasan is not an instansi; this door is closed. A commercial
  PSrE would be the route, which is the same gate as Tier 2 in §4.3.
- Building an *in-house* seal with our own keys would add a second uncertified
  cryptographic artifact that proves exactly what the first one already proves.
  It doubles what has to be explained to a reader without doubling what can be
  demonstrated to one.

Its real use case is a document **issued with no human signer** — a surat
keterangan aktif generated on request, a transcript, a machine-issued
attestation. This system cannot issue such a letter today; every naskah has a
signer. When that changes, or when a PSrE certificate exists, the seal becomes
the right answer.

**What to do now:** nothing, except keep the pipeline order sealable. The moment
a seal exists it belongs between "the PDF is final" and "the hash is computed",
which is where PR-3 already computes `pdfHash`. No abstraction is needed — only
the discipline not to design anything that puts signing before finalisation.

---

### PR-5b — Identity behind a key, and the identifiers a seal would need — **step 1 SHIPPED**

Steps 1 and 2 below are built: `UserIdentity` holds the legal name, NIK, place
and date of birth; `POST /esign/me/request` refuses an applicant whose identity
is incomplete or unverified **and names what is missing**; approving a request
is the moment a Super Admin states *how* the identity was checked
(`IdentityVerificationMethod`), and that statement — not a scan — is what is
kept. Editing any of the four fields clears the verification, because what an
approver attested is *that* data, not that the person was once checked.

Two things fell out of building it. `LetterRecipient`-style thinking applies to
NIK too: it is `@unique`, so one NIK cannot underwrite two signing accounts —
otherwise revoking one key leaves the other, claiming the same person, still
signing. And **the NIK encodes the birth date** (digits 7–12, with the day + 40
for women), so the two fields check each other for free: a transposed digit in
either is caught without asking anything outside. That check *warns* rather than
refuses — civil-registry errors exist, and blocking a legitimate official
because their own NIK is internally inconsistent costs more than reporting it.

**Step 3 is now built too, and the reasoning changed on the way.** Two
corrections came out of reviewing the first version:

*The verification methods were mostly unfalsifiable.* Of the three offered —
card shown in person, scan examined, known personally — two left nothing anyone
could check. An approver could pick either without doing anything, and the
record would read "because I said so". A choice that leaves no evidence shrinks
the whole gate to a click. And requiring a hundred staff across five units to
visit the Super Admin in person is not a flow anyone can run. There is one path
now: a KTP photograph uploaded through the system.

*Deleting the image at the decision was an over-correction.* It made
"show the card you checked" unanswerable — and that is precisely the question
retention exists for. eIDAS Art. 24.2(h) requires registration information to
be kept "for the purpose of providing evidence in legal proceedings", and the
CA/Browser Forum sets the figure at **seven years after the certificate ceases
to be valid**. A hash does not substitute: it can decide whether a copy is
identical, it cannot show what was examined. So a rejected request has its image
deleted immediately — no key was issued, so nothing is being accounted for — and
an approved one keeps it until `ktpRetainUntil`, computed from the key's expiry
plus `IDENTITY_DOCUMENT_RETENTION_YEARS` (default 7, lowerable by the yayasan,
and written down in one place rather than chosen implicitly).

What holds either way: **the applicant loses read access the moment the request
is decided.** They already hold their own KTP, so closing that path costs them
nothing and removes an exfiltration route from a hijacked session. Only Super
Admin can open it, through one endpoint that records every read into
`AuditLog` — because "only Super Admin can see it" is a promise that needs a
record before anyone can check it.

The files live in `apps/api/private/identity/`, mode 0600, gitignored, and on
no static route. Not tidiness: `public/uploads` is served behind `uploadsAuth`,
which its own comment calls authentication rather than authorisation — any
valid access token opens every file there. Retention is enforced by
`pnpm --filter api db:purge-identity-documents`, run periodically, because a
retention date with nothing to act on it is a date in a database while the file
stays on disk forever.

#### The original write-up

#### What the standards require

Asked on 2026-09-03, and the premise checks out against the standards on both
sides.

**A signature binds to a person only if the certificate says who.** BSrE's own
enrolment collects full name, **NIK**, phone, a **photograph of the KTP**, and a
**selfie**, and matches them against Dukcapil's population data — name, NIK,
date of birth, photo, biometrics. ETSI EN 319 412-2 gives the shape the result
takes in the certificate: the subject's `serialNumber` is
*3-character identity type + 2-character ISO country code + `-` + identifier*,
where the type is one of `PAS` (passport), `IDC` (national identity card),
`PNO` (civic registration number), `TAX` or `TIN`. For Indonesia that is:

    serialNumber = IDCID-<NIK>

**What this system binds to today is a database row.** A key is issued to a
`User` whose only identity is a name and an email. The signature therefore
proves "whoever knew the passphrase of the key we issued to user-id X" — and
nothing in the system says who X is in the world. That is the gap, and closing
it does **not** require a PSrE:

1. Store the identity a certificate would carry — legal name as on the KTP,
   NIK, place and date of birth — as a prerequisite for a signing key, not as
   optional profile decoration.
2. **Refuse the request when it is incomplete**, naming what is missing, rather
   than letting a key be issued to an unidentified account.
3. Require a **KTP photograph** at enrolment and have the Super Admin confirm
   it against the entered data before approving. That is the identity-proofing
   step, and recording *that it happened, by whom, and on what evidence* also
   closes the AATL ICA5(a) item already on the backlog.

#### Keeping the KTP: what the standards say, and the one fact that decides it

Asked 2026-09-03, weighing *delete after verification* against *keep for a
fixed period* against *delete immediately and re-check against the real KTP if
questioned*.

**The instinct to keep it matches the standard.** eIDAS Art. 24.2(h) obliges a
qualified trust service provider to *"record and keep accessible for an
appropriate period of time … all relevant information concerning data issued and
received … in particular, for the purpose of providing evidence in legal
proceedings"*. ETSI EN 319 412-5 goes further and lets a certificate **declare**
its retention period, expressed as a number of years after the certificate
expires. So "kalau nanti dipertanyakan, ada dasarnya" is not a hunch — it is the
codified reason registration evidence is retained at all. Note what the standards
do *not* do: they fix no number. Each provider states its own period in its
practice statement, which means we have to choose ours and write it down.

**The flaw in deleting immediately.** Re-checking against the signer's KTP today
proves the person exists and their data matches. It does not prove what was
presented at enrolment, which is the question actually in dispute when someone
claims a key was issued to an impostor.

**But one fact settles the shape of any answer.** `/uploads` is served by
`uploadsAuth`, which is **authentication, not authorisation** — the middleware's
own comment says so: *"any valid access token, including a santri's or a
parent's, opens every file in the directory."* Filenames are crypto-random and
that is the only separation. So *"only Super Admin may see it"* **cannot be
implemented by putting a KTP through the existing upload endpoint.** A KTP image
needs storage with per-record authorisation, or it must not be stored at all.

**Recommendation, in the order it should be built:**

1. **Ship the identity gate without the image first.** Required fields (legal
   name as on the KTP, NIK, place and date of birth), an automatic refusal that
   names what is missing, and a Super Admin who confirms the data against a KTP
   *seen* — in person, which for this yayasan is the normal case — and records
   that they did. That delivers the whole evidentiary benefit and stores no new
   sensitive image.
2. **The durable artefact is the verification record, never the image**: who
   verified, when, which fields were compared, and — if an image was uploaded —
   its SHA-256. That record is small, carries no personal data beyond what the
   account already holds, and answers the diligence question permanently. If a
   copy of the KTP is later produced by anyone, the hash settles whether it is
   the same file.
3. **Only then, if the yayasan still wants the image**, build authorised storage
   for it — outside `/uploads`, read only through an endpoint that checks the
   caller is Super Admin, with every access logged. Retention **tied to the
   signing key, not to the calendar**: delete when the key it justified has
   expired or been revoked, plus a stated tail. A key here already has a short,
   per-approval validity, so this is naturally much shorter than a guessed
   "1–2 years", and it is defensible because it is derived from what the
   evidence is *for*.

#### How long, counted from when — and whether OCR changes the answer

Asked 2026-09-03.

**The counting basis is settled, and it is not issuance.** The CA/Browser Forum
Baseline Requirements say it plainly: *"The CA SHALL retain all documentation
relating to certificate requests and the verification thereof, and all
Certificates and revocation thereof, for at least **seven years after any
Certificate based on that documentation ceases to be valid**."* Audit logs get
the same seven years. ETSI EN 319 412-5 expresses its declared retention the
same way — a number of years **after the certificate expires**. eIDAS Art.
24.2(h) sets the purpose but no number, leaving each provider to state its own.

So: **seven years is the common figure, and every standard counts it from the
end of validity, not from issuance.** Worth knowing that the proportionality of
that number is contested inside the standards bodies themselves — CA/B Forum
ballot SC28 (2020) noted that seven years of retention for a two-year
certificate is out of proportion. Our keys are shorter-lived still: validity is
granted per approval in days, so "after expiry" arrives quickly.

Applied here, the two artefacts deserve different answers:

- **The verification record: keep it for as long as the letters.** Letters are
  archived permanently, so "who was verified as this signer, by whom, on what
  evidence" has to stay answerable permanently. The record is a few fields and
  a hash — it costs nothing to keep and everything to lose.
- **The image: do not keep it at all** — for the reason below.

#### OCR: yes for the text, no for the face

**It works well enough.** Published work on Indonesian e-KTP puts Tesseract with
proper preprocessing — grayscale, Gaussian blur, thresholding, deskew, line
segmentation — at roughly 90–98% field accuracy. Two routes, and the choice
matters legally more than technically: a local WASM engine keeps the image
inside our own system (and needs no native dependency, which matters on a stack
that already cannot resolve `sharp`), while a commercial OCR API is more
accurate but makes the KTP a **transfer of personal data to a third party**,
needing its own lawful basis and a processor agreement. For a yayasan of this
size the second is disproportionate.

**The reason to do it is not accuracy — it is that OCR dissolves the retention
problem.** Reading the card turns the image into a *comparison result*, and a
comparison result is exactly the durable artefact recommended above. The flow
becomes:

1. The applicant uploads the KTP.
2. OCR extracts NIK, name, place and date of birth.
3. The system compares them field by field against what the applicant typed.
4. The Super Admin sees the match report **and** the image, once, while deciding.
5. On decision the **image is deleted**; the report and the image's SHA-256 are
   kept.

Nothing sensitive is stored long-term, so there is no retention window to argue
about and no concentrated target to protect. The `/uploads` authorisation gap
still has to be respected — the image must be readable only by the deciding
Super Admin and only until the decision — but it is a much smaller problem when
the file's life is measured in days.

**What OCR does not do: catch forgery.** Anyone submitting a fabricated KTP
submits one whose printed text matches what they typed, so the fields will
agree. Its real value is data quality and sparing the Super Admin a manual
character-by-character comparison of a 16-digit NIK. Presenting it as fraud
detection would be the same overclaim as calling a weighted sum "AI".

**Face matching the KTP photo against the profile photo: recommended against.**

1. A facial image is biometric data — *data pribadi yang bersifat spesifik*
   under UU PDP. Art. 20(2) requires **explicit consent, given separately**, not
   folded into general terms, plus layered protection and the sanctions exposure
   that comes with sensitive data.
2. What it automates is a judgement a Super Admin who knows the staff personally
   makes better, in an organisation of roughly a hundred accounts.
3. A printed KTP photograph — low resolution, often years old — matched against
   a profile photo produces false rejections, and a false rejection here blocks
   a legitimate official from signing.
4. Decisively: **BSrE's own enrolment already performs face matching against
   Dukcapil**, the authoritative population database. If the yayasan ever moves
   to a PSrE, it receives real biometric verification against the right source.
   Building our own now is building a worse version of something that would
   later arrive properly.

**On access, the proposal is right and for the right reason.** The requester
loses read-back once the decision is made: they already hold their own KTP, so
denying it costs them nothing, and it removes an exfiltration path from a
hijacked account — the threat is a leaked *user* session, not the user. Two
additions: the requester must still be able to see *that* a document is on file
and *when it will be deleted*, because UU PDP gives a data subject the right to
the record of processing; and Super Admin access must be logged, since "only
Super Admin can see it" is a promise that needs a record before anyone can check
it. NIK and an identity document sit at the sensitive end of UU PDP, so the duty
of care here is higher than for the rest of the system.

**The seal side — what identifies an organisation.** ETSI EN 319 412-1 gives
`organizationIdentifier` the same shape: *3-character legal-person identity type
+ 2-character country code + `-` + identifier*, where the type is `NTR` (national
trade register), `VAT` (VAT/tax number), or `LEI` (global Legal Entity
Identifier, always `LEIXG-`). Mapped onto a yayasan:

| Certificate field | Value for Yayasan Pesantren Cipansor | Why |
|---|---|---|
| `organizationIdentifier` | `NTRID-AHU-3039.AH.01.04.Tahun 2022` | A yayasan's national register **is** Ditjen AHU Kemenkumham, and the pengesahan badan hukum number is its entry. This is the primary identifier. |
| (alternative) | `VATID-<NPWP, digits only>` | Accepted where a tax number is the registry of record. Keep both on file; put NTR in the certificate. |
| `O` organizationName | `Yayasan Pesantren Cipansor` | The legal name **exactly as in the SK**, not the brand or the pesantren's popular name. |
| `OU` organizationalUnit | e.g. `MTs Cipansor` | Only when the seal is issued per unit. BSrE issues seals both per Organisasi and per Unit Organisasi, so the field has to exist even if unused at first. |
| `L` / `ST` / `C` | `Tasikmalaya` / `Jawa Barat` / `ID` | **A certificate carries a locality, not a postal address.** The full street address belongs in the registration record behind the seal, not in the subject DN. |

So the answer to *"alamat organisasi cocoknya bagaimana?"* is: locality,
province and country in the certificate; the full address in the yayasan's
identity record, which is what the registrar checks the certificate against.

**Found while answering this.** The naskah's letterhead printed
`SK Kemenkumham RI No. AHU-0012345.AH.01.04.Tahun 2020`, hard-coded in the
generator. `0012345` is a placeholder and the year is wrong — meaning **every
naskah dinas this system has ever issued carried a legal-entity number that does
not exist**, while three different values lived side by side: that one, the
notarial deed in `LETTERHEAD.legalBasis` (copied from a real letter), and the
genuine `AHU-3039.AH.01.04.Tahun 2022` on the public legalitas page. The naskah
now prints `LETTERHEAD.legalBasis` — the only one of the three that came from a
document — along with the real address and telephone number, replacing
`0265-123456`, which was also invented. This is the same class of defect as a
fabricated bank account number, and it was sitting on the letterhead of every
official letter.

Recommended order of work: the identity gate (1–3 above) is worth building now
and is independent of any PSrE decision. The seal itself waits — see §5b(c).

---

### Deployment note — **done, 2026-09-03**

The whole series shipped to production on 2026-09-03. The prediction above held:
`prisma migrate diff` against the live database came back **5 new tables + 12
new columns + one replaced index, with no `DROP TABLE` and no `DROP COLUMN`**,
so `db push` was safe and no reseed was needed (`seed.ts` was untouched across
all nine PRs). 285 → 290 tables; 107 users / 14 santri / 2 letters intact.

Two corrections to what this section used to assume:

- **`--accept-data-loss` was still required**, even with nothing dropped —
  Prisma also warns when adding a unique index (`letter_signatures.pdf_hash`).
  The right response is not to refuse the flag but to prove the warning empty
  first: the table had 0 rows and the column did not yet exist.
- **`db:archive-letters` had nothing to archive.** `letter_signatures` in
  production was empty; the one letter marked `SIGNED` was seed data with no
  signature row. The ordering rule stands for the future — it simply protected
  nothing this time.

---

## 7. Walking the chain in production, 2026-09-03

Route probes said the deploy was live. They were wrong about what that proved,
and the walk is what found it.

### The deadlock — the whole feature was unreachable

`requestKey` required an identity that was **already verified**. Verification
only happens in `decideRequest`, on a request. The two waited on each other, and
every applicant got the same answer forever: *"sudah lengkap tetapi belum
diverifikasi"*. **Nobody could ever obtain a signing key**, so signed naskah,
the PDF archive, public verification and revocation were all unreachable. Nine
PRs of work, closed off by one line. Fixed in **#449**.

Two lessons worth keeping:

- **1,399 unit tests were green over it**, and one of them — *"menolak pengajuan
  bila datanya lengkap tetapi belum diverifikasi"* — asserted the bug as correct
  behaviour. Each test locked half the chain against its own expectation and
  nothing composed the two. The replacement guard,
  `esign.identity-chain.test.ts`, walks from filling in the identity to the key
  being approved, and was proven red against `main` before the fix landed.
- **`401` does not prove a route exists.** `router.use(authenticate)` runs
  before route matching, so a mistyped path answers 401 too. Probing
  `/esign/me/identity/document` returned 401 and the real path turned out to be
  `/esign/me/identity/ktp`. To prove a route exists, knock with a valid token.

### What the walk confirmed

| step | result |
|---|---|
| request with no identity | refused, naming all four missing fields |
| complete but no KTP | refused, asking for the upload |
| KTP upload | stored SHA-256 **identical** to the source file |
| Super Admin reads the KTP | 200, same hash, logged as `READ / UserIdentity.ktp` |
| approve without declaring a match | **refused** |
| approve with the declaration | `ktpRetainUntil` = key expiry **+ 7 years**, not upload date |
| passphrase | requested **after** approval, as decided on 2026-09-03 |
| tembusan | internal + external, ordered, correct |
| signing | download = archive = `pdfHash`, all three identical |
| verify by upload | valid, intact, **no NIP anywhere** |
| **one byte altered** | **not found** — the substitution attack §2.6 exists to stop |
| revoke, then re-verify | revoked, `revocationVerified: true` |

Two design properties confirmed in production rather than assumed: the KTP
uploaded before a `--force-recreate` **survived it** (the point of #448), and
verification still works after the signing key row is deleted, because the
public key lives on the signature row — old letters stay verifiable forever.

### The orphan hole the walk found, and how it was closed

**Deleting a `UserIdentity` row did not delete its KTP file.**
`db:purge-identity-documents` worked from `ktpRetainUntil` in the database, so a
file whose row was gone was unreachable by it — permanently. The relation is
`onDelete: Cascade` from `User`, so deleting one user was enough to strand their
KTP scan on disk.

Fixed by adding a second phase to the same command that walks in the other
direction: list the directory, subtract every `ktpFileName` still on record,
delete what is left. Only that direction can find an orphan — a file no row
names will never appear in any query, which is precisely why the database-driven
phase could not be extended to cover it.

Three ways a file reaches that state, none of which raises an error:

- the cascade above, including `seed.ts`, which TRUNCATEs;
- a process that dies between `storeIdentityDocument` and the
  `prisma.userIdentity.update` that records the name — the file is written
  first, and nothing outside the request knows it exists yet;
- a database restored from a backup older than the volume.

The second of those also sets the sweep's one parameter. A legitimate upload
looks exactly like an orphan for the milliseconds between those two statements,
so files are spared until they are a full day old (`IDENTITY_ORPHAN_GRACE_MS`).
The asymmetry decides the direction: waiting longer leaves an orphan one day
longer, while sweeping too early deletes a KTP someone just uploaded and leaves
them to re-upload it without ever learning why.

### Nothing ran the purge — scheduled in the application, 2026-09-03 (#455)

Measured on the production host first: `crontab -l` empty for the deploy user,
`/etc/cron.d` holding only `certbot`, `e2scrub_all` and `sysstat`.
**`db:purge-identity-documents` had never been scheduled**, so both phases — the
retention purge and the orphan sweep — existed and had never run. `ktpRetainUntil`
was computed and stored on every upload, the retention figure was documented, and
nothing deleted anything. The retention window was a column, not a promise, and
the code that would honour it being correct changed nothing about that.

**Where the scheduler belongs, and why not cron.** The script's own header argued
for a command over an in-process scheduler on the grounds that *"a command that
was not run leaves a trace in crontab that can be inspected."* Inspecting it is
what showed the trace was absent — the argument failed on its only test. Three
further reasons put the job inside the application:

- The KTP files live on the `api_identity` volume mounted into the API container,
  and the database is reachable only across the Compose bridge network. Anything
  outside the container has to borrow both through `docker compose exec`.
- A host crontab does not travel with the image. It pins the deployment to one
  machine, and moving the stack means remembering to recreate it — the class of
  step that is discovered missing years later, exactly as this one was.
- It is not in the repository, so nothing reviews it, and no test can see it.

The API already runs six `node-cron` jobs in-process on `Asia/Jakarta`, verified
live in the production container's log. The purge is now the seventh, daily at
**02:30 WIB** — in the gap between the 01:00 snapshot and the 03:00 cleanup.

**What replaces crontab as the audit trail.** A scheduler that dies quietly is
the real objection to in-process jobs, and the answer is not a different
scheduler but a durable record. Every run that is not a dry run writes one
`audit_logs` row (`PURGE_IDENTITY_DOCUMENTS`) carrying the four counts — expired,
orphaned, on disk, referenced. Log lines could not do this job: `docker-compose.yml`
rotates at 10 MB × 3 files while the metrics job writes a line every minute, so
evidence that the purge ran last week is overwritten well before anyone asks. The
audit row makes *"when was this retention window last actually enforced"* a single
query. It records counts only — never file names, which are randomised precisely
so they name nobody.

One process runs it: `container_name` in `docker-compose.yml` pins the API to a
single instance. Were that to change, a collision would still be harmless —
deleting an already-deleted file is not an error, and re-nulling a null column
changes nothing — so there is no lock, only a written reason why none is needed.

`pnpm --filter api db:purge-identity-documents [--dry-run]` still exists and now
calls the same function, so the manual path and the scheduled path cannot drift.

**But that command cannot run inside the production container**, and this is the
second reason the host-cron plan was never going to work. Measured on the running
image: `pnpm` is present, `tsx` is not — it is a devDependency, and the image
installs production dependencies only. The `.ts` scripts under `prisma/scripts/`
*are* copied in, so the image ships three scripts it cannot execute. A crontab
entry calling `docker compose exec api pnpm --filter api
db:purge-identity-documents` would have failed every night, silently, exactly
like the entry that was never written. The command is for a developer checkout
or the host's build tooling; in production the compiled job is the only path:

```bash
docker compose exec api node -e "
  const {purgeIdentityDocuments} = require('./dist/jobs');
  const {prisma} = require('./dist/lib/prisma');
  purgeIdentityDocuments(prisma, {dryRun: true})
    .then(s => console.log(s.expired.length, s.orphans.length, s.onDiskCount, s.referencedCount))
    .finally(() => prisma.\$disconnect());
"
```

---

## 6. Open decisions for the yayasan

1. **Which letters must verify outside the pesantren?** That answer sets whether
   Tier 2 (BSrE) is required or merely desirable, and by when.
2. **Signing authority (PR-6) — the rendering shipped, the governance is still
   open.** `1513317` put the a.n./u.b./Plt./Plh. forms in the naskah and the
   signature block, and that is all it settled: the *mechanism* to express a
   delegation now exists. What it did **not** settle is who may sign a.n. whom,
   when each form applies, and whether delegation is even required —
   `SELECTABLE_SIGNING_AUTHORITY_FORMS` (`packages/shared/src/types/letter-signing-authority.ts`)
   deliberately validates nothing, because the system holds no surat kuasa or
   SK penunjukan to check against. The charter (`anggaran-dasar.md`, Pasal 18
   ayat 1) is the reason this cannot be waved away: **Pengurus mewakili the
   yayasan only as Ketua Umum *together with* one other Pengurus**, so a letter
   that represents the yayasan to an outside party needs two signers, and a
   single Ketua signature does not satisfy the article. Two questions therefore
   remain the yayasan's: (a) may a.n./u.b./Plt./Plh. stand in for the second
   signer at all, or does external representation require two real signatures;
   and (b) if a form is allowed, what evidence of the delegation must exist
   before it may be selected. Tracked, not answered — `naskah-dinas`.
3. **Retention:** how long a signed letter and its archived PDF must be kept —
   this drives whether Tier 3 (B-LTA) is in scope.
4. **Arabic in letter bodies (PR-7):** whether staff need to write Arabic script
   inside the naskah, or whether an Arabic element on the letterhead — shipped as
   part of the lambang image — is enough. §5b(a) adds a third answer that did not
   exist when this question was written: the DOCX track lets a drafter write
   Arabic in Word and upload the PDF, which covers most of the need without the
   shaping engine.
5. ~~**`NIP.` in the signature block (§5b(b)).**~~ **Answered 2026-09-03: remove
   it.** NIP is internal, so it no longer prints in the naskah's signature block
   and no longer appears on the verification page (#444). It is still held on the
   user record for internal use. Confirmed live during the production walk: the
   verification response carries name and position only.
6. ~~**Segel elektronik (§5b(c)).**~~ **Answered 2026-09-03: not for now.** The
   yayasan stays on in-house keys. Tier 2, the e-seal and the standard BSrE
   footnote wording all wait on that decision being revisited.
7. ~~**Whether to store the KTP image at all (§PR-5b).**~~ **Answered
   2026-09-03: store it, with a retention window.** The `/uploads` authorisation
   gap was not closed but side-stepped — the scans live in
   `apps/api/private/identity/`, which no static route serves, readable only
   through a Super-Admin endpoint that logs every read (#447), on a named volume
   so a redeploy cannot silently destroy the evidence the retention promises
   (#448). The tail is `IDENTITY_DOCUMENT_RETENTION_YEARS`, default 7, measured
   from **key expiry** per CA/Browser Forum. Lowering it is the yayasan's call;
   the orphan-file hole in §7 should be closed first, since it defeats any
   retention figure.

8. **How long a revoked-and-superseded letter stays downloadable.** Raised by
   the walk rather than decided by it: a revoked letter still verifies as
   *found, intact, revoked*, which is correct. Nobody has said how long its
   archived bytes should remain retrievable.
8. **The yayasan's own identity record (§PR-5b).** Confirm the legal name
   exactly as written in the pengesahan, the NPWP, and the full registered
   address. The letterhead has been printing a fabricated Kemenkumham number
   until today, so these should be checked against the documents rather than
   against the code.
