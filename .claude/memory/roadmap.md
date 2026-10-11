# Roadmap — what to do next, in order

Ordered backlog as of **2026-09-28**. Defects in detail are in
[`known-issues.md`](./known-issues.md); where the work stands (environments,
what waits on the user, what is in flight) is in [`progress.md`](./progress.md).

Ordering principle: anything that can harm people or data first, then anything
a visitor sees, then correctness, then deliverables, then tidiness. When an
item is done, delete it — git keeps the history. (The long record of closed
items before 2026-09-25 is in the history of this file and of
`docs/ROADMAP.md`.)

## 1. Now — in this order (decided 2026-09-23 → 27)

00. **The user's answers of 2026-09-27**, smallest and most exposed first
    (each is its own PR, wired end to end, with tests and before/after):
    1. (done: zakat off the donation forms, #584);
    2. daily attendance per `decisions/absensi-harian.md` — done: the one
       page (#585), the Alpa/Terlambat notice with a personal inbox (#587),
       the follow-up task with a contact log (#588), the register reminder
       (#590) and the pattern flag (#596);
    3. (done: one TK daily-report page, #592);
    4. (done: the Kurikulum list removed, 308 to Kurikulum Merdeka, #589);
    4b. **the units' accreditation** (`decisions/akreditasi-unit.md`,
       2026-09-28): one official record per unit in the portal, read by the
       EMIS and Dapodik exports and the SKHUN — and the readiness
       self-assessment stops overwriting it, the SKHUN stops printing "B" for
       a unit with none (#597); then the public site (Legalitas and the
       unit's section, three languages, hidden once expired — #598);
    5. the permit rule's three parameters (`pemutus-izin-santri.md`): the
       doctor's note (#606), the koordinator asrama for going home or
       staying overnight (#607, which added `permits.off_campus`), then the
       wali's approval for staff-filed leave off the pondok (schema change);
    6. who manages asrama (`unit-vs-asrama-vs-takhosus.md`): the list, and
       the koordinator's placement in their own asrama;
    7. guru wali at SMP IT and SMA Qur'an as a relation guru → murid
       dampingan (`peran-dan-tugas-tambahan.md`).
    8. **The yayasan's oversight, rebuilt from the closed #508 and #509**
       (`decisions/pengawasan-dan-rapat-pembina.md`). Done 2026-09-28:
       Pengawasan Internal, Manajemen Risiko and Kepatuhan Syariah open for
       the organs (#609). Next: #508's auth fixes that still apply to `main`,
       each its own PR. The first: the unused Socket.IO server removed
       (`decisions/realtime-polling.md`). The four design questions were answered the same day;
       build in this order — the Pembina's decision as a recorded meeting or
       a unanimous written resolution, in the existing ratification flow;
       the Ps. 43 suspension (authority held, 7/7/7 deadlines, void by law);
       TPPK/Satgas as timed per-unit assignments; violations reported through
       Aduan & Aspirasi. The deed arrived the same day
       (`skills/tata-kelola-yayasan/anggaran-dasar.md`): quorum 2/3 then
       >1/2, no Plh, the Pengawas acts as its chair plus one member.
    9. **Sign-in policy** (`decisions/autentikasi-2fa-dan-sandi.md`,
       2026-09-28), each its own PR, in this order:
       - 2FA codes that work (recovery codes, typing tolerance, the admin's
         "turn off 2FA" reachable from the users list) and the 2FA screens in
         Indonesian — the prerequisite for everything below (done, #614);
       - no fallback to the legacy `users.role` on refresh and 2FA, so a
         session ends at the next renewal once its last role is gone, and a
         role that now demands 2FA is not renewed without it (done, #615);
       - 2FA mandatory for the unit heads too (the four kepala sekolah and
         the Pimpinan Pesantren): one list, `SECOND_FACTOR_ROLE_CODES` in
         `@cipansor/shared`, and the profile says "wajib" instead of offering
         to turn it off (done, #616);
       - the post-login invitation for staff and wali ("Nanti saja", no
         limit; santri not invited): the list is
         `SECOND_FACTOR_INVITE_ROLE_CODES`, and the API answers `isInvited`
         (done, #623);
       - passwords, part A: length 8 with 2FA / 15 without, a local list of
         common and leaked passwords plus the service's and the account's
         own name, no composition rules, one check wherever a password is set
         (done, #625);
       - passwords, part B: a must-change flag (set by someone else, marked
         leaked by an admin, 2FA turned off under a short password, and every
         account once at the release — by script, with part A in the same
         release); changing one's own password ends the *other* sessions
         only (done, #632 — on staging; parts A and B go to production
         together, and `scripts/require-password-change-all.ts` runs once
         after that deploy).
       - **passkey (FIDO2/WebAuthn) as the first sign-in path** (decided
         2026-09-30, `decisions/autentikasi-2fa-dan-sandi.md`): a "Masuk
         dengan passkey" button above the password form; password + TOTP +
         recovery codes kept as fallback, so no second recovery channel is
         built; one passkey satisfies `requiresSecondFactor` because WebAuthn
         user verification is provable, unlike Google's `amr`. After 4.A and
         passwords part B, as its own multi-PR track (schema + registration;
         sign-in ceremony; admin reset + recovery hardening + e2e).
    10. **SPMB 2027/2028 in the portal and on the public site** (decided
        2026-10-02, `decisions/spmb-2027-2028.md`; after the users-module
        scope fix, before the Pesantren unit; target: released before wave 2
        opens on 1 January 2027, which needs the user's approval). Each its
        own PR, wired end to end:
        - ~~units: official name beside the short one, plus NPSN, operating
          permit and email (Profil Unit), and the seed's address corrected~~
          (#635);
        - ~~waves with four sessions (registration, test, results,
          re-registration) and a pay-in-full discount per wave, with units
          excluded~~ (#640);
        - ~~the fee breakdown per unit × ikhwan/akhwat × boarding, and per-unit
          requirements, minimum age and contact person~~ (#640, #641);
        - ~~the public `/public/spmb` page and the chatbot read all of it,
          and a registration goes to the chosen unit's period~~ (#642);
        - ~~the brochure loaded by `db:seed:spmb-2027-2028`~~ (#644, on
          staging 2026-10-03; production with a release);
        - ~~the base seed's and the pack's SPMB in the module's shape~~
          (S5b);
        - ~~the SPMB form in three languages~~ (S6);
        - ~~the brochure's programmes, facilities, extracurriculars and
          agenda on the public site, in three languages~~ (decided
          2026-10-04, `decisions/fasilitas-dan-kegiatan-situs-publik.md`;
          the extracurricular forms fixed first); the brochure's
          extracurriculars load on production with a release
          (`db:seed:ekskul-2027-2028`), and the brochure's original photos
          replace the facility icons when the user has them;
        - ~~the full yayasan structure on the public site (names and
          positions)~~ (#637).
    11. **Surat keterangan santri through E-Office** (decided 2026-10-02,
        `decisions/surat-keterangan-lewat-eoffice.md`; after the SPMB track).
        `students/documents` creates a `SURAT_KETERANGAN` draft filled from
        the student's record, which then takes its agenda number, TTE and
        verification like any naskah. Its menu place is Akademik → Students.

0. **Architecture audit plan** (report 2026-09-25, linked in `progress.md`;
   decisions in `decisions/istilah-dan-penamaan.md`; the user said "laksanakan"
   on 2026-09-25, so it runs first). Phases, each releasable alone:
   0. guards — done (#560, #562, #563);
   1. reconnect the broken calls area by area (Perizinan done in #564 and
      #568; Asrama in #569 and #571; mata pelajaran in #573; laporan harian
      in #577; wali kelas in #579–#581; next the schedules, HR employees,
      Sertifikat, and counselling's remaining gaps in
      `known-issues.md`), delete the 84 dead ones, `services/` and the
      `api-client` alias;
   2. glossary from the user's eight decisions, with *santri* on every
      portal screen (decided 2026-09-27, `istilah-dan-penamaan.md` §1) — a
      label sweep; state formats keep *murid* / *peserta didik*;
   3. consolidate duplicates (tahfidz, report cards, lesson plans,
      P5 → kokurikuler, accounting, depreciation, daily logs, duplicate pages,
      dashboards);
   4. API grouped by context under `/api/v1`, Zod contracts in
      `packages/shared` → `zod-to-openapi` → `openapi-typescript` client, one
      style for actions (`POST /{id}/{verb}`), updates (`PATCH`), aggregates
      (`/summary`) and self (`/me`); Prisma models renamed; multi-file schema;
   5. web route groups, URLs that follow the API, 308s, Indonesian labels;
      the portal becomes Indonesian-only and every public page gets complete
      Indonesian, English and Arabic;
   5b. donations, zakat and wakaf rebuilt to UU 23/2011, UU 41/2004, PSAK 409
      and PSAK 412 — after the yayasan answers the two facts in `progress.md`;
   6. module boundaries enforced by lint, Zod on every mutation, one test
      location, a cron lock, dead models dropped once proven dead;
   7. `docs/ARCHITECTURE.md` rewritten from the result.

1. **Finish the role catalogue.** The pesantren part shipped in #552. Left:
   - wakasek per bidang as a timed assignment — wakasek is no longer a role
     code (#575, `decisions/peran-dan-tugas-tambahan.md`);
   - the rest of the homeroom pages — *Pesan Orang Tua*, the pupil page's
     figures, the kepala sekolah's path to a class (known-issues). The
     relation itself shipped in #579; attendance in #580; behaviour notes in
     #581;
   - **the Pesantren unit** (decided 2026-09-29,
     `decisions/struktur-organisasi-dan-identitas.md`): create it, move the
     Kiai, musyrif, ustadz, muhafidz and TU Pesantren assignments off SMP IT
     (a data migration replayed on a copy of production first), and drop the
     seed's "Direktorat/Direktur Pendidikan";
   - `PESANTREN_ADMIN` — once the pesantren unit exists;
   - a Panitia SPMB assignment that expires — needs writers of `expires_at`,
     which `decommissioned-modules.guard.test.ts` forbids today, so the guard
     changes in the same PR;
   - relabel "Admin" → "Operator": role names in the seed ("Admin TK Qur'an", …),
     `ROLE_LABELS` on the profile page, the SPMB page copy — plus a small data
     migration for the stored names.
2. **Model A — a permission per feature plus a data scope.** Replaces the legacy
   buckets (`STAFF`, `UNIT_ADMIN`, …) and the per-page `allowedRoles` lists
   with one contract. The five bendahara codes become **one Bendahara role with
   a unit scope** (decided 2026-09-25; no `PESANTREN_BENDAHARA` before then).
   Read filters keyed on `role !== SUPER_ADMIN` need a per-module judgment
   about whether the yayasan board sees across units — `emis` is per-unit on
   purpose (a Dapodik/EMIS export), `paud-report`'s check is an authorization
   gate, not a filter. Decide case by case, never by find-and-replace.
   **How, decided 2026-09-29** (`decisions/struktur-organisasi-dan-identitas.md`):
   step by step but complete — one function per PR (Bendahara, Guru, Kepala
   Sekolah, Admin/Operator, TU, Komite, Orang Tua, Siswa, Guru BK, Alumni);
   first a guard whose baseline only shrinks (per-unit role literals,
   `UserRole` buckets, role lists outside `@cipansor/shared`, unit scope read
   outside one door), and "done" is that baseline at zero. Alongside it: one
   organisation tree, three levels at most (Yayasan → Unit → Bidang;
   `Department` and `OrgUnit` merged; a post separate from its holder, with a
   term), unit usaha as nodes of that tree; `Realm` removed last.
3. **One adaptive `/dashboard` and a scoped `/analytics`.** The three leadership
   dashboards were deleted in #544 because their figures were wrong; what
   remains must show only numbers a query produced, for the caller's scope.
4. **Identity and integrations** (decided 2026-09-23): accounts in Cipansor
   first, then Google Workspace, then Microsoft; SSO in stages; an account is
   removed six months after its owner leaves (the unit admin requests, the
   Super Admin approves). Confirmed again 2026-09-29 with research (a
   Microsoft hub needs Entra ID P1 for everyone provisioned, and santri may
   not hold nonprofit licences): Google OUs by **policy** (Staf, Santri SMA,
   Santri SMP restricted, emergency accounts), groups **derived** from
   Cipansor's assignments and relations, never kept by hand; Microsoft groups,
   if ever needed, written by Cipansor through Graph. **#441 closed
   2026-09-29** after a third audit, and rebuilt from clean branches as
   six small PRs, in this order:
   - **A. Sign in with Google.** `@cipansor.or.id` accounts only (`hd`). A
     role that requires 2FA still enters its Cipansor code afterwards.
     Linking notifies the owner, and linked accounts can be unlinked. No
     Microsoft path. See `decisions/autentikasi-2fa-dan-sandi.md`.
   - **B. A files table and private Blob storage.** Managed identity,
     user-delegation SAS, no account key, no public container. Unattached
     files are deleted after 24 hours. Modules move one at a time. See
     `decisions/penyimpanan-berkas.md`.
   - **C. The HR directory and employee documents**, salvaged from #441 on
     top of B.
   - **D. Case-insensitive unique email.** The migration is renamed and
     replayed on a copy of production first.
   - **E. The upload rate limit and the boot-time secrets check.** Small and
     independent, so it can go first.
   - **F. Tokens out of `localStorage`** (issue #523) — done in #620: the
     API issues the session as HttpOnly cookies plus a routing cookie the
     Next middleware reads locally, with a double-submit CSRF check. Left
     over: an upload's `<img>` fails once the 15-minute access cookie has
     expired on an idle page, until a call refreshes it; the signed,
     short-lived file URLs of B are the lasting answer.

## 2. Before a real launch

The checklist lives outside the repository while it is public (it concerns
accounts and credentials). What is safe to say here: the data is demo data
until real users are onboarded, and the real SPMB dates, fees and units for an
actual intake are the yayasan's decision — the seed's values are placeholders.

**Align with national and international standards** (asked by the user on
2026-09-26): academic, pesantren, teaching, finance and information security.
Per domain when that domain is next changed — name its standards and offer a
short check — and a full pass after the audit plan and Model A, at the latest
before the pre-launch checklist. Verify each standard is still in force when
it is researched. Already researched, cite rather than repeat: the decisions
in `decisions/` (roles and duties, Pimpinan Pesantren, units, e-signature,
naming and ZIS/wakaf).

## 3. Agreed feature queue (in the order approved)

1. **Validation and rejection rules** across forms and flows.
2. **Complete parent and student data** — occupation, income and family members
   (needed for scholarships and fee relief), CRUD for guardian data, and SPMB →
   active santri only once the registration fee is settled (transfers excepted).
   Jenjang progression TK → SD → SMP → SMA shipped in the #489 split
   (2026-09-14 … 20). Check the rest against `main` before starting.
3. **Fill the empty tables.** 45 of 285 were empty on 2026-09-02 (a real
   `count(*)` per table — `reltuples` reports every never-analysed table as
   empty). Since then 11 tables were dropped and the presentation pack
   (`db:seed:presentasi`) filled many: recount first.
4. **Module audit** — every backend module reachable from the frontend and vice
   versa, and by at least one role. Resolve a module by the API endpoints its
   pages call, not by a route name in a planning document: the PAUD module
   looked missing because it ships under `/tk`, where the old plan wrote
   `/paud`. Three pages that plan named are genuinely absent — `/tk/settings`,
   `/dashboard/performance`, `/dashboard/unit/[id]` — confirm they are wanted
   before building them.

## 4. Deliverables

- **User guide per role, and technical docs** — to be produced through a skill
  (step 4 of the agent-context restructure, see `progress.md`). Decisions that
  still hold: the guide is role-first (each role's chapter covers every module
  it touches); the README becomes lean (overview, tech, install, links, a few
  screenshots) and every screen's picture lives in the guide, per task, under
  `docs/screens/`. The page and role galleries are rebuilt locally and never
  committed; the technical document carries the page map as text (decided
  2026-10-10, `decisions/dokumentasi-bergambar.md`).

## 5. Customer-service chatbot — four gaps

Design and rationale: [`chatbot-design.md`](../../docs/planning/chatbot-design.md).
Retrieval is settled — the whole corpus goes into every prompt (§1 "REVISED
AGAIN" has the numbers and the trigger for revisiting). **Do not reopen it from
taste.**

1. **The eval suite is not in CI.** 36 golden and 23 red-team cases,
   `pnpm --filter api chatbot:eval`, run only when someone remembers. Each run
   costs money, so nightly or pre-release fits better than per-PR.
2. **No persona version history and no eval gate on save.** A Super Admin can
   change the pesantren's public voice with no revision trail.
3. **The golden set is 36 cases against the 50–100 the design asked for.** Grow
   it from `/settings/chatbot/percakapan`, filtered to unanswered questions.
4. **Escalation to the team inbox is unproven end to end** — route, queue,
   scheduler and transport exist; no forwarded question has been seen to
   arrive. `delivered` is not `success`.

Phase 2 (an agent for signed-in users) stays parked. It must call the existing
authorized endpoints as the user, with their **active** role — never a vector
index over the database — and it waits on §3's data quality: an agent restates
whatever the API hands it, fluently, with authority the number has not earned.

## 6. E-Office and electronic signature

Plan and findings: [`EOFFICE_ESIGN_PLAN.md`](../../docs/EOFFICE_ESIGN_PLAN.md).
The signing crypto is good and should not be rebuilt (scrypt-sealed Ed25519
keys, a passphrase never stored, a lifecycle guard). Next, in value order:

1. **The rest of the DOCX authoring track** — sign the uploaded bytes (with the
   TTE visualisation stamped on; *shipped `1513317`*) and a pre-filled DOCX
   template.
2. **PR-7 — Arabic** (an embedded Unicode font and a shaping engine).
3. KTP OCR, deliberately last.

**Deferred:** **PR-5 — PAdES B-B plus RFC 3161 timestamps** (option b,
2026-09-29). Without a TSA endpoint the timestamp adds dependencies but no
evidential value; revisit when the yayasan picks a TSA provider or decides on
PSrE — see `decisions/esign-standards-ceiling.md`. **PR-6 (a.n./u.b./Plt./Plh.)
shipped `1513317`**, no longer a governance blocker.

Signed naskah are served from their archived bytes (`LetterSignedDocument`),
and `generate-letter-pdf.test.ts` pins the hash of a plain letter: a layout
change that alters it would report every signed letter as altered.

## 7. Smaller open threads

- **SPMB naming, backend half.** The pages moved to `/spmb` in #439 with
  permanent redirects from `/ppdb/*` and `/psb/*`. Left: rename
  `modules/admissions/ppdb-wave.*` → `spmb-wave.*` with its exports and
  `/api/ppdb-waves` paths, retire the `getPSBStats`/`PsbSummary` aliases and
  `/analytics/psb`, keep every old path alive with a permanent redirect, and
  sweep the comments. No data migration — the database holds no `ppdb`/`psb`
  names.
- **Unit history for reports.** `student_unit_enrollments` and
  `utils/student-unit-history.ts` exist and `dashboard` + `dashboard-enhancement`
  already use them, but other reports still filter on `students.unit_id` (the
  unit *now*) — 44 literal `student: { unitId` filters on 2026-09-25 — so a
  santri's TK history moves to SD IT the day they move up. Swap one module per
  PR: analytics/reporting/export next, then assessment analytics, health,
  accreditation, then the rest. Tests that mock the Prisma client must learn
  the new models too; if that bites again, write one shared mock factory. Treat `unitAt()` returning `current` as *unknown* in
  historical reports. Still undecided: a mid-year transfer yields two rows in
  one year — pick "state on a cut-off date" or "both" for annual per-unit
  reports, and write it here.
- **E-mail.** No spend or volume alarm (Google's daily cap is the only limit).
  BIMI is self-asserted, so Gmail will never show the logo; nobody has yet sent
  a test to a Yahoo mailbox. The SPF record's Outlook include is vestigial —
  removing it is the user's call.
- **Turnstile.** A real sign-in from an ordinary (residential) browser has not
  been confirmed; a datacenter probe cannot prove it. Cloudflare's dashboard
  warning that the site "never calls siteverify" is wrong, and the site key is
  baked in at **build** time.
- **Regulation-driven additions:** UU PDP 27/2022 (parental-consent records, a
  privacy policy, data-subject access and erasure, a data-access audit); ISAK
  35 non-profit statements and the UU Yayasan annual-report package; a zakat
  *collection* (muzakki) model beside the existing distribution side.
- **Tidiness:** ~200 racy `isVisible({ timeout })` probes in the e2e specs
  (206 on 2026-09-25); `no-explicit-any` in the API, fixed opportunistically
  per module.

## Operating notes that keep costing time when forgotten

- **A merge is not a deploy.** Before saying a fix is live, read the `commit`
  that `/healthz` reports. To prove a build carries a change, pick a marker the
  change *deleted* — a string the change added may already exist in the old
  build.
- **After switching branches, regenerate before trusting a failure:**
  `pnpm --filter @cipansor/shared build` and `pnpm --filter api db:generate`.
  A stale client imports enums as `undefined`; a stale `shared` makes `tsc`
  report exports that plainly exist. `vitest` can pass while `tsc` fails.
- **CI installs with `--frozen-lockfile`.** A local install is not frozen, so
  lockfile drift passes locally and fails several CI jobs within seconds.
- **The Security job can go red on a PR that changed no code.** `audit:deps`
  asks npm's live advisory endpoint, so a new advisory reds every open PR at
  once. The fix is almost always a pin in the root `package.json`
  `pnpm.overrides`. And green is not "checked": an unreachable endpoint passes
  with a `::warning` annotation — read it, and set `AUDIT_FAIL_ON_UNREACHABLE=1`
  when a release must not ship on an unverified tree.
- **`prisma migrate diff` cannot see triggers, functions or views.**
  `assert_yayasan_organ_exclusive` nearly vanished from the baseline with an
  empty diff. Write such changes by hand and check the database directly.
- **`migrate deploy` runs a script without `DO $…$` statement by statement.**
  A data migration that relies on temporary tables or all-or-nothing must be
  wrapped in `BEGIN;` … `COMMIT;`. Recover a failed replay with
  `prisma migrate resolve --rolled-back <name>`.
- **`tsx` is not in the production image**, so the `.ts` scripts cannot run
  inside the container. Anything scheduled belongs in the API's in-process
  `node-cron` jobs, which also write an `audit_logs` row per run.
- **A smaller backup is not by itself data loss.** `dashboard_history` is pruned
  to the last 24 hours; compare per-table row counts between dumps.
- **Check `/public/spmb` in a browser, not with `curl`.** The server renders the
  pre-hydration state ("Belum Dibuka"); the period arrives on the client.
  `isActive` on a period is administrative intent — whether registration is
  open is always derived from the dates.
- **Never use Playwright's unquoted `text=` for short strings.** It matches a
  case-insensitive substring and the sidebar comes first in the DOM
  (`text=UA` matched "Konsolidasi Keuangan"). `rbac.test.ts` guards it.
- **Never push to `main`** (a ruleset also requires PRs), and never `Write`
  `schema.prisma` wholesale — edit it surgically.
