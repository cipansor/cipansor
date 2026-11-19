export const PERMISSIONS = {
  // User Management
  USER_VIEW: 'USER_VIEW',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',

  // Role Management
  ROLE_VIEW: 'ROLE_VIEW',
  ROLE_MANAGE: 'ROLE_MANAGE', // Create, Update, Delete Roles & Permissions

  // Student Management
  STUDENT_VIEW: 'STUDENT_VIEW',
  STUDENT_CREATE: 'STUDENT_CREATE',
  STUDENT_UPDATE: 'STUDENT_UPDATE',
  STUDENT_DELETE: 'STUDENT_DELETE',

  // Teacher & Staff Management
  TEACHER_VIEW: 'TEACHER_VIEW',
  TEACHER_MANAGE: 'TEACHER_MANAGE',
  STAFF_VIEW: 'STAFF_VIEW',
  STAFF_MANAGE: 'STAFF_MANAGE',

  // Academic / Curriculum
  ACADEMIC_VIEW: 'ACADEMIC_VIEW',
  ACADEMIC_MANAGE: 'ACADEMIC_MANAGE', // Subjects, Classes, Schedules

  // Exams & Grades
  EXAM_VIEW: 'EXAM_VIEW',
  EXAM_MANAGE: 'EXAM_MANAGE',
  GRADE_VIEW: 'GRADE_VIEW',
  GRADE_MANAGE: 'GRADE_MANAGE',

  // Finance
  FINANCE_VIEW: 'FINANCE_VIEW',
  FINANCE_MANAGE: 'FINANCE_MANAGE', // Invoices, Payments, Budgets

  // Inventory / Assets
  INVENTORY_VIEW: 'INVENTORY_VIEW',
  INVENTORY_MANAGE: 'INVENTORY_MANAGE',

  // Library
  LIBRARY_VIEW: 'LIBRARY_VIEW',
  LIBRARY_MANAGE: 'LIBRARY_MANAGE',

  // Health / UKS
  HEALTH_VIEW: 'HEALTH_VIEW',
  HEALTH_MANAGE: 'HEALTH_MANAGE',

  // Dormitory / Pesantren
  DORMITORY_VIEW: 'DORMITORY_VIEW',
  DORMITORY_MANAGE: 'DORMITORY_MANAGE',

  // Tahfidz
  TAHFIDZ_VIEW: 'TAHFIDZ_VIEW',
  TAHFIDZ_MANAGE: 'TAHFIDZ_MANAGE',

  // Admissions (PSB)
  ADMISSION_VIEW: 'ADMISSION_VIEW',
  ADMISSION_MANAGE: 'ADMISSION_MANAGE',

  // Settings
  SETTINGS_MANAGE: 'SETTINGS_MANAGE',

  /**
   * Pelindungan data pribadi: daftar dan tindak lanjut permintaan hak subjek
   * data (UU 27/2022 Pasal 30, 35, 40, 43).
   *
   * Satu izin, bukan RoleCode baru. Yayasan menunjuk petugas pelindungan data
   * pribadi beserta penggantinya (Pasal 53), dan penunjukan itu berpindah orang
   * tanpa berpindah jabatan struktural — role baru akan memaksa setiap
   * penunjukan ulang menjadi perubahan data kepegawaian. Izin ini dapat
   * diberikan kepada peran mana pun lewat layar peran.
   *
   * Hanya SUPER_ADMIN yang memegangnya secara bawaan; sisa peran memperolehnya
   * dengan penunjukan, bukan dengan menduduki jabatan tertentu.
   */
  PDP_MANAGE: 'PDP_MANAGE',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_GROUPS = {
  USER: [
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_DELETE,
  ],
  ROLE: [PERMISSIONS.ROLE_VIEW, PERMISSIONS.ROLE_MANAGE],
  STUDENT: [
    PERMISSIONS.STUDENT_VIEW,
    PERMISSIONS.STUDENT_CREATE,
    PERMISSIONS.STUDENT_UPDATE,
    PERMISSIONS.STUDENT_DELETE,
  ],
  EMPLOYEE: [
    PERMISSIONS.TEACHER_VIEW,
    PERMISSIONS.TEACHER_MANAGE,
    PERMISSIONS.STAFF_VIEW,
    PERMISSIONS.STAFF_MANAGE,
  ],
  ACADEMIC: [
    PERMISSIONS.ACADEMIC_VIEW,
    PERMISSIONS.ACADEMIC_MANAGE,
    PERMISSIONS.EXAM_VIEW,
    PERMISSIONS.EXAM_MANAGE,
    PERMISSIONS.GRADE_VIEW,
    PERMISSIONS.GRADE_MANAGE,
  ],
  FINANCE: [PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_MANAGE],
  ASSETS: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_MANAGE],
  LIBRARY: [PERMISSIONS.LIBRARY_VIEW, PERMISSIONS.LIBRARY_MANAGE],
  HEALTH: [PERMISSIONS.HEALTH_VIEW, PERMISSIONS.HEALTH_MANAGE],
  PESANTREN: [
    PERMISSIONS.DORMITORY_VIEW,
    PERMISSIONS.DORMITORY_MANAGE,
    PERMISSIONS.TAHFIDZ_VIEW,
    PERMISSIONS.TAHFIDZ_MANAGE,
  ],
  ADMISSION: [PERMISSIONS.ADMISSION_VIEW, PERMISSIONS.ADMISSION_MANAGE],
  SYSTEM: [PERMISSIONS.SETTINGS_MANAGE],
};

