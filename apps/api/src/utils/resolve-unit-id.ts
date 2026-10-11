import { Request } from 'express';
import { RoleCode } from '@prisma/client';
import { Errors } from '@/middleware/error';

/**
 * Resolve the effective unitId for the current request.
 * SUPER_ADMIN users are global and may optionally specify a unitId via
 * query string to scope their operation.
 * Non-SUPER_ADMIN users MUST use the unitId from their JWT to prevent
 * cross-unit access via query parameter injection.
 *
 * NOTE: Only the query string (and JWT for non-SUPER_ADMIN) is consulted —
 * the request body is intentionally NOT checked because every write route
 * in the codebase validates its body with a Zod schema that either uses
 * `.strict()` (rejects unknown fields) or lacks a `unitId` property (strips
 * it by default). A `req.body.unitId` fallback would therefore be dead code
 * and misleading documentation for API consumers. SUPER_ADMIN callers MUST
 * supply the unitId via `?unitId=...` on the query string.
 */
export function resolveUnitId(req: Request): string | undefined {
  // SUPER_ADMIN is checked first so that a SUPER_ADMIN who happens to have
  // a unitId in their JWT (e.g. assigned to a specific unit) can still
  // operate globally by omitting the unitId query param.
  if (req.user?.roleCode === RoleCode.SUPER_ADMIN) {
    return (req.query.unitId as string | undefined) || req.user?.unitId || undefined;
  }
  // Non-SUPER_ADMIN users: always use JWT unitId (never trust query/body)
  if (req.user?.unitId) {
    return req.user.unitId;
  }
  // Non-SUPER_ADMIN with no unitId in JWT — cannot resolve
  return undefined;
}

/**
 * Boolean helper to check if the current request is from a SUPER_ADMIN user.
 *
 * NOTE: Named `isSuperAdminUser` (not `isSuperAdmin`) to avoid name collision
 * with the Express middleware `isSuperAdmin` exported from
 * `@/middleware/auth`, which has signature `(req, res, next)` and is used
 * directly in route definitions. Importing both into the same file would
 * otherwise require aliasing.
 */
export function isSuperAdminUser(req: Request): boolean {
  return req.user?.roleCode === RoleCode.SUPER_ADMIN;
}

/**
 * Roles whose remit is the whole foundation rather than one unit.
 *
 * The yayasan board oversees every unit and holds the `*_VIEW` permissions to
 * match (see YAYASAN_OVERSIGHT in modules/roles/permissions.ts), but its users
 * have no `unitId` — there is no single unit they belong to. Services that
 * scoped with `where.unitId = currentUser.unitId || 'none'` therefore returned
 * nothing at all for them: the Ketua Yayasan opened /units and was told
 * "Belum ada unit" while five units existed.
 *
 * The reason it looked correct in review is that `deriveLegacyRole()` maps
 * every YAYASAN_* code onto the legacy 'UNIT_ADMIN' string, so a check written
 * as `role !== SUPER_ADMIN` silently classified the board as unit admins. Any
 * scoping decision must be made on `roleCode`, never on the legacy `role`.
 */
export const FOUNDATION_SCOPE_ROLES: readonly string[] = [
  RoleCode.SUPER_ADMIN,
  RoleCode.YAYASAN_PEMBINA,
  RoleCode.YAYASAN_KETUA,
  RoleCode.YAYASAN_SEKRETARIS,
  RoleCode.YAYASAN_BENDAHARA,
  RoleCode.YAYASAN_ANGGOTA,
  RoleCode.YAYASAN_PENGAWAS,
];

/**
 * True when the role sees across all units rather than being pinned to one.
 *
 * This grants *breadth*, not power: what a foundation role may do with what it
 * can see is still decided by its permission list. Use it only to widen a
 * `where` clause, never to skip an authorize() check.
 */
