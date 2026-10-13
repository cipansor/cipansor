/**
 * Role-code vocabulary shared by the API and the web app.
 *
 * The database enum in `apps/api/prisma/schema.prisma` (`RoleCode`) is the
 * source of truth for WHICH codes exist; this module is the source of truth
 * for how they are GROUPED (admin, teacher-level, staff, ...) and how they
 * map back to the six legacy `UserRole` buckets. Before this module, those
 * groupings were hand-mirrored in three places (`apps/api` auth middleware,
 * `apps/web` rbac helpers, `apps/web` navigation config) and had already
 * drifted apart.
 *
 * `apps/api` has a sync test asserting these string values exactly match the
 * Prisma enum — if you add a RoleCode to the schema, add it here too.
 */

const SCHOOL_PREFIXES = ["TKQ", "SDIT", "SMPIT", "SMAQ"] as const;

/** `perSchool("GURU")` → `["TKQ_GURU", "SDIT_GURU", "SMPIT_GURU", "SMAQ_GURU"]` */
const perSchool = (suffix: string): string[] =>
  SCHOOL_PREFIXES.map((p) => `${p}_${suffix}`);

// ---------------------------------------------------------------------------
// Functional groups
// ---------------------------------------------------------------------------

/** System administrators: full administrative UI + admin-only API routes. */
export const ADMIN_ROLE_CODES: readonly string[] = [
  "SUPER_ADMIN",
  ...perSchool("ADMIN"),
];

/**
 * Yayasan governance (board members, auditors, treasurer, ...). Elevated
 * foundation-level oversight, deliberately NOT system administrators.
 */
export const GOVERNANCE_ROLE_CODES: readonly string[] = [
  "YAYASAN_PEMBINA",
  "YAYASAN_KETUA",
  "YAYASAN_SEKRETARIS",
  "YAYASAN_BENDAHARA",
  "YAYASAN_ANGGOTA",
  "YAYASAN_PENGAWAS",
];

/**
 * Pengurus — the organ that RUNS the yayasan (UU 16/2001 Pasal 31 ayat 1), and
 * so the only one that drafts its plans. Pembina ratifies the work programme
 * and annual budget (Pasal 28 ayat 2 huruf d); Pengawas supervises and advises
 * (Pasal 40 ayat 1). Neither authors the documents they then judge.
 */
export const PENGURUS_ROLE_CODES: readonly string[] = [
  "YAYASAN_KETUA",
  "YAYASAN_SEKRETARIS",
  "YAYASAN_BENDAHARA",
  "YAYASAN_ANGGOTA",
];

/** Kepala sekolah — educational leadership, not system administration. */
export const PRINCIPAL_ROLE_CODES: readonly string[] =
  perSchool("KEPALA_SEKOLAH");

/**
 * Guru BK — the school counsellors. They exist only at the secondary units
 * (TK Qur'an and SD IT have none), matching the RoleCode enum. Besides a
 * session's own counsellor, they are the only readers of a unit's
 * confidential counselling sessions (decided 2026-09-26).
 */
export const GURU_BK_ROLE_CODES: readonly string[] = [
  "SMPIT_GURU_BK",
  "SMAQ_GURU_BK",
];

/**
 * Teachers and BK counsellors. Wakasek and wali kelas are duties a guru holds,
 * not role codes of their own (merged into `*_GURU` on 2026-09-26): wali kelas
 * is `Class.homeroomTeacherId`.
 */
export const SCHOOL_TEACHER_ROLE_CODES: readonly string[] = [
  ...perSchool("GURU"),
  ...GURU_BK_ROLE_CODES,
];

/**
 * Pesantren leadership: the Kiai, Pimpinan Pesantren (UU 18/2019 Ps. 9 ayat 2,
 * "pemimpin tertinggi Pesantren"). Cipansor has no separate operational
 * director, so PESANTREN_DIREKTUR was removed on 2026-09-25.
 */
export const PESANTREN_LEADER_ROLE_CODES: readonly string[] = [
  "PESANTREN_PENGASUH",
];