// ---------------------------------------------------------------------------
// Role → permission matrix
// ---------------------------------------------------------------------------
//
// Until this existed, the seed gave permissions to SUPER_ADMIN and to nobody
// else: 81 roles in the database, 1 with a non-empty permission array. Because
// hasPermission() implicitly waves SUPER_ADMIN through, that was invisible in
// testing as super admin and produced a blanket 403 for all 80 other roles on
// every hasPermission()-gated endpoint. GET /api/students is the busiest of
// them, so a musyrif could not open the santri list that is the whole point of
// their account.
//
// Route-level authorize() checks are unaffected — this only fills the gap for
// permission-gated routes. Keep the two consistent when adding either.

const P = PERMISSIONS;

const VIEW_ONLY_ACADEMIC: Permission[] = [
  P.STUDENT_VIEW,
  P.ACADEMIC_VIEW,
  P.EXAM_VIEW,
  P.GRADE_VIEW,
];

/** Everything except role administration and system settings. */
const UNIT_ADMIN_PERMISSIONS: Permission[] = [
  P.USER_VIEW,
  P.STUDENT_VIEW,
  P.STUDENT_CREATE,
  P.STUDENT_UPDATE,
  P.STUDENT_DELETE,
  P.TEACHER_VIEW,
  P.TEACHER_MANAGE,
  P.STAFF_VIEW,
  P.STAFF_MANAGE,
  P.ACADEMIC_VIEW,
  P.ACADEMIC_MANAGE,
  P.EXAM_VIEW,
  P.EXAM_MANAGE,
  P.GRADE_VIEW,
  P.GRADE_MANAGE,
  P.FINANCE_VIEW,
  P.FINANCE_MANAGE,
  P.INVENTORY_VIEW,
  P.INVENTORY_MANAGE,
  P.LIBRARY_VIEW,
  P.LIBRARY_MANAGE,
  P.HEALTH_VIEW,
  P.HEALTH_MANAGE,
  P.DORMITORY_VIEW,
  P.DORMITORY_MANAGE,
  P.TAHFIDZ_VIEW,
  P.TAHFIDZ_MANAGE,
  P.ADMISSION_VIEW,
  P.ADMISSION_MANAGE,
];

/** Governance: read broadly, change nothing. Pengawas is an auditor. */
const YAYASAN_OVERSIGHT: Permission[] = [
  P.USER_VIEW,
  P.STUDENT_VIEW,
  P.TEACHER_VIEW,
  P.STAFF_VIEW,
  P.ACADEMIC_VIEW,
  P.EXAM_VIEW,
  P.GRADE_VIEW,
  P.FINANCE_VIEW,
  P.INVENTORY_VIEW,
  P.LIBRARY_VIEW,
  P.HEALTH_VIEW,
  P.DORMITORY_VIEW,
  P.TAHFIDZ_VIEW,
  P.ADMISSION_VIEW,
];

/** Classroom teaching: own students, own grades. */
const TEACHING: Permission[] = [
  ...VIEW_ONLY_ACADEMIC,
  P.EXAM_MANAGE,
  P.GRADE_MANAGE,
  P.TAHFIDZ_VIEW,
];

/** Kepala sekolah run a unit but do not administer the system. */
const UNIT_LEADERSHIP: Permission[] = [
  ...TEACHING,
  P.STUDENT_UPDATE,
  P.TEACHER_VIEW,
  P.STAFF_VIEW,
  P.ACADEMIC_MANAGE,
  P.FINANCE_VIEW,
  P.HEALTH_VIEW,
  P.LIBRARY_VIEW,
  P.INVENTORY_VIEW,
  P.DORMITORY_VIEW,
  P.TAHFIDZ_MANAGE,
  P.ADMISSION_VIEW,
];

/** Asrama staff supervise santri: dormitory + tahfidz + pastoral view. */
const PENGASUHAN: Permission[] = [
  P.STUDENT_VIEW,
  P.DORMITORY_VIEW,
  P.DORMITORY_MANAGE,
  P.TAHFIDZ_VIEW,
  P.TAHFIDZ_MANAGE,
  P.HEALTH_VIEW,
  P.ACADEMIC_VIEW,
];

