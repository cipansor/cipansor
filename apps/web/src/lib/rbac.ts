/**
 * Client-side RBAC helpers — the single source of truth for the web app's
 * route protection and dashboard routing (used by `middleware.ts` and the
 * role-scoped layouts).
 *
 * The backend already collapses the rich `RoleCode` vocabulary
 * (`SDIT_GURU`, `YAYASAN_BENDAHARA`, …) down to a legacy `UserRole` bucket
 * via `deriveLegacyRole()` (see `apps/api/src/middleware/auth.ts`) and ships
 * it as `user.role`. This module mirrors that mapping so the web side can
 * derive the same bucket directly from `user.userRoles[].role.code` when the
 * legacy field is absent — keeping the two vocabularies aligned without
 * forcing a big-bang migration of the ~40 pages that still read `user.role`.
 *
 * IMPORTANT: `ROLE_CODE_TO_LEGACY` must stay in sync with the backend's
 * `LEGACY_ROLE_EXPANSION`. If you add a RoleCode there, mirror it here.
 */

/** The six coarse buckets the route/dashboard maps are keyed on. */
export type LegacyRole =
  "SUPER_ADMIN" | "UNIT_ADMIN" | "TEACHER" | "STAFF" | "STUDENT" | "PARENT";

const LEGACY_ROLES: readonly LegacyRole[] = [
  "SUPER_ADMIN",
  "UNIT_ADMIN",
  "TEACHER",
  "STAFF",
  "STUDENT",
  "PARENT",
];

/**
 * RoleCode → legacy bucket. Mirrors the backend `LEGACY_ROLE_EXPANSION`
 * inverted (first mapping wins). Governance Yayasan roles intentionally
 * collapse to `UNIT_ADMIN`, matching the backend.
 */
export const ROLE_CODE_TO_LEGACY: Record<string, LegacyRole> = {
  SUPER_ADMIN: "SUPER_ADMIN",

  // Yayasan governance + per-unit admins → UNIT_ADMIN
  YAYASAN_PEMBINA: "UNIT_ADMIN",
  YAYASAN_KETUA: "UNIT_ADMIN",
  YAYASAN_SEKRETARIS: "UNIT_ADMIN",
  YAYASAN_BENDAHARA: "UNIT_ADMIN",
  YAYASAN_ANGGOTA: "UNIT_ADMIN",
  YAYASAN_PENGAWAS: "UNIT_ADMIN",
  TKQ_ADMIN: "UNIT_ADMIN",
  SDIT_ADMIN: "UNIT_ADMIN",
  SMPIT_ADMIN: "UNIT_ADMIN",
  SMAQ_ADMIN: "UNIT_ADMIN",

  // Teachers + kepala sekolah/guru BK + pesantren
  // educators (incl. gender-segregated variants) + PT academics → TEACHER
  TKQ_GURU: "TEACHER",
  SDIT_GURU: "TEACHER",
  SMPIT_GURU: "TEACHER",
  SMAQ_GURU: "TEACHER",
  TKQ_KEPALA_SEKOLAH: "TEACHER",
  SDIT_KEPALA_SEKOLAH: "TEACHER",
  SMPIT_KEPALA_SEKOLAH: "TEACHER",
  SMAQ_KEPALA_SEKOLAH: "TEACHER",
  SMPIT_GURU_BK: "TEACHER",
  SMAQ_GURU_BK: "TEACHER",
  PESANTREN_PENGASUH: "TEACHER",
  USTADZ: "TEACHER",
  MUSYRIF: "TEACHER",
  MUHAFIDZ: "TEACHER",

  // Tata usaha + bendahara + pesantren administration + business units
  // → STAFF (business managers are NOT admins — see backend note)
  TKQ_TATA_USAHA: "STAFF",
  SDIT_TATA_USAHA: "STAFF",
  SMPIT_TATA_USAHA: "STAFF",
  SMAQ_TATA_USAHA: "STAFF",
  TKQ_BENDAHARA: "STAFF",
  SDIT_BENDAHARA: "STAFF",
  SMPIT_BENDAHARA: "STAFF",
  SMAQ_BENDAHARA: "STAFF",
  PESANTREN_TATA_USAHA: "STAFF",
  PUSTAKAWAN: "STAFF",
  PERAWAT: "STAFF",
  KEAMANAN: "STAFF",
  LABORAN: "STAFF",
  BUSINESS_MANAGER: "STAFF",
  BUSINESS_STAFF: "STAFF",

  // Students → STUDENT
  SDIT_SISWA: "STUDENT",
  SMPIT_SISWA: "STUDENT",
  SMAQ_SISWA: "STUDENT",

  // Parents → PARENT
  TKQ_ORANG_TUA: "PARENT",
  SDIT_ORANG_TUA: "PARENT",
  SMPIT_ORANG_TUA: "PARENT",
  SMAQ_ORANG_TUA: "PARENT",

  // Komite and alumni are deliberately absent — this map mirrors the backend
  // (apps/api middleware/auth.ts ROLE_CODE_TO_LEGACY_ROLE), which leaves them
  // unmapped for RoleCode-native authorization. They still reach the app via
  // the persisted `user.role` column, and their menus come from
  // getNavigationForRoleCode(), which is RoleCode-based already.
};