export function isFoundationScopedRole(roleCode?: string | null): boolean {
  return !!roleCode && FOUNDATION_SCOPE_ROLES.includes(roleCode);
}

/**
 * The unit a unit-scoped list is narrowed to, for the oversight modules
 * (internal audit, risk, sharia compliance): `undefined` means every unit.
 *
 * A foundation role oversees every unit and belongs to none, so it sees them
 * all and may narrow to one with `?unitId=`. Everyone else sees their own
 * unit, whatever the query says, and a unit-bound role without one is refused.
 *
 * These modules used to decide it on the legacy `role`, where
 * deriveLegacyRole() files every YAYASAN_* code under UNIT_ADMIN: the
 * Pengawas — the organ whose job this is — was turned away with "Unit ID
 * required", while a unit's admin could read another unit by naming it in
 * the query.
 */
export function listUnitScope(req: Request): string | undefined {
  if (isFoundationScopedRole(req.user?.roleCode)) {
    const asked = req.query.unitId;
    return typeof asked === 'string' && asked && asked !== 'all' ? asked : undefined;
  }
  if (!req.user?.unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  return req.user.unitId;
}

/** Whether the request may see, or act on, a row of `unitId` — the per-row half of listUnitScope. */
export function mayReachUnit(req: Request, unitId: string | null | undefined): boolean {
  return actorReachesUnit(req.user, unitId);
}

/**
 * The actor a scope decision is made from — the verified token's identity, not
 * the request. Services take this shape (never `Request`) so the rule lives in
 * one place and stays unit-testable.
 */
export interface UnitActor {
  roleCode?: string | null;
  unitId?: string | null;
}

/**
 * Whether `actor` may see, or act on, a row of `unitId`. A foundation role
 * reaches every unit; everyone else is pinned to their own, and an actor
 * without a unit reaches none.
 */
export function actorReachesUnit(
  actor: UnitActor | undefined | null,
  unitId: string | null | undefined
): boolean {
  if (isFoundationScopedRole(actor?.roleCode)) return true;
  return !!actor?.unitId && unitId === actor.unitId;
}

/**
 * Refuses a row out of the request's reach — or missing — with 404, as if it
 * did not exist: an id guessed from another unit says nothing about that unit.
 */
export function assertReachesUnit(
  req: Request,
  unitId: string | null | undefined,
  resource: string
): void {
  if (!unitId || !mayReachUnit(req, unitId)) throw Errors.notFound(resource);
}

/**
 * The unit a new row is written to. A foundation role names it (a unit it
 * carries on its token is the default); everyone else writes to their own,
 * whatever the body says.
 */
export function writeUnitScope(req: Request, named: string | null | undefined): string {
  return writeUnitScopeFor(req.user, named);
}

/** Actor-based half of `writeUnitScope`, for services that do not hold a `Request`. */
export function writeUnitScopeFor(
  actor: UnitActor | undefined | null,
  named: string | null | undefined
): string {
  if (isFoundationScopedRole(actor?.roleCode)) {
    const unitId = named || actor?.unitId;
    if (!unitId) throw Errors.badRequest('Pilih unit');
    return unitId;
  }
  if (!actor?.unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  return actor.unitId;
}

/**
 * Leadership roles across Foundation, Schools/Units, Pesantren, and Higher Education.
 */
export const LEADERSHIP_ROLES: readonly string[] = [
  RoleCode.SUPER_ADMIN,
  RoleCode.YAYASAN_KETUA,
  RoleCode.YAYASAN_PEMBINA,
  RoleCode.YAYASAN_PENGAWAS,
  RoleCode.YAYASAN_SEKRETARIS,
  RoleCode.YAYASAN_BENDAHARA,
  RoleCode.YAYASAN_ANGGOTA,
  RoleCode.TKQ_ADMIN,
  RoleCode.SDIT_ADMIN,
  RoleCode.SMPIT_ADMIN,
  RoleCode.SMAQ_ADMIN,
  RoleCode.TKQ_KEPALA_SEKOLAH,
  RoleCode.SDIT_KEPALA_SEKOLAH,
  RoleCode.SMPIT_KEPALA_SEKOLAH,
  RoleCode.SMAQ_KEPALA_SEKOLAH,
  RoleCode.PESANTREN_PENGASUH,
];

/**
 * Helper to check if a user role belongs to unit or foundation leadership.
 */
export function isLeadershipRole(roleCode?: string | null): boolean {
  return !!roleCode && LEADERSHIP_ROLES.includes(roleCode as RoleCode);
}

/**
 * Roles that work across the academic units rather than inside one.
 *
 * The asrama houses santri from SD IT, SMP IT and SMA Qur'an together, and the
 * shared services — klinik, perpustakaan, keamanan, laboratorium — serve the
 * whole campus. None of these people belong to a school, but the data model
 * gives a user exactly one `unitId`, so the seed assigns them to SMP IT
 * because that is where most santri are.
 *
 * That made their unit-scoped queries return *most* of the right rows and
 * silently drop the rest: a muhafidz opening tahfidz records simply could not
 * see the SD IT santri they teach, with nothing to indicate rows were missing.
 * Granting breadth here is what actually matches the job.
 */
export const CROSS_UNIT_SCOPE_ROLES: readonly string[] = [
  RoleCode.PESANTREN_PENGASUH,
  RoleCode.PESANTREN_TATA_USAHA,
  RoleCode.USTADZ,
  RoleCode.MUSYRIF,
  RoleCode.MUHAFIDZ,
  RoleCode.KEAMANAN,
  RoleCode.PERAWAT,
  RoleCode.PUSTAKAWAN,
  RoleCode.LABORAN,
];

/**
 * True when the role's remit spans every unit — the foundation board, or the
 * boarding and shared-service staff.
 *
 * Like isFoundationScopedRole this only ever *widens* a `where` clause. What
 * the role may do with the rows it can now see is still its permission list.
 */
export function seesAllUnits(user: {
  roleCode?: string | null;
  /**
   * Legacy UserRole. Consulted **only** to recognise SUPER_ADMIN, for callers
   * that predate roleCode and still pass `role` alone. It is deliberately not
   * used for anything else: deriveLegacyRole() maps every YAYASAN_* code onto
   * 'UNIT_ADMIN', so trusting `role` generally is exactly what hid the
   * foundation board's scope in the first place.
   */
  role?: string | null;
}): boolean {
  if (user.role === RoleCode.SUPER_ADMIN) return true;
  return (
    isFoundationScopedRole(user.roleCode) ||
    (!!user.roleCode && CROSS_UNIT_SCOPE_ROLES.includes(user.roleCode))
  );
}

/**
 * The `unitId` a token carries for the ACTIVE role assignment — one rule for
 * every path that mints a token: login, 2FA, refresh and switching role.
 *
 * A role assignment binds a person, a role and a scope; the token's unit is
 * that scope. The paths used to disagree: switchRole returned null for every
 * `seesAllUnits` role while refresh fell back to the home unit, so a person
 * who switched to a yayasan role held foundation scope for one access token
 * and their home unit's after the next refresh, with nothing to show for it.
 *
 * Only a FOUNDATION role may carry no unit — its scope is the whole yayasan.
 * Cross-unit service roles (perawat, pustakawan, musyrif…) keep their home
 * unit: their breadth comes from `seesAllUnits` widening a query, never from
 * an empty scope that every `unitId ? filter : everything` clause reads as
 * "no limit at all".
 */
export function tokenUnitId(
  assignmentUnitId: string | null | undefined,
  roleCode: string | null | undefined,
  userUnitId: string | null | undefined
): string | null {
  if (assignmentUnitId) return assignmentUnitId;
  if (isFoundationScopedRole(roleCode)) return null;
  return userUnitId ?? null;
}
