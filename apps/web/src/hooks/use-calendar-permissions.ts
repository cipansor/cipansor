import { CALENDAR_WRITE_ROLE_CODES } from "@cipansor/shared";
import { getActiveRoleCode } from "@/lib/rbac";
import { useAuthStore } from "@/stores/auth";

/** The active role may write calendar events; the API is still the boundary. */
export function useCanWriteCalendar(): boolean {
  const user = useAuthStore((state) => state.user);
  const roleCode = getActiveRoleCode(user);
  return !!roleCode && CALENDAR_WRITE_ROLE_CODES.includes(roleCode);
}