/** Role → default dashboard landing route. */
export const roleDashboardMap: Record<LegacyRole, string> = {
  SUPER_ADMIN: "/dashboard",
  UNIT_ADMIN: "/dashboard",
  TEACHER: "/teacher",
  STAFF: "/staff",
  STUDENT: "/student",
  PARENT: "/parent",
};

/**
 * Role → allowed route prefixes (`"*"` = all).
 *
 * Kept in sync with `config/navigation.ts`: each bucket lists exactly what the
 * navigations mapped to it expose, plus the routes every signed-in user needs.
 * These two files are the same contract seen from opposite ends — if a sidebar
 * shows a link, the middleware here must let it through, otherwise the user
 * gets bounced to /unauthorized by a menu we drew ourselves. Add a nav item,
 * add its prefix here.
 *
 * This is UX-level gating only. The real authorization boundary is the API,
 * which checks permissions per RoleCode.
 */
export const roleRouteAccess: Record<LegacyRole, string[]> = {
  SUPER_ADMIN: ["*"],
  UNIT_ADMIN: [
    "/academic-years",
    "/admissions",
    "/spmb",
    "/alumni",
    "/analytics",
    "/announcements",
    "/assessment",
    "/attendance",
    "/calendar",
    "/canteen",
    "/cbt/banks",
    "/cbt/exams",
    "/classes",
    "/counseling",
    "/curriculum",
    "/daily-report",
    "/dashboard",
    "/donation",
    "/dormitories",
    "/duty-roster",
    "/e-office",
    "/emis",
    "/extracurricular",
    "/facilities",
    "/finance",
    "/foundation",
    "/grc-dashboard",
    "/health",
    "/hr",
    "/ibadah",
    "/inventory",
    "/kitab-progress",
    "/laundry",
    "/library",
    "/marketing",
    "/meals",
    "/muhadatsah",
    "/muhadhoroh",
    "/muhasabah",
    "/notifications",
    "/organisasi",
    "/payroll",
    "/pengawasan",
    "/perencanaan",
    "/permits",
    "/kinerja",
    "/portfolio",
    "/practicum",
    "/procurement",
    "/profile",
    "/project",
    "/quality",
    "/reception",
    "/reports",
    "/research",
    "/rewards",
    "/risk-management",
    "/settings",
    "/student-org",
    "/students",
    "/syariah",
    "/tahfidz",
    "/takhosus",
    "/talenta",
    "/tata-laksana",
    "/tk",
    "/unauthorized",
    "/unit-usaha",
    "/units",
    "/users",
    "/violations",
    "/wakaf-infaq",
    "/wilayah",
  ],
  TEACHER: [
    "/admissions",
    "/spmb",
    "/alumni",
    "/analytics",
    "/announcements",
    "/assessment",
    "/assignments",
    "/attendance",
    "/canteen",
    "/certificates",
    "/classes",
    "/counseling",
    "/curriculum",
    "/daily-report",
    "/dashboard",
    "/dormitories",
    "/duty-roster",
    "/e-office",
    "/extracurricular",
    "/health",
    "/homeroom",
    "/hr",
    "/ibadah",
    "/kitab-progress",
    "/laundry",
    "/library",
    "/meals",
    "/muhadatsah",
    "/muhadhoroh",
    "/muhasabah",
    "/musyrif",
    "/notifications",
    "/kinerja",
    "/permits",
    "/portfolio",
    "/practicum",
    "/profile",
    "/quality",
    "/rapor-pesantren",
    "/reports",
    "/research",
    "/rewards",
    "/schedule",
    "/settings",
    "/student-org",
    "/students",
    "/tahfidz",
    "/takhosus",
    "/teacher",
    "/unauthorized",
    "/users",
    "/violations",
  ],
  STAFF: [
    "/admissions",
    "/analytics",
    "/announcements",
    "/spmb",
    "/donation",
    "/e-office",
    "/finance",
    "/health",
    "/kinerja",
    "/lingkungan",
    "/notifications",
    "/permits",
    "/profile",
    "/quality",
    "/reports",
    "/rewards",
    "/schedule",
    "/settings",
    "/staff",
    "/students",
    "/unauthorized",
    "/violations",
  ],
  STUDENT: [
    "/alumni",
    "/announcements",
    "/assessment",
    "/assignments",
    "/attendance",
    "/certificates",
    "/classes",
    "/counseling",
    "/donation",
    "/extracurricular",
    "/ibadah",
    "/kitab-progress",
    "/library",
    "/muhadatsah",
    "/muhadhoroh",
    "/muhasabah",
    "/notifications",
    "/portfolio",
    "/practicum",
    "/profile",
    "/quality/complaints",
    "/research",
    "/schedule",
    "/settings",
    "/student",
    "/student-org",
    "/tahfidz",
    "/unauthorized",
    "/wallet",
  ],
  PARENT: [
    "/announcements",
    "/notifications",
    "/parent",
    "/profile",
    "/quality/complaints",
    "/settings",
    "/unauthorized",
  ],
};

