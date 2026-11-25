import { UNIT_ADMIN_ROLE_CODES } from "@cipansor/shared";
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

  if (sessionRoleCode(user) === "SUPER_ADMIN") return true;
  if (event.createdById && event.createdById === user.id) return true;

  return (
    UNIT_ADMIN_ROLE_CODES.includes(sessionRoleCode(user) ?? "") &&
    !!event.unitId &&
    event.unitId === sessionUnitId(user)
  );
}
