import {
  payrollButtons,
  type PayrollAction,
  type PayrollStatus,
} from "@cipansor/shared";
import { getActiveRoleCode } from "./rbac";

/** The slice of the persisted user the payroll policy needs. */
export interface PayrollActionsUser {
  id: string;
  unitId?: string | null;
  role?: string | null;
  userRoles?: Array<{
    isPrimary?: boolean;
    role?: { code?: string | null } | null;
    unit?: { id: string } | null;
  }> | null;
}

/** The slice of a period the list returns (including `_count.payrolls`). */
export interface PayrollActionsPeriod {
  unitId: string;
  status: PayrollStatus | "CALCULATED";
  createdById?: string | null;
  approvedById?: string | null;
  slipCount?: number;
  _count?: { payrolls?: number };
  totalEmployees?: number;
}

/**
 * The buttons a period may show for this user. Derived from the same
 * `decidePayroll` the API enforces, so the portal never offers an action the
 * server will refuse.
 */
export function periodActionsFor(
  user: PayrollActionsUser,
  period: PayrollActionsPeriod,
): PayrollAction[] {
  const activeAssignment =
    user.userRoles?.find((assignment) => assignment.isPrimary) ??
    user.userRoles?.[0];

  return payrollButtons(
    {
      sub: user.id,
      roleCode: getActiveRoleCode(user) ?? "",
      unitId: activeAssignment?.unit?.id ?? user.unitId ?? null,
    },
    {
      unitId: period.unitId,
      status: period.status === "CALCULATED" ? "DRAFT" : period.status,
      createdById: period.createdById ?? "",
      approvedById: period.approvedById ?? null,
      slipCount:
        period.slipCount ??
        period._count?.payrolls ??
        period.totalEmployees ??
        0,
    },
  );
}
