# Progress — where the work stands

Updated **2026-10-13**. What a new session needs to pick up the thread, newest
first. Keep it short: finished work belongs to git history, and the ordered
backlog to [`roadmap.md`](roadmap.md).

## Environments

- **Production** — `cipansor.or.id`, Azure App Service since 2026-09-24. A
  release needs the user's explicit approval every time, and
  releases the SHA staging reports at `/healthz`, not the head of `main`.
  Migrations run when the container starts (`MIGRATE_ON_START`).
- **Staging** — `staging.cipansor.or.id`, demo data only, deploys every `main`
  on which CI and E2E (Chromium) pass, about 25 minutes after the merge (a
  documentation-only merge is not rebuilt). At `b6e0eed86` (#714) on
  2026-10-11 (the first attempt met an Azure Resource Manager 503 and was
  re-run); its `/healthz` reports `database` and `environment` (#675), and
  `deploy-watch.yml` checked every deploy against it (#664; watcher deleted 2026-11-11 — the owner watches the Actions tab). SMP IT's accreditation certificate was recorded there on
  2026-09-29 at the user's request, by the SMP admin demo account — which
  therefore now asks for a 2FA code — so the public section shows it.
- **CodeQL is a required check** on `main` since 2026-09-25 (ruleset rule
  `code_scanning`, errors and high-or-higher alerts). The user's caveat: it
  may be dropped if the repository goes private and code scanning would need
  a paid licence.

## Waiting on the user

- **Absensi pegawai (PR #630, merged 2026-10-12) — before a unit switches
  self-attendance on.** The 2026-10-09 audit's defects are fixed (punches
  recorded, settings only for the super admin and unit admins, private selfies,
  the 50% ceiling, records kept ten years, the camera and location the web
  header had denied). Selfie and location stay **off** until a unit's admin
  turns them on, and that waits on the yayasan: the employee privacy notice
  (D1) and a DPIA for the selfie (UU PDP Ps. 34), plus staff records for every
  non-teaching employee and the unit's sites, work week and policy
  (`roadmap.md` §0a, decisions in `decisions/absensi-pegawai.md`, open defects
  in `known-issues.md`).

- **The next production release.** #630 (staff attendance) and #714 (pesantren
  staff reach every school's santri) are both merged (2026-10-11/12), the
  condition the user set on 2026-10-09. Each step that writes production data
  is still confirmed separately, right before it runs: the SPMB and
  extracurricular loaders, `apps/api/scripts/require-password-change-all.ts`,
  and the production VAPID pair. Passwords parts A and B must go out together,
  with that script run once after the deploy; SPMB 2027/2028 needs a release
  before 1 January 2027 to take wave 2. (Which fixes production still lacks is
  for the machine-local memory, not here — see "Where things live".)
- Role catalogue items decided but not built: wakasek per bidang as a
  timed assignment (Model A; wakasek is no longer a role code —
  `decisions/peran-dan-tugas-tambahan.md`), `PESANTREN_ADMIN` (needs a
  pesantren unit first — every pesantren role is scoped to SMP IT today), a
  Panitia SPMB assignment that expires, and the "Admin" → "Operator" label.
- One Bendahara role with a unit scope waits for Model A (decided 2026-09-25).
- **The public assistant on staging** — the user decided (2026-10-09) on a
  key of staging's own with a cost cap, provisioned through a temporary cloud
  role, then deferred doing it; ask again at the end of every report. Until
  then staging runs the assistant switched off (#657 does that when the key
  is missing).
- **Accreditation certificates of SD IT and SMA Qur'an** — the user is
  asking the schools for them (2026-09-28); each unit appears on the public
  site once its certificate is entered. TK Qur'an has none yet — it was
  only just established — and is not mentioned.
- **Musyrif assignments in production.** Until the yayasan enters them
  (Asrama → an asrama → Musyrif, #569), a boarder has no musyrif on record:
  their leave goes to the unit head, visibly so, and their Alpa is followed
  up by the wali kelas (#588).
- **ZIS and wakaf facts** (asked 2026-09-27; the user does not know yet and
  will check): the yayasan's zakat status (UPZ of BAZNAS Kab. Tasikmalaya, a
  licensed LAZ, or none) and whether it is a registered nazhir (KUA / SIWAK /
  BWI). What the web shows, and the interim rule the user set, are in
  `decisions/istilah-dan-penamaan.md` §7.

**Answered on 2026-09-27** (recorded in the decisions; the work is in
`roadmap.md`): the three permit parameters (`pemutus-izin-santri`); who
manages asrama (`unit-vs-asrama-vs-takhosus`); _santri_ on every screen
(`istilah-dan-penamaan` §1); guru wali runs at SMP IT and SMA Qur'an
(`peran-dan-tugas-tambahan`); daily attendance — one page, automatic
follow-up, no guru piket (`absensi-harian`); one TK daily-report page and the
Kurikulum list page folded away (both removals approved). The next production
release was **deferred** by the user ("tunda dulu … kumpul dulu perbaikan dan
pengembangannya"), who asked to keep being reminded.

**Answered on 2026-09-28:** the attendance pattern flag's four parameters
(`absensi-harian`, all the recommended options); the units' accreditation —
on the public site from one official record in the portal, kept by the unit's
admin or the Super Admin, a reminder 12 months before it runs out
(`akreditasi-unit`); a permit's doctor's note — kept to the end of the leave's
academic year, opened by the decider, the wali and the unit head
(`pemutus-izin-santri`); PR #508 (Pengawas, WBS, suspension of Pengurus) and #509 (organ
decisions and minutes) — both **closed** after an audit
(<https://claude.ai/artifact/Cs8yAjGuZcYJzrVi874k9d>): #508 is split and
redesigned, #509 becomes a Pembina meeting decision in the existing
ratification flow (`pengawasan-dan-rapat-pembina`); the four design questions of that rebuild —
the Ps. 43 suspension, the WBS, TPPK/Satgas and the form of the Pembina's
decision — all answered with the recommended options the same day. The
founding deed (2012) arrived too, summarised in the `tata-kelola-yayasan`
skill; whether it was amended since is still to ask.
Also on 2026-09-28, after an audit of the Dependabot majors #601–#604:
Sentry is **removed** rather than upgraded (#601–#603 closed) — no
environment ever ran it, and v11 collects cookies, bodies and local
variables by default; error monitoring is to be chosen before launch (the
release plan points at Azure Application Insights). ESLint 10 merged (#604).

## In flight

- **Dua penjadwal di dokumen teknis (#875, 2026-11-12).** Merge #804 membuat
  penjadwal notifikasi (`modules/notifications/scheduler.service.ts`) benar-benar
  berjalan dari `main.ts`, tetapi `docs/` tidak ikut diperbarui. §6.6 hanya
  mengenal `jobs/scheduler.ts`, tabel §6.6 tidak memuat enam tugas penjadwal
  notifikasi, `POST /notifications/scheduler/trigger` + `Notification.dedupeKey`
  + model `NotificationDelivery` + dua migrasinya tidak tercatat, dan catatan
  "satu instans" membuat pembaca menyimpulkan penjadwal notifikasi pun tidak
  aman multi-instans — padahal ia mengklaim slot lewat `notification_deliveries`.
  Angka 19/17 §6.6 sudah benar (dibetulkan #771/#630 di v1.3), jadi sisa
  pekerjaannya: §6.6 kini menunjuk perintah ukur + tabel tugas penjadwal kedua,
  batasan "satu instans" dipisah, `ARCHITECTURE.md` menyebut penjadwal kedua,
  `MOBILE_API.md` menyelaraskan klaim pengingat SPP (bulanan `spp-reminder.job`
  vs `payment-reminder` sekali-per-tagihan; `PENDING` bukan `SENT`). Kartu
  panduan pengguna untuk tab **Penjadwalan** ditunda dengan alasan:
  `/notifications/whatsapp` tidak punya menu (`NO_MENU_BY_DESIGN`,
  known-issues.md), jadi tak ada menu path (golden rule #11) — dicatat di
  `known-issues.md`. Putaran tinjau menemukan klaim "aman multi-instans" terlalu
  luas: hanya tiga tugas ber-`dedupeKey` yang aman, tiga tugas massal
  (`attendance-summary`, `tahfidz-progress`, `monthly-report`) memakai
  `createManyNotifications` tanpa kunci sehingga tetap menggandakan; keduanya
  (plus klaim H-7/H-3/H-1 vs sekali-per-tagihan) dicatat di `known-issues.md` dan
  dikoreksi di dokumen.
- **Versi patch Prisma di dokumen teknis (#874, 2026-11-12).** Tabel 2
  (Batasan) memaku `Prisma 7.10.0` sementara `apps/api/package.json` sudah
  `7.10.1` — sisa bump Dependabot (#870). Tidak ada pemeriksa yang menangkapnya
  (`check_docs.py` mencocokkan jumlah modul/model/rute/job, bukan versi
  dependensi), jadi baris itu akan basi lagi tiap bump. Diperbaiki dengan opsi 2
  issue: `Prisma 7` (tingkat mayor), sejalan keputusan #782/#783 dan baris yang
  sama (`Next.js 16`, `React 19`, …). Satu baris + entri Riwayat Revisi `1.5`
  pada cabang ini.
  Rule 9: #1052 (#833) menyentuh berkas yang sama; digabung di worktree hanya
  bentrok pada baris Riwayat Revisi (dua-duanya menambah `1.5`) → siapa yang
  digabung kedua menomori ulang (mis. #1052 tetap `1.5`, #874 jadi `1.6`);
  `check_docs.py --final` 0 ERROR pada pohon gabungan.

- **EMIS teacher export + module tests (#868 + #873, one PR, 2026-11-12).**
  `exportTeacherData` invented `jenisKelamin: 'L'`, `tempatLahir: ''` and
  `tanggalLahir: ''` although `Teacher.gender`/`birthPlace`/`birthDate` exist
  and the HR module fills them — every teacher was exported male with an empty
  birthplace, and it differed from Dapodik's export of the same person. Fixed
  per K11 (2026-11-09): gender maps from the column, `''` when null (the type
  is now `'' | 'L' | 'P'`), birth columns read directly. #868's test gap is
  closed by `modules/emis/tests/emis.service.test.ts` (real service, only
  Prisma mocked). Three of the deferred defects (student `agama`, teacher
  `sertifikasi`/`statusPegawai`, institution `jumlahRuangKelas`, dead
  `emis.schema.ts`) are recorded in `known-issues.md`; K11 deferred them and no
  separate issue exists yet.

- **Documentation PRs, 2026-11-11:** #1035 (#778, cross-unit scope; **also
  carries #801** — the portfolio read-scope and two-party message-reply rules in
  `docs/DOKUMEN-TEKNIS.md` §8, per K18 "one PR together with #778"), #1036
  (#779, screen labels), #1046 (#792, the absensi-pegawai sync — the first to
  document the Absen Saya flow). All three were merged together in a worktree:
  only one conflict, both #1035 and #1046 appending a `0.5` row to the Guru
  booklet's revision table; `check_docs.py` and the two guard tests pass on the
  merged tree. Merge them as a set.

- **Issue triage, 2026-11-11 (oldest open `ready` first):** #795 closed
  **NOT_PLANNED** — it asked for a weekly usage report from `Pengawas armada`
  (SDLC 23), but the owner retired that automation on 2026-11-11 (label
  `automation-health` deleted, `RETIRED["SDLC 23"]` in `deploy-sdlc-agents.py`,
  `IDEAS.md` §5, tracked by #1047 / PR #1045); the report is now read manually.
  Building the step would resurrect a retired automation. #801 advanced: its
  finding 1 was already fixed via #762, and the remaining scope (K18) rode on
  PR #1035. Still open and untouched: the broken `/parent/messages` route (a
  product gap, not documentation — worth its own issue).
- **Beranda wali (#869, 2026-11-11).** The wali home read a `ChildSummary`
  shape the API never sends (`c.studentId`, a `recentAttendance.percentage`,
  `latestTahfidz.totalJuz`, `pendingPayments`, `pendingViolations`,
  `unreadRewards`), so every tile fell to `0` / `—`. Fixed by decision **K13**:
  the `GET /parent/dashboard` shape is canonical, now a DTO in
  `@cipansor/shared` (`ParentChild`, `ParentDashboardChildSummary`,
  `ParentDashboardData`) used by both sides; `holisticScore` /
  `boardingHarmonyScore` are `null` when no query produced them and the tile
  then shows "–" (never a fabricated `100`); attendance is computed from the
  last seven `recentAttendance` rows (`PRESENT`); the asrama tile renders only
  when a placement exists. Pelanggaran/Penghargaan/Dompet tiles are deferred to
  #764 (K13.3). Tests: API service, web unit and e2e `/parent`.
  - **Review fix (K13.4, 2026-11-12).** The card and the tahfidz dimension of
    the holistic score had read `lastTahfidz.juz` — the juz a setoran *sits in*,
    not hafalan — so one ayah of juz 30 showed "30 Juz" and scored 100. Both now
    use `memorizedJuz`: the ZIYADAH ayah per juz (murojaah excluded), each juz
    weighed by its own size, in the DTO as `memorizedJuz` (`null` when no
    ZIYADAH record, never `0`). The page also moved off a bare `api.get` in a
    `useEffect` onto `useParentChildren`/`useParentDashboard` (the data-layer
    rule).
  - **Review fix round 2 (K13.4, 2026-11-12).** Two defects found in review of
    the round-1 fix. (a) `memorizedJuz` was rounded to *two* decimals, so one or
    two ayah of juz 30 (0.0018 juz) rounded to `0` — the card read "0 Juz" and
    the tahfidz dimension scored 0 for a santri who recited that day. The raw
    value now feeds `tahfidzScore`, and the DTO rounds to *three* decimals
    (smallest real record = 1/564). (b) `useParentChildren` /
    `useParentDashboard` keyed by a constant, and logout only drops the
    push-status cache — a second wali signing in on the same device read the
    first's children/dashboard from cache (CWE-524). Both keys now carry
    `user.id` and the query is `enabled: !!user?.id`.

- **Open PRs, 2026-10-13:** #777 (the gate watch; ready, all checks green,
  waiting on the review gate), #668 and #775, #804 (draft). Merged since
  2026-10-10: #512, #714, #708 + #734 (tested together on `main`), #761 and
  #766 (the human note only on risky PRs, and Markdown is never risky), #630
  (staff attendance), #726 (the Pesantren unit), #747 (portfolio and replies
  follow who may read them), #773 (a PR must link an open, ready issue), #783
  (guides point at what measures a count; closed sixteen drift issues). #706:
  closed in favour of #783.

- **Audit of #655, #657 and #628 (asked 2026-10-09).** All three merged: #655
  (public SPMB announcement), #657 (assistant on staging, mirrored on Arabic
  pages), #628 (E-Office round 2); #701 closed as covered by #657 (one name,
  `APP_ENV`); CODEOWNERS removed (#720), the review-gate scripts fixed (#716).
  Report: <https://claude.ai/artifact/Di6W55CSPJoUhpezzA1cXU>.

- **The Pesantren unit — part A merged (#714, 2026-10-11; on staging).** Walking every
  menu page of the pesantren's roles before and after moving them to a
  Pesantren unit showed the musyrif, ustadz and muhafidz losing the schools'
  santri in Muhadhoroh, Muhadatsah, Ibadah, Kitab and Sanad, and their unit
  pickers offering their own unit only. Part A puts those modules on
  `studentScope`, writes a record to the santri's unit, and offers every
  unit to whoever reaches every unit. Part B then creates the unit, moves the
  five roles by a data migration (replayed on a copy of production:
  nine people, eight teacher records, no duplicates, idempotent) and drops
  the seed's Direktorat Pendidikan.

- **Application documents (`docs/`), merged with PR #512 on 2026-10-11.** A technical document (arc42 +
  C4-1/2/3) and the user manuals (general part + Guru booklet, all T2: written
  from code, never run, every card ⚠), built by the `dokumen-aplikasi-cipansor`
  skill. The first run (2026-09-29, another agent) shipped broken tables,
  invented routes and a wrong job count; the audit is
  `docs/EVALUASI-DOKUMEN.md`, and the skill now carries machine
  checks (`check_docs.py`, `check_env.py`, a self-verifying `build_docs.py`).
  The documents were later flattened from `docs/dokumen-aplikasi/` into `docs/`
  root (source `DOKUMEN-TEKNIS.md`, `PANDUAN-PENGGUNA-*.md`, `EVALUASI-DOKUMEN.md`;
  generated `fakta/`, `diagrams/`, `alur/`, and the `*.docx`/`*.pdf` artifacts
  untracked) with `docs/README.md` as the index. The `.docx`/`.pdf` are no longer
  committed (2026-09-29, user's call): git cannot show a binary's contents, so a
  tracked copy could not be reviewed against its `.md` source and only added
  drift risk; `check_docs.py --built` and `build.json` were removed with it.
  The fix commits (`0b6c189`, `0f993b3`) are on the branch (the first push
  attempts were refused with 403 until the Claude GitHub App access was
  restored).
  **Folded into #512 (2026-09-30, user's call).** #627 (this branch) was closed
  and its content moved onto `docs/readme-overhaul-visual-qa`: #512 already
  rewrote the README with a full screenshot gallery and had fixed the _same_
  seven dynamic detail pages for the Next 16 `params` Promise, so the two were
  the "individually green, red when merged" pair of golden rule #9. The merge
  kept #512's page implementation and brought over only the guard test that
  pins it (`next-dynamic-params.guard.test.ts`, 127/127 against `use(params)`).
  #512 also had two stale conflicts with `main` (`role-switcher.tsx`,
  `sidebar.tsx` — its `realmColorClass` is the correct side) that were resolved
  and it is `MERGEABLE` again. Its figures were re-measured after the merge:
  94 API modules (was 93), 67 four-file / 25 five-part, ~1412 handlers, and the
  new `certificates` module was added to the document. Gate on the merged tree:
  API build + build:strict, API 3352, web build, web 640, lint 0 errors,
  format, `check-doc-refs` 1744/1744. `screenshot-flow.ts` was Prettier-formatted
  (CI Lint rejects unformatted `.ts`).
  Before it merged, #512 was audited again (2026-10-10): the README was
  rewritten with a few screenshots, the galleries left git
  (`decisions/dokumentasi-bergambar.md`), and two read leaks it carried were
  closed (an employee's HR record, a santri's full row under violations and
  rewards).
  Open: T1 verification with screenshots and the other role booklets (the
  `.docx`/`.pdf`-in-git question is settled: they are untracked).

- **E-Office / naskah dinas audit, round 2.** The persuratan and TTE surfaces
  reviewed against ANRI and PAdES practice. Built: a daily/weekly **retention
  review job** that lists letters past their JRA-derived retention and never
  destroys them (`db:retention-review`, weekly Monday 05:00 WIB — destruction
  needs a berita acara, not a script); the **public key-status surface**
  (AATL ICA7) at `/public/verify-key`, answering a key's state from the
  fingerprint printed on every verification page; urgency labelled
  Sangat Segera / Segera / Biasa (three degrees, decided 2026-10-09); the
  agenda CSV export moved onto the shared Axios instance (it was a raw relative
  `fetch` that only worked behind nginx); and an unused placeholder preview
  component removed (the letter page already rendered the signed PDF). Findings and the standards ceiling are in
  [`docs/EOFFICE_ESIGN_PLAN.md`](../../docs/EOFFICE_ESIGN_PLAN.md) and
  `decisions/esign-standards-ceiling.md`. Round 2 closed out on PR **#628**
  (all checks green 2026-09-29): the Devin findings F1–F12 are fixed, the
  CodeQL `js/insufficient-password-hash` alert on `publicKeyFingerprint` is
  cleared by removing the tainted path (the alert's source was a test
  passphrase literal, not production code), and the audit corrected a wrong
  premise — **Ed25519 does not block PAdES**; ETSI TS 119 312 V2.1.1 Table A.1
  lists EdDSA as _shall support_, and it is **AATL** that omits it. The
  a.n./u.b./Plt./Plh. signing-authority forms and signing uploaded DOCX/PDF
  bytes were built in `1513317`; the one remaining item, **PAdES B-B + RFC
  3161**, was **deferred (option b, 2026-09-29)** until the yayasan procures a
  TSA endpoint — without a trusted timestamp it adds a CMS/PKCS#7 builder and an
  X.509 certificate (today the signer identity is a raw public key) but no
  evidential value. The Ed25519→RSA/ECDSA switch stays an _interoperability_
  choice, not a PAdES requirement. See `decisions/esign-standards-ceiling.md`.

  **Round-2 follow-up, found by this agent (not in F1–F12): cross-unit service
  roles read the whole letter book.** `letterScopeWhere`, `assertLetterAccess`
  and `choosesUnit` keyed their "sees everything" branch on `seesAllUnits`,
  which is broad enough for shared services (a librarian sees every santri) but
  not for correspondence. Every cross-unit service account — pustakawan,
  perawat, keamanan, musyrif, ustadz, laboran, and the Pesantren office — was
  handed the entire yayasan's correspondence, unclassified letters included, and
  could pass `?unitId=` to read another school's agenda; the retention list came
  with it. The three now key on `isFoundationScopedRole` (board + super admin),
  the same line `admissions.access.ts` draws for SPMB, so those roles see only
  the letters they are actually part of. Regression tests pin the list clause,
  the direct read, and `choosesUnit`. Also silenced the `/correspondence/stats`
  toast the E-Office home fired for every staff member without letter duty
  (`skipErrorToast`), and hardened `verifyByPdfBuffer` to verify the _uploaded_
  hash rather than read back the field it looked the row up by.

  **Two gate defects found while closing the follow-up:** the retention
  controller test cast `vi.fn()` to `NextFunction` and read `next.mock.calls`
  (TS2339 under `build:strict`, fixed with `NextFunction & ReturnType<typeof
vi.fn>`), and `e-office-retention.spec.ts`'s unit-scope case registered its
  `waitForResponse` after `page.goto` (the race the file's own first test warns
  against; the listener now registers first). Both were pre-existing, neither a
  regression from the access-control change.

  **Third pass, 2026-09-29 — the signature's own invariants and the citations.**
  Walking the a.n./u.b./Plt./Plh. payload change to its end turned up four
  things a diff review would not:

  - **`canonicalVersion`.** Adding the authority fields extended the signed
    payload, so every letter signed _before_ the change would have been
    reported as forged (a `v1` signature checked against the `v2` shape). The
    payload is now versioned (`canonicalPayload(payload, version)`,
    `CURRENT_CANONICAL_VERSION`, `LetterSignature.canonicalVersion`,
    `canonicalVersionOf` mapping the pre-column `NULL` rows to `v1`), and
    verification reads the stored version rather than guessing.
  - **Upload ownership (CWE-639).** The `UPLOADED` signing path read
    `Letter.fileUrl` and signed those bytes without asking who uploaded them —
    so a drafter could paste another user's upload URL and have the system
    sign and archive _someone else's document_ as their own naskah. `LetterUpload`
    records `filename → userId` at upload, and `assertLetterUploadOwnedBy`
    refuses a file whose owner is not in the letter's chain; a file with no
    ownership row is refused, not waved through.
  - **A revoked download answered with the forgery sentence.** `stampRevoked`
    changes the bytes, so the system's own post-revocation download no longer
    matched `pdfHash` and `verifyByPdfBuffer` called it "tidak terdaftar". The
    stamped copy's hash is now stored on the archive at revocation time
    (`LetterSignedDocument.revokedSha256`) and matched exactly — replacing a
    bounded (200-row) recompute that silently stopped recognising older official
    copies.
  - **A retention guard that actually guards.** The user's hard constraint is
    that retention lists, never destroys; `letter-retention.no-destroy.guard.test.ts`
    now checks the job, its CLI _and_ the whole API tree for any `delete`/
    `deleteMany`/raw SQL `DELETE` of `Letter`/`LetterSignature`.

  **Citations corrected at the source.** Five files cited "Peraturan ANRI
  5/2021 Pasal 6" for the destruction rule; that regulation is _Pedoman Umum
  Tata Naskah Dinas_ and its Pasal 6 is about types of regulatory naskah —
  nothing to do with retention. The destruction rule is **UU 43/2009 Pasal
  51–52 jo. PP 28/2012**. Two more attributions were wrong the same way:
  signature validity cited UU 43/2009 (Kearsipan) instead of **UU 11/2008 jo.
  UU 19/2016 (UU ITE) Pasal 11**, and the urgency degrees were credited to
  Peraturan ANRI 5/2021 rather than the instansi tata-naskah pedoman. All fixed
  in `docs/EOFFICE_ESIGN_PLAN.md` (§2.9–§2.13, §4.3), the `naskah-dinas` skill,
  `decisions/esign-standards-ceiling.md` and the source comments.

- **The brochure's facilities, extracurriculars and agenda on the public site
  — merged 2026-10-04 (#653, #654), on staging and checked there.** Decided
  by the user (`decisions/fasilitas-dan-kegiatan-situs-publik.md`):
  _Fasilitas_ (`/campus`) and _Kegiatan_ (`/activities`) as two menu items,
  in Indonesian, English and Arabic. The extracurriculars are read from the
  portal module; the brochure's nine were loaded on staging by
  `db:seed:ekskul-2027-2028`, and staging's two invented demo rows were
  removed at the user's request. Production gets both with a release, after
  checking which extracurriculars it already holds. The facility icons wait
  for the brochure's original photographs, which the user is asking for.

- **Web Push and stored notification preferences — merged 2026-10-03
  (#626), on staging and proven there** (a push delivered to a real browser
  endpoint, decrypted). The user chose to build the sender
  (`decisions/notifikasi-push.md`): the notification table is the push
  outbox, preferences are stored for real, lock-screen text per category, one
  VAPID pair per environment (staging's set by the deploy job from the
  `staging` environment secret; production needs its own pair with the
  release). Then hand-written notifications limited to the sender's scope
  (#648), the setoran recorder skipped off Chromium (#649), and the CSP
  without `upgrade-insecure-requests`, which WebKit applied to `http://localhost`
  (#650, `lessons/webkit-seen-only-after-merge.md`).
- **Pengumuman, the one way to broadcast — merged 2026-10-03 (#651), on
  staging and proven there** (an admin offered only its unit; published to
  the unit's staff, out of every bell on withdrawal; writing to the yayasan
  refused; the old addresses 308). Decided 2026-10-03,
  `decisions/siaran-pengumuman.md`: sending by relation, bell + push only,
  no approval but recorded and withdrawable. Then (decided 2026-10-04, this
  PR): no list of everyone's notifications — the sender and the unit's
  overseers see, per announcement, bells reached and read; a notification is
  opened and deleted by its owner only; templates and the WhatsApp broadcast
  tab are gone.

- **Audit phase 1, area by area.** Done: Perizinan (#564, then #568 moved
  the decision to the mentor), Asrama (#569, #571), mata pelajaran and guru
  pengampu (#573), laporan harian (#577), the wali kelas relation (#579),
  daily attendance (#580, one page in #585, its follow-up in #587, #588 and
  #590, and the pattern flag in #596), behaviour notes (#581), the Kurikulum
  list (#589), one daily-report page (#592), the units' accreditation record
  (#597), accreditation on the public site (#598), the permit's doctor's
  note (#606), the koordinator asrama for izin pulang and bermalam (#607).
  Then Pengawasan Internal, Manajemen Risiko and Kepatuhan Syariah for the
  yayasan's organs, salvaged from #508 (#609, roadmap 00.8), Sentry
  removed (#610), and the unused Socket.IO server removed — the web polls
  (`decisions/realtime-polling.md`, 2026-09-28). Sign-in (roadmap 00.9):
  2FA recovery codes that work and the 2FA screens in Indonesian (#614),
  sessions that follow the account's live roles (#615), and 2FA mandatory for
  the head of every unit (#616). Then a unit's NPSN, set on _Edit Unit_, and
  Profil Unit's real statistics (#619). #441 (SSO and Blob storage) closed
  after its third audit; rebuilt as six PRs (roadmap 4). Profil → Legalitas
  states its governance note once (#622). The post-login invitation to turn
  2FA on (#623), and the realm badge beside a role name for every realm
  (#624). The session moved to HttpOnly cookies (#620, issue #523). The
  password rules (00.9, part A: #625), and the forced password change (part
  B: #632). Then, in the order decided on 2026-10-02: the users-module scope
  fix (#634), and SPMB 2027/2028 in the portal and on the public site
  (`decisions/spmb-2027-2028.md`, roadmap 00.10). Its first part: the units'
  official identity on every document, with the Rapor Merdeka PDF readable
  again (#635). Then every document of a test copy stamped "SALINAN UJI"
  (staging, #636). Then the real office holders: one list in
  `@cipansor/shared` (`office-holders.ts`) for the public site's full
  structure (Profil → Pimpinan, three languages), the seed's organs and the
  demo accounts. A guarded migration renames the demo accounts and sets the
  invented board rows aside. The portal's Organ Yayasan tab is grouped by organ,
  and its add and edit forms work again (#637). Then printed documents signed
  by the unit's real head (`GET /units/:id/head`), the tahfidz certificate
  signed as the yayasan's own is, and every print window stamped on a test
  copy through one `printDocument()`. #636 had missed the five pages that print
  from a window of their own (#638). The surat keterangan santri goes through
  E-Office (decided 2026-10-02, `decisions/surat-keterangan-lewat-eoffice.md`;
  not built). Then the SPMB module itself. First, each unit's intake is
  entered in the portal (Penerimaan (SPMB) → Periode & Gelombang): the waves
  with their test, results and re-registration days and the discount for
  paying in full, and the unit's requirements, minimum age and contact. Wave
  statuses now follow their dates daily at 00:01 WIB; nothing had run that
  update (S3a, #640). Then each unit's fee table as the brochure's "Rincian
  Biaya" prints it, with the totals computed from the lines (S3b, #641).
  Then the public page reads each unit's intake from
  `GET /admissions/public/intakes` — one tab per unit, the open one first,
  with its waves, fee table and totals, requirements and contact, labelled in
  three languages — and a registration goes to the chosen unit's period. An
  intake counts as open only while one of its waves is: between two waves
  the API refused the form the page offered. The homepage badge and the
  chatbot read the same intakes; `/public/active-period` and `/public/units`
  are gone (#642). A new high advisory with no fixed release (`braces`,
  dev-only) is accepted until 2026-11-03 by the Security job, and dompurify
  moves to 3.4.16 (#643). Then the brochure itself: loaded by a script
  (`db:seed:spmb-2027-2028`, decided 2026-10-03, #644), on staging since
  2026-10-03 and on production with a release; each unit's admin still sets
  the real wave quotas and the contact. Then the seeds make a unit's intake
  in the module's shape too — one period, two waves around today, the
  brochure's fees — named apart from the brochure's (S5b, #645). A
  registrant's Qur'an ability got one vocabulary: the public form had sent
  codes no score read (#646). Then the public SPMB form, its status lookup
  and its document upload in Indonesian, English and Arabic, right to left in
  Arabic (S6). Then the brochure's programmes, facilities, extracurriculars
  and agenda on the public site in three languages (#653, #654). Now the
  Pesantren unit.
  Still open from before: the wali's
  approval for staff-filed leave off the pondok (roadmap 00.5, third part).
  Next: the rest of the homeroom pages (below), the class and teacher
  schedules, HR employees, Sertifikat, then the dead calls, `services/` and
  the `api-client` alias.
- **Homeroom, what is left** (known-issues, "Homeroom pages that still do
  not work"): _Pesan Orang Tua_, the pupil page's figures, the kepala
  sekolah's way to a class's dashboard.
- **Naming, endpoint and architecture audit — done 2026-09-25**; the user
  widened it the same day to every module without exception, every API
  endpoint and web route, the repository structure, the architecture and
  `AGENTS.md`, and allowed a total restructure provided it is tidy and
  standard. Report: <https://claude.ai/artifact/CqSKU3Zh7tYtDC5LSFvQL9>.
  Measured: 213 web call sites hit API paths that do not exist (109 reachable
  from pages, in 31 areas — proven on staging: `POST /permits/:id/approve`,
  `/curriculum/curriculums`, `/hr/employees`, `/certificates` all 404);
  10 API modules and 9 web routes are misnamed, 35 + 32 more need tidying;
  Most modules did not meet the module standard (measured in `known-issues.md`). Plan in seven phases (roadmap §1):
  guards → reconnect the broken contract → glossary → consolidate duplicates →
  API by context under `/api/v1` with a Zod → OpenAPI contract → web → harden
  → docs. The glossary still comes before Model A's permission keys.
  **The user decided the eight naming questions the same day and said
  "laksanakan"** — recorded in `decisions/istilah-dan-penamaan.md`: murid in
  the schools, santri in Takhosus; the yayasan's spellings (Takhosus, Tahfidz);
  portal Indonesian only, public site in three languages; tables renamed with
  their models; `/api/v1`; no laboratory module; donations, ZIS and wakaf built
  to the law. Phases run in order from 0.
- **Skipped tests** — asked by the user on 2026-09-25, to take in priority
  order: make every skipped API, web and Playwright test run, or say why it
  cannot. Known so far: 92 of the 94 skipped API tests are two opt-in suites
  that need a real Postgres (`decommission-pt-session.integration`,
  `database-migrations`); the Playwright suite has data guards
  (`test.skip` when the seed lacks rows) and firefox/webkit run with
  `continue-on-error`. The Chromium run reports 41 skipped (2026-09-27);
  one of them, `tk-daily-report`, had been hiding a broken flow for months
  (`lessons/guard-tests-that-measure-the-wrong-thing.md`).

- **Issue triage, 2026-11-12 (#872, tinjauan putaran 2 pada PR #1068):** jembatan
  triase, cabang `fix/872-triage-sweep-fifo`. Reviewer menemukan bahwa
  `drain_retry_markers` **menghapus** kunci `triage-retry-<n>` begitu checkpoint
  menyebut sebuah run — padahal `activity_signal` hanya menghitung body issue +
  komentar non-armada, **tidak** label. Run yang didispatch *sebelum* label masuk
  (mis. run lama pada issue `ready`, yang sweep biasa lewati) memfinalkan issue
  tanpa meninjau label itu, dan menghapus retry di situ membuang satu-satunya
  kesempatan label ditriase. Perbaikan: drain menahan retry selama checkpoint
  masih menyebut run (in-flight **atau** selesai-belum-difinalkan); run yang
  memfinalkan checkpoint mengosongkan `run`, jadi pass berikutnya berhenti
  menahan, melipat retry menjadi `pending`, lalu mendispatch. Tes round-trip tiga
  pass (RUNNING → COMPLETED → kuras) **merah** pada skrip sebelum perbaikan
  (`triage-retry-818` hilang), hijau sesudahnya; berkas guard 174 lulus.
  Commit `8701601f`, dipush; balasan basmalah diposting. **Golden rule 9:** PR
  draft **#1058** (`fix/838-label-guard-relabel-after-revocation`) menyentuh
  keempat berkas yang sama — wajib digabung di worktree + gerbang bersama
  sebelum yang kedua di-merge. (Satu tes `pnpm-supply-chain.guard.test.ts` gagal
  di lingkungan ini karena `pnpm` adalah shim npm — sudah gagal di `main`, bukan
  regresi.)

- **Issue triage, 2026-11-11 (lanjutan):** #825 (`documentation`, kontrak
  `dueDate` tanggal-saja + kalender WIB setelah #775) dikerjakan di **PR #1049**
  pada `docs/825-dueDate-wib-contract`: `MOBILE_API.md` §3 menyebut `dueDate` =
  `YYYY-MM-DD` dan bulan tagihan WIB; `DOKUMEN-TEKNIS.md` §8 dapat butir
  konvensi tanggal/waktu (menunjuk `utils/wib-day.ts`) dan §6.6 menyebut bulan
  WIB; `PANDUAN-PENGGUNA-BENDAHARA.md` menjelaskan Tanggal Jatuh Tempo = sebuah
  tanggal (bukan jam), dengan ambang menunggak 07.00 WIB. `check_docs.py` tidak
  menambah ERROR (16 teknis / 2 pengguna =
  baseline `main`). Murni dokumentasi → job kode CI di-skip. Beririsan berkas
  dengan PR dokumen yang menunggu (#1035/#1036/#1046) tetapi di lokasi berbeda;
  nomor versi diambil 1.4/0.3 agar tak bentrok. **Koreksi tinjauan:** versi awal
  salah dua kali — (a) `getChildFinance` mengembalikan `dueDate` sebagai
  **timestamp ISO**, bukan `YYYY-MM-DD` (Prisma `Date` diserialkan `res.json`);
  (b) `getStudentOutstandingBalances` (`dueDate < new Date()`) membuat tagihan
  menunggak **07.00 WIB** pada tanggal jatuh tempo, bukan akhir hari — jadi
  "sehari penuh" itu tidak benar. Dokumen dikoreksi; cacat kode dilacak di
  **#1050** (`lessons/date-only-midnight-utc-vs-now.md`). **PR #1049 sudah
  MERGED ke `main`** (merge commit `25693e32`, 2026-11-11), jadi #825 selesai.

- **Issue triage, 2026-11-11 (lanjutan 2):** #830 (`docs`: aturan pin GitHub
  Actions ke commit SHA) + #943 (`docs`: batas bawah `overrides` + penjaga
  pnpm-supply-chain) dikerjakan bersama sesuai keputusan maintainer **K16** di
  **PR #1051** pada `docs/830-943-ci-supply-chain`. Subbagian baru **"Rantai
  pasok CI"** di `docs/SDLC-FLOW.md` (kedua aturan), satu baris di blok gerbang
  mutu `AGENTS.md`, satu baris DT §10 "Keamanan: rantai pasok", satu kalimat
  kebijakan `overrides` di `docs/DEPLOYMENT.md`, dan tiga berkas `.claude/`
  (gate/SKILL.md, lessons/audit-deps…, roadmap.md) diubah dari "pin" menjadi
  "batas bawah ≥ rilis perbaikan pertama". `docs/SDLC-FLOW.md` tergolong
  **kode** (`is_code()`, dibaca `automation-fleet.guard.test.ts`), jadi job CI
  berjalan. `check_docs.py` 16 ERROR = baseline; guard (automation-fleet,
  github-actions-pinning, decommissioned-modules) lulus 189; sensitive bersih.
  Satu uji `pnpm-supply-chain.guard.test.ts` gagal **lingkungan** (pnpm tak
  terpasang di sini) — lulus di CI. **#801** (docs #747: cakupan baca portofolio
  + balasan pesan) sudah ditangani di PR #1035 (branch #778), jadi tidak
  diduplikasi. **#749** sudah ditangani PR #1033. **#778/#779/#792/#811**
  masing-masing sudah punya PR terbuka (#1035/#1036/#1046/#1048).

- **Issue triage, 2026-11-11 (lanjutan 3):** #833 (`docs`: jalur galat 409 pada
  keputusan cuti setelah #668) dikerjakan sesuai keputusan **K17** di **PR
  #1052** pada `docs/833-leave-409`: DT §8.3 menyebut `Errors.conflict` → 409 +
  pemakaiannya di modul `hr` (keputusan cuti bersamaan; setujui dua kali =
  idempoten, tolak yang sudah disetujui = 400); panduan Kepala Unit kartu
  *Mengelola pegawai dan cuti* menambah baris 409 (pesan disalin persis dari
  `hr.service.ts`, penjaga `pesan-karangan` mencocokkan ke kode web+API);
  `README.md` baris Kepegawaian. Anotasi Swagger `409` di `hr.routes.ts`
  dikeluarkan dari lingkup (K17 → PR kode terpisah) dan **dilacak di issue baru
  #1053** (`documentation`, `priority:low`). `check_docs.py` TEKNIS 16 =
  baseline, KEPALA-UNIT 2 = pra-ada (L386 `**Buat Baru**`, L403 pesan "Judul dan
  konten wajib diisi"); sensitive bersih. Catatan: `progress.md` disunting di
  tiga cabang (#1049 sudah merged; #1051 & #1052 menambah blok di titik yang
  sama) sehingga resolusi konflik = simpan kedua blok.

- **Koreksi tinjauan #1052, 2026-11-12.** Tinjauan `adminypc` meminta lebih dari
  sekadar kutipan pesan: kartu panduan Kepala Unit menjanjikan kemampuan yang
  tidak dimiliki perannya. Diverifikasi pada tumpukan berjalan: `POST
  /hr/employees` dan `PATCH /hr/leaves/:id/approve` sama-sama dijawab **403**
  untuk `*_KEPALA_SEKOLAH` (kelompok TEACHER; rute `authorize(SUPER_ADMIN,
  UNIT_ADMIN)`). Maka kartu *Mengelola pegawai dan cuti* diganti menjadi
  *Memantau pegawai dan cuti* (hanya tab Karyawan/Cuti/Risiko Retensi), baris
  galat 409 dilepas dari kartu (peran tak dapat mencapainya; tetap di DT §8),
  dan Riwayat Revisi 0.2 kembali jujur **T1** karena langkah barunya dijalankan
  ulang. `README.md` menyebut aktor yang benar (admin unit / Super Admin).
  Sekaligus ditemukan cacat aplikasi di luar lingkup dokumen: **formulir
  *Ajukan Cuti*** mengirim **id pengguna** sebagai `staffId` (API menuntut id
  profil pegawai) → 404 "Staff not found"; dilacak di **#1061**.

- **Koreksi tinjauan #1052, putaran kedua, 2026-11-12.** Setelah balasan putaran
  pertama, kartu *Memantau pegawai dan cuti* masih menyatakan hal yang tidak
  benar dan diverifikasi ulang pada tumpukan berjalan (kepala `sdit.kepala`):
  langkah "saring dengan **Semua Status**" **tidak menyaring** (`GET
  /hr/employees?status=ACTIVE|INACTIVE|ON_LEAVE` → total 8, sama; `RESIGNED`/
  `RETIRED` → 400 karena `queryTeachersSchema` hanya menerima tiga nilai), dan
  klaim tab **Cuti**/**Risiko Retensi** berisi data keliru — `GET /hr/leaves`
  kepala → **404 "Employee profile not found"**, `GET /hr/analytics/retention-risk`
  → **403** (rute admin-only), jadi kedua tab kosong bagi kepala. Kartu
  dirapikan: hanya tab **Karyawan** (8 pegawai) yang dijanjikan, kotak **Cari
  nama atau NIP...** menggantikan saringan status, dan tab Cuti/Retensi
  dinyatakan kosong bagi kepala. Gambar 6 ditangkap ulang dari `/hr` (kepala,
  tab Karyawan) dan manifes diperbarui. Riwayat Revisi menambah baris **0.3**
  (kode `6b3c6127`). `.claude/memory/known-issues.md`: entri formulir cuti
  diperkaya (unit admin 404, Super Admin **500** FK `leaves_staff_id_fkey`,
  guru-untuk-diri 403, staf non-guru 404) dan ditambah entri baru "saringan
  Status `/hr` tidak menyaring + menawarkan status yang ditolak API 400".
  `check_docs.py` KEPALA-UNIT tetap **2 ERROR** (keduanya pra-ada di `main`:
  kartu Pengumuman `Buat Baru` & pesan "Judul dan konten wajib diisi").

- **Koreksi tinjauan #1052, putaran ketiga, 2026-11-12.** Dua temuan lanjutan
  `adminypc`: (E) kartu menyembunyikan akses cuti pribadi kepala unit; (F)
  anjuran "abaikan notifikasi galat" terlalu luas. Diverifikasi pada tumpukan
  berjalan dengan **dua** akun kepala: `smpit.kepala` (punya baris `staff`
  **dan** `teacher`) vs `sdit.kepala` (tak punya profil). Temuan E benar dan
  lebih halus dari dugaan: `getLeaves` (controller) membatasi non-admin ke
  profil sendiri tetapi **mendahulukan `teacherId` atas `staffId`**, jadi cuti
  yang dibuat pada baris `staff` tak pernah muncul bagi kepala yang punya
  keduanya — `POST /hr/leaves` (staffId) → **201**, `GET /hr/leaves` → **0
  baris**. Kartu diperbaiki: tab **Cuti** = pengajuan atas nama profil kepala
  sendiri (bukan seluruh unit), tab **Risiko Retensi** tak dapat diakses kepala
  (403); baris bantuan dipisah untuk kedua tab. Temuan F: notifikasi galat
  berasal dari `retention-risk`/`contracts-expiring` (403, selalu) dan `leaves`
  (404, hanya bila profil kepala tak ada) — `useEmployees` justru **berhasil**
  (kepala dijawab 200, 8 baris), jadi kartu kini menyuruh mengabaikan galat
  **hanya bila** daftar **Karyawan** tetap tampil. `known-issues.md`: entri
  notifikasi diperjelas (2 vs 3 toast per akun) + entri baru "tab Cuti non-admin
  menyaring profil yang salah". Riwayat Revisi 0.3 diperbarui.

- **Koreksi tinjauan #1052, putaran keempat, 2026-11-12.** Tiga temuan
  presisi lanjutan atas kartu yang sama, semuanya diperbaiki: (G) batasan dua
  profil — daftar **Cuti** non-admin hanya membaca **satu** profil
  (`teacherId` didahulukan) sedangkan `createLeave` mengisi `staffId`, jadi
  pengajuan pribadi pemilik dua profil bisa hilang dari daftar; kini
  dinyatakan di langkah dan tabel bantuan (perbaikan perilaku perlu PR kode:
  `getLeaves` menggabungkan kedua profil). (H) tab **Risiko Retensi** tetap
  **dapat dibuka** kepala unit — yang ditolak hanya permintaan datanya (403),
  jadi kartu tidak lagi menulis "tidak dapat diakses". (I) petunjuk
  "abaikan galat" dirapikan: hanya galat **Risiko Retensi** yang boleh
  diabaikan; galat **Cuti**/lain harus diperiksa lebih dulu sebelum
  dilaporkan. `known-issues.md` entri tab Cuti dipertegas (kedua profil;
  solusi = union).

- **Model A design document** — approved to draft on 2026-09-25: a permission
  per feature and action, data scope from the assignment, menus derived from
  permissions, separation-of-duty rules locked in code, and the account
  lifecycle (joiner–mover–leaver, immediate deactivation, SCIM from Microsoft
  Entra or a Google Directory API sync after SSO). For the user's review before
  any code. `docs/DEPLOYMENT.md` goes
  after 2026-10-01 (the VM is the rollback target until then, and a guard test
  reads it).

- **Issue triage, 2026-11-11 (continued, oldest open `ready` first):** #811
  (`refactor`, the date-only sweep for `Invoice.dueDate` — K15) implemented in
  **PR #1048** on `refactor/811-date-only-dueDate`: the non-formal course
  invoice writer now stores `dayDate(wibDayOf(now + 7d))`, `getSppMatrix`
  bounds the year and reads the month on the UTC calendar (dropping the dead
  `monthDate`), the SPP seed uses `Date.UTC`, and `dayDate`'s comment again
  claims the single canonical form. New coverage: `tests/spp-matrix.test.ts`
  (runs under a non-UTC `TZ`) plus two non-formal dueDate cases; four of them
  fail on `main`, all pass after. Gate green locally (api 5177, web 961,
  build:strict, lint). E2E red on the **runner DNS flake** (apt cannot resolve
  `security.ubuntu.com` in *Install Playwright*), not the diff. The review's
  first round then found the regression this PR's own canonical form caused —
  a date-only `dueDate` compared to `new Date()` marks a bill overdue at 07:00
  WIB on its due day — so a follow-up commit adds `wibOverdueCutoff()` and
  replaces that bound in `getInvoices`, `getStudentFinanceSummary`,
  `getFinancialSummary`, `getStudentOutstandingBalances`, `getSppMatrix`, the
  dashboard alert, `checkOverdueInvoices` and parent-engagement. The review
  asked for tests pinning the three changed services (golden rule #7); added
  in `dashboard/tests/wib-day-bounds.test.ts`, `analytics/tests/wib-day-bounds.test.ts`
  and a new `analytics/tests/alerts-overdue-bound.test.ts` — all three fail on
  the pre-fix code. Gate green locally (api 5188, build:strict, lint).

- **Issue triage, 2026-11-11 (lanjutan 5):** #848 (`bug`, `priority:medium`,
  jembatan triase mendispatch `SDLC 01` pada label bot → triase ganda)
  **ditutup dengan bukti** — bukan karena kurang bermanfaat. **K26** sudah
  terpenuhi oleh commit `c86b9969` (2026-11-09, masuk `main` lewat PR #972 yang
  tidak menyebut nomor issue ini, sehingga ia tertinggal terbuka): `SDLC 01 ·
  Triase bug` dilebur ke `SDLC 15 · Triase issue`, dan
  `issue-triage-bridge.sh:71` kini mendispatch id SDLC 15 (`42ec7401…`) saja.
  Penjaga `apps/api/src/utils/automation-fleet.guard.test.ts` (*"folds Triase
  bug into the single triage owner"*, 163 tes lulus) menegaskan jembatan memuat
  id SDLC 15 dan **tidak** memuat id SDLC 01; `docs/SDLC-FLOW.md` butir 1 & 3
  ditandai **SELESAI (2026-11-09)**. Komentar penutup mencatat tiap kriteria
  penerimaan beserta buktinya.

- **Issue triage, 2026-11-11 (lanjutan 4):** #849 (`bug`, `priority:high`, tab
  **Hari Ini** halaman Menu Makan selalu 404) dikerjakan sesuai **K5** di
  **PR #1059** pada `fix/849-meals-today-routing`. Cacatnya routing **dan**
  bentuk respons: web memanggil `GET /meals/menus/today?unitId=`, tidak ada
  rute yang menjawabnya — `/menus/:id` mengambilnya dengan `id = "today"` →
  selalu 404; dan handler hari ini mengembalikan array sedangkan halaman
  membaca `{ breakfast, lunch, dinner, snack }`. Perbaikan: hook memanggil rute
  kanonik `GET /meals/menus/today/:unitId` (unit di path, seperti
  `calendar`/`duty-roster`) lalu **melipat** array ke objek yang dibaca
  halaman; query nonaktif tanpa unit; tab Hari Ini meminta memilih satu unit
  saat "Semua Unit" (tidak ada agregasi, K5). Tes: `use-meals.test.tsx` (3),
  `today-menu-route.test.ts` (mengunci rute kanonik + 404 path lama),
  `e2e/meals.spec.ts` (gagal sebelum, lulus sesudah). Tangkapan sebelum/sesudah
  di cabang `screenshots/849` (`docs/pr-screens/849/`). Cakupan hanya tab Hari
  Ini; tab Mingguan & `/meals/stats` menyusul sebagai issue terpisah (K5 poin
  3). Cacat WIB di `getTodayMenu` sudah beres di `main`. Tidak ada PR terbuka
  lain yang menyentuh berkas `meals` → aturan emas 9 tidak berlaku. Pelajaran
  ditambahkan ke `lessons/api-integration-traps.md`.
- **Issue triage, 2026-11-11 (lanjutan 6):** #866 (`bug`, `priority:medium`,
  check wajib `PR template reminder` bisa merah permanen karena balapan label
  issue tertaut) dikerjakan sesuai **K27 opsi A** di **PR #1063** pada
  `fix/866-template-check-republish`. Bug blok kode (`Cara menguji` hanya fence)
  sudah lebih dulu diperbaiki di `main` (#965), jadi yang dikerjakan tinggal
  celah balapannya: `issue-label-sync.sh --issue` kini menjalankan ulang gate
  terhadap kepala tiap PR terbuka yang menutup issue itu dan menerbitkan check
  `PR template reminder` di sana (pola `publish_pr_check`, digeneralisasi jadi
  `publish_check <name>`); guard dijalankan dengan `BASE_REF` PR agar hasilnya
  setia. `issue-label-sync.yml` meneruskan `DEFAULT_BRANCH`. Uji guard baru di
  `github-label-guards.guard.test.ts` (`PR template reminder re-publish (#866)`):
  **gagal 4** terhadap skrip pra-perbaikan, **lulus 25** sesudahnya. Suite API
  penuh 5161 lulus. Pelajaran baru:
  `lessons/required-check-wedged-by-label-race.md`.

- **Issue triage, 2026-11-11 (lanjutan 6):** #867 (`chore`, lima job Actions
  tanpa `timeout-minutes`) dikerjakan di **PR #1064** pada
  `chore/867-workflow-job-timeouts`. Jumlahnya sudah bergeser: kini **6 job**
  (bukan 5) — `deploy-production.yml` menambah job `gate` setelah issue ditulis;
  total 31 job di 19 workflow. Ditambahkan plafon sesuai durasi nyata + margin:
  15 (release gate), 45 (kedua job deploy; staging 7–9 mnt, produksi 2–3 mnt),
  30 (kedua job load-test). Guard baru `workflow-job-timeout.guard.test.ts`
  menuntut **setiap** job di `.github/workflows/*.yml` punya `timeout-minutes`
  berupa bilangan bulat positif < 360; **gagal** pada workflow pra-perbaikan
  (keenam job terdaftar), **lulus** sesudahnya. Suite API penuh 5183 lulus.

## Recently done (2026-10-09 → 10)

- **Merged:** #655 (SPMB banner and delayed dialog on the public site), #657
  (assistant on staging, widget in id/en/ar), #716, #720, #724 (Apache 2.0
  while the repository is public), #628 (E-Office audit round 2), #728, #736
  (migrations use no PostgreSQL extension), #698 (every bracketed placeholder
  reported, with an oracle test), #675 (`/health` answers 503 when the database
  is unreachable, with a bounded probe), #711 (fleet renumbered, target design
  and implementation steps in `docs/SDLC-FLOW.md`, hard PR-description gate),
  #744 (letter and agenda numbers use the WIB calendar), #677 (k6 smoke before
  each release), #664 (deploy watchdog).
- **Decided:** `decisions/otomasi-armada.md` (alerts, k6, release label, no
  CHANGELOG, private advisories, duplicates, #680, the human note) and
  `decisions/showcase-portofolio.md`.
- **Closed without merging:** #748 (duplicate of #708), #681, #682 and #683
  (#680 handled by the rule already in `docs/LABELS.md`).
- **Found while reviewing:** #749 (14 routes answer 400 to every write), #754
  (marketing trend 500, fixed by #691), #755 (campaign ROI never counts the
  registration fee).

## Recently done (2026-09-24 → 28)

- **A permit's doctor's note (#606, merged 2026-09-28):** the wali or staff
  attach a photo or PDF (5 MB, type read from the bytes) when filing; the
  decider, the unit head and the wali open it in the page, each opening
  audited; everyone else sees that one exists. Kept in the database, erased
  nightly once the leave's academic year has ended. Also: an upload over
  multer's limit is a 400, not a 500, on every route. Before/after:
  <https://claude.ai/artifact/8g9EKudwHe51HuhSfazT2c>.
- **Project task notice (#605, merged 2026-09-28):** a saved task is no
  longer reported as failed when telling its assignee fails.
- **Units' accreditation (#597 record, #598 public site; both on staging
  2026-09-28):** one official record per unit, kept by the unit's admin or
  the Super Admin at _Sistem → Profil Unit_ with the certificate PDF, read by
  the EMIS/Dapodik exports and the SKHUN; the public site shows the one in
  force on _Profil → Legalitas_ and the unit's section, in three languages,
  hidden once expired; a reminder 12 months before. Before/after:
  <https://claude.ai/artifact/3hknmFTyFDXGC21eRhSaoV>,
  <https://claude.ai/artifact/4seR52ain9pns4gimg7iz3>.

- **Absence follow-up, tier 2 (#588, merged 2026-09-28):** _Wali Kelas →
  Tindak Lanjut Absensi_ (and _Pengasuhan → Tindak Lanjut Absensi_ for the
  musyrif) lists the last 7 days' Alpa with no reason, whom to call (linked
  walis, then the enrolment contact; tel and WhatsApp links) and what was
  tried. _Catat hasil_ logs a contact (`attendance_follow_ups`, additive
  migration): Sakit/Izin change the mark, "tanpa keterangan" closes it,
  "tidak terhubungi" keeps it open. A santri mukim's Alpa is their
  musyrif's; everyone else's — a boarder with no musyrif on record included —
  the wali kelas's. 15:00 WIB reminder, in the app and by email. Before/after:
  <https://claude.ai/artifact/Pf6E87kiXVtoWY5zVMi3Yk>.
- **Alpa/Terlambat told at once, and a personal inbox (#587, on staging):**
  the wali in the app and by email, a boarder's musyrif in the app; only a
  change, only today's register. The header bell opens _Notifikasi Saya_
  (`/notifications/me`) for every role. Before/after:
  <https://claude.ai/artifact/U8v1GvscgBToGn5JbyfY34>.
- **Open (auto-merge):** #589 the Kurikulum list removed, its addresses 308
  to Kurikulum Merdeka, the page renamed _Mata Pelajaran & Jadwal_
  (<https://claude.ai/artifact/A2DxB8CfdYucgp7Swwdeuy>); #590 the register
  reminder 30 minutes after a class's first lesson (in-app, holidays silent).

- **The donation forms offer what the yayasan offers (#584, merged
  2026-09-28):** Zakat Maal and Zakat Fitrah are off the public _Wakaf &
  Infaq_ form and staff entry (_Keuangan → Donation/ZIS → Catat Donasi_), and
  the API refuses them on both create routes; one list in shared
  (`OFFERED_DONATION_TYPES`). Before/after:
  <https://claude.ai/artifact/5h545yrMwLAuvtc9HmnRcE>.
- **One register, one page (#585, merged 2026-09-28):** _Wali Kelas →
  Absensi Harian_ opens `/attendance/record` on the homeroom class;
  `/homeroom/attendance` 308s and its copy is gone; the sidebar lights one
  entry (`activeNavHref`). Before/after:
  <https://claude.ai/artifact/Xpvzges8nGMSjSxCEMwHXh>.
- **Golden rule 12 (#583):** a decision that is the user's is researched
  first, then offered as a multiple-choice question.

- **Wali kelas is a relation, not a role (#579, merged and on staging
  2026-09-27):** the _Wali Kelas_ menu group shows for the wali kelas of a
  class this academic year (`Class.homeroomTeacherId`); a class's homeroom
  data is read by its wali kelas and the unit's kepala sekolah and operator,
  written by the wali kelas in the current year, 404 to other teachers; notes
  are changed by their author only; responses carry five pupil columns. The TK
  wali kelas persona now holds TK A. Before/after:
  <https://claude.ai/artifact/6fki1HjBDZcqigUKE8W9cR>.
- **Daily attendance is taken by the people who teach the class (#580,
  merged 2026-09-27):** until then every teacher, wali kelas and kepala
  sekolah got 403 saving a register (**Mengajar → Absensi → Input
  Kehadiran**; **Wali Kelas → Absensi Harian** called routes that did not
  exist). Now the class's wali kelas, a teacher with a lesson in it, and the
  unit's operator; the day is a calendar day; saving again corrects it;
  `GET /attendance/me/classes` tells the page which registers the user takes.
  Before/after: <https://claude.ai/artifact/7SjEhmVqzSwxxrDvpGardr>.
- **Behaviour notes (#581):** **Wali Kelas → Catatan Perilaku** lists and
  writes the class's notes; a positive note is no longer stored as a
  violation; a note needing attention keeps its action. Before/after:
  <https://claude.ai/artifact/WxamzJEDT1AKdjpsGfwMDJ>.

- **Laporan harian end to end (#577, merged 2026-09-27):** a TK guru writes a
  child's day with a photo (**Mengajar → Mutabaah Yaumiyah → Buat Laporan**;
  the button used to open "Laporan tidak ditemukan"), the wali reads and
  acknowledges it (**Anak Saya → Laporan Harian**; it used to say "Data Siswa
  Tidak Ditemukan"), and the TK admin's form, edit page and check-in save.
  One contract in `packages/shared/src/schemas/daily-report.ts` (calendar
  day; unit and year derived from the pupil and date; photos are uploads);
  who reads and writes is set per role and per child; forms no longer fill in
  meals, health or mood nobody recorded. Before/after:
  <https://claude.ai/artifact/JwabzXL9oGAKLJ8iXhxkEk>.
- **An empty Select shows its placeholder (#576):** the wrapper's `""`
  sentinel only applies when an "All" item exists
  (`lessons/select-empty-value-sentinel.md`). Before/after:
  <https://claude.ai/artifact/7aRTpH1sy1WKiHTyaFhTkJ>.
- **Wakasek and wali kelas are duties of a guru, not role codes (#575):**
  every `*_WAKASEK` and `*_WALI_KELAS` assignment moved to `*_GURU` of the
  same unit (migration replayed on a copy of production first); 53 role codes.
  Decision: `decisions/peran-dan-tugas-tambahan.md`. Before/after:
  <https://claude.ai/artifact/3p6XhHyASGZYNH4uWSxuYs>.
- **Confidential counselling sessions (#574, on staging, verified):** read in
  full by their counsellor and the unit's guru BK; the kepala sekolah sees
  that they exist and their referrals; nobody else receives them.
  Before/after: <https://claude.ai/artifact/Q6hbYf2fEzfo9W51h2E3p4>.
- **Mata pelajaran and guru pengampu work end to end, within the unit
  (#573).** Before/after: <https://claude.ai/artifact/HpkA1erLZGkdZb47QJBJVd>.

- **Asrama end to end (#571, merged 2026-09-26):** adding and editing an
  asrama, adding, changing and deleting a kamar, and placing a santri all
  failed before (wrong field, PATCH to a PUT route, the facilities module's
  rooms); "Terisi" was always 0. One contract in
  `packages/shared/src/schemas/dormitories.ts`; the API keeps kamar capacity,
  occupied kamar/asrama cannot be deleted, placements move in one
  transaction, placement reads carry four student fields instead of the row.
  Who writes is unchanged (question above). Before/after:
  <https://claude.ai/artifact/BeJwFwWPbtFdo4NhJAicT1>.
- **A santri's leave is decided by their own mentor (#568, merged
  2026-09-26):** the musyrif of their kamar or asrama for a boarder, the wali
  kelas otherwise; the unit head for more than seven days, for a santri with
  no mentor on record, or as a recorded takeover. Admins no longer decide.
  Every permit carries `decision`; **Perizinan → Perlu keputusan saya**; the
  wali kelas menu gained Perizinan; migration `20260926000000_permit_decider`
  (additive). The demo wali kelas and musyrif personas now have classes and
  kamar. Rule and sources: `decisions/pemutus-izin-santri.md`.
- **Musyrif assigned from the asrama page (#569, merged 2026-09-26):** nothing
  could write `musyrif_assignments` before; **Asrama → an asrama → Musyrif →
  Tugaskan musyrif** (Pimpinan Pesantren and super admin). Same PR: the kamar
  list called a path the API never served, and every asrama read "Putri" and
  "Tidak Aktif". #568 and #569 were gated together (rule 9) before merging.
  Before/after for both: <https://claude.ai/artifact/HRLjvCfZu1c9Z9hHM9ftQp>.
- **User credentials leave the database only when a query names them (#565)**
  and **plain notification text is escaped in e-mail bodies (#566)**, both
  merged 2026-09-25.

- **Perizinan end to end (#564, merged 2026-09-25, on staging):** one contract
  in `@cipansor/shared` (`schemas/permits.ts`: types, Zod, and the role lists
  both sides read); a status flow with conditional moves (409 otherwise); reads
  scoped by `studentScope`; Pos Gerbang at `/permits/gate` for keamanan (308
  from `/reception/gate`); wali, staff dashboard and musyrif card on the same
  hooks; e2e `permits.spec.ts` (wali files → kepala approves → keamanan out and
  back → bendahara refused). Before/after on staging:
  <https://claude.ai/artifact/HQPwoVwwzJzuAxUHZrxs4M>. #564 merged with the
  CodeQL check red, which is why CodeQL became required; #566 fixed the sink.
- **Web ↔ API contract guard (#563):** `utils/web-api-contract.guard.test.ts`
  asks the real router about every web call; a baseline that only shrinks.
- **Naming decisions and `AGENTS.md` conventions (#562)**; records (#561).
- **Roles reach their own pages (#559, merged 2026-09-25, verified on
  staging):** kepala sekolah open `/perencanaan` (200, was bounced to
  `/dashboard`) and drafted and deleted an RKA Unit through the API;
  pustakawan `/library`, laboran `/inventory`, manajer usaha `/unit-usaha`
  all 200; tata usaha still sent from `/library` to `/staff`. The yayasan
  organs' accounts need 2FA, so their menu was checked by the e2e spec only.
- **Four API routes that never ran (#560):** `GET /simaan/upcoming`,
  `POST /notifications/whatsapp/send`, `GET /donation/mustahik` (each
  swallowed by a `/:id` sibling) and a second `POST /inventory/depreciation/run`.
  `utils/route-shadowing.guard.test.ts` walks the real router tree.
- Agent context step 4: the domain skills `panduan-peran`,
  `tata-kelola-yayasan` and `naskah-dinas` (#558).

- Santri and staff data scoped to the caller (#546, #547, #549, #550);
  2FA required for the yayasan organs (#548); a unit admin can no longer make
  themselves Super Admin (#543); CodeQL alerts cleared (#545).
- Pesantren role catalogue (#552): no Direktur, the Kiai is Pimpinan Pesantren
  and also Pembina; Musyrifah, Wali Kamar and Murabbi merged into Musyrif,
  Muhafidzah into Muhafidz.
- The E2E helper that picked another spec's plan (#551).
- The server checks who is named _atasan penilai_ on a PK: never the owner,
  and only someone who holds a supervising role (#553).
- Agent context (#554, #555, #556): `CLAUDE.md` imports `AGENTS.md` and this
  index; stale docs deleted; roadmap and known issues cut to open work;
  decisions and lessons moved here from the machine-local memory; golden rules
  10 (before/after screenshots) and 11 (menu path + state).
- **Licence: Apache License 2.0 while the repository is public, since
  2026-10-09; back to proprietary when it goes private** (the steps are in
  `decisions/lisensi.md`). Names, logos, photographs and personal data are
  outside it (`NOTICE`).

## Next

Model A (a permission per feature plus a data scope), then one adaptive
`/dashboard` and a scoped `/analytics` — see [`roadmap.md`](roadmap.md).
