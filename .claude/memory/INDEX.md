# Project memory — index

Where the work stands, what was decided, and what was learned the hard way.
Claude loads this file in every session (through `CLAUDE.md`); any other agent
should read it before starting, and open a file below when its line matches the
task. The rules for what goes here and what does not are in `AGENTS.md` →
"Where things live". **Nothing sensitive in this folder** — the repository is
public until release, and the Security CI job and Claude's `guard.sh` refuse
the mechanical cases.

## State — update as the work moves

| File | Holds | Update when |
|---|---|---|
| [`progress.md`](progress.md) | what is merged, on staging, in production; what waits on the user; what is in flight | a PR merges, a deploy runs, the user decides something |
| [`roadmap.md`](roadmap.md) | the ordered backlog — what to do next, and why in that order | priorities change, or an item is done |
| [`known-issues.md`](known-issues.md) | open defects, in detail | a defect is found, or fixed (delete a fixed entry; git keeps it) |

## Decisions — settled; do not re-open without a new reason

- [pimpinan-pesantren-kiai](decisions/pimpinan-pesantren-kiai.md) — no Direktur; the Kiai is Pimpinan Pesantren (unit head) and also Pembina, with the legal basis
- [pk-organ-yayasan-tanpa-kontrak](decisions/pk-organ-yayasan-tanpa-kontrak.md) — Pembina, Pengurus and Pengawas make no PK; a unit head's PK hangs on the unit's ratified RKA
- [pengesahan-dokumen-yayasan](decisions/pengesahan-dokumen-yayasan.md) — who drafts, reviews and ratifies RPJP/Renstra/RKA; ratified documents freeze
- [pengawasan-dan-rapat-pembina](decisions/pengawasan-dan-rapat-pembina.md) — #508/#509 closed (2026-09-28); decided: Ps. 43 lean (authority held, 7/7/7, void by law), WBS in Aduan & Aspirasi with recusal, TPPK/Satgas per unit, Pembina decides by recorded meeting or unanimous written resolution; never Super Admin; AD copy awaited
- [rka-dua-tingkat](decisions/rka-dua-tingkat.md) — four planning levels (RPJP → Renstra → RKA Yayasan → RKA Unit); never propose three
- [unit-vs-asrama-vs-takhosus](decisions/unit-vs-asrama-vs-takhosus.md) — a unit issues its own graduation; asrama is not a unit; takhosus is `UnitType.PESANTREN`; who manages asrama (Pimpinan + TU Pesantren + SA; koordinator places)
- [menu-ia-tiga-tingkat](decisions/menu-ia-tiga-tingkat.md) — at most three menu levels, nine groups by discipline; no sub-sub-menus
- [eoffice-revocation-authority](decisions/eoffice-revocation-authority.md) — who may revoke a naskah dinas; Pengawas, not Ketua; never Super Admin
- [eoffice-revocation-mechanics](decisions/eoffice-revocation-mechanics.md) — revocation is a signed statement; the DICABUT stamp; requesting ≠ deciding
- [eoffice-verify-by-upload-not-qr](decisions/eoffice-verify-by-upload-not-qr.md) — verify by uploading the PDF, never by a token page; Arabic in the naskah
- [esign-standards-ceiling](decisions/esign-standards-ceiling.md) — AATL/eIDAS/PP 71 ceiling; Ed25519 does not block PAdES (AATL does); no PSrE for now; PAdES B-B + RFC 3161 deferred (2026-09-29) until a TSA provider is chosen; research not to repeat
- [chatbot-retrieval-settled](decisions/chatbot-retrieval-settled.md) — the whole corpus goes into every prompt; what was rejected; when to revisit
- [route-naming](decisions/route-naming.md) — PPDB/PSB → SPMB with permanent redirects; pesantren terms are never translated
- [istilah-dan-penamaan](decisions/istilah-dan-penamaan.md) — santri on every screen (murid only in state formats), spellings, portal Indonesian-only vs trilingual public site, `/api/v1`, tables follow models, no lab module, ZIS/wakaf law + what the yayasan offers, target module names
- [pemutus-izin-santri](decisions/pemutus-izin-santri.md) — a santri's leave is decided by their musyrif or wali kelas, not the kepala; heads only after 7 days, no mentor, or takeover; going home → koordinator asrama; staff-filed leave off the pondok waits for the wali; doctor's note only when needed, kept to the end of the TA, opened by decider + wali + head, kept to the end of the academic year, opened by the decider, the wali and the unit head (2026-09-28)
- [public-site-photography](decisions/public-site-photography.md) — where real photos come from, what was left behind, claim only what a photo shows
- [peran-dan-tugas-tambahan](decisions/peran-dan-tugas-tambahan.md) — a role code is a person's function; wakasek, wali kelas, guru wali, … are relations or timed assignments; guru wali runs at SMP IT/SMA Qur'an; who reads a confidential counselling session
- [absensi-harian](decisions/absensi-harian.md) — the register is taken in class by the wali kelas or a teacher of the class; one page; automatic follow-up owned by the wali kelas or the musyrif; no guru piket; the pattern flag's four parameters (2026-09-28)
- [realtime-polling](decisions/realtime-polling.md) — no push channel; the web polls; Socket.IO removed (no client); Web Push first for phones, WebSocket only for a seconds-level need and after Model A, with its conditions
- [notifikasi-push](decisions/notifikasi-push.md) — Web Push built 2026-10-03 (#626): the notification table is the outbox, lock screen per category (health/BK/violations/complaints/audit generic), every bell kind pushed subject to stored per-kind preferences, quiet hours user-set in WIB, one VAPID pair per environment, push-service allowlist, a subscription belongs to the account that enabled it; research not to repeat
- [autentikasi-2fa-dan-sandi](decisions/autentikasi-2fa-dan-sandi.md) — 2FA wajib: admin, organ, kepala unit; diajak sesudah login: staf + wali, "Nanti saja" tanpa batas; sandi diganti karena kejadian, bukan kalender; panjang + daftar terlarang lokal (NIST 800-63B-4); "Masuk dengan Google" hanya akun @cipansor.or.id (`hd`), peran wajib tetap kode Cipansor sesudahnya, tanpa jalur Microsoft; passkey Cipansor sebagai jalur masuk **pertama** (Model A), sandi+TOTP+kode pemulihan tetap fallback, satu passkey memenuhi kewajiban 2FA
- [struktur-organisasi-dan-identitas](decisions/struktur-organisasi-dan-identitas.md) — audit 2026-09-29: unit Pesantren dibuat; satu pohon org maks 3 tingkat, jabatan terpisah dari pemegangnya; Model A bertahap tapi menyeluruh (baseline hanya menyusut); Google OU per kebijakan + grup otomatis; Cipansor → Google → Microsoft ditegaskan (hub Microsoft butuh P1)
- [penyimpanan-berkas](decisions/penyimpanan-berkas.md) — satu tabel berkas (pemilik, status tertaut), Blob privat lewat managed identity + SAS delegasi pengguna, tanpa kunci akun atau kontainer publik; yang tak tertaut dihapus sesudah 24 jam; rancangan #441 ditolak
- [dokumentasi-bergambar](decisions/dokumentasi-bergambar.md) — two skills, one workflow (document skill calls the screenshot rig); three picture layers (task cards, process storyboards, per-account atlas); only pictures embedded in a document go to git; ditegaskan 2026-10-10: galeri sapuan di luar git, README sedikit gambar, tampilan lengkap di panduan + peta teks di dokumen teknis
- [akreditasi-unit](decisions/akreditasi-unit.md) — each unit's accreditation on the public site from one official record in the portal (admin unit or Super Admin, with the PDF); shown once its certificate exists; hidden once expired; readiness never overwrites it; reminder 12 months before
- [spmb-2027-2028](decisions/spmb-2027-2028.md) — 2027/28 registration runs in the portal (no bit.ly), target before wave 2 (1 Jan 2027); the brochure's waves, discounts, fees, requirements and contacts become SPMB module data; requirements follow the brochure (Permendikdasmen 3/2025 risk noted); "Ramram"; full structure on the public site; real names and photos in the seed and portal, every document of a test copy stamped "SALINAN UJI"; official + short unit names with NPSN/permit; order: users scope fix → SPMB → Pesantren unit; the brochure is loaded by a script (`db:seed:spmb-2027-2028`) on staging now and on production with a release, then owned by the unit's admin (2026-10-03)
- [derajat-kecepatan-naskah](decisions/derajat-kecepatan-naskah.md) — naskah dinas: tiga derajat Sangat Segera (24 jam) / Segera (2×24 jam) / Biasa; `URGENT` tetap derajat 24 jam (pedoman: "Amat Segera/Kilat"); tanpa Kilat terpisah (2026-10-09)
- [spmb-announcement-publik](decisions/spmb-announcement-publik.md) — the public site announces SPMB with a banner (always, while a unit is open) plus a delayed dialog once a visit until closed for the period, both derived from `GET /admissions/public/intakes` (no schema change); why a banner beats an interstitial (Google/Ad Grants); public-host gate, per-period dismissal (banner in one cookie), server origin never from request headers, steps aside under automation; trilingual (2026-10-05, corrected 2026-10-08)
- [lisensi](decisions/lisensi.md) — Apache License 2.0 **selama repo publik** (2026-10-09), kembali **proprietary begitu repo privat** (langkahnya tercatat): mengapa bukan MIT (§6 merek, §3 paten, §5 kontribusi, NOTICE); nama/logo, foto, dan data pribadi di luar lisensi; tidak bisa ditarik untuk versi yang sudah terbit
- [surat-keterangan-lewat-eoffice](decisions/surat-keterangan-lewat-eoffice.md) — a santri's surat keterangan is an E-Office naskah filled from the student's record: agenda number, TTE by the unit's head, verifiable by upload; the browser-numbered print goes (2026-10-02)
- [siaran-pengumuman](decisions/siaran-pengumuman.md) — Pengumuman satu-satunya jalan siaran (Quick Send/Buat Notifikasi dihapus); siapa→siapa menurut relasi (guru→kelasnya, musyrif→kamarnya, kepala/TU/admin→unit, organ & Pimpinan Pesantren→yayasan; Super Admin tidak menulis isi); lonceng + push saja; tanpa persetujuan, tercatat, bisa ditarik (2026-10-03); daftar Notifikasi admin dipensiunkan → terkirim/dibaca per pengumuman, templat dihapus (2026-10-04)
- [fasilitas-dan-kegiatan-situs-publik](decisions/fasilitas-dan-kegiatan-situs-publik.md) — Fasilitas (`/campus`) and Kegiatan (`/activities`) as two menu items; facilities in the site config, extracurriculars from the portal module with admin-kept EN/AR names (brochure loaded by `db:seed:ekskul-2027-2028`, unmarked ones → SD IT/SMP IT/SMA Qur'an); agenda without dates; photos only where one shows the place (2026-10-04)
- [akses-data-pegawai](decisions/akses-data-pegawai.md) — NIK/KK/alamat/TTL/rekening pegawai hanya untuk diri sendiri, admin unit, TU unit, organ, Super Admin; rekan (termasuk kepala sekolah) melihat kolom direktori (2026-10-10)

## Lessons — traps that already cost time

- [guard-tests-that-measure-the-wrong-thing](lessons/guard-tests-that-measure-the-wrong-thing.md) — "what would have to change for this test to go red?"; chains with no root; fuzz against invariants; a test that skips itself; a scanner blind to the defect's shape; a suite that signs in as someone who cannot be refused; an absence assertion that retries until the thing goes away
- [teacher-dashboard-fake-stats](lessons/teacher-dashboard-fake-stats.md) — four kinds of figures that lie, and how to find each
- [generated-docs-need-machine-checks](lessons/generated-docs-need-machine-checks.md) — a green build and a self-review said "compliant" over a document with every table destroyed, invented routes and a wrong job count; check claims against the code and open the artefact
- [breadth-over-depth](lessons/breadth-over-depth.md) — built wider than used; walk a real journey end to end
- [student-status-case-mismatch](lessons/student-status-case-mismatch.md) — `'active'` vs `'ACTIVE'`: 43 queries returned zero; one vocabulary + CHECK + scanner
- [prisma-include-leaks-pii](lessons/prisma-include-leaks-pii.md) — `include: { student }` sends 69 columns of a child's data; always `select`
- [rbac-nav-contract](lessons/rbac-nav-contract.md) — `navigation.ts` and `rbac.ts` are one contract; the three directions tested, and how they go blind
- [api-integration-traps](lessons/api-integration-traps.md) — empty permission matrix, Express 5 `req.query`, `/:id` shadowing, unmounted paths; a file over multer's limit answering 500
- [auth-session-traps](lessons/auth-session-traps.md) — refresh-token stampede, pre-rehydration redirects, the 4 KB cookie; an HttpOnly routing cookie every refusal must clear, no refresh without a session, the bucket minted in one place, e2e tests that rotate a shared session
- [stale-temporal-data](lessons/stale-temporal-data.md) — derive dates from now; `isActive` is not a schedule
- [migration-history-baselined](lessons/migration-history-baselined.md) — `0_init`; `migrate diff` blind to triggers; CI's `db push`; wrap data migrations in BEGIN/COMMIT; renumber a branch's migrations from the diff, never a date glob
- [seed-verify-throwaway-db](lessons/seed-verify-throwaway-db.md) — prove a seed change on a disposable, isolated Postgres
- [git-three-dot-diff-hides-stale-base](lessons/git-three-dot-diff-hides-stale-base.md) — measure from the merge base; paired PRs; a bot's stale-tree commit
- [git-checkout-path-destroys-uncommitted](lessons/git-checkout-path-destroys-uncommitted.md) — `git add -A` before a mutation test
- [branch-switch-stale-artifacts](lessons/branch-switch-stale-artifacts.md) — rebuild `shared` and regenerate Prisma after checkout or stash
- [pnpm-install-silently-installs-nothing](lessons/pnpm-install-silently-installs-nothing.md) — exit 0, nothing installed; `CI=true`
- [audit-deps-fails-on-time-not-diff](lessons/audit-deps-fails-on-time-not-diff.md) — the Security job reds on the date, and greens without checking
- [github-actions-minutes-exhausted](lessons/github-actions-minutes-exhausted.md) — a 2-second job with no steps is a billing wall; read the annotation
- [gh-cli-and-shell-traps](lessons/gh-cli-and-shell-traps.md) — `gh pr edit` does nothing; unquoted heredocs run backticks; all green yet BLOCKED = a CodeQL category missing
- [docker-image-size-traps](lessons/docker-image-size-traps.md) — Prisma's optional peer, `chown -R`, recursive `*.sql` in `.dockerignore`
- [next-image-optimizer-dead](lessons/next-image-optimizer-dead.md) — `/_next/image` never resizes; ship images at display size
- [nextjs-loading-boundary-commits-200](lessons/nextjs-loading-boundary-commits-200.md) — a root `loading.tsx` turns every 404 into a 200
- [mobile-layout-audit](lessons/mobile-layout-audit.md) — `scrollWidth` lies here; the ancestor-walk test that works
- [radix-scrollarea-thumb-stalls](lessons/radix-scrollarea-thumb-stalls.md) — the thumb that stops at 3%; measuring at end of frame
- [radix-direction-defaults-ltr](lessons/radix-direction-defaults-ltr.md) — `<html dir="rtl">` does not reach Radix Tabs/Select; pass `dir` (or a `DirectionProvider`) and assert the attribute
- [select-empty-value-sentinel](lessons/select-empty-value-sentinel.md) — `""` vs the wrapper's sentinel; never `value={x || undefined}`; build a form of Selects after its data, do not reset it
- [webkit-seen-only-after-merge](lessons/webkit-seen-only-after-merge.md) — Firefox/WebKit run only on `main`; a CSP that broke WebKit passed every PR check; an informational job that times out cancels the run and staging never deploys — dispatch E2E on the branch, check `/healthz` moved

Update a file in place — one subject, one file — on a branch and through a PR,
like any other change. Keep this index to one line per file.
