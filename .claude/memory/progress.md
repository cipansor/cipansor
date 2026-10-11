# Progress — where the work stands

Updated **2026-10-04**. What a new session needs to pick up the thread, newest
first. Keep it short: finished work belongs to git history, and the ordered
backlog to [`roadmap.md`](roadmap.md).

## Environments

- **Production** — `cipansor.or.id`, Azure App Service since 2026-09-24. A
  release needs the user's explicit approval every time, and
  releases the SHA staging reports at `/healthz`, not the head of `main`.
  Migrations run when the container starts (`MIGRATE_ON_START`).
- **Staging** — `staging.cipansor.or.id`, demo data only, deploys every `main`
  on which CI and E2E (Chromium) pass, about 25 minutes after the merge (a
  documentation-only merge is not rebuilt). At `6bfdfa340` (#651) on
  2026-10-04. SMP IT's accreditation certificate was recorded there on
  2026-09-29 at the user's request, by the SMP admin demo account — which
  therefore now asks for a 2FA code — so the public section shows it.
- **CodeQL is a required check** on `main` since 2026-09-25 (ruleset rule
  `code_scanning`, errors and high-or-higher alerts). The user's caveat: it
  may be dropped if the repository goes private and code scanning would need
  a paid licence.

## Waiting on the user

- Approval for the next production release — deferred by the user on
  2026-09-27; ask again at the end of every report. Passwords parts A and B
  must go out together, with `scripts/require-password-change-all.ts` run
  once after that deploy; SPMB 2027/2028 needs a release before
  1 January 2027 to take wave 2. (Which fixes production
  still lacks is for the machine-local memory, not here — see "Where things
  live".)
- Role catalogue items decided but not built: wakasek per bidang as a
  timed assignment (Model A; wakasek is no longer a role code —
  `decisions/peran-dan-tugas-tambahan.md`), `PESANTREN_ADMIN` (needs a pesantren unit first — every pesantren role is
  scoped to SMP IT today), a Panitia SPMB assignment that expires, and the
  "Admin" → "Operator" label.
- One Bendahara role with a unit scope waits for Model A (decided 2026-09-25).
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
manages asrama (`unit-vs-asrama-vs-takhosus`); *santri* on every screen
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

- **Application documents (`docs/`), now folded into PR #512
  (`docs/readme-overhaul-visual-qa`).** A technical document (arc42 +
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
  rewrote the README with a full screenshot gallery and had fixed the *same*
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
  lists EdDSA as *shall support*, and it is **AATL** that omits it. The
  a.n./u.b./Plt./Plh. signing-authority forms and signing uploaded DOCX/PDF
  bytes were built in `1513317`; the one remaining item, **PAdES B-B + RFC
  3161**, was **deferred (option b, 2026-09-29)** until the yayasan procures a
  TSA endpoint — without a trusted timestamp it adds a CMS/PKCS#7 builder and an
  X.509 certificate (today the signer identity is a raw public key) but no
  evidential value. The Ed25519→RSA/ECDSA switch stays an *interoperability*
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
  (`skipErrorToast`), and hardened `verifyByPdfBuffer` to verify the *uploaded*
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
    payload, so every letter signed *before* the change would have been
    reported as forged (a `v1` signature checked against the `v2` shape). The
    payload is now versioned (`canonicalPayload(payload, version)`,
    `CURRENT_CANONICAL_VERSION`, `LetterSignature.canonicalVersion`,
    `canonicalVersionOf` mapping the pre-column `NULL` rows to `v1`), and
    verification reads the stored version rather than guessing.
  - **Upload ownership (CWE-639).** The `UPLOADED` signing path read
    `Letter.fileUrl` and signed those bytes without asking who uploaded them —
    so a drafter could paste another user's upload URL and have the system
    sign and archive *someone else's document* as their own naskah. `LetterUpload`
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
    now checks the job, its CLI *and* the whole API tree for any `delete`/
    `deleteMany`/raw SQL `DELETE` of `Letter`/`LetterSignature`.

  **Citations corrected at the source.** Five files cited "Peraturan ANRI
  5/2021 Pasal 6" for the destruction rule; that regulation is *Pedoman Umum
  Tata Naskah Dinas* and its Pasal 6 is about types of regulatory naskah —
  nothing to do with retention. The destruction rule is **UU 43/2009 Pasal
  51–52 jo. PP 28/2012**. Two more attributions were wrong the same way:
  signature validity cited UU 43/2009 (Kearsipan) instead of **UU 11/2008 jo.
  UU 19/2016 (UU ITE) Pasal 11**, and the urgency degrees were credited to
  Peraturan ANRI 5/2021 rather than the instansi tata-naskah pedoman. All fixed
  in `docs/EOFFICE_ESIGN_PLAN.md` (§2.9–§2.13, §4.3), the `naskah-dinas` skill,
  `decisions/esign-standards-ceiling.md` and the source comments.
- **The brochure's facilities, extracurriculars and agenda on the public site
  — on a branch (2026-10-04).** Decided by the user
  (`decisions/fasilitas-dan-kegiatan-situs-publik.md`): *Fasilitas*
  (`/campus`) and *Kegiatan* (`/activities`) as two menu items. The
  extracurriculars are read from the portal module, and the brochure's nine
  are loaded by `db:seed:ekskul-2027-2028` (staging after merge, production
  with a release). It needed the module's forms fixed first: #653, the
  forms sent categories, schedules and capacities the API refused or dropped,
  and Edit was a 404. The facility icons wait for the brochure's original
  photographs, which the user is asking for.

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
  the head of every unit (#616). Then a unit's NPSN, set on *Edit Unit*, and
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
  Arabic (S6). Next: the brochure's programmes, facilities, extracurriculars
  and agenda on the public site in three languages. Then the Pesantren unit.
  Still open from before: the wali's
  approval for staff-filed leave off the pondok (roadmap 00.5, third part).
  Next: the rest of the homeroom pages (below), the class and teacher
  schedules, HR employees, Sertifikat, then the dead calls, `services/` and
  the `api-client` alias.
- **Homeroom, what is left** (known-issues, "Homeroom pages that still do
  not work"): *Pesan Orang Tua*, the pupil page's figures, the kepala
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
  22 of 93 modules meet the module standard. Plan in seven phases (roadmap §1):
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
- **Model A design document** — approved to draft on 2026-09-25: a permission
  per feature and action, data scope from the assignment, menus derived from
  permissions, separation-of-duty rules locked in code, and the account
  lifecycle (joiner–mover–leaver, immediate deactivation, SCIM from Microsoft
  Entra or a Google Directory API sync after SSO). For the user's review before
  any code. `docs/DEPLOYMENT.md` goes
  after 2026-10-01 (the VM is the rollback target until then, and a guard test
  reads it).

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
  the Super Admin at *Sistem → Profil Unit* with the certificate PDF, read by
  the EMIS/Dapodik exports and the SKHUN; the public site shows the one in
  force on *Profil → Legalitas* and the unit's section, in three languages,
  hidden once expired; a reminder 12 months before. Before/after:
  <https://claude.ai/artifact/3hknmFTyFDXGC21eRhSaoV>,
  <https://claude.ai/artifact/4seR52ain9pns4gimg7iz3>.

- **Absence follow-up, tier 2 (#588, merged 2026-09-28):** *Wali Kelas →
  Tindak Lanjut Absensi* (and *Pengasuhan → Tindak Lanjut Absensi* for the
  musyrif) lists the last 7 days' Alpa with no reason, whom to call (linked
  walis, then the enrolment contact; tel and WhatsApp links) and what was
  tried. *Catat hasil* logs a contact (`attendance_follow_ups`, additive
  migration): Sakit/Izin change the mark, "tanpa keterangan" closes it,
  "tidak terhubungi" keeps it open. A santri mukim's Alpa is their
  musyrif's; everyone else's — a boarder with no musyrif on record included —
  the wali kelas's. 15:00 WIB reminder, in the app and by email. Before/after:
  <https://claude.ai/artifact/Pf6E87kiXVtoWY5zVMi3Yk>.
- **Alpa/Terlambat told at once, and a personal inbox (#587, on staging):**
  the wali in the app and by email, a boarder's musyrif in the app; only a
  change, only today's register. The header bell opens *Notifikasi Saya*
  (`/notifications/me`) for every role. Before/after:
  <https://claude.ai/artifact/U8v1GvscgBToGn5JbyfY34>.
- **Open (auto-merge):** #589 the Kurikulum list removed, its addresses 308
  to Kurikulum Merdeka, the page renamed *Mata Pelajaran & Jadwal*
  (<https://claude.ai/artifact/A2DxB8CfdYucgp7Swwdeuy>); #590 the register
  reminder 30 minutes after a class's first lesson (in-app, holidays silent).

- **The donation forms offer what the yayasan offers (#584, merged
  2026-09-28):** Zakat Maal and Zakat Fitrah are off the public *Wakaf &
  Infaq* form and staff entry (*Keuangan → Donation/ZIS → Catat Donasi*), and
  the API refuses them on both create routes; one list in shared
  (`OFFERED_DONATION_TYPES`). Before/after:
  <https://claude.ai/artifact/5h545yrMwLAuvtc9HmnRcE>.
- **One register, one page (#585, merged 2026-09-28):** *Wali Kelas →
  Absensi Harian* opens `/attendance/record` on the homeroom class;
  `/homeroom/attendance` 308s and its copy is gone; the sidebar lights one
  entry (`activeNavHref`). Before/after:
  <https://claude.ai/artifact/Xpvzges8nGMSjSxCEMwHXh>.
- **Golden rule 12 (#583):** a decision that is the user's is researched
  first, then offered as a multiple-choice question.

- **Wali kelas is a relation, not a role (#579, merged and on staging
  2026-09-27):** the *Wali Kelas* menu group shows for the wali kelas of a
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
- The server checks who is named *atasan penilai* on a PK: never the owner,
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
