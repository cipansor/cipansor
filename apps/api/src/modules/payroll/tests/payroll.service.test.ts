import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Generation is the moment a policy turns into money, so the two refusals
 * live here rather than in a report the admin may never open:
 *
 *  - a work day with no attendance row makes the deduction unknowable, and
 *  - a deduction past the guard (PP 36/2021 art. 32) needs an explicit,
 *    recorded override.
 *
 * The slip's own arithmetic is exercised too: the transaction callback runs
 * against a mock, so the base salary line and the totals it feeds are asserted
 * on the real code path rather than only in the salary-splitting helper.
 */

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payrollPeriod: { findUnique: vi.fn(), update: vi.fn() },
    staff: { findMany: vi.fn() },
    salaryComponent: { findMany: vi.fn(), upsert: vi.fn() },
    staffAttendance: { groupBy: vi.fn() },
    workWeekConfig: { findFirst: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../attendance-deduction.service', () => ({
  attendanceDeductionService: { computeForPeriod: vi.fn() },
}));

import { prisma } from '../../../lib/prisma';
import { attendanceDeductionService } from '../attendance-deduction.service';
import { payrollService } from '../payroll.service';

const PERIOD = {
  id: '11111111-1111-4111-8111-111111111111',
  unitId: 'unit-sd',
  status: 'DRAFT',
  startDate: new Date('2026-09-01'),
  endDate: new Date('2026-09-30'),
};

function deductionRow(overrides: Record<string, unknown> = {}) {
  return {
    staffId: 'staff-1',
    staffName: 'Ustadz Ahmad',
    counts: {
      lateMinutes: 0,
      lateDays: 0,
      absentDays: 0,
      presentDays: 22,
      earlyLeaveDays: 0,
      overtimeMinutes: 0,
    },
    lines: [],
    totalDeductions: 0,
    totalEarningAdditions: 0,
    gross: 3_000_000,
    guardWarnings: [],
    guardBreaches: [],
    allowanceCap: 0,
    cappedByAllowance: 0,
    unresolvedDates: [],
    ...overrides,
  };
}

const txMock = {
  payroll: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  payrollItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  payrollPeriod: { update: vi.fn() },
  salaryComponent: { upsert: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(PERIOD as never);
  vi.mocked(prisma.staff.findMany).mockResolvedValue([
    {
      id: 'staff-1',
      nip: '198501012010011001',
      department: 'Guru',
      position: 'Guru',
      user: { name: 'Ustadz Ahmad' },
      employeeSalary: { baseSalary: 3_000_000, items: [], taxStatus: 'TK/0', npwp: null },
    },
  ] as never);
  vi.mocked(prisma.salaryComponent.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.staffAttendance.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.workWeekConfig.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([] as never);
  // Run the transaction callback so the slip arithmetic is exercised, not just
  // the preflight. The callback receives the mock in place of the real client.
  vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(txMock)
      : Promise.all(arg as unknown[])) as never);
  txMock.payroll.findUnique.mockResolvedValue(null);
  txMock.payroll.create.mockResolvedValue({ id: 'payroll-1' });
  txMock.payroll.aggregate.mockResolvedValue({ _sum: { netSalary: 0 }, _count: 0 });
  txMock.payrollItem.createMany.mockResolvedValue({ count: 0 });
  txMock.payrollPeriod.update.mockResolvedValue({});
  vi.mocked(attendanceDeductionService.computeForPeriod).mockResolvedValue([
    deductionRow(),
  ] as never);
});

describe('payrollService.generate', () => {
  it('refuses when a work day has no attendance row', async () => {
    vi.mocked(attendanceDeductionService.computeForPeriod).mockResolvedValue([
      deductionRow({ unresolvedDates: ['2026-09-03', '2026-09-04'] }),
    ] as never);

    await expect(
      payrollService.generate({ periodId: PERIOD.id, overwrite: false } as never)
    ).rejects.toThrow(/Absensi belum lengkap/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a deduction past the guard without an override reason', async () => {
    vi.mocked(attendanceDeductionService.computeForPeriod).mockResolvedValue([
      deductionRow({ guardBreaches: ['Gaji pokok 1500000 di bawah UMK 2000000'] }),
    ] as never);

    await expect(
      payrollService.generate({ periodId: PERIOD.id, overwrite: false } as never)
    ).rejects.toThrow(/melampaui batas/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('proceeds past the guard when an override reason is given', async () => {
    vi.mocked(attendanceDeductionService.computeForPeriod).mockResolvedValue([
      deductionRow({ guardBreaches: ['Gaji pokok 1500000 di bawah UMK 2000000'] }),
    ] as never);

    await expect(
      payrollService.generate({
        periodId: PERIOD.id,
        overwrite: false,
        overrideGuardReason: 'Kesepakatan tertulis dengan pegawai',
      } as never)
    ).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('does not block on an informational cap note', async () => {
    vi.mocked(attendanceDeductionService.computeForPeriod).mockResolvedValue([
      deductionRow({
        guardWarnings: ['Potongan dibatasi 500000 agar tidak melewati batas tunjangan'],
      }),
    ] as never);

    await expect(
      payrollService.generate({ periodId: PERIOD.id, overwrite: false } as never)
    ).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('payrollService.generate — the slip’s base salary line', () => {
  it('prints the base salary once and totals the items to match', async () => {
    // A structure whose basic component is the seeded BASIC_SALARY and whose
    // employee also carries a BASIC_SALARY *item* — the shape that paid the
    // base twice once the generator matched the item as an allowance.
    vi.mocked(prisma.salaryComponent.findMany).mockResolvedValue([
      {
        id: 'comp-basic',
        code: 'BASIC_SALARY',
        name: 'Gaji Pokok',
        type: 'EARNING',
        classification: 'POKOK',
        isTaxable: true,
        isActive: true,
        sortOrder: 1,
      },
    ] as never);
    vi.mocked(prisma.staff.findMany).mockResolvedValue([
      {
        id: 'staff-1',
        nip: '198501012010011001',
        department: 'Guru',
        position: 'Guru',
        user: { name: 'Ustadz Ahmad' },
        employeeSalary: {
          baseSalary: 3_500_000,
          taxStatus: 'TK/0',
          npwp: null,
          items: [
            {
              amount: 3_000_000,
              isPercentage: false,
              rate: null,
              component: {
                id: 'comp-basic',
                code: 'BASIC_SALARY',
                name: 'Gaji Pokok',
                type: 'EARNING',
                classification: 'POKOK',
                isTaxable: true,
              },
            },
          ],
        },
      },
    ] as never);

    await payrollService.generate({ periodId: PERIOD.id, overwrite: false } as never);

    const items = txMock.payrollItem.createMany.mock.calls[0][0].data as {
      componentCode: string;
      amount: unknown;
    }[];
    const baseLines = items.filter((i) => i.componentCode === 'BASIC_SALARY');
    expect(baseLines).toHaveLength(1);
    expect(Number(baseLines[0].amount)).toBe(3_500_000);

    const created = txMock.payroll.create.mock.calls[0][0].data;
    // Base 3.5M, no allowances, no deduction lines → earnings equal the base.
    expect(Number(created.totalEarnings)).toBe(3_500_000);
    expect(Number(created.netSalary)).toBe(3_500_000);
    // Taxable income is the base alone; the skipped item adds nothing.
    expect(Number(created.taxableIncome)).toBe(3_500_000);
  });
});
