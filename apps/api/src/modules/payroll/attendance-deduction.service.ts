import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { Errors } from '../../middleware/error';
import { calculateMonthlyPph21, isBasicSalaryComponent, reconcileSalary } from './payroll-tax';
import { dayOf, dayString, wibWeekday } from '../../utils/wib';
import {
  holidaysInRange,
  isHolidayDay,
  workWeekFor as sharedWorkWeekFor,
} from '../../utils/work-calendar';

/**
 * Attendance → pay deduction engine.
 *
 * Every number lives in `PayrollPolicyRule`; this file only evaluates it. Two
 * invariants are enforced here rather than trusted to the rule's author:
 *
 *  1. Deductions come from the *allowance* side of the payslip. A rule whose
 *     basis resolves to `GAJI_POKOK` is refused, and — because a rule can
 *     still produce a total larger than the allowances (a multiplier, a
 *     formula, a stacked set of rules) — the engine caps the whole deduction
 *     set at the allowance side, so the basic salary is never reduced.
 *  2. The result never crosses the guard config: total deductions stay under
 *     `maxDeductionPercent` of gross and the basic share stays at or above
 *     `minBasicSharePercent`; a breach is reported, not silently applied. The
 *     percentage can never exceed 50 — PP 36/2021 Ps. 65 caps every deduction
 *     from one wage payment together at 50% — and a unit with no guard row
 *     gets that legal bound, not none.
 */

export interface DeductionLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  basisLabel: string;
  amount: number;
  detail: string;
}

export interface AttendanceDeductionResult {
  lines: DeductionLine[];
  totalEarningAdditions: number;
  totalDeductions: number;
  guardWarnings: string[];
}

/**
 * One staff member's computed deductions, plus the two reasons a payslip
 * period must not be generated yet: work days with no attendance row at all,
 * and a deduction that would cross the guard.
 */
export interface StaffDeductionRow {
  staffId: string;
  staffName: string;
  counts: AttendanceCounts;
  lines: DeductionLine[];
  totalDeductions: number;
  totalEarningAdditions: number;
  gross: number;
  /** Informational notes: the cap bit, the salary structure is odd, … */
  guardWarnings: string[];
  /** Reasons generation must stop until the admin decides (or overrides). */
  guardBreaches: string[];
  /** The allowance side of the payslip — the ceiling for attendance deductions. */
  allowanceCap: number;
  /** Amount removed because the raw total exceeded the allowance cap. */
  cappedByAllowance: number;
  /** Work days in the period with no attendance row for this person. */
  unresolvedDates: string[];
}

/** The limits a payslip's deduction set may never cross, from config. */
export interface GuardLimits {
  maxDeductionPercent: number;
  minBasicSharePercent: number;
  mustStayAboveUmk: boolean;
  umkNominal: number | null;
}

/** Whether a rule names the written document it rests on. */
export function hasLegalBasis(rule: { legalBasisDoc: string | null }): boolean {
  return Boolean(rule.legalBasisDoc && rule.legalBasisDoc.trim().length > 0);
}

/** PP 36/2021 Ps. 65: all deductions from one wage payment, at most 50% of it. */
export const LEGAL_MAX_DEDUCTION_PERCENT = 50;

/**
 * The guard a unit has before an admin writes one: the legal ceiling and
 * nothing else. The basic-share and UMK checks are the yayasan's own figures
 * (a UMK nominal, a share of its salary structure) and stay off until set —
 * guessing them would block payslips over numbers nobody chose.
 */
export const DEFAULT_GUARD: GuardLimits = {
  maxDeductionPercent: LEGAL_MAX_DEDUCTION_PERCENT,
  minBasicSharePercent: 0,
  mustStayAboveUmk: false,
  umkNominal: null,
};

/**
 * The guard for a unit: its own row, else the yayasan-wide row, else
 * `DEFAULT_GUARD`. The order is explicit — reading "the unit's or the
 * yayasan's" with one unordered query returned whichever the database found
 * first.
 */
