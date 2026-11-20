import {
  BENDAHARA_ROLE_CODES,
  PAYROLL_APPROVER_ROLE_CODES,
  PAYROLL_COMPONENT_MANAGER_ROLE_CODES,
} from "./roles";

/**
 * Penggajian — who may do what to a payroll period, written once (#990).
 *
 * The API asks this function before every write and the portal reads
 * `payrollButtons` to decide which buttons to draw, so a button appears
 * exactly when its request would be accepted. The rules are the owner's
 * decision of 2026-11-10:
 *
 * - Bendahara_Unit drafts and pays its own unit's payroll;
 * - Bendahara_Yayasan (`YAYASAN_BENDAHARA`) manages the yayasan-level salary
 *   components — the yayasan is the employer (PP 36/2021) — and approves every
 *   unit's period, with the Ketua Pengurus (`YAYASAN_KETUA`) as stand-in;
 * - the account that created a period never approves it;
 * - Super_Admin only reads, so IT administration stays apart from financial
 *   approval;
 * - Admin_Unit, Kepala_Unit, TU_Unit and Guru do not see payroll at all.
 *
 * The order is deliberate and is what makes the answers stable: role (403),
 * then unit scope (404), then creator (403), then status (409).
 */

/** The Prisma enum `PayrollStatus`, repeated because the web cannot import it. */
export const PAYROLL_STATUS_VALUES = [
  "DRAFT",
  "APPROVED",
  "PAID",
  "CANCELLED",
] as const;
export type PayrollStatus = (typeof PAYROLL_STATUS_VALUES)[number];

export type PayrollAction =
  | "COMPONENT_WRITE"
  | "SALARY_WRITE"
  | "PERIOD_CREATE"
  | "PERIOD_UPDATE"
  | "GENERATE"
  | "ADJUST"
  | "APPROVE"
  | "PAY"
  | "CANCEL"
  | "DELETE";

export const PAYROLL_ACTIONS: readonly PayrollAction[] = [
  "COMPONENT_WRITE",
  "SALARY_WRITE",
  "PERIOD_CREATE",
  "PERIOD_UPDATE",
  "GENERATE",
  "ADJUST",
  "APPROVE",
  "PAY",
  "CANCEL",
  "DELETE",
];

/** The verified token's identity — never the request body. */
export interface PayrollActor {
  sub: string;
  roleCode: string;
  unitId: string | null;
}

/** What the rules need to know about an existing period. */
export interface PayrollPeriodFacts {
  unitId: string;
  status: PayrollStatus;
  createdById: string;
  slipCount: number;
}

export type PayrollRefusalStatus = 403 | 404 | 409;

export type PayrollDecision =
  { ok: true } | { ok: false; status: PayrollRefusalStatus; reason: string };

const ALLOW: PayrollDecision = { ok: true };
const refuse = (
  status: PayrollRefusalStatus,
  reason: string,
): PayrollDecision => ({
  ok: false,
  status,
  reason,
});

/** Actions that act on one existing period, so they need `PayrollPeriodFacts`. */
const PERIOD_ACTIONS: readonly PayrollAction[] = [
  "PERIOD_UPDATE",
  "GENERATE",
  "ADJUST",
  "APPROVE",
  "PAY",
  "CANCEL",
  "DELETE",
];

const isBendaharaUnit = (roleCode: string): boolean =>
  BENDAHARA_ROLE_CODES.includes(roleCode);
const isApprover = (roleCode: string): boolean =>
  PAYROLL_APPROVER_ROLE_CODES.includes(roleCode);

/**
 * Whether the role may attempt the action at all — the 403 step, before any
 * record is looked at (R1.23, R1.26, R1.28, R1.32, R1.33).
 */
function roleAllows(actor: PayrollActor, action: PayrollAction): boolean {
  switch (action) {
    case "COMPONENT_WRITE":
      return PAYROLL_COMPONENT_MANAGER_ROLE_CODES.includes(actor.roleCode);
    case "APPROVE":
      return isApprover(actor.roleCode);
    case "CANCEL":
      return isBendaharaUnit(actor.roleCode) || isApprover(actor.roleCode);
    default:
      return isBendaharaUnit(actor.roleCode);
  }
}

const ROLE_REFUSALS: Record<PayrollAction, string> = {
  COMPONENT_WRITE: "Hanya Bendahara Yayasan yang boleh mengubah komponen gaji",
  SALARY_WRITE: "Hanya bendahara unit yang boleh menyusun gaji pegawai",
  PERIOD_CREATE: "Hanya bendahara unit yang boleh membuat periode penggajian",
  PERIOD_UPDATE: "Hanya bendahara unit yang boleh mengubah periode penggajian",
  GENERATE: "Hanya bendahara unit yang boleh membuat slip gaji",
  ADJUST: "Hanya bendahara unit yang boleh menyesuaikan slip gaji",
  APPROVE: "Hanya penyetuju gaji yang boleh menyetujui periode penggajian",
  PAY: "Hanya bendahara unit yang boleh menandai periode penggajian dibayar",
  CANCEL: "Peran aktif ini tidak boleh membatalkan periode penggajian",
  DELETE: "Hanya bendahara unit yang boleh menghapus periode penggajian",
};

