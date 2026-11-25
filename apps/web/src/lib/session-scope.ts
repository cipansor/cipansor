import { FOUNDATION_SCOPE_ROLE_CODES } from "@cipansor/shared";

/**
 * The unit a signed-in session is actually scoped to.
 *
 * `user.unitId` on `/auth/me` is the person's *profile* unit. The API scopes a
 * request by the active role assignment's unit instead (`tokenUnitId` in
 * `apps/api/src/utils/resolve-unit-id.ts`), so a person whose profile is SD IT
 * but whose active assignment is Admin SMP IT writes as SMP IT. Reading the
 * profile unit here made the calendar form list SD IT classes and send SD IT,
 * which the API refused.
 */
export interface SessionScopeUser {
  role?: string | null;
  unitId?: string | null;
  unit?: { id?: string | null } | null;
  userRoles?: Array<{
    isPrimary?: boolean;
    role?: { code?: string | null } | null;
    unit?: { id?: string | null } | null;
  }> | null;
}

function activeAssignment(user: SessionScopeUser | null | undefined) {
  const assignments = user?.userRoles ?? [];
  return assignments.find((a) => a?.isPrimary) ?? assignments[0] ?? undefined;
}

/** The RoleCode of the active assignment, or the legacy fallback. */
export function sessionRoleCode(
  user: SessionScopeUser | null | undefined,
): string | undefined {
  return activeAssignment(user)?.role?.code ?? user?.role ?? undefined;
}

export function sessionUnitId(
  user: SessionScopeUser | null | undefined,
): string | undefined {
  if (!user) return undefined;
  const assignment = activeAssignment(user);
  if (assignment?.unit?.id) return assignment.unit.id;
  if (FOUNDATION_SCOPE_ROLE_CODES.includes(sessionRoleCode(user) ?? "")) {
    return undefined;
  }
  return user.unitId ?? user.unit?.id ?? undefined;
}

/** True when the active role sees every unit (the foundation's organs). */
export function overseesAllUnits(
  user: SessionScopeUser | null | undefined,
): boolean {
  if (!user) return false;
  if (FOUNDATION_SCOPE_ROLE_CODES.includes(sessionRoleCode(user) ?? "")) {
    return true;
  }
  return !sessionUnitId(user);
}