export function pickGuard<
  T extends {
    unitId: string | null;
    maxDeductionPercent: number;
    minBasicSharePercent: number;
    mustStayAboveUmk: boolean;
    umkNominal: Prisma.Decimal | number | null;
  },
>(rows: T[], unitId: string | null): GuardLimits {
  const row =
    (unitId ? rows.find((r) => r.unitId === unitId) : undefined) ??
    rows.find((r) => r.unitId === null);
  if (!row) return DEFAULT_GUARD;
  return {
    maxDeductionPercent: row.maxDeductionPercent,
    minBasicSharePercent: row.minBasicSharePercent,
    mustStayAboveUmk: row.mustStayAboveUmk,
    umkNominal: row.umkNominal === null ? null : Number(row.umkNominal),
  };
}

/**
 * The rules that apply to a unit: its own, plus the yayasan-wide ones it has
 * not replaced. A unit rule with the same `code` as a yayasan rule takes its
 * place — before, both applied, and a late arrival was fined twice.
 */
export function effectiveRules<T extends { unitId: string | null; code: string }>(rules: T[]): T[] {
  const unitCodes = new Set(rules.filter((r) => r.unitId !== null).map((r) => r.code));
  return rules.filter((r) => r.unitId !== null || !unitCodes.has(r.code));
}

/**
 * Which rules are allowed to charge. A deduction needs its written basis
 * (PP 36/2021 Ps. 63(2)); earnings and any rule that names a legal document
 * pass. Filtering *before* `effectiveRules` matters: a unit rule with no basis
 * must not suppress the yayasan rule of the same code and then be dropped
 * itself, which left the unit with no deduction at all.
 */
export function basedRules<T extends { kind: string; legalBasisDoc: string | null }>(
  rules: T[]
): T[] {
  return rules.filter((r) => r.kind !== 'DEDUCTION' || hasLegalBasis(r));
}

/**
 * The rupiah ceiling the guard config alone imposes on a payslip's deductions.
 * `Infinity` when no guard is given — the allowance side still caps below.
 * The percentage is held to the legal 50% even if a row says more.
 */
export function guardCapFor(gross: number, guard: GuardLimits | null): number {
  if (!guard) return Infinity;
  const percent = Math.min(guard.maxDeductionPercent, LEGAL_MAX_DEDUCTION_PERCENT);
  let cap = (gross * percent) / 100;
  const keepBasic = (gross * guard.minBasicSharePercent) / 100;
  cap = Math.min(cap, gross - keepBasic);
  if (guard.mustStayAboveUmk && guard.umkNominal !== null) {
    cap = Math.min(cap, gross - guard.umkNominal);
  }
  return Math.max(0, cap);
}

/**
 * The cap every payslip's attendance deductions must respect, in rupiah: the
 * allowance side (`gross − GAJI_POKOK`) further limited by the guard. When no
 * guard is configured the allowance side alone is the cap — the invariant does
 * not depend on an admin having created the row.
 */
export function deductionCapFor(
  gross: number,
  allowanceCap: number,
  guard: GuardLimits | null
): number {
  return Math.max(0, Math.min(allowanceCap, guardCapFor(gross, guard)));
}

/**
 * The allowance side still available to attendance deductions, after the
 * slip's own deductions (BPJS, loans, …) and its PPh 21 have taken their share.
 * Capping attendance against the *gross* allowance total let the combined
 * deductions drop net pay below the basic salary — the attendance engine has
 * to spend what the rest of the slip leaves, not what it started with.
 */
export function allowanceCapFor(
  allowanceTotal: number,
  existingDeductions: number,
  pph21: number
): number {
  return Math.max(0, allowanceTotal - existingDeductions - pph21);
}

/**
 * Shrink a set of deduction lines so their total does not exceed `cap`, in
 * priority order (the first line keeps its amount; the last is trimmed). Lines
 * that reach zero are dropped, and the amount removed is returned so the caller
 * can report it. This is what keeps a multiplier or a stacked rule from
 * reaching into the basic salary.
 */