/** Type guard: is this string one of the six legacy buckets? */
export function isLegacyRole(value: unknown): value is LegacyRole {
  return (
    typeof value === "string" && LEGACY_ROLES.includes(value as LegacyRole)
  );
}

/** Derive the legacy bucket for a RoleCode, or `undefined` if unmapped. */
export function deriveLegacyRole(roleCode: string): LegacyRole | undefined {
  if (isLegacyRole(roleCode)) return roleCode;
  return ROLE_CODE_TO_LEGACY[roleCode];
}

/** Minimal shape of the persisted user needed for RBAC decisions. */
export interface RbacUser {
  role?: string | null;
  userRoles?: Array<{
    isPrimary?: boolean;
    role?: { code?: string | null } | null;
  }> | null;
}

/**
 * The RoleCode of the user's active (primary) assignment — the code the API
 * reads from the token — or undefined when the user has none.
 */
export function getActiveRoleCode(
  user: RbacUser | null | undefined,
): string | undefined {
  const assignments = user?.userRoles ?? [];
  const primary =
    assignments.find((a) => a?.isPrimary) ?? assignments[0] ?? undefined;
  return primary?.role?.code ?? undefined;
}

/**
 * Resolve the effective legacy bucket for a user.
 *
 * Backward-compatible by design: the legacy `user.role` field (still emitted
 * by the backend) wins when it is a valid bucket, so existing behavior is
 * preserved exactly. Only when it is missing/invalid do we derive the bucket
 * from the primary `userRoles[].role.code` (RoleCode) — the alignment path.
 */
export function getEffectiveRole(
  user: RbacUser | null | undefined,
): LegacyRole | undefined {
  if (!user) return undefined;

  // The active (primary) assignment decides, as on the API, which derives
  // req.user.role from the token's roleCode. `user.role` is the legacy column
  // and always holds a legacy value, so reading it first made the assignment
  // branch dead code for every real user: ketua@ — STAFF in that column, Ketua
  // Pengurus by assignment — was bounced from /perencanaan to /staff by the web
  // while the API served the page, and switching roles never changed which
  // pages the web allowed.
  const code = getActiveRoleCode(user);
  if (code) {
    const derived = deriveLegacyRole(code);
    if (derived) return derived;
  }

  if (isLegacyRole(user.role)) return user.role;

  // Last-ditch: a raw RoleCode sitting in `user.role`.
  if (typeof user.role === "string") {
    return deriveLegacyRole(user.role);
  }
  return undefined;
}

/**
 * Pages one RoleCode needs beyond its bucket.
 *
 * The buckets are coarse: every kepala sekolah shares TEACHER with every guru,
 * and the pustakawan shares STAFF with tata usaha and the nurse. Opening these
 * pages to a whole bucket would show them to everyone in it, so each entry
 * opens a page to the one role whose job it is. The API still decides what
 * the role may do there.
 *
 * Found on 2026-09-25 by printing every role's menu
 * (`apps/web/scripts/role-menus.ts`): each page below was refused to the very
 * role it exists for, while the API already admitted that role. Model A
 * (roadmap §1.2) replaces the buckets and this map with a permission per
 * feature.
 */