/**
 * Roles that make a second factor mandatory (decided 2026-09-28, decision
 * `autentikasi-2fa-dan-sandi`): system administrators, the yayasan's organs,
 * and the head of every unit — the four kepala sekolah and the Pimpinan
 * Pesantren. Holding any of them in any active assignment is enough. Everyone
 * else may turn 2FA on from their profile.
 */
export const SECOND_FACTOR_ROLE_CODES: readonly string[] = [
  ...ADMIN_ROLE_CODES,
  ...GOVERNANCE_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...PESANTREN_LEADER_ROLE_CODES,
];

/**
 * Pesantren educators and dormitory mentors. One role per duty, not per
 * gender: putra/putri follows the asrama or halaqah served, and wali kamar and
 * murabbi are musyrif duties (merged 2026-09-25).
 */
export const PESANTREN_EDUCATOR_ROLE_CODES: readonly string[] = [
  "USTADZ",
  "MUSYRIF",
  "MUHAFIDZ",
];

/** Tata usaha (administrative office) across school units and pesantren. */
export const TATA_USAHA_ROLE_CODES: readonly string[] = [
  ...perSchool("TATA_USAHA"),
  "PESANTREN_TATA_USAHA",
];

/** Unit treasurers (yayasan treasurer is in GOVERNANCE_ROLE_CODES). */
export const BENDAHARA_ROLE_CODES: readonly string[] = perSchool("BENDAHARA");

/** Cross-unit support staff mapped to concrete service modules. */
export const SUPPORT_ROLE_CODES: readonly string[] = [
  "PUSTAKAWAN",
  "PERAWAT",
  "KEAMANAN",
  "LABORAN",
];

/**
 * Roles whose remit spans every unit's santri: the pesantren's own staff (the
 * asrama houses SD IT, SMP IT and SMA Qur'an together) and the cross-unit
 * support staff. The API widens their reads with `seesAllUnits`; the web stops
 * pinning their dashboards to their home unit. What they may *do* is still
 * their permission list.
 */
export const CROSS_UNIT_ROLE_CODES: readonly string[] = [
  ...PESANTREN_LEADER_ROLE_CODES,
  "PESANTREN_TATA_USAHA",
  ...PESANTREN_EDUCATOR_ROLE_CODES,
  ...SUPPORT_ROLE_CODES,
];

/** Business-unit personnel (kantin, laundry, koperasi, ...). */
export const BUSINESS_ROLE_CODES: readonly string[] = [
  "BUSINESS_MANAGER",
  "BUSINESS_STAFF",
];

/** Students across school units. TK Qur'an has no per-student SISWA role. */
export const STUDENT_ROLE_CODES: readonly string[] = [
  "SDIT_SISWA",
  "SMPIT_SISWA",
  "SMAQ_SISWA",
];

/** Parents/guardians. */
export const PARENT_ROLE_CODES: readonly string[] = perSchool("ORANG_TUA");

/** School committees (komite sekolah). */
export const KOMITE_ROLE_CODES: readonly string[] = perSchool("KOMITE");

/**
 * Accounts invited to turn 2FA on, right after signing in, until they do
 * (decided 2026-09-28, `decisions/autentikasi-2fa-dan-sandi.md`): every
 * educator and staff member whose role does not already make 2FA mandatory,
 * and the wali santri. "Nanti saja" has no limit; the invitation returns at the
 * next sign-in. Santri are not invited — most do not hold a phone — and the
 * decision names neither komite nor alumni. Anyone may still turn 2FA on from
 * their profile.
 */
export const SECOND_FACTOR_INVITE_ROLE_CODES: readonly string[] = [
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
  ...TATA_USAHA_ROLE_CODES,
  ...BENDAHARA_ROLE_CODES,
  ...SUPPORT_ROLE_CODES,
  ...BUSINESS_ROLE_CODES,
  ...PARENT_ROLE_CODES,
];

/** Alumni across the secondary units (no TK Qur'an / SD IT alumni role). */
export const ALUMNI_ROLE_CODES: readonly string[] = [
  "SMPIT_ALUMNI",
  "SMAQ_ALUMNI",
];

