import { ADMIN_ROLE_CODES } from "@cipansor/shared";
import { getActiveRoleCode, type RbacUser } from "@/lib/rbac";

/**
 * Who runs staff attendance — the daily list and its settings: Super Admin and
 * a unit's admin, as the API's `assertHrAdmin` allows. The yayasan's organs
 * share the admin pages' bucket, so they can open the URL; they run no unit's
 * attendance, and every request those pages make would be refused.
 */
export function canManageStaffAttendance(
  user: RbacUser | null | undefined,
): boolean {
  const code = getActiveRoleCode(user);
  return !!code && ADMIN_ROLE_CODES.includes(code);
}
