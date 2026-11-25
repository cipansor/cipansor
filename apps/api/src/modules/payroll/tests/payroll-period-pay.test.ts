import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tandai dibayar (#990, PR-04) — the transition that turns an approved payroll
 * into money that left the account.
 *
 * The tests drive the real service against a mock client, so what is asserted
 * is the code path the API runs: which slips move, what the period stores, and
 * which journal lines are written in the same transaction.
 */

const accountCode = {
  findFirst: vi.fn(),
};

const txMock = {
  payroll: { updateMany: vi.fn(), aggregate: vi.fn() },
  payrollPeriod: { updateMany: vi.fn(), findUnique: vi.fn() },
  journalEntry: { create: vi.fn() },
  accountCode,
};

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payrollPeriod: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    payroll: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    payrollItem: { deleteMany: vi.fn() },
    staff: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../finance/accounting-config.service', () => ({
  ACCOUNT_MAPPING_KEYS: {
    PAYROLL_EXPENSE: 'ACCOUNT_MAPPING_PAYROLL_EXPENSE',
    CASH: 'ACCOUNT_MAPPING_CASH',
    TAX_PAYABLE: 'ACCOUNT_MAPPING_TAX_PAYABLE',
  },
  getAccountOrFallback: vi.fn(),
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { getAccountOrFallback } from '../../finance/accounting-config.service';
import { payrollPeriodService } from '../payroll.service';

const PERIOD = {
  id: 'period-1',
  unitId: 'unit-sd',
  name: 'Gaji Juni 2026',
  status: 'APPROVED',
  createdById: 'user-creator',
  notes: null as string | null,
  _count: { payrolls: 3 },
};

const TREASURER = { sub: 'user-bendahara', roleCode: 'SDIT_BENDAHARA', unitId: 'unit-sd' };
const YAYASAN_BENDAHARA = {
  sub: 'user-yayasan',
  roleCode: 'YAYASAN_BENDAHARA',
  unitId: null,
};
const CREATOR_APPROVER = { sub: 'user-creator', roleCode: 'YAYASAN_BENDAHARA', unitId: null };

/** A balanced set of totals: gross 10M, tax 250k, other 250k, net 9.5M. */
function totals(overrides: Record<string, unknown> = {}) {
  return {
    _sum: {
      totalEarnings: new Prisma.Decimal(10_000_000),
      totalDeductions: new Prisma.Decimal(500_000),
      taxAmount: new Prisma.Decimal(250_000),
      netSalary: new Prisma.Decimal(9_500_000),
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(PERIOD as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(txMock)
      : Promise.all(arg as unknown[])) as never);

  txMock.payroll.updateMany.mockResolvedValue({ count: 3 });
  txMock.payroll.aggregate.mockResolvedValue(totals() as never);
  txMock.payrollPeriod.updateMany.mockResolvedValue({ count: 1 });
  txMock.payrollPeriod.findUnique.mockResolvedValue({
    ...PERIOD,
    status: 'PAID',
  } as never);
  txMock.journalEntry.create.mockResolvedValue({});

  vi.mocked(getAccountOrFallback).mockImplementation((async (_unit: string, key: string) => {
    if (key === 'ACCOUNT_MAPPING_TAX_PAYABLE') {
      return {
        id: 'acc-tax',
        unitId: 'unit-sd',
        isActive: true,
        type: 'LIABILITY',
      };
    }
    return { id: key === 'ACCOUNT_MAPPING_CASH' ? 'acc-cash' : 'acc-expense' };
  }) as never);
  accountCode.findFirst.mockImplementation((async () => ({
    id: 'acc-other-payable',
    unitId: 'unit-sd',
    isActive: true,
    type: 'LIABILITY',
  })) as never);
});

describe('payrollPeriodService.markAsPaid — the happy path', () => {
  it('moves the period and its APPROVED slips to PAID and stamps both dates (R1.27)', async () => {
    const payDate = new Date('2026-06-25T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T09:15:00.000Z'));

    const result = await payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, payDate);

    // Only APPROVED slips are paid: a DRAFT slip was never approved.
    expect(txMock.payroll.updateMany).toHaveBeenCalledWith({
      where: { periodId: PERIOD.id, status: 'APPROVED' },
      data: { status: 'PAID' },
    });

    const update = txMock.payrollPeriod.updateMany.mock.calls[0][0] as {
      data: { status: string; payDate: Date; paidAt: Date };
    };
    expect(update.data.status).toBe('PAID');
    // `payDate` is the business date from the request; `paidAt` is the clock.
    expect(update.data.payDate).toEqual(payDate);
    expect(update.data.paidAt).toEqual(new Date('2026-06-26T09:15:00.000Z'));
    expect(result!.status).toBe('PAID');

    vi.useRealTimers();
  });

  it('books a balanced journal: gross expense, net cash, tax and other payables', async () => {
    await payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'));

    const lines = txMock.journalEntry.create.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data
    );

    const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const credit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(debit).toBe(10_000_000);
    expect(credit).toBe(10_000_000);

    // The expense is the gross, the cash is the net, and the two liabilities
    // are the deductions — that is the whole payroll entry.
    const line = (accountId: string) => {
      const found = lines.find((l) => l.accountId === accountId);
      return { debit: Number(found?.debit), credit: Number(found?.credit) };
    };
    expect(line('acc-expense')).toEqual({ debit: 10_000_000, credit: 0 });
    expect(line('acc-cash')).toEqual({ debit: 0, credit: 9_500_000 });
    expect(line('acc-tax')).toEqual({ debit: 0, credit: 250_000 });
    expect(line('acc-other-payable')).toEqual({ debit: 0, credit: 250_000 });

    // Every line is in the period's unit, references the period, and names the
    // person who clicked the button.
    for (const line of lines) {
      expect(line.unitId).toBe('unit-sd');
      expect(line.reference).toBe(PERIOD.id);
      expect(line.createdById).toBe('user-bendahara');
    }
  });

  it('aggregates only the slips it just paid', async () => {
    await payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'));
    expect(txMock.payroll.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { periodId: PERIOD.id, status: 'PAID' } })
    );
  });

  it('writes no line for a deduction of zero', async () => {
    txMock.payroll.aggregate.mockResolvedValue(
      totals({
        taxAmount: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        netSalary: new Prisma.Decimal(10_000_000),
      }) as never
    );
    await payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'));

    const accounts = txMock.journalEntry.create.mock.calls.map(
      (call) => (call[0] as { data: { accountId: string } }).data.accountId
    );
    expect(accounts).toEqual(['acc-expense', 'acc-cash']);
  });
});

