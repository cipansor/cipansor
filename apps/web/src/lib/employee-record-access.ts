import {
  ADMIN_ROLE_CODES,
  FOUNDATION_SCOPE_ROLE_CODES,
  TATA_USAHA_ROLE_CODES,
} from "@cipansor/shared";
import { getActiveRoleCode, getEffectiveRole, type RbacUser } from "@/lib/rbac";

type Viewer = (RbacUser & { id?: string | null }) | null | undefined;

/**
 * Who reads an employee's HR record beyond the directory — personal data,
 * bank account, contracts, leave, documents, employment history: the employee
 * and whoever keeps HR records (a unit's admin and Tata Usaha, the foundation).
 * The mirror of the API's `keepsHrRecords` and `assertMayReadEmployeeRecord`
 * (decisions/akses-data-pegawai.md). The API decides; this keeps the page from
 * offering tabs it would answer 404 to.
 */
export function readsEmployeeRecord(
  viewer: Viewer,
  employeeUserId: string | null | undefined,
): boolean {
  if (!viewer) return false;
  if (employeeUserId && viewer.id === employeeUserId) return true;
  const code = getActiveRoleCode(viewer);
  return (
    !!code &&
    (FOUNDATION_SCOPE_ROLE_CODES.includes(code) ||
      ADMIN_ROLE_CODES.includes(code) ||
      TATA_USAHA_ROLE_CODES.includes(code))
  );
}

/**
 * Who edits or removes an employee: the buckets the API's
 * `PUT`/`DELETE /hr/employees/:id` accept (Super Admin and unit admin).
 */
export function managesEmployees(viewer: Viewer): boolean {
  const bucket = getEffectiveRole(viewer);
  return bucket === "SUPER_ADMIN" || bucket === "UNIT_ADMIN";
}
