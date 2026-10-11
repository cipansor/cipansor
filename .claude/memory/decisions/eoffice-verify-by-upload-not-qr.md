# eoffice-verify-by-upload-not-qr

> E-Office letter verification is deliberately upload-the-PDF + Turnstile, never scan-QR-and-trust — the feature as it stands is the `naskah-dinas` skill; its audit and plan are docs/EOFFICE_ESIGN_PLAN.md

**How the feature works now is the `naskah-dinas` skill**
(`.claude/skills/naskah-dinas/SKILL.md`); the audit findings, the PR sequence
and the sources live in `docs/EOFFICE_ESIGN_PLAN.md` (added 2026-09-02). Read
the skill before touching e-office, the letter PDF, or the signing code. What
follows is only what is easiest to get wrong.

## Public transactional pages are Indonesian, like their siblings

`/public/verify-letter`, `/public/verify-card` and `/public/verify-key` are
**Indonesian only**, even though they live on the public host where content
pages are Indonesian/English/Arabic. They are not content: a visitor arrives
holding a sheet of paper and needs one answer, and the sheet, the letter and the
office that answers are all Indonesian. Translating the answer while the naskah
under it stays Indonesian adds a way to misread, not a way to understand. This
is the same line the rest of the verification surface already draws, so
`verify-key` follows its siblings rather than becoming the one trilingual page
in the set (review flag F11, decided 2026-09-29). `i18n-coverage.test.ts` does
not see inline page strings, so nothing else would have recorded the choice.

## The design decision — do not "restore" the QR landing page

Public verification happens at `/public/verify-letter`: upload the PDF, pass
Turnstile (`requireTurnstile('verify-letter')`) and a rate limiter, submit. The server SHA-256s the uploaded bytes against
`LetterSignature.pdfHash`.

`/verifikasi/[token]` was removed **on purpose**. A token attests *"a letter with
this token was signed"*, never *"the document in your hand is that letter"* — so
an attacker keeps a genuine QR and edits the body ("30 November" → "1 November")
and the old page still answered **valid**, showing no subject for non-PUBLIC
letters to contradict it.

**Proven in production 2026-09-03, not just argued.** A signed naskah verified as
valid and intact; flipping **one bit** at the midpoint of the same PDF made the
next upload answer `found: false`. That is the whole design in one measurement —
and it is why the answer is bound to the bytes and never to the token.

**Corrected 2026-09-03 (#446) — this file used to say the QR carries the raw
token and "scanning it opens nothing, by design".** The second half was never a
design, only a consequence: a code whose whole appearance promises something
will open, that opens nothing, is worse than no code. The QR now encodes
`https://cipansor.or.id/public/verify-letter` — **the page address, with no
token in it**. Scanning takes the reader to the place they hand over the file,
which is the useful thing, and reintroduces no oracle because the page still
demands the PDF. The yayasan lambang sits in the centre at error-correction H;
proved by decoding a 250 dpi render with jsQR, not by looking at it. The address
comes from `letterVerificationUrl()` in `utils/verification-url.ts` — the
generator used to build its own from `NEXT_PUBLIC_SITE_URL`, a *web* variable
read inside the API where it is never defined.

## Arabic in the naskah — requested, blocked, specified

The user asked (2026-09-02) that Arabic script be supported in letter bodies
later. **PR-1 deliberately refuses it rather than half-rendering it**, with a
message naming the offending characters; before that the failure was a swallowed
throw that produced a SIGNED but permanently unverifiable letter.

Why it is not a patch: PDF standard fonts are WinAnsi-only, so it needs an
embedded Unicode face (Tinos/Liberation Serif + subset Noto Naskh Arabic) **and**
a shaping engine — `pdf-lib` has none, and embedding glyphs without contextual
joining and RTL reordering renders Arabic as isolated letters in the wrong order,
which is worse than refusing. Realistic route is `harfbuzzjs` (WASM) feeding
positioned glyphs to pdf-lib.

~~It is blocked on PR-3~~ — **PR-3 shipped (#437), so it is unblocked.** The
byte-stability worry it named is now handled by the archive plus a pinned
SHA-256 in `generate-letter-pdf.test.ts`, which turns any layout change into a
deliberate migration instead of a silent one.

**A cheaper route appeared while answering a different question.** §5b(a) of the
plan proposes a second authoring track — download a filled DOCX template, edit
in Word, export PDF, upload — which is what ANRI's own SRIKANDI does for naskah
keluar. A drafter needing an Arabic quotation writes it in Word and exports,
which removes harfbuzzjs shaping from the critical path entirely. PR-7 becomes
an optimisation for the form-generated track rather than a blocker. Not built.

Full spec: `docs/EOFFICE_ESIGN_PLAN.md` §PR-7 and §5b(a). Cheaper still if only
the kop surat needs Arabic — put the calligraphy in the lambang image, which
needs no shaping at all.

## The perishable fact — resolved

The implementation was stranded at commit `e93a7cf2` (PR #421, +5,112 lines)
after a Jules commit titled as a two-line e2e/dependency fix deleted it 17
minutes after it merged into the #414 branch. **Recovered and shipped in #435;
#414 closed by the user on 2026-09-03.** Tag `esign-salvage` still marks the
commit.

See [git-three-dot-diff-hides-stale-base](../lessons/git-three-dot-diff-hides-stale-base.md) for how to catch this class of
commit, and [`roadmap.md`](../roadmap.md) §6 for where it sits in the backlog.

## Ke mana harus membaca, per 2026-09-03

Seluruh riset standar dan keputusan yayasan ada di `docs/EOFFICE_ESIGN_PLAN.md`:
§5b (dua jalur penyusunan, QR vs logo, segel elektronik) dan §PR-5b (identitas
penandatangan, retensi pindaian KTP, OCR, pencocokan wajah). Jangan meriset
ulang — angkanya sudah dikutip berikut sumbernya.

**Diperbarui 2026-09-02.** Pencabutan naskah kini nyata dan bertanda tangan —
lihat [eoffice-revocation-authority](./eoffice-revocation-authority.md) dan [eoffice-revocation-mechanics](./eoffice-revocation-mechanics.md).
Halaman verifikasi menyebut nama pencabutnya dan membuktikan pencabutannya
(`revocationVerified`), bukan sekadar menyatakan "dicabut". Kesimpulan tingkat
kepatuhannya di [esign-standards-ceiling](./esign-standards-ceiling.md).
