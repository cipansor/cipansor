# Known issues — open defects

Open defects only, each rechecked against the code on **2026-09-25**
(asrama and schema entries on 2026-09-26; daily report, schedules,
counselling and growth on 2026-09-27). The
ordered backlog is [`roadmap.md`](./roadmap.md); where the work stands is
[`progress.md`](./progress.md); the system overview is
[`ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

- **Fixed → delete the entry.** Git keeps the history; this file is not a
  changelog. (The long record of what was fixed before 2026-09-25 is in the
  history of this file and of `docs/KNOWN_ISSUES.md`.)
- **An entry can be stale.** Check it against `main` before quoting it to
  anyone — this file once called a finished feature "urgent".
- **Nothing sensitive** (`AGENTS.md` → "Where things live"). An authorization
  weakness that is still open is recorded outside the repository until it is
  fixed; say here only that a module needs review.

## Broken flows and wrong figures

- **The per-role screenshot sweep cannot log in** (found 2026-09-29). `apps/web/scripts/screenshot-roles.ts` posts `/auth/login`
  without `X-Client: bearer`, so since the HttpOnly-cookie session (#620) the body carries no token and every role fails
  "Unexpected login response". Its menu walk also skips nested items. `.claude/skills/screenshot-roles/scripts/screenshot-flow.ts`
  (`atlas`) replaces it; the old script and `scripts/dev-up.sh` (builds the web with a leaked `NODE_ENV=development`, see the `stack`
  skill) still need fixing.
- **The password screens contradict each other and the decision** (found
  2026-09-29 while checking a manual against the screens).
  `Profile → Keamanan` still advises changing the password "at least every 3
  months" (`app/profile/page.tsx`), against `decisions/autentikasi-2fa-dan-sandi.md`
  (change on an event, not a calendar); its client-side floor message says
  "minimal 8 karakter" (the full 15-or-8 rule is only checked on submit). And
  `Settings → Keamanan Akun` says password handling belongs to an administrator
  and to "IT Support", while the change form lives on Profile.
- **Wrong language in the portal chrome.** The avatar menu reads *Profile*,
  *Settings*, *Logout* (`components/layout/header.tsx`) in a portal decided to be
  Indonesian only, and several screens still say *Siswa* / *Daftar Siswa*
  (attendance record, menu group *Mengajar*) where the decision is *santri*.
  The manuals quote the screen as it is.
- **The marketing dashboard's monthly attributed revenue always fails**
  (found 2026-10-03). `getMonthlyAttributedRevenue` in
  `marketing/roi.service.ts` filters `invoice.student.registrant`, a relation
  that does not exist (`Student` has `registrants`), so Prisma refuses the
  query and the endpoint answers 500 on every call: `/marketing`
  ("Marketing & PSB") shows an error toast and an empty revenue chart. Its unit test
  (`tests/funnel-trend.test.ts`) mocks Prisma, so it cannot see a wrong
  relation name. Fix: `registrants: { some: { campaignId: { not: null }, … } }`,
  with a test against a real query shape (or an e2e that opens the page and
  expects no error).
- **The web calls API paths that do not exist — 184 distinct calls left**
  (212 when measured on 2026-09-25; Perizinan fixed in #564, the asrama pages
  in #569 and #571, mata pelajaran in #573, laporan harian in #577, the
  homeroom pages in #579–#581; the list is
  `apps/api/src/utils/web-api-contract.baseline.json`, which the contract guard
  keeps honest — it only shrinks; staging answers them "Route … not found").
  Worst felt now: the Kurikulum list
  (`/curriculum/curriculums`), HR employees (`/hr/employees`), every
  Sertifikat page (`/certificates`), parent messages (`/parent/messages`),
  and three pages that write `/api/…` and so call `/api/api/…`
  (`analytics/grc`, `talenta/analytics`, `perencanaan/[id]/activity-dialog`).
  84 more sit in functions nothing imports, mostly `services/`. The Tagihan and
  Types entries below are part of this. Phase 1 of the audit plan fixes it area
  by area; the guard (#563) stops new ones.
- **An extracurricular's members, attendance and achievements do not work**
  (found 2026-10-04; the extracurricular itself — create, edit, list,
  detail — was fixed in the same week). On the detail page the *Anggota*,
  *Absensi* and *Prestasi* tabs, and a student's own enrolment, call
  `/extracurricular/{id}/enrollments`, `/{id}/attendance`, `/{id}/enroll`
  and `/enrollments/{id}/approve|reject`, which the router does not serve
  (they are in the contract baseline), and `GET /extracurricular/achievements`
  and `/my-enrollments`, which it *does* answer — through `/:id`, as "not
  found". That is the error toast on every detail page, and the contract
  guard cannot see these two because `/:id` matches them. The served routes
  are `/enrollments/list`, `/attendance/list`, `/achievements/list` and
  `/students/:studentId`. Underneath is a model difference that is a decision,
  not a typo: the web has enrolment as PENDING → APPROVED/REJECTED, the API as
  ACTIVE/GRADUATED/WITHDRAWN/DISMISSED with no approval step.
- **The wali's home page shows figures nobody produced.** Seen with the TK
  Qur'an wali (parent portal home, `apps/web/src/app/parent/page.tsx`).
  - Attendance falls back to `0%` in red when the summary carries none
    (`?? 0`), so "no records" reads as "never came".
  - A child who lives in no asrama gets a "Harmony Asrama" tile (an English
    label), with "—%".
  - "Skor Holistik" shows for a TK child too.

  Show a figure only when a query produced it, and an asrama tile only for a
  santri with a placement (`lessons/teacher-dashboard-fake-stats.md`).
- **The profile names a kepala sekolah "Guru/Ustadz".** The badge under the
  name on *avatar → Profile* labels the legacy bucket (`getEffectiveRole`),
  so every kepala and the Pimpinan Pesantren read as teachers, and organs as
  "Admin Unit"; the role picker in the header already shows the role's name.
- **Homeroom pages that still do not work** (after #579–#581).
  *Wali Kelas → Pesan Orang Tua* calls `/homeroom/classes/{id}/messages` and
  `POST /homeroom/messages`, which do not exist; the `messages` module
  (`/messages`, a recipient per message) is the place to wire it, with the
  pupils' wali as recipients. The pupil page (`/homeroom/students/[id]`)
  shows figures that are not data: *Pramuka — Aktif* for every pupil, rank
  #0, average 0, "0 / 30 Juz", *Invalid Date*. The kepala sekolah reads a
  class's dashboard through the API but has no menu path to it.
- **Class and teacher schedules.** The web calls
  `/curriculum/schedules/class/{id}`, `/curriculum/schedules/teacher/{id}`
  and `PUT /curriculum/schedules/{id}`; the API serves
  `/classes/:classId/schedule` and `PATCH`, and names the day `dayOfWeek`
  where the web sends `day`. And `createSchedule`
  (`curriculum.service.ts`) checks only for a clash in time: a slot accepts
  any teacher, not only the subject's guru pengampu for that class
  (`teacherSubject`, #573). Its error message is English.
- **Counselling: the quick actions do nothing.** On a session's page (#574
  made the notes and referrals tabs real), "Mulai Sesi", "Selesaikan Sesi" and
  "Hubungi Orang Tua" are buttons with no handler, and there is no form to add
  a note or a referral from the web.
- **The staff dashboard's other counters are always 0.** `use-staff-dashboard.ts`
  reads `meta.pagination.total` for health, violations, rewards and students;
  those APIs send other shapes (#564 fixed only the permit counter). The API has
  three pagination shapes (`pagination`, `meta.pagination`, `meta`) — phase 6.
- **`/musyrif/boarding-center` is still mostly sample data** (Social Harmony,
  "4 Musyrif on Duty", alerts, health counts); only the dormitory list and,
  since #564, the permit card and tab are live. The page says so.
- **Permits without a gate code.** Older seeded permits have `code` null, so the
  gate cannot find them once approved. New permits always get one; approving a
  code-less permit should assign one.
- **2FA recovery codes are stored but never accepted.** Enrolment writes
  `twoFactorRecoveryCodes`; no login path reads them, so a user who loses the
  authenticator cannot use them.

- **Tagihan & SPP — the write screens call an API that does not exist.** The
  read screens were fixed in #540; the writes still use the imagined contract
  (`apps/web/src/hooks/use-finance.ts`): "Buat Tagihan" sends `billType` (the
  API wants `paymentTypeId`), "Tagihan Massal" posts to
  `/finance/invoices/bulk` (no such route), "Catat Pembayaran" sends
  `billId`/`paymentMethod` (API: `invoiceId`/`method`), and deleting a payment
  calls `DELETE /finance/payments/:id` (no such route).
- **The WhatsApp page (`/notifications/whatsapp`) is on no menu**, and calls
  the API with a bare `fetch` (not `lib/api.ts`), so its POSTs carry no CSRF
  header, which the API requires. Its broadcast tab went with Pengumuman
  (`decisions/siaran-pengumuman.md`); what is left — send one message, a
  provider check, a scheduler trigger — is admin tooling nobody reaches.
- **A unit's operator sees every unit's subjects.** *Classes → Mata
  Pelajaran & Jadwal* for Admin SD IT lists SMP IT's subjects (seen
  2026-09-28), and its *Tanpa Guru Pengampu* card counts them.
- **Small wrong labels and filters seen 2026-09-28:** the Kehadiran list
  (`/attendance`) offers teachers a "Semua Unit" filter and its pager is in
  English; *Catat Donasi* shows an English date format and "Campaign"; the
  TK daily-report table and check-in say "No results found", "Pick a date",
  "Apply"; *Kurikulum Merdeka* raises a "Route GET /api/hr/employees not
  found" toast on load; `GET /parent/children` still uses
  `include: { student }` (see `lessons/prisma-include-leaks-pii.md`).
- **Some stored notification preferences have no reader yet.** Since #626 the
  settings page saves for real (`notification_preferences`), and push and the
  family e-mails read it. The SMS and WhatsApp switches are stored but the
  WhatsApp sender does not consult them; "Laporan Bulanan" and "Frekuensi
  Pengingat" have no producer at all. Wire each when its sender is touched.
- **Every save error is shown twice, app-wide.** The axios interceptor in
  `apps/web/src/lib/api.ts` toasts every error response, and
  `components/providers/query-provider.tsx` sets `mutations.onError:
  handleQueryError`, which toasts again. Pick one place; do not patch per page.
- **SPMB decision buttons are disabled for the unit admins who may use them.**
  `apps/web/src/app/spmb/registrations/[id]/page.tsx` compares the primary
  role code with `"UNIT_ADMIN"`, which no role code is (`SDIT_ADMIN`,
  `SMPIT_ADMIN`, …). The fix is one line, but it changes who decides
  admissions — see "Waiting on a decision".
- **Kelengkapan Data Santri list.** "Nama Siswa" shows the NIS (the row
  carries `user.name`, the page reads `name`); the summary cards read a
  different shape from what `report/completeness` returns; and the child's NIK
  is shown in full in the table, where UU 27/2022 Ps. 4 asks for minimal
  display of specific personal data.
- **"+ Tambah Sasaran" and "+ Tambah Kegiatan"** (`perencanaan/[id]/page.tsx`)
  show to every reader, including the Pembina, the Pengawas, and anyone on a
  ratified plan. The server refuses correctly; the buttons mislead.
- **`/certificates/verify/[code]` is behind the session wall** (404 on the apex,
  307 → `/login` on the portal), so a verification link cannot serve the people
  it is for. Sanad certificates already point at `/public/verify-sanad`.
  Making this one public first needs a decision on what it discloses.
- **The seed's closing log prints three logins that do not exist**
  (`apps/api/prisma/seed.ts`, the final `console.log` block): `pengawas@`,
  `kepala.sdit@`, `kepala.smpit@`. The accounts created are
  `yayasan.pengawas@`, `sdit.kepala@`, `smpit.kepala@`. Trust
  `packages/shared/src/types/demo-accounts.ts`, not that log.
- **The pager speaks English** in an Indonesian system —
  `components/shared/pagination.tsx` ("Showing 1 to 10 of 14 results", "Rows
  per page"), used by every `DataTable`.
- **Violation and reward "Types" tabs write to nothing.** No `ViolationType` /
  `RewardType` model exists; `/violations/categories` and `/rewards/categories`
  return the bare enum. Either build the models and endpoints, or remove the
  tab and its hooks (`useViolationTypes`, `useRewardTypes` and their mutations).
- **One RKA Yayasan per year is enforced by a `findFirst` only**
  (`perencanaan.service.ts`, `createPlan`), so two concurrent requests can both
  pass. The real fix is a partial unique index — a schema change.

- **An account created as a teacher from Users & Roles has no teacher record**
  (seen 2026-10-02): its dashboard says "Gagal memuat beberapa data" and
  "This account is not linked to a teacher record". HR employees creates both;
  Users & Roles creates only the login. Either the form says so and links to
  HR, or it creates the record — not decided.

- **Surat keterangan santri are printed outside E-Office** (found
  2026-10-02; to be routed through it,
  [`decisions/surat-keterangan-lewat-eoffice.md`](decisions/surat-keterangan-lewat-eoffice.md)).
  `students/documents` makes the letter's number in the browser. The letter is
  not in the agenda, has no TTE, and cannot be verified. It also prints
  unstyled, because the app's CSS does not reach its print window. The page
  is in no menu. `tahfidz/certificate` is in no menu either; both open only by
  URL.

- **A period's registration fee and its fee table are entered apart.**
  `registrationFee` is what the applicant is billed on registering; the fee
  table is what the public page and the chatbot show, and the brochure's
  table has a "Pendaftaran" line of its own. Nothing checks that the two
  agree, so an admin can announce one figure and bill another. The public
  page shows the registration fee only for a period with no fee table.

## Access that is too narrow, or needs review

- **The yayasan's organs have no SPMB item in their menu.** They read SPMB
  (decided 2026-09-23: the panitia prepares, the kepala unit decides, the
  board reads along), and the API and the pages let them. But they reach
  `/spmb` and `/spmb/periods` only by typing the address.

- **The kepala sekolah cannot open a Raport Merdeka of their own unit**
  (found 2026-10-02). `assertRaportAccess` (`raport-merdeka.service`) admits a
  unit's admin and a teacher who covers the class; a kepala who teaches none
  of the classes gets 403 "Anda tidak memiliki akses ke siswa di unit lain"
  for a santri of their own unit — the wrong reason, and the head who signs
  the raport (`pimpinanUnit`). Whether a head reads every raport of the unit is
  a scope decision for Model A.
- **Who manages asrama — decided 2026-09-27, not built.** Adding asrama and
  kamar and placing santri still admits the super admin, every school's admin
  (TK's included, whose pupils never board) and the yayasan organs — the
  legacy `UNIT_ADMIN` bucket, named once as `DORMITORY_MANAGER_ROLE_CODES`.
  Decided: Pimpinan Pesantren, TU Pesantren and the super admin; the
  koordinator asrama places santri in their own asrama
  (`decisions/unit-vs-asrama-vs-takhosus.md`; `roadmap.md` 00.6).
- **The dormitories module needs a read-scope review.** Its read routes do not
  all apply the same scope check; see the module before widening who reads it.

- **Page gates (`allowedRoles`) disagree with `rbac.ts` on 23 pages.** Most are
  deliberate (`/settings` for one's own profile, `/settings/roles` for Super
  Admin only). To review: `/homeroom/performance` and
  `/rapor-pesantren/config` for TEACHER (wali kelas), and
  `/analytics/parent-engagement` for TEACHER/STAFF. Model A replaces both lists.
- **Some modules still admit whole legacy buckets** (`STAFF` in particular),
  where a feature permission would be narrower. Review module by module under
  Model A; the list is kept outside the repository.
- **"Roles & Permissions" edits a list almost nothing reads** (measured
  2026-09-25). Super Admin can create a role and tick permissions, stored in
  `roles.permissions`, but only 13 API routes check a permission
  (`hasPermission`); 670 check a legacy bucket (`authorize`), menus come from
  `navigation.ts` by role code, and web routes from `rbac.ts` by bucket. A new
  role gets the fallback menu, and unticking a permission does not remove the
  access a bucket grants. Model A (roadmap §1.2) is the fix. Until it lands
  the page says so itself (`PermissionScopeNotice`, 2026-09-25): deactivating
  the account is what revokes access, within the 15-minute token life.

- **Laporan harian: the TK guru and kepala sekolah have no path to it.**
  A TK guru's menu has *Mutabaah Yaumiyah* only; the *TK / PAUD* group
  (Laporan Harian, its class and parent views, check-in, edit) is the unit
  admin's, and the middleware sends TEACHER away from `/tk`. The TK kepala
  sekolah has no daily-report item at all, though the API lets principals
  read and write. `/homeroom/daily-report` (a class's day, for the wali kelas)
  is linked from nowhere. The user chose one page on 2026-09-27 — the TK guru
  writes for their class, the TK kepala sekolah reads, the other page trees
  308 (`roadmap.md` item 00.3).
- **Pantau Tumbuh Kembang (`/health/growth`) has no menu item** and no link
  from any page; it is reached only by typing the address.

## Waiting on a decision

Measured, and deliberately not decided alone because each changes authority or
opens personal data. Once answered: do it, delete the item, and record the
decision.

1. **Tata Usaha and "Luluskan".** The API lets TU graduate a student
   (`manageAlumni`, #500); the page `students/[id]` admits only
   `SUPER_ADMIN`/`UNIT_ADMIN`/`TEACHER`, so TU is bounced. Widening the page
   opens the student's full personal record to TU.
2. **The `students.nis` column.** #515 dropped its unique index and kept the
   column so the rollback image could still write. Drop it in a release of its
   own, after one full release with no old writer — or keep it as a snapshot.
3. **Who may accept or reject an SPMB applicant** (the disabled buttons above).
4. **Takhosus as a fifth unit** (`UnitType.PESANTREN`, decided 2026-09-13;
   to be built, decided again 2026-09-29 in
   `decisions/struktur-organisasi-dan-identitas.md`) is not built. Until it
   is, every pesantren role — the Kiai included — is assigned in the **SMP
   IT** unit, and takhosus halaqoh sit under SMA. The seed also still makes an
   `OrgUnit` "Direktorat Pendidikan" with a "Direktur Pendidikan" post.
5. **Dashboard metrics cadence.** `aggregateDashboardMetrics` runs every minute
   and writes 6 rows a run (`jobs/scheduler.ts`), for figures that move on the
   scale of a class period. Retention was fixed; the cadence is a product call.
6. **Two kepala sekolah in one unit.** The 2026-08-14 e-mail rename put two seed
   families side by side. The seed now has one per unit; the live data was not
   rechecked. Prefer `is_active = false` over deleting, so the audit trail
   survives.

## Design gaps

- **No PDF here prints Arabic script.** The Raport Merdeka prints in the
  built-in Helvetica (WinAnsi) and leaves Arabic out; it used to embed Amiri,
  which drew nothing legible (lessons/guard-tests-that-measure-the-wrong-thing,
  "A file that opens is not a page that reads"). Arabic needs a shaping
  (harfbuzz) and right-to-left pipeline and a font that subsets correctly.
  The raport's own text is Latin — surah names are transliterated.
- **Names that say something other than what the module does** (audit
  2026-09-25, every module): `practicum` is Amaliyah Tadris, `research` is
  Fathul Kutub (shown as "Turats Lab"), `inventory` is fixed assets,
  `student-`/`teacher-compliance` are data completeness,
  `finance-`/`dashboard-enhancement` name their history, `pengawasan`
  (internal audit) reads as the Pengawas organ, `non-formal` is courses,
  `/api/health` is the UKS module while `/health` is the server check, and
  `/assessment/skhun` prints a document not issued since the national exam was
  abolished (2021). 50 English menu labels in an Indonesian UI; 27 paths with
  more than one label. Full table: the audit report linked in `progress.md`.
- **Manajemen Risiko is still half English.** The list page was translated
  when the yayasan's organs were given it (2026-09-28); the heatmap
  ("Risk Heatmap", "Almost Certain" … "Catastrophic"), the create page
  ("Create New Risk", every label and message), the detail page and the raw
  enum values in the table (`FINANCIAL`, `HIGH`, `OPEN`) are not.
- **`lingkungan` still decides unit scope on the legacy `role`.** Internal
  audit, risk and sharia compliance moved to the helpers in
  `apps/api/src/utils/resolve-unit-id.ts` (`listUnitScope`,
  `assertReachesUnit`, `writeUnitScope`) on 2026-09-28; `lingkungan` has the
  same hand-written `isPrivileged` and should move too.
- **One concept, several modules** (audit 2026-09-25): tahfidz across five
  modules (`takhosus` re-exposes murojaah, simaan, sanad and halaqoh on the same
  tables), report cards in five places, lesson plans in three models, P5 in two
  modules (the term was retired by Permendikdasmen 13/2025 — now
  *kokurikuler*), chart of accounts and journals in `finance` and
  `finance-enhancement`, two monthly-depreciation implementations
  (`jobs/asset-depreciation.job.ts` runs; `inventory/depreciation.service.ts`
  never did), three daily santri logs (`daily-report`, `ibadah`, `muhasabah`),
  and duplicate pages: `/payroll` + `/hr/payroll`, `/wallet` +
  `/finance/wallet`, `/tahfidz/simaan` + `/takhosus/simaan`, three certificate
  pages. Laporan harian alone has three ways to write one
  (`/daily-report/new`, `/tk/daily-reports/new`, `/tk/daily-reports/create`
  for a class) plus check-in, the wali kelas page and Mutabaah bulk, and two
  pages for the wali (`/parent/daily-report`, and the list in
  `/parent/buku-penghubung`).
- **A wali's reply to a daily report is appended to `homeActivity`**
  ("[Tanggapan Orang Tua]: …"). There is no column for it, so it cannot be
  shown apart from the teacher's suggestion for home.
- **The daily-report photo rule knows only local uploads.**
  `dailyReportPhotoSchema` accepts `…/uploads/<file>`; when stored files move
  to blob storage (roadmap 4, PR B), it references a file id instead, in the
  same change.
- **The module standard is not followed.**
  22 of 93 modules have all five parts; 12 call Prisma from a route or
  controller; 23 import other modules directly (the rule is the event bus);
  1,457 bare `res.json` against 399 `ApiResponse`; 349 of 562 POST/PUT/PATCH
  routes carry no `validate()`. (`AGENTS.md` and `docs/ARCHITECTURE.md` were
  corrected on 2026-09-25; the code itself is phase 6 of the plan.)
- **Schema and migrations disagree on two points** (measured 2026-09-26 with
  `prisma migrate diff` from a database built by `migrate deploy` to
  `schema.prisma`): `admission_waves.full_by_capacity` is `Boolean?` in the
  schema but `NOT NULL DEFAULT false` in its migration, and the migrations
  create `exam_grade_duplicates_backup`, a one-off backup table the schema
  does not model. Neither came from recent work; a new migration's diff shows
  both and nothing is wrong with it. Make the field `Boolean` and decide
  whether the backup table can be dropped.
- **Scheduled jobs assume one instance.** Ten `node-cron` jobs run inside the
  API process with no lock; scaling the App Service to two instances would send
  SPP reminders twice. Add a `pg_try_advisory_lock` (or a separate worker)
  before any scale-out.

- **Ratification by the yayasan is not modelled collectively.** One Pembina
  account decides, not a meeting. And the header of an `IN_PROGRESS` plan can
  still be edited by its author: there is no per-field rule (realisation may
  change, ratified text may not).
- **Module sprawl, to consolidate by design, not by deletion.**
  `dashboard-enhancement`, `finance-enhancement` and `research` are mounted
  separately and in use (route collisions with `dashboard`, ~34 web call sites
  into `/finance-enhancement`). The six kitab models (`Kitab`, `KitabKuning`,
  `KitabAssignment`, `KitabProgress`, `KitabProgressRecord`,
  `KitabStudentProgress`) want one design, which needs a destructive migration.
  The canonical `/admissions/registrants` page was never built; the SPMB
  registrant UI lives at `/spmb` (the API already has the
  `/admissions/registrants` routes).

- **61 free-text columns keep their code vocabulary in a comment**
  (measured 2026-10-03: `String` fields in `schema.prisma` whose comment lists
  codes such as `// STUDENT, STAFF, TEACHER`). Nothing stops a writer that
  never read the comment; that is how `students.status` (#492) and
  `registrants.quran_ability` (2026-10-03) came to hold two spellings. Sweep
  them one module at a time when the module is touched: measure what each
  column holds (`select x, count(*) … group by x`), then a Prisma enum or a
  CHECK, and `z.enum` at the edge
  (`lessons/student-status-case-mismatch.md`).

## Performance

- **`next/image` has never optimised anything.** Every `/_next/image` request
  returns the source file unchanged at every width: `sharp` does not resolve in
  the standalone output, and the copy in the store is the glibc build on an
  Alpine runner. Measured on the VM image in August; the App Service image is
  built from the same Dockerfile. The fix is a runtime-image change (musl
  `sharp` in the runner, or a glibc base). Until then ship images at display
  size — `galleryThumb()` in `packages/shared/src/public-site.ts` does.
- **The dashboard trend has no page.** `jobs/dashboard-metrics.job.ts` runs
  every minute and writes 6 `dashboard_history` rows (8,640 a day, pruned to
  24 hours) for `GET /dashboard/metrics`. Its only web consumer,
  `useDashboardMetrics` in `hooks/use-dashboard.ts`, is used by no page
  (found 2026-09-28, while removing Socket.IO). Either show the trend on a
  dashboard, or drop the job, the endpoint and the hook together. That is a
  product decision.

## Tests

- **`spmb-workflow.spec.ts` leaves an active admission period behind on every
  run** ("SPMB E2E Auto …"). On a fresh CI database that is one extra period;
  on a local stack reused across runs they pile up, push the seeded SMP IT
  intake out of the Admissions overview, and `admissions-funnel.spec.ts`
  fails (seen after three full runs, 2026-09-28). The spec should delete what it
  creates, or the funnel test should look the seeded period up by name.
- **About a hundred e2e heading assertions are unscoped** (103 by a plain grep,
  2026-09-25). `getByRole("heading", …)` in `apps/web/e2e` without a `<main>`
  scope can match a sidebar group title
  (Ringkasan, Akademik, Keuangan, …) — one test was green for months by
  matching the "Keuangan" group instead of the page. Those using an exact name
  are safe; the regex ones are not. Sweep file by file.
- **Firefox and WebKit fail `page-state-helper.spec.ts:33`** deterministically.
  The matrix is `continue-on-error`, so it does not block; it is not a flake.

- **`teacher-management.spec.ts` skips all 12 of its tests** ("Teachers page
  not available"): the page it looks for does not exist (HR employees is on
  the broken-calls list). It is green because it asserts nothing; rewrite it
  when the employees page is wired.
- **Two e2e specs fail at random under the full suite and pass alone.**
  `certificates.spec.ts` (preview/print number, lines 118 and 153 on
  different runs) failed after its retry in two full Chromium runs on
  2026-09-27 and passed 3/3 on its own each time; `cbt.spec.ts` (create and
  delete an exam) needed a retry once. Suspect the print popup's timing under
  load. See `lessons/guard-tests-that-measure-the-wrong-thing.md`, "E2E that
  fails on a random spec each run".

## Unverified

- **The PWA install prompt on `portal.cipansor.or.id`.** The apex ships no PWA
  on purpose (#401). On the portal, whether Chrome fires
  `beforeinstallprompt` is unproven. Next step: DevTools → Application →
  Manifest → *Installability* on a real device. Suspects, in order: Chrome's
  engagement threshold (a fresh Incognito window has none), then the manifest's
  `"id": "/"`.
- **The maskable icons and `screenshots` are generated, then committed.**
  `scripts/gen-pwa-assets.py` writes `public/icons/maskable-*.png` and
  `public/screenshots/*.png`; the outputs are tracked and serve correctly
  (verified 2026-09-29), but the generator is not part of the build, so a logo
  or page change that regenerates them must have the new PNGs committed by hand.
  Forgetting leaves the old file in place with no test to notice — the suites
  read the manifest's declared fields, not the bytes.
- **Advanced manifest fields are absent** (audit 2026-09-29), each a judgement
  call rather than a defect: no `launch_handler` (`"navigate-existing"` keeps
  the installed window instead of stacking a new one), no `handle_links`
  (`"preferred"` sends in-scope links to the installed app), no
  `related_applications`/`prefer_related_applications`, no
  `apple-touch-startup-image` splash (iOS shows a blank launch frame until the
  first paint), no `iarc_rating_id`. Add when the product wants the behaviour.
- **Declarative Web Push is not used** (audit 2026-09-29). Safari 18.4+ accepts a
  service-worker-free push JSON with an `app_badge` field; the `push` handler
  in `sw.js` is the path every browser needs, so add the field only when a
  badge count is wanted.
- **The manifest screenshots do not show what an installer gets.** The
  richer-install sheet shows `public/screenshots/*`: a Super Admin dashboard
  with English menu labels and a wali dashboard reading "Kehadiran: 0%" over
  empty cards (seed data with nothing recorded). Retake from the presentation
  data pack (`paket-presentasi`) as a wali and a teacher before release.
- **A deliberate push-off is coordinated across tabs** (fixed 2026-09-29). The
  marker that stops the shell's `useWebPush` from re-registering an endpoint the
  user just turned off lives in a module-level set (`lib/push-cache.ts`) and is
  mirrored to the other tabs on a `BroadcastChannel`; a tab that hears `push-off`
  marks the endpoint and drops the `PushSubscription` it still holds, so its
  reconcile cannot re-create the row. The marker itself is still per tab (a tab
  that was closed and reopened starts clean, which is correct — the server row
  is gone), only the *change* is broadcast.

## Deliberate — do not "fix"

- **Public-site translation stops at scripture, domain terms and identifiers.**
  Leaders' mottos and the donation page's hadith and verse stay Indonesian
  (generating Arabic or English would publish a reconstruction as scripture);
  so do Pesantren, SPMB, Wakaf, Infaq, Santri, Tahfidz, Musyrif and the unit
  names, the decree number, NPWP and ministry name, and the recorded values
  ("Hamba Allah", bank details). News bodies are Indonesian, marked `lang="id"`,
  with a line telling the reader. `config/i18n-coverage.test.ts` holds the
  allowlist, each exception with its reason.
- **No self-service "lupa password".** An admin starts a reset (Pengguna → ⋯ →
  *Kirim tautan reset password*), so nothing unauthenticated can make the
  system send mail or reveal which addresses have accounts.
- **The apex has no PWA.** `pwaEnabledForHost` withholds the manifest there,
  because `start_url` is the landing page and the shortcuts 404 on that host.
- **Naskah dinas are verified by uploading the PDF**, not by a token page — a
  token page lets someone substitute content.