/**
 * Menulis data alumni (alumni, karier, pendidikan, donasi, acara, kehadiran) —
 * admin dan tata usaha, di lingkup unitnya. Satu sumber untuk API
 * (`modules/alumni/alumni-access.ts`) dan web (tombol di halaman Alumni).
 */
export const ALUMNI_WRITE_ROLE_CODES: readonly string[] = [
  ...ADMIN_ROLE_CODES,
  ...TATA_USAHA_ROLE_CODES,
];

/**
 * Membaca kontak, data diri, dan analisis nilai per alumni — pengelola ditambah
 * kepala sekolah dan organ yayasan. Akun lain melihat direktori tanpa semua itu.
 */
export const ALUMNI_PERSONAL_DATA_ROLE_CODES: readonly string[] = [
  ...ALUMNI_WRITE_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...GOVERNANCE_ROLE_CODES,
];

/** External roles (students, parents, alumni, komite) that cannot participate in E-Office correspondence. */
export const EXCLUDED_CORRESPONDENCE_ROLES: readonly string[] = [
  ...STUDENT_ROLE_CODES,
  ...PARENT_ROLE_CODES,
  ...KOMITE_ROLE_CODES,
  ...ALUMNI_ROLE_CODES,
];

/**
 * Roles that handle a unit's correspondence as part of the job: the office
 * that registers and files letters, and the head who signs them.
 *
 * Single source of truth for the E-Office "Edit Naskah Surat" UI toggle and
 * the API's letter-access guard (`apps/api/src/utils/letter-access.ts`), so
 * the two can never drift apart again. The API has a sync test
 * (`apps/api/src/middleware/roles-sync.test.ts`) asserting the grouped
 * strings match the `RoleCode` Prisma enum exactly.
 *
 * Deliberately an explicit list rather than a permission string: introducing a
 * LETTER_* permission would mean editing the role→permission matrix and would
 * only take effect after every existing JWT expired; an allowlist checked at
 * request time is auditable in one place and correct immediately.
 */
export const LETTER_UNIT_SCOPE_ROLES: readonly string[] = [
  ...TATA_USAHA_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...perSchool("ADMIN"),
];

/**
 * Foundation/executive roles that may edit a letter's naskah too — the
 * API's `updateLetter` grants the creator, these executive roles, and any
 * `LETTER_UNIT_SCOPE_ROLES` holder (via `handlesUnitCorrespondence`).
 */
export const LETTER_EDIT_EXECUTIVE_ROLES: readonly string[] = [
  "SUPER_ADMIN",
  "YAYASAN_KETUA",
  "YAYASAN_SEKRETARIS",
];

/**
 * Foundation roles that see across units — the mirror of the API's
 * `FOUNDATION_SCOPE_ROLES` (`apps/api/src/utils/resolve-unit-id.ts`). Note the
 * `SUPER_ADMIN` literal rather than `ADMIN_ROLE_CODES`: a school's own
 * `*_ADMIN` is unit-scoped, so it is deliberately **not** foundation-scoped.
 * `roles-sync.test.ts` pins this list equal to the API's, both directions.
 */
export const FOUNDATION_SCOPE_ROLE_CODES: readonly string[] = [
  "SUPER_ADMIN",
  ...GOVERNANCE_ROLE_CODES,
];

/**
 * Who may open the archive retention review (the E-Office card and its page).
 *
 * Exactly the API's guard (`choosesUnit(actor) || handlesUnitCorrespondence(actor)`
 * in `correspondence.controller.ts`): the office and head who handle a unit's
 * letters, plus the foundation roles that may choose a unit. The web card reads
 * this so it does not offer a door the server answers 403 — which it did while
 * the card only checked that a `unitId` existed, and almost every account has one.
 */
export const LETTER_RETENTION_ROLE_CODES: readonly string[] = [
  ...LETTER_UNIT_SCOPE_ROLES,
  ...FOUNDATION_SCOPE_ROLE_CODES,
];

/** True when a role code may open the retention review. Mirrors the API guard. */
export function mayReviewLetterRetention(
  roleCode: string | null | undefined,
): boolean {
  return !!roleCode && LETTER_RETENTION_ROLE_CODES.includes(roleCode);
}