export const roleCodeRouteAccess: Readonly<Record<string, readonly string[]>> =
  {
    // The four unit admins run Rapor Pesantren — its config is stored per unit
    // and `PUT /rapor-pesantren/config` authorizes UNIT_ADMIN — but the
    // `/rapor-pesantren` entry is a menu item of the *pesantren* navigations
    // and of TEACHER, not of the school admin menu. Without this the sidebar
    // link (and the page itself) bounced the unit admin straight back to
    // /dashboard — the rapor-config e2e caught it as a 307. A head keeps it
    // through TEACHER.
    TKQ_ADMIN: ["/rapor-pesantren"],
    SDIT_ADMIN: ["/rapor-pesantren"],
    SMPIT_ADMIN: ["/rapor-pesantren"],
    SMAQ_ADMIN: ["/rapor-pesantren"],
    // The head drafts the RKA Unit their PK must anchor to
    // (`canAuthorUnitPlan` on the API), and reads their unit's page and its
    // accreditation (Profil Unit).
    TKQ_KEPALA_SEKOLAH: ["/perencanaan", "/units"],
    SDIT_KEPALA_SEKOLAH: ["/perencanaan", "/units"],
    SMPIT_KEPALA_SEKOLAH: ["/perencanaan", "/units"],
    SMAQ_KEPALA_SEKOLAH: ["/perencanaan", "/units"],
    PUSTAKAWAN: ["/library"],
    // Laboratory equipment: the role holds INVENTORY_VIEW / INVENTORY_MANAGE.
    // `/practicum` is Amaliyah Tadris (teaching practice), not a laboratory.
    LABORAN: ["/inventory"],
    BUSINESS_MANAGER: ["/canteen", "/laundry", "/unit-usaha"],
    BUSINESS_STAFF: ["/canteen", "/laundry"],
  };

/**
 * Can this role reach `pathname`? `roleCode`, when given, adds the pages in
 * `roleCodeRouteAccess` to what the bucket allows.
 */
export function canAccessRoute(
  role: LegacyRole | undefined,
  pathname: string,
  roleCode?: string | null,
): boolean {
  if (!role) return false;
  const allowed = roleRouteAccess[role] ?? [];
  if (allowed.includes("*")) return true;
  const extra = (roleCode && roleCodeRouteAccess[roleCode]) || [];
  // Match on segment boundaries, not raw string prefixes: a plain startsWith
  // would let "/student" also grant "/students" (the whole admin student
  // roster) to every student.
  return [...allowed, ...extra].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * RoleCode-level landing overrides.
 *
 * The six legacy buckets are too coarse for a few RoleCodes: alumni collapse
 * into STUDENT and komite into STAFF, which would drop them on a student or
 * staff dashboard full of data that is not theirs. These land them on the page
 * their own sidebar actually starts with.
 */
const roleCodeDashboardOverrides: Record<string, string> = {
  SMPIT_ALUMNI: "/alumni",
  SMAQ_ALUMNI: "/alumni",
  TKQ_KOMITE: "/reports",
  SDIT_KOMITE: "/reports",
  SMPIT_KOMITE: "/reports",
  SMAQ_KOMITE: "/reports",
  // Kepala sekolah sit in the TEACHER bucket but run a unit, so their sidebar
  // opens on the management dashboard rather than the teaching one.
  TKQ_KEPALA_SEKOLAH: "/dashboard",
  SDIT_KEPALA_SEKOLAH: "/dashboard",
  SMPIT_KEPALA_SEKOLAH: "/dashboard",
  SMAQ_KEPALA_SEKOLAH: "/dashboard",
};

/** The dashboard a role should land on. */
export function getDashboardForRole(
  role: LegacyRole | undefined,
  roleCode?: string | null,
): string {
  if (roleCode && roleCodeDashboardOverrides[roleCode]) {
    return roleCodeDashboardOverrides[roleCode];
  }
  return role ? roleDashboardMap[role] : "/dashboard";
}

/** The primary RoleCode for a user, if any. */
export function getPrimaryRoleCode(
  user: RbacUser | null | undefined,
): string | undefined {
  const assignments = user?.userRoles ?? [];
  const primary =
    assignments.find((a) => a?.isPrimary) ?? assignments[0] ?? undefined;
  return primary?.role?.code ?? undefined;
}