export function applyDeductionCap(
  lines: DeductionLine[],
  cap: number
): { lines: DeductionLine[]; total: number; capped: number } {
  const deductions = lines.filter((l) => l.kind === 'DEDUCTION');
  const raw = deductions.reduce((s, l) => s + l.amount, 0);
  if (raw <= cap) return { lines, total: raw, capped: 0 };

  let remaining = cap;
  const kept: DeductionLine[] = [];
  for (const line of lines) {
    if (line.kind !== 'DEDUCTION') {
      kept.push(line);
      continue;
    }
    if (remaining <= 0) continue;
    if (line.amount <= remaining) {
      remaining -= line.amount;
      kept.push(line);
    } else {
      kept.push({ ...line, amount: remaining, detail: `${line.detail} (dibatasi tunjangan)` });
      remaining = 0;
    }
  }
  return { lines: kept, total: cap, capped: raw - cap };
}

const ROUNDING: Record<string, (n: number) => number> = {
  NONE: (n) => n,
  ROUND: (n) => Math.round(n),
  FLOOR: (n) => Math.floor(n),
  CEIL: (n) => Math.ceil(n),
};

/**
 * A tiny arithmetic evaluator for FORMULA rules. Supports + - * / ( ), the
 * variables supplied, and decimal numbers. No `eval`, no property access.
 */