/**
 * True when a role code may edit a letter's naskah (excluding the "is the
 * creator" check, which is by user id). Mirrors `updateLetter` on the API so
 * the E-Office "Edit Naskah Surat" UI toggle and the server guard read the
 * same source.
 */
export function mayEditLetter(roleCode: string | null | undefined): boolean {
  if (!roleCode) return false;
  return (
    LETTER_UNIT_SCOPE_ROLES.includes(roleCode) ||
    LETTER_EDIT_EXECUTIVE_ROLES.includes(roleCode)
  );
}

/** Every RoleCode in the system — must equal the Prisma enum exactly. */
export const ALL_ROLE_CODES: readonly string[] = [
  ...ADMIN_ROLE_CODES,
  ...GOVERNANCE_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PESANTREN_LEADER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
  ...TATA_USAHA_ROLE_CODES,
  ...BENDAHARA_ROLE_CODES,
  ...SUPPORT_ROLE_CODES,
  ...BUSINESS_ROLE_CODES,
  ...STUDENT_ROLE_CODES,
  ...PARENT_ROLE_CODES,
  ...KOMITE_ROLE_CODES,
  ...ALUMNI_ROLE_CODES,
];

// ---------------------------------------------------------------------------
// Legacy UserRole bridge
// ---------------------------------------------------------------------------

/** The six coarse buckets of the legacy `UserRole` enum. */
export type LegacyRole =
  "SUPER_ADMIN" | "UNIT_ADMIN" | "TEACHER" | "STAFF" | "STUDENT" | "PARENT";

export const LEGACY_ROLES: readonly LegacyRole[] = [
  "SUPER_ADMIN",
  "UNIT_ADMIN",
  "TEACHER",
  "STAFF",
  "STUDENT",
  "PARENT",
];

/**
 * Legacy bucket → RoleCodes it expands to. This is the canonical bridge used
 * by the API's `authorize()` for routes still written against `UserRole`.
 *
 * Deliberate exclusions (no legacy bucket): KOMITE_* and ALUMNI_* — they
 * predate nothing; modules serving them must use RoleCode directly.
 */
export const LEGACY_ROLE_EXPANSION: Record<LegacyRole, string[]> = {
  SUPER_ADMIN: ["SUPER_ADMIN"],
  UNIT_ADMIN: [...GOVERNANCE_ROLE_CODES, ...perSchool("ADMIN")],
  TEACHER: [
    ...SCHOOL_TEACHER_ROLE_CODES,
    ...PRINCIPAL_ROLE_CODES,
    ...PESANTREN_LEADER_ROLE_CODES,
    ...PESANTREN_EDUCATOR_ROLE_CODES,
  ],
  STAFF: [
    ...TATA_USAHA_ROLE_CODES,
    ...BENDAHARA_ROLE_CODES,
    ...SUPPORT_ROLE_CODES,
    ...BUSINESS_ROLE_CODES,
  ],
  STUDENT: [...STUDENT_ROLE_CODES],
  PARENT: [...PARENT_ROLE_CODES],
};

/**
 * RoleCode → legacy bucket (inverse of LEGACY_ROLE_EXPANSION; first mapping
 * wins). Komite and alumni codes intentionally have no entry.
 */
export const ROLE_CODE_TO_LEGACY: Record<string, LegacyRole> = (() => {
  const map: Record<string, LegacyRole> = {};
  for (const [legacy, codes] of Object.entries(LEGACY_ROLE_EXPANSION) as Array<
    [LegacyRole, string[]]
  >) {
    for (const code of codes) {
      if (!map[code]) map[code] = legacy;
    }
  }
  return map;
})();

/** Type guard: is this string one of the six legacy buckets? */
export function isLegacyRole(value: unknown): value is LegacyRole {
  return (
    typeof value === "string" && (LEGACY_ROLES as string[]).includes(value)
  );
}

/** Derive the legacy bucket for a RoleCode, or `undefined` if unmapped. */
export function legacyRoleFor(roleCode: string): LegacyRole | undefined {
  if (isLegacyRole(roleCode)) return roleCode;
  return ROLE_CODE_TO_LEGACY[roleCode];
}