/**
 * Decide one action. `period` is required for the actions that act on an
 * existing period; for the rest it is ignored.
 */
export function decidePayroll(
  actor: PayrollActor,
  action: PayrollAction,
  period?: PayrollPeriodFacts,
): PayrollDecision {
  // 1. Role.
  if (!roleAllows(actor, action)) return refuse(403, ROLE_REFUSALS[action]);

  const needsPeriod = PERIOD_ACTIONS.includes(action);
  if (!needsPeriod) return ALLOW;
  if (!period) {
    throw new Error(`decidePayroll: ${action} needs PayrollPeriodFacts`);
  }

  // 2. Scope: a unit treasurer reaches its own unit only; anything else looks
  //    like an id that does not exist (R1.20).
  if (
    isBendaharaUnit(actor.roleCode) &&
    (!actor.unitId || period.unitId !== actor.unitId)
  ) {
    return refuse(404, "Periode penggajian");
  }

  // 3. Creator: the account that drafted a period never approves it (R1.25).
  if (action === "APPROVE" && actor.sub === period.createdById) {
    return refuse(403, "Pembuat periode tidak boleh menyetujui periode itu");
  }

  // 4. Status.
  switch (action) {
    case "APPROVE":
      if (period.status !== "DRAFT") {
        return refuse(
          409,
          `Periode berstatus ${period.status} tidak dapat disetujui`,
        );
      }
      if (period.slipCount === 0) {
        return refuse(409, "Periode penggajian belum memiliki slip");
      }
      return ALLOW;

    case "PAY":
      return period.status === "APPROVED"
        ? ALLOW
        : refuse(
            409,
            `Periode berstatus ${period.status} tidak dapat ditandai dibayar`,
          );

    case "PERIOD_UPDATE":
    case "GENERATE":
    case "ADJUST":
      return period.status === "DRAFT"
        ? ALLOW
        : refuse(
            409,
            `Periode berstatus ${period.status} tidak dapat ${action === "PERIOD_UPDATE" ? "diubah" : action === "GENERATE" ? "digenerate" : "disesuaikan"}`,
          );

    case "CANCEL":
      if (period.status === "PAID" || period.status === "CANCELLED") {
        return refuse(
          409,
          `Periode berstatus ${period.status} tidak dapat dibatalkan`,
        );
      }
      if (isBendaharaUnit(actor.roleCode) && period.status === "APPROVED") {
        return refuse(
          403,
          "Bendahara unit hanya dapat membatalkan periode berstatus DRAFT",
        );
      }
      if (isApprover(actor.roleCode) && period.status === "DRAFT") {
        return refuse(
          403,
          "Penyetuju gaji hanya dapat membatalkan periode berstatus APPROVED",
        );
      }
      return ALLOW;

    case "DELETE":
      return period.status === "DRAFT"
        ? ALLOW
        : refuse(409, `Periode berstatus ${period.status} tidak dapat dihapus`);

    default:
      return ALLOW;
  }
}

/**
 * The actions a caller may take right now — what the portal draws as buttons.
 * Actions that need a period are only listed when the period's facts are given.
 */
export function payrollButtons(
  actor: PayrollActor,
  period?: PayrollPeriodFacts,
): PayrollAction[] {
  return PAYROLL_ACTIONS.filter((action) => {
    if (PERIOD_ACTIONS.includes(action) && !period) return false;
    return decidePayroll(actor, action, period).ok;
  });
}

/**
 * The unit a payroll read is scoped to.
 *
 * A unit treasurer is pinned to the unit on the token whatever the request
 * names (R1.16); Super_Admin and the yayasan organs read every unit and may
 * narrow to one with `?unitId=` (R1.18).
 *
 * `{ all: true }` means every unit. A treasurer whose token carries no unit
 * gets `{ unitId: null }` — the caller answers 403, never "every unit", so a
 * missing scope can never widen a read.
 */
export type PayrollScope =
  { all: true } | { all: false; unitId: string | null };

export function payrollReadScope(actor: PayrollActor): PayrollScope {
  if (!isBendaharaUnit(actor.roleCode)) return { all: true };
  return { all: false, unitId: actor.unitId ?? null };
}

/** The unit a new payroll row is written to (R1.19, R1.24): the token's unit. */
export function payrollWriteUnit(actor: PayrollActor): string | null {
  return isBendaharaUnit(actor.roleCode) ? (actor.unitId ?? null) : null;
}

/** True when the role sees payroll across every unit (R1.18). */
export function seesEveryPayrollUnit(actor: PayrollActor): boolean {
  return !isBendaharaUnit(actor.roleCode);
}