export function evaluateFormula(expr: string, vars: Record<string, number>): number {
  const tokens = expr.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(\.\d+)?|[()+\-*/]/g);
  if (!tokens) throw Errors.badRequest('Formula tidak valid');

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseFactor(): number {
    const token = next();
    if (token === undefined) throw Errors.badRequest('Formula tidak lengkap');
    if (token === '(') {
      const value = parseExpr();
      if (next() !== ')') throw Errors.badRequest('Tanda kurung tidak seimbang');
      return value;
    }
    if (token === '-') return -parseFactor();
    if (/^\d/.test(token)) return Number(token);
    if (token in vars) return vars[token];
    throw Errors.badRequest(`Variabel tidak dikenal: ${token}`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw Errors.badRequest('Formula tidak valid');
  return result;
}

interface RuleLike {
  code: string;
  kind: string;
  trigger: string;
  basis: string;
  mode: string;
  rate: Prisma.Decimal | null;
  unit: string;
  tiersJson: Prisma.JsonValue | null;
  formulaExpr: string | null;
  capPerDay: Prisma.Decimal | null;
  capPerMonth: Prisma.Decimal | null;
  rounding: string;
  legalBasisDoc: string | null;
  isActive: boolean;
}

interface StaffPayContext {
  /** Base salary (GAJI_POKOK) — never a deduction basis. */
  baseSalary: number;
  /** Allowance lines by component code, with their classification. */
  allowances: { code: string; name: string; amount: number; classification: string }[];
  /** The full monthly wage (base + allowances), for the 1/173 hourly rate. */
  monthlyWage: number;
  workDays: number;
  hoursPerDay: number;
}

interface AttendanceCounts {
  lateMinutes: number;
  lateDays: number;
  absentDays: number;
  presentDays: number;
  earlyLeaveDays: number;
  overtimeMinutes: number;
}

/** Resolve a rule's basis to a rupiah amount, from allowances only. */
function resolveBasis(basis: string, ctx: StaffPayContext): { amount: number; label: string } {
  if (basis === 'GAPOK' || basis === 'POKOK') {
    throw Errors.badRequest(
      `Aturan memakai gaji pokok sebagai dasar (${basis}); potongan kehadiran hanya boleh dari tunjangan`
    );
  }
  if (basis === 'TETAP' || basis === 'TUNJANGAN') {
    const amount = ctx.allowances.reduce((s, a) => s + a.amount, 0);
    return { amount, label: 'Total tunjangan' };
  }
  if (basis === 'UPAH_SEJAM') {
    // PP 35/2021 art. 32: an hour of overtime is 1/173 of a *month's* wage —
    // base salary plus fixed allowances — not 1/173 of the allowances alone,
    // which underpaid every overtime hour.
    return { amount: ctx.monthlyWage / 173, label: 'Upah sejam (1/173 upah sebulan)' };
  }
  if (basis === 'UPAH_SEHARI') {
    const total = ctx.allowances.reduce((s, a) => s + a.amount, 0);
    return { amount: total / Math.max(1, ctx.workDays), label: 'Upah sehari' };
  }
  const component = ctx.allowances.find((a) => a.code === basis);
  if (!component) {
    throw Errors.badRequest(`Komponen dasar tidak ditemukan atau bukan tunjangan: ${basis}`);
  }
  return { amount: component.amount, label: component.name };
}

/** The count a rule multiplies by, per its trigger. */
function triggerCount(trigger: string, counts: AttendanceCounts): number {
  switch (trigger) {
    case 'LATE':
      return counts.lateDays;
    case 'ABSENT':
      return counts.absentDays;
    case 'EARLY_LEAVE':
      return counts.earlyLeaveDays;
    case 'PRESENT':
      return counts.presentDays;
    case 'OVERTIME':
      return counts.overtimeMinutes;
    default:
      return 0;
  }
}

function triggerMinutes(trigger: string, counts: AttendanceCounts): number {
  if (trigger === 'LATE') return counts.lateMinutes;
  if (trigger === 'OVERTIME') return counts.overtimeMinutes;
  return 0;
}

function tieredAmount(tiers: Prisma.JsonValue | null, count: number): number | null {
  if (!Array.isArray(tiers)) return null;
  for (const raw of tiers) {
    if (typeof raw !== 'object' || raw === null) continue;
    const tier = raw as Record<string, unknown>;
    const from = Number(tier.from ?? 0);
    const to = tier.to === null || tier.to === undefined ? Infinity : Number(tier.to);
    if (count >= from && count <= to) {
      if (tier.amount !== undefined) return Number(tier.amount);
      if (tier.rate !== undefined) return count * Number(tier.rate);
    }
  }
  return null;
}

/**
 * Evaluate one rule against a staff member's pay context and attendance.
 * Returns null when the rule produces nothing (no occurrences, or the rule
 * would not apply), so the caller can skip the line entirely.
 */
export function evaluateRule(
  rule: RuleLike,
  ctx: StaffPayContext,
  counts: AttendanceCounts
): DeductionLine | null {
  const count = triggerCount(rule.trigger, counts);
  const minutes = triggerMinutes(rule.trigger, counts);
  const rate = rule.rate ? Number(rule.rate) : 0;

  // Nothing happened for this trigger: no line, no zero row on the payslip.
  if (count === 0 && minutes === 0) return null;

  const basis = resolveBasis(rule.basis, ctx);
  const unitMultiplier =
    rule.unit === 'PER_MENIT' ? minutes : rule.unit === 'PER_HARI' ? count : count || 1;

  let amount = 0;
  let detail = '';
  switch (rule.mode) {
    case 'NOMINAL':
    case 'MANUAL':
      amount = rate * unitMultiplier;
      detail = `${rate} × ${unitMultiplier}`;
      break;
    case 'PERSENTASE':
      amount = basis.amount * rate * unitMultiplier;
      detail = `${(rate * 100).toFixed(2)}% × ${basis.label} × ${unitMultiplier}`;
      break;
    case 'PRORATA':
      amount = basis.amount * (count / Math.max(1, ctx.workDays));
      detail = `${basis.label} × ${count}/${ctx.workDays} hari`;
      break;
    case 'PENGALI':
      amount = basis.amount * rate * count;
      detail = `${rate} × ${basis.label} × ${count}`;
      break;
    case 'BERTINGKAT': {
      const tiered = tieredAmount(rule.tiersJson, count);
      if (tiered === null) return null;
      amount = tiered;
      detail = `bertingkat pada ${count}`;
      break;
    }
    case 'FORMULA': {
      if (!rule.formulaExpr) return null;
      amount = evaluateFormula(rule.formulaExpr, {
        count,
        minutes,
        basis: basis.amount,
        rate,
        workDays: ctx.workDays,
      });
      detail = rule.formulaExpr;
      break;
    }
    default:
      return null;
  }

  if (rule.capPerDay !== null && rule.capPerDay !== undefined) {
    amount = Math.min(amount, Number(rule.capPerDay) * Math.max(1, count));
  }
  if (rule.capPerMonth !== null && rule.capPerMonth !== undefined) {
    amount = Math.min(amount, Number(rule.capPerMonth));
  }

  amount = (ROUNDING[rule.rounding] ?? ROUNDING.NONE)(amount);
  if (amount <= 0) return null;

  return {
    code: rule.code,
    name: rule.code,
    kind: rule.kind === 'EARNING' ? 'EARNING' : 'DEDUCTION',
    basisLabel: basis.label,
    amount,
    detail,
  };
}

/**
 * The work week a payslip is computed against, from the unit's
 * `WorkWeekConfig` (falling back to the yayasan default). Nothing here is a
 * literal: a 5-day week with 8-hour days changes the prorata and the hourly
 * rate without touching this file.
 */
async function workWeekFor(unitId: string | null) {
  return sharedWorkWeekFor(unitId);
}

/**
 * Every calendar day in the period that the work week calls a working day and
 * that is not a whole-unit holiday, as `YYYY-MM-DD` in WIB.
 */
async function workDatesInPeriod(
  start: Date,
  end: Date,
  unitId: string | null,
  workDays: number[]
): Promise<string[]> {
  const holidays = await holidaysInRange(start, end, unitId);
  const dates: string[] = [];
  const first = dayOf(dayString(start));
  const last = dayOf(dayString(end));
  for (let d = first; d <= last; d = new Date(d.getTime() + 86_400_000)) {
    const day = dayString(d);
    if (!workDays.includes(wibWeekday(day))) continue;
    if (isHolidayDay(day, holidays)) continue;
    dates.push(day);
  }
  return dates;
}

export const attendanceDeductionService = {
  /**
   * Active rules for a unit, yayasan-wide rules included, as of a date. A rule
   * whose `effectiveFrom`/`effectiveTo` window does not cover the period is
   * not applied — the columns are a schedule, not decoration.
   *
   * The raw list is returned as-is: the caller decides which rules may charge
   * (see `basedRules`). Overriding happens after that filter, so a unit rule
   * that is not allowed to charge cannot shadow a yayasan rule of the same
   * code and leave the unit with nothing.
   */
  async rulesFor(unitId: string | null, asOf?: Date) {
    const day = asOf ? dayOf(dayString(asOf)) : undefined;
    return prisma.payrollPolicyRule.findMany({
      where: {
        isActive: true,
        OR: [{ unitId }, { unitId: null }],
        ...(day
          ? {
              AND: [
                { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: day } }] },
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] },
              ],
            }
          : {}),
      },
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    });
  },

  /**
   * Deductions for every staff member in a period. Reads the same attendance
   * rows the payslip shows, so the number a person sees on the slip is the
   * number the engine used.
   */
  async computeForPeriod(periodId: string) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      include: { unit: true },
    });
    if (!period) throw Errors.notFound('Periode penggajian');

    const allRules = await this.rulesFor(period.unitId, period.startDate);
    // A deduction needs its written basis — the perjanjian kerja, peraturan
    // kepegawaian or PKB that sets it (PP 36/2021 Ps. 63(2)). The settings
    // refuse to activate one without it; a row from before that rule is
    // skipped here and named, rather than charged. This runs *before*
    // `effectiveRules`: a unit deduction with no basis must not replace the
    // yayasan rule of the same code and then be dropped, which left the unit
    // with no deduction at all.
    const unbasedRules = allRules.filter((r) => r.kind === 'DEDUCTION' && !hasLegalBasis(r));
    const rules = effectiveRules(basedRules(allRules));
    const guardRows = await prisma.payrollGuardConfig.findMany({
      where: { isActive: true, OR: [{ unitId: period.unitId }, { unitId: null }] },
    });
    // The slip only taxes the base salary when an active basic component is
    // marked taxable; read the same flag here or the engine estimates a PPh 21
    // the slip never charges and shrinks the allowance it may spend.
    const basicComponents = await prisma.salaryComponent.findMany({
      where: { isActive: true, type: 'EARNING' },
      select: { code: true, classification: true, isTaxable: true },
    });
    const basicComponent = basicComponents.find((c) => isBasicSalaryComponent(c));
    const baseIsTaxable = basicComponent?.isTaxable ?? false;
    const guard = pickGuard(guardRows, period.unitId);

    // Only staff who actually draw a salary can have a payslip, so only they
    // belong in this computation. Staff without one used to be included, and
    // every work day they had no attendance row for blocked the whole period.
    const staffList = await prisma.staff.findMany({
      where: { unitId: period.unitId, deletedAt: null, employeeSalary: { isNot: null } },
      include: {
        user: { select: { name: true, id: true } },
        employeeSalary: { include: { items: { include: { component: true } } } },
      },
    });

    const week = await workWeekFor(period.unitId);
    const workDates = await workDatesInPeriod(
      period.startDate,
      period.endDate,
      period.unitId,
      week.workDays
    );

    const attendance = await prisma.staffAttendance.findMany({
      where: {
        staffId: { in: staffList.map((s) => s.id) },
        date: { gte: period.startDate, lte: period.endDate },
      },
    });

    // An employee exempt from clocking in has no attendance rows by design, so
    // their unrecorded days must not be read as "nothing was recorded". Their
    // attendance deductions are zero; the rest of the payslip is untouched.
    const exemptions = await prisma.attendanceExemption.findMany({
      where: { isActive: true },
      select: { staffId: true, roleCode: true },
    });
    const exemptStaffIds = new Set(
      exemptions.map((e) => e.staffId).filter((id): id is string => !!id)
    );
    const exemptRoleCodes = new Set(
      exemptions.map((e) => e.roleCode).filter((code): code is string => !!code)
    );
    const staffUserIds = staffList.map((s) => s.user.id);
    const roleAssignments = await prisma.userRoleAssignment.findMany({
      where: { userId: { in: staffUserIds }, isActive: true },
      select: { userId: true, role: { select: { code: true } } },
    });
    const rolesByUser = new Map<string, string[]>();
    for (const a of roleAssignments) {
      rolesByUser.set(a.userId, [...(rolesByUser.get(a.userId) ?? []), a.role.code]);
    }

    const byStaff = new Map<string, AttendanceCounts>();
    for (const row of attendance) {
      const counts = byStaff.get(row.staffId) ?? {
        lateMinutes: 0,
        lateDays: 0,
        absentDays: 0,
        presentDays: 0,
        earlyLeaveDays: 0,
        overtimeMinutes: 0,
      };
      if (row.status === 'LATE') {
        counts.lateDays += 1;
        counts.lateMinutes += row.lateMinutes ?? 0;
      } else if (row.status === 'ABSENT') counts.absentDays += 1;
      else if (row.status === 'PRESENT') counts.presentDays += 1;
      byStaff.set(row.staffId, counts);
    }

    return staffList.map((staff) => {
      const salary = staff.employeeSalary;
      // Read the structure the same way the payslip charges it: base salary,
      // the allowance side, and the other deduction lines (percentage items are
      // stored as a rate, not a nominal). A month's wage (PP 35/2021 art. 32) is
      // the base salary plus the fixed earning items — summing only the items
      // left an employee whose salary is entirely `baseSalary` with a zero
      // hourly rate, so every UPAH_SEJAM overtime rule paid nothing.
      const reconciled = reconcileSalary(
        salary?.items ?? [],
        Number(salary?.baseSalary ?? 0),
        baseIsTaxable
      );
      const ctx: StaffPayContext = {
        baseSalary: reconciled.baseSalary,
        allowances: reconciled.allowances,
        monthlyWage: reconciled.monthlyWage,
        workDays: workDates.length,
        hoursPerDay: week.hoursPerDay,
      };

      const counts = byStaff.get(staff.id) ?? {
        lateMinutes: 0,
        lateDays: 0,
        absentDays: 0,
        presentDays: 0,
        earlyLeaveDays: 0,
        overtimeMinutes: 0,
      };

      const isExempt =
        exemptStaffIds.has(staff.id) ||
        (rolesByUser.get(staff.user.id) ?? []).some((code) => exemptRoleCodes.has(code));

      const lines: DeductionLine[] = [];
      const guardWarnings: string[] = unbasedRules.map(
        (r) => `Aturan ${r.code} tidak diterapkan: belum ada dasar hukum tertulis`
      );
      const guardBreaches: string[] = [];
      if (!isExempt) {
        for (const rule of rules) {
          const line = evaluateRule(rule as RuleLike, ctx, counts);
          if (line) lines.push(line);
        }
      }

      const gross = reconciled.gross;
      // Deductions already on the slip (BPJS, PPh 21, loan repayments, …) come
      // out of the allowance side too, so the attendance engine may only spend
      // what is left of it. Capping attendance alone let the combined total
      // reduce net pay below the basic salary. PPh 21 is computed the same way
      // the slip computes it, or the cap would not describe the real slip.
      const pph21 = calculateMonthlyPph21(
        reconciled.taxableIncome,
        salary?.taxStatus ?? 'TK/0',
        !!salary?.npwp
      );
      const allowanceCap = allowanceCapFor(
        ctx.allowances.reduce((s, a) => s + a.amount, 0),
        reconciled.configuredDeductions,
        pph21
      );
      const cap = deductionCapFor(gross, allowanceCap, guard);
      const cappedResult = applyDeductionCap(lines, cap);
      const totalDeductions = cappedResult.total;
      const totalEarningAdditions = cappedResult.lines
        .filter((l) => l.kind === 'EARNING')
        .reduce((s, l) => s + l.amount, 0);

      if (cappedResult.capped > 0) {
        // The cap did its job: the payslip is safe. Informational only — this
        // must not block generation, or a cap the engine enforces would itself
        // become a reason no payslip can be produced.
        guardWarnings.push(
          `Potongan dibatasi ${cappedResult.capped} agar tidak melewati batas tunjangan (${cap})`
        );
      }

      // A breach is the admin's salary *structure* crossing the legal bound
      // (basic below the configured share, or below UMK). The engine cannot
      // fix that by capping attendance — the gap exists before any deduction —
      // so it stops and asks for an explicit, recorded decision.
      if (guard) {
        const minBasic = (gross * guard.minBasicSharePercent) / 100;
        if (ctx.baseSalary < minBasic) {
          guardBreaches.push(
            `Gaji pokok ${ctx.baseSalary} di bawah ${guard.minBasicSharePercent}% dari bruto (${minBasic})`
          );
        }
        if (
          guard.mustStayAboveUmk &&
          guard.umkNominal !== null &&
          ctx.baseSalary < guard.umkNominal
        ) {
          guardBreaches.push(`Gaji pokok ${ctx.baseSalary} di bawah UMK ${guard.umkNominal}`);
        }
      }

      // A work day with no row at all is not the same as an absence the
      // employee was marked for: nothing was recorded, so nothing can be
      // deducted from it honestly. Payroll generation is blocked on these —
      // except for someone the policy exempts from clocking in.
      const recorded = new Set(
        attendance.filter((a) => a.staffId === staff.id).map((a) => dayString(a.date))
      );
      const unresolvedDates = isExempt ? [] : workDates.filter((d) => !recorded.has(d));

      return {
        staffId: staff.id,
        staffName: staff.user.name,
        counts,
        lines: cappedResult.lines,
        totalDeductions,
        totalEarningAdditions,
        gross,
        guardWarnings,
        guardBreaches,
        allowanceCap,
        cappedByAllowance: cappedResult.capped,
        unresolvedDates,
      };
    });
  },
};