const SUFFIX_PERMISSIONS: Array<[RegExp, Permission[]]> = [
  [/_ADMIN$/, UNIT_ADMIN_PERMISSIONS],
  [/_KEPALA_SEKOLAH$/, UNIT_LEADERSHIP],
  [/_GURU$|_GURU_BK$/, TEACHING],
  [
    /_TATA_USAHA$/,
    [
      P.USER_VIEW,
      P.STUDENT_VIEW,
      P.STUDENT_CREATE,
      P.STUDENT_UPDATE,
      P.TEACHER_VIEW,
      P.STAFF_VIEW,
      P.ACADEMIC_VIEW,
      P.ADMISSION_VIEW,
      P.ADMISSION_MANAGE,
    ],
  ],
  [/_BENDAHARA$/, [P.STUDENT_VIEW, P.FINANCE_VIEW, P.FINANCE_MANAGE]],
  [/_KOMITE$/, [P.STUDENT_VIEW, P.ACADEMIC_VIEW, P.FINANCE_VIEW]],
  // Empty on purpose, and it is the tighter setting rather than an unfinished
  // one. These roles are scoped by *relationship*: a wali reaches their child
  // through the StudentParent link (parent.service.verifyParentAccess), and a
  // santri through their own record. There is no permission that expresses
  // "only mine" — STUDENT_VIEW guards the admin roster, so granting it here
  // would show a wali every santri in the unit instead of their own children.
  //
  // The hazard runs the other way: adding a hasPermission() gate to a route
  // these roles use locks out every wali and santri at once, silently, and
  // only in production. relationship-scoped-roles.test.ts pins both halves.
  [/_ALUMNI$/, []],
  [/_SISWA$|_MAHASISWA$/, []],
  [/_ORANG_TUA$/, []],
];

const EXPLICIT_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: Object.values(P),

  // No YAYASAN_ADMIN: it was the only yayasan role holding USER_CREATE /
  // USER_UPDATE / ROLE_VIEW, and those now belong to SUPER_ADMIN alone. The
  // rest of the yayasan roles are oversight, not administration.
  YAYASAN_KETUA: [...YAYASAN_OVERSIGHT, P.FINANCE_MANAGE],
  YAYASAN_PEMBINA: YAYASAN_OVERSIGHT,
  YAYASAN_PENGAWAS: YAYASAN_OVERSIGHT,
  YAYASAN_ANGGOTA: YAYASAN_OVERSIGHT,
  // Sekretaris Pengurus is oversight too (keputusan pemilik 2026-11-16, #1020):
  // organ yayasan writes only through its own lanes (asas tulis organ, #991),
  // and changing santri data is not one of them. The Sekretaris still *sees*
  // the roster through STUDENT_VIEW in YAYASAN_OVERSIGHT. P.USER_VIEW dropped
  // with it — it was already in YAYASAN_OVERSIGHT.
  YAYASAN_SEKRETARIS: [...YAYASAN_OVERSIGHT],
  YAYASAN_BENDAHARA: [...YAYASAN_OVERSIGHT, P.FINANCE_MANAGE],

  PESANTREN_PENGASUH: [...UNIT_LEADERSHIP, ...PENGASUHAN],
  PESANTREN_TATA_USAHA: [
    P.STUDENT_VIEW,
    P.STUDENT_CREATE,
    P.STUDENT_UPDATE,
    P.ACADEMIC_VIEW,
    P.DORMITORY_VIEW,
    P.ADMISSION_VIEW,
  ],
  USTADZ: [...TEACHING, P.DORMITORY_VIEW],
  // Wali kamar and murabbi are musyrif duties (merged 2026-09-25); the old
  // WALI_KAMAR set (santri + asrama view only) went with them. Narrowing a
  // musyrif to one room is a data scope, not a separate role.
  MUSYRIF: PENGASUHAN,
  MUHAFIDZ: PENGASUHAN,

  PUSTAKAWAN: [P.STUDENT_VIEW, P.LIBRARY_VIEW, P.LIBRARY_MANAGE],
  PERAWAT: [P.STUDENT_VIEW, P.HEALTH_VIEW, P.HEALTH_MANAGE],
  LABORAN: [P.STUDENT_VIEW, P.INVENTORY_VIEW, P.INVENTORY_MANAGE, P.ACADEMIC_VIEW],
  KEAMANAN: [P.STUDENT_VIEW],
  BUSINESS_MANAGER: [P.FINANCE_VIEW, P.FINANCE_MANAGE, P.INVENTORY_VIEW, P.INVENTORY_MANAGE],
  BUSINESS_STAFF: [P.INVENTORY_VIEW],
};

/**
 * Permissions for a RoleCode. Explicit entries win; otherwise the code's
 * suffix decides, so the per-unit roles (TKQ_/SDIT_/SMPIT_/SMAQ_) resolve by
 * function rather than needing 4 near-identical entries each.
 *
 * Unknown codes get `[]` — deliberately. A role nobody has classified should
 * not silently inherit access; it shows up as a 403 and gets classified.
 */
export function permissionsForRoleCode(roleCode: string): Permission[] {
  const explicit = EXPLICIT_PERMISSIONS[roleCode];
  if (explicit) return Array.from(new Set(explicit));

  for (const [pattern, permissions] of SUFFIX_PERMISSIONS) {
    if (pattern.test(roleCode)) return Array.from(new Set(permissions));
  }

  return [];
}
