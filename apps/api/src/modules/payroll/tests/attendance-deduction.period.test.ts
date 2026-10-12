import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payrollPeriod: { findUnique: vi.fn() },
    payrollGuardConfig: { findMany: vi.fn() },
    payrollPolicyRule: { findMany: vi.fn() },
    salaryComponent: { findMany: vi.fn() },
    staff: { findMany: vi.fn() },
    staffAttendance: { findMany: vi.fn() },
    attendanceExemption: { findMany: vi.fn() },
    userRoleAssignment: { findMany: vi.fn() },
  },
}));

vi.mock('../../../utils/work-calendar', () => ({
  workWeekFor: vi.fn(async () => ({ workDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 7 })),
  holidaysInRange: vi.fn(async () => []),
  isHolidayDay: vi.fn(() => false),
}));

import { prisma } from '../../../lib/prisma';
import { attendanceDeductionService } from '../attendance-deduction.service';

const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const PERIOD = {
  id: 'period-1',
  unitId: 'unit-1',
  startDate: new Date('2026-09-01'),
  endDate: new Date('2026-09-02'),
};

/** A base salary of 10M plus a 1M meal allowance — no other lines. */
const STAFF = [
  {
    id: 'staff-1',
    user: { id: 'user-1', name: 'Ustadz Ahmad' },
    employeeSalary: {
      baseSalary: 10_000_000,
      taxStatus: 'TK/0',
      npwp: null,
      items: [
        {
          amount: 1_000_000,
          isPercentage: false,
          rate: null,
          component: {
            code: 'MEAL_ALLOWANCE',
            name: 'Tunjangan Makan',
            type: 'EARNING',
            classification: 'TIDAK_TETAP',
            isTaxable: true,
          },
        },
      ],
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.payrollPeriod.findUnique.mockResolvedValue(PERIOD as never);
  m.payrollGuardConfig.findMany.mockResolvedValue([] as never);
  m.payrollPolicyRule.findMany.mockResolvedValue([] as never);
  m.staff.findMany.mockResolvedValue(STAFF as never);
  m.staffAttendance.findMany.mockResolvedValue([] as never);
  m.attendanceExemption.findMany.mockResolvedValue([] as never);
  m.userRoleAssignment.findMany.mockResolvedValue([] as never);
});

describe('computeForPeriod — PPh 21 basis matches the slip', () => {
  it('does not tax an untaxed base salary, so the allowance cap is not shrunk', async () => {
    m.salaryComponent.findMany.mockResolvedValue([
      { code: 'BASIC_SALARY', classification: 'POKOK', isTaxable: false },
    ] as never);

    const [row] = await attendanceDeductionService.computeForPeriod(PERIOD.id);

    // Only the 1M taxable allowance is income; the 10M base is untaxed, so the
    // slip charges no PPh 21 and the whole 1M allowance stays available.
    expect(row.allowanceCap).toBe(1_000_000);
  });

  it('taxes a taxable base salary, reducing the allowance the engine may spend', async () => {
    m.salaryComponent.findMany.mockResolvedValue([
      { code: 'BASIC_SALARY', classification: 'POKOK', isTaxable: true },
    ] as never);

    const [row] = await attendanceDeductionService.computeForPeriod(PERIOD.id);

    // Base 10M + allowance 1M = 11M taxable, no NPWP → PPh 21 480k, leaving 520k.
    expect(row.allowanceCap).toBe(520_000);
  });

  it('treats a structure with no basic component as the slip does: base untaxed', async () => {
    // The generator prints no basic line and adds nothing to taxable income
    // when there is no active basic component, so the engine must not tax it.
    m.salaryComponent.findMany.mockResolvedValue([] as never);

    const [row] = await attendanceDeductionService.computeForPeriod(PERIOD.id);

    expect(row.allowanceCap).toBe(1_000_000);
  });
});

describe('computeForPeriod — rules and guard', () => {
  const baseRule = {
    unitId: null,
    code: 'POTONGAN_TELAT',
    kind: 'DEDUCTION',
    trigger: 'LATE',
    basis: 'MEAL_ALLOWANCE',
    mode: 'NOMINAL',
    rate: 10_000,
    unit: 'PER_KEJADIAN',
    tiersJson: null,
    formulaExpr: null,
    capPerDay: null,
    capPerMonth: null,
    rounding: 'NONE',
    priority: 0,
    isActive: true,
  };

  beforeEach(() => {
    m.salaryComponent.findMany.mockResolvedValue([] as never);
  });

  it('skips a deduction rule with no written basis and names it', async () => {
    m.payrollPolicyRule.findMany.mockResolvedValue([{ ...baseRule, legalBasisDoc: null }] as never);

    const [row] = await attendanceDeductionService.computeForPeriod(PERIOD.id);

    expect(row.guardWarnings).toContain(
      'Aturan POTONGAN_TELAT tidak diterapkan: belum ada dasar hukum tertulis'
    );
  });

  it('keeps the yayasan rule when a same-code unit rule has no legal basis', async () => {
    // The unit rule shadows the yayasan rule by code, but it may not charge
    // without a basis — so it must not remove the yayasan rule too. Before the
    // fix, `effectiveRules` ran first, dropped the yayasan rule, and the unit
    // rule was then filtered out, leaving no deduction at all.
    m.payrollPolicyRule.findMany.mockResolvedValue([
      { ...baseRule, unitId: null, legalBasisDoc: 'Peraturan Kepegawaian Yayasan Ps. 12' },
      { ...baseRule, unitId: 'unit-1', legalBasisDoc: null },
    ] as never);
    m.staffAttendance.findMany.mockResolvedValue([
      { staffId: 'staff-1', date: new Date('2026-09-01'), status: 'LATE', lateMinutes: 30 },
    ] as never);

    const [row] = await attendanceDeductionService.computeForPeriod(PERIOD.id);

    const line = row.lines.find((l) => l.code === 'POTONGAN_TELAT');
    expect(line).toBeDefined();
    expect(line?.amount).toBe(10_000);
    expect(row.guardWarnings).toContain(
      'Aturan POTONGAN_TELAT tidak diterapkan: belum ada dasar hukum tertulis'
    );
  });

  it('lets a based unit rule replace the yayasan rule of the same code', async () => {
    // The override still applies once the unit rule is allowed to charge.
    m.payrollPolicyRule.findMany.mockResolvedValue([
      { ...baseRule, unitId: null, rate: 10_000, legalBasisDoc: 'Peraturan Kepegawaian Ps. 12' },
      { ...baseRule, unitId: 'unit-1', rate: 25_000, legalBasisDoc: 'Peraturan Unit Ps. 3' },
    ] as never);
    m.staffAttendance.findMany.mockResolvedValue([
      { staffId: 'staff-1', date: new Date('2026-09-01'), status: 'LATE', lateMinutes: 30 },
    ] as never);

    const [row] = await attendanceDeductionService.computeForPeriod(PERIOD.id);

    const line = row.lines.find((l) => l.code === 'POTONGAN_TELAT');
    expect(line?.amount).toBe(25_000);
    expect(row.guardWarnings).not.toContain(
      'Aturan POTONGAN_TELAT tidak diterapkan: belum ada dasar hukum tertulis'
    );
  });

  it('reads every guard row for the unit and the yayasan, not whichever comes first', async () => {
    await attendanceDeductionService.computeForPeriod(PERIOD.id);

    expect(m.payrollGuardConfig.findMany).toHaveBeenCalledWith({
      where: { isActive: true, OR: [{ unitId: 'unit-1' }, { unitId: null }] },
    });
  });
});