describe('payrollPeriodService.markAsPaid — a journal that cannot be written', () => {
  it('refuses the payment when the expense or cash account is unmapped', async () => {
    vi.mocked(getAccountOrFallback).mockResolvedValue(null as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });

    // The throw rolls the transaction back, so the period is never left PAID
    // without its entry (R1.27).
    expect(txMock.journalEntry.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('refuses the payment when the PPh 21 mapping is missing, never searching by name', async () => {
    vi.mocked(getAccountOrFallback).mockImplementation((async (_unit: string, key: string) => {
      if (key === 'ACCOUNT_MAPPING_TAX_PAYABLE') return null;
      return { id: key === 'ACCOUNT_MAPPING_CASH' ? 'acc-cash' : 'acc-expense' };
    }) as never);
    // A PPh 23 account would be the wrong credit target; the service must not
    // even look for a name match.
    accountCode.findFirst.mockResolvedValue({
      id: 'acc-pph23',
      name: 'Utang Pajak Penghasilan Pasal 23',
      unitId: 'unit-sd',
      isActive: true,
      type: 'LIABILITY',
    } as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(accountCode.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a mapping that points to another unit’s account', async () => {
    vi.mocked(getAccountOrFallback).mockImplementation((async (_unit: string, key: string) => {
      if (key === 'ACCOUNT_MAPPING_TAX_PAYABLE') {
        return {
          id: 'acc-foreign-tax',
          unitId: 'unit-smp',
          isActive: true,
          type: 'LIABILITY',
        };
      }
      return { id: key === 'ACCOUNT_MAPPING_CASH' ? 'acc-cash' : 'acc-expense' };
    }) as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses the payment when the other-payables account is missing', async () => {
    accountCode.findFirst.mockResolvedValue(null as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('uses the unit’s mapped PPh 21 account, whatever its code', async () => {
    vi.mocked(getAccountOrFallback).mockImplementation((async (_unit: string, key: string) => {
      if (key === 'ACCOUNT_MAPPING_TAX_PAYABLE') {
        return {
          id: 'acc-pph-sd',
          code: '2-1099',
          unitId: 'unit-sd',
          isActive: true,
          type: 'LIABILITY',
        };
      }
      return { id: key === 'ACCOUNT_MAPPING_CASH' ? 'acc-cash' : 'acc-expense' };
    }) as never);

    await payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'));

    const accounts = txMock.journalEntry.create.mock.calls.map(
      (call) => (call[0] as { data: { accountId: string } }).data.accountId
    );
    expect(accounts).toContain('acc-pph-sd');
    expect(accounts).not.toContain('acc-tax');
  });

  it.each([
    ['inactive', { isActive: false }],
    ['not a liability', { type: 'ASSET' }],
    ['another unit', { unitId: 'unit-smp' }],
  ])('refuses a mapped PPh 21 account that is %s', async (_label, override) => {
    vi.mocked(getAccountOrFallback).mockImplementation((async (_unit: string, key: string) => {
      if (key === 'ACCOUNT_MAPPING_TAX_PAYABLE') {
        return {
          id: 'acc-pph-bad',
          unitId: 'unit-sd',
          isActive: true,
          type: 'LIABILITY',
          ...override,
        };
      }
      return { id: key === 'ACCOUNT_MAPPING_CASH' ? 'acc-cash' : 'acc-expense' };
    }) as never);
    accountCode.findFirst.mockResolvedValue(null as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses the second payment when another request already claimed the period', async () => {
    txMock.payrollPeriod.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(txMock.payroll.updateMany).not.toHaveBeenCalled();
    expect(txMock.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rolls the period and slips back when the journal cannot be written', async () => {
    const state = { period: 'APPROVED', slips: 'APPROVED' };
    const statefulTx = {
      payrollPeriod: {
        updateMany: vi.fn(
          async (args: { where: { status?: string }; data: { status: string } }) => {
            if (args.where.status && state.period !== args.where.status) return { count: 0 };
            state.period = args.data.status;
            return { count: 1 };
          }
        ),
        findUnique: vi.fn(async () => ({ ...PERIOD, status: state.period })),
      },
      payroll: {
        updateMany: vi.fn(async (args: { data: { status: string } }) => {
          state.slips = args.data.status;
          return { count: 3 };
        }),
        aggregate: vi.fn(async () => totals()),
      },
      journalEntry: { create: vi.fn() },
      accountCode: { findFirst: vi.fn(async () => null) },
    };

    vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) => {
      const snapshot = { ...state };
      try {
        return await (arg as (tx: unknown) => unknown)(statefulTx);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    }) as never);
    vi.mocked(getAccountOrFallback).mockImplementation((async (_unit: string, key: string) => {
      if (key === 'ACCOUNT_MAPPING_TAX_PAYABLE') return null;
      return { id: key === 'ACCOUNT_MAPPING_CASH' ? 'acc-cash' : 'acc-expense' };
    }) as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(state).toEqual({ period: 'APPROVED', slips: 'APPROVED' });
  });

  it('writes no journal when the slips carry no earnings', async () => {
    txMock.payroll.aggregate.mockResolvedValue(
      totals({
        totalEarnings: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        netSalary: new Prisma.Decimal(0),
      }) as never
    );
    const period = await payrollPeriodService.markAsPaid(
      TREASURER,
      PERIOD.id,
      new Date('2026-06-25')
    );
    expect(txMock.journalEntry.create).not.toHaveBeenCalled();
    expect(period!.status).toBe('PAID');
  });
});

describe('payrollPeriodService.markAsPaid — the refusals', () => {
  it('refuses a DRAFT period with 409', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue({
      ...PERIOD,
      status: 'DRAFT',
    } as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a period already PAID with 409', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue({
      ...PERIOD,
      status: 'PAID',
    } as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses another unit’s period with 404, never 403', async () => {
    // A treasurer must not learn that the id exists elsewhere (R1.17).
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue({
      ...PERIOD,
      unitId: 'unit-smp',
    } as never);

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses the yayasan treasurer with 403 — paying is the unit’s act', async () => {
    await expect(
      payrollPeriodService.markAsPaid(YAYASAN_BENDAHARA, PERIOD.id, new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses an unknown id with 404', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(null as never);
    await expect(
      payrollPeriodService.markAsPaid(TREASURER, 'nope', new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('payrollPeriodService.approve — the creator rule', () => {
  it('refuses an approver who created the period (R1.25)', async () => {
    await expect(payrollPeriodService.approve(CREATOR_APPROVER, PERIOD.id)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets another yayasan treasurer approve and stamps who did it', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue({
      ...PERIOD,
      status: 'DRAFT',
    } as never);

    await payrollPeriodService.approve(YAYASAN_BENDAHARA, PERIOD.id, 'Disetujui');

    const update = txMock.payrollPeriod.updateMany.mock.calls[0][0] as {
      data: { approvedById: string; notes: string };
    };
    expect(update.data.approvedById).toBe('user-yayasan');
    expect(update.data.notes).toBe('Disetujui');
  });

  it('refuses a period with no slips (R1.35)', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue({
      ...PERIOD,
      status: 'DRAFT',
      _count: { payrolls: 0 },
    } as never);

    await expect(payrollPeriodService.approve(YAYASAN_BENDAHARA, PERIOD.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe('payrollPeriodService.create — the unit comes from the token', () => {
  it('writes the token unit even when the body names another', async () => {
    vi.mocked(prisma.payrollPeriod.create).mockResolvedValue({ id: 'new' } as never);

    await payrollPeriodService.create(TREASURER, {
      name: 'Gaji Juli 2026',
      month: 7,
      year: 2026,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      unitId: 'unit-smp',
    } as never);

    const create = vi.mocked(prisma.payrollPeriod.create).mock.calls[0][0] as {
      data: { unitId: string; status: string; createdById: string };
    };
    expect(create.data.unitId).toBe('unit-sd');
    expect(create.data.status).toBe('DRAFT');
    expect(create.data.createdById).toBe('user-bendahara');
  });

  it('refuses a treasurer whose token carries no unit', async () => {
    await expect(
      payrollPeriodService.create({ ...TREASURER, unitId: null }, {
        name: 'x',
        month: 7,
        year: 2026,
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      } as never)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
