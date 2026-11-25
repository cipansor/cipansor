import {
  CALENDAR_FOUNDATION_WRITE_ROLE_CODES,
  CALENDAR_WRITE_ROLE_CODES,
  UNIT_ADMIN_ROLE_CODES,
} from "@cipansor/shared";
import {
  sessionRoleCode,
  sessionUnitId,
  type SessionScopeUser,
} from "./session-scope";

export interface CalendarAccessUser extends SessionScopeUser {
  id?: string | null;
}

export interface CalendarEventAccess {
  createdById?: string | null;
  unitId?: string | null;
}

/**
 * Whether the signed-in user may edit or delete this agenda.
 *
 * Mirrors `CalendarService.delete`/`update`: SUPER_ADMIN may touch anything, a
 * creator may touch their own agenda, and a unit admin may touch any agenda in
 * their unit. Showing the action on every row because the user holds
 * ACADEMIC_MANAGE offered a kepala sekolah a Hapus that the API answers 403.
 */
export function canModifyCalendarEvent(
  user: CalendarAccessUser | null | undefined,
  event: CalendarEventAccess | null | undefined,
): boolean {
  if (!user || !event) return false;

  const roleCode = sessionRoleCode(user);
  if (!roleCode || !CALENDAR_WRITE_ROLE_CODES.includes(roleCode)) return false;
  if (roleCode === "SUPER_ADMIN") return true;
  if (event.createdById && event.createdById === user.id) return true;

  if (
    UNIT_ADMIN_ROLE_CODES.includes(roleCode) &&
    !!event.unitId &&
    event.unitId === sessionUnitId(user)
  ) {
    return true;
  }

  // Pengurus manage the foundation-wide agenda (no unit); a unit's class or
  // school agenda belongs to that unit's admin.
  return (
    CALENDAR_FOUNDATION_WRITE_ROLE_CODES.includes(roleCode) && !event.unitId
  );
}
