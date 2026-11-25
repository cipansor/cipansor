import type { Request } from 'express';
import type { PayrollStatus } from '@prisma/client';
import {
  decidePayroll,
  payrollReadScope,
  payrollWriteUnit,
  type PayrollAction,
  type PayrollActor,
  type PayrollDecision,
  type PayrollPeriodFacts,
} from '@cipansor/shared';
import { requireUser } from '../../middleware/auth';
import { Errors } from '../../middleware/error';

/**
 * The payroll rules, wired to the request and to the database errors.
 *
 * `decidePayroll` (@cipansor/shared) is the only place the 403/404/409 rules
 * are written; this file turns a `Request` into a `PayrollActor`, builds the
 * `PayrollPeriodFacts` a decision needs, and converts a refusal into the
 * `ApiError` the response helper renders.
 */

/** The verified token's identity — never the request body or query. */
export function payrollActor(req: Request): PayrollActor {
  const user = requireUser(req);
  return { sub: user.id, roleCode: user.roleCode, unitId: user.unitId ?? null };
}

/** Refuse, or return normally. The message reaches the caller as-is. */
export function assertPayroll(
  actor: PayrollActor,
  action: PayrollAction,
  period?: PayrollPeriodFacts
): void {
  const decision: PayrollDecision = decidePayroll(actor, action, period);
  if (decision.ok) return;
  switch (decision.status) {
    case 403:
      throw Errors.forbidden(decision.reason);
    case 404:
      throw Errors.notFound(decision.reason);
    default:
      throw Errors.conflict(decision.reason);
  }
}

/**
 * The unit a payroll list is narrowed to: `undefined` means every unit.
 *
 * A unit treasurer is pinned to the token's unit and a request's `unitId` is
 * ignored (R1.16); Super_Admin and the yayasan organs read every unit and may
 * narrow to one (R1.18). A treasurer whose token carries no unit reaches
 * nothing — never everything.
 */
export function listUnitFor(actor: PayrollActor, named?: string): string | undefined {
  const scope = payrollReadScope(actor);
  if (scope.all) return named && named !== 'all' ? named : undefined;
  if (!scope.unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  return scope.unitId;
}

/** The unit a payroll write lands on: the token's unit, never the body's. */
export function writeUnitFor(actor: PayrollActor): string {
  const unitId = payrollWriteUnit(actor);
  if (!unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  return unitId;
}

/**
 * Whether the actor may reach a row of `unitId` — the per-row half of
 * `listUnitFor`. A row outside it answers 404, exactly as a missing id does,
 * so its existence is never confirmed.
 */
export function assertRowInScope(actor: PayrollActor, unitId: string, resource: string): void {
  const scope = payrollReadScope(actor);
  if (scope.all) return;
  if (!scope.unitId || scope.unitId !== unitId) throw Errors.notFound(resource);
}

/** The facts `decidePayroll` needs about a period the service just loaded. */
export function periodFacts(period: {
  unitId: string;
  status: PayrollStatus;
  createdById: string;
  approvedById?: string | null;
  _count?: { payrolls: number };
  payrolls?: unknown[];
}): PayrollPeriodFacts {
  return {
    unitId: period.unitId,
    status: period.status,
    createdById: period.createdById,
    approvedById: period.approvedById ?? null,
    slipCount: period._count?.payrolls ?? period.payrolls?.length ?? 0,
  };
}
