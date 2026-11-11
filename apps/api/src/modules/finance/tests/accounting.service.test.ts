import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    accountCode: { findMany: vi.fn(), count: vi.fn(), delete: vi.fn() },
    journalEntry: { create: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../../lib/prisma';
import {
  createManualJournal,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  deleteAccount,
} from '../accounting.service';

type Mock = ReturnType<typeof vi.fn>;
const mocked = prisma as unknown as {
  accountCode: { findMany: Mock; count: Mock; delete: Mock };
  journalEntry: { create: Mock; count: Mock; groupBy: Mock };
  $transaction: Mock;
};

// `createManualJournal` opens `prisma.$transaction(cb)`; the callback receives
// the transaction client. Give it a `journalEntry.create` we can watch, so the
// test can prove *which* rows were (not) written, not merely that a call failed.
const txCreate = vi.fn();

const account = (over: Partial<Record<string, unknown>>) => ({
  id: 'acc',
  code: '0000',
  name: 'Akun',
  type: 'ASSET',
  normalBalance: 'DEBIT',
  ...over,
});

const sum = (debit: number, credit: number) => ({
  _sum: { debit: { toNumber: () => debit }, credit: { toNumber: () => credit } },
});

beforeEach(() => {
  vi.clearAllMocks();
  txCreate.mockResolvedValue({ id: 'je' });
  mocked.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ journalEntry: { create: txCreate } })
  );
});

describe('createManualJournal', () => {
  const base = {
    unitId: 'unit-1',
    date: new Date('2026-03-01'),
    description: 'Jurnal manual',
    createdById: 'user-1',
  };

  it('rejects an unbalanced journal and writes no journal entry', async () => {
    await expect(
      createManualJournal({
        ...base,
        entries: [
          { accountId: 'kas', debit: 1000, credit: 0 },
          { accountId: 'pendapatan', debit: 0, credit: 900 },
        ],
      })
    ).rejects.toThrow(/not balanced/i);

    expect(txCreate).not.toHaveBeenCalled();
  });

  it('accepts a balanced journal and writes one row per entry', async () => {
    txCreate.mockResolvedValueOnce({ id: 'je-1' }).mockResolvedValueOnce({ id: 'je-2' });

    const result = await createManualJournal({
      ...base,
      entries: [
        { accountId: 'kas', debit: 1000, credit: 0 },
        { accountId: 'pendapatan', debit: 0, credit: 1000 },
      ],
    });

    expect(result).toHaveLength(2);
    expect(txCreate).toHaveBeenCalledTimes(2);

    const first = txCreate.mock.calls[0][0].data;
    expect(first.accountId).toBe('kas');
    expect(first.debit.toString()).toBe('1000');
    expect(first.credit.toString()).toBe('0');
    expect(first.referenceType).toBe('MANUAL');
    // Every row of one journal shares the group reference.
    expect(txCreate.mock.calls[0][0].data.reference).toBe(txCreate.mock.calls[1][0].data.reference);
  });

  it('tolerates a rounding difference within one cent', async () => {
    const result = await createManualJournal({
      ...base,
      entries: [
        { accountId: 'kas', debit: 1000.005, credit: 0 },
        { accountId: 'pendapatan', debit: 0, credit: 1000 },
      ],
    });

    expect(result).toHaveLength(2);
  });
});

describe('getTrialBalance', () => {
  it('follows normalBalance: debit-normal as debit-credit, credit-normal as credit-debit', async () => {
    mocked.accountCode.findMany.mockResolvedValue([
      account({ id: 'kas', code: '1101', name: 'Kas', type: 'ASSET', normalBalance: 'DEBIT' }),
      account({
        id: 'utang',
        code: '2101',
        name: 'Hutang Usaha',
        type: 'LIABILITY',
        normalBalance: 'CREDIT',
      }),
    ]);
    mocked.journalEntry.groupBy.mockResolvedValue([
      { accountId: 'kas', ...sum(5000, 1000) },
      { accountId: 'utang', ...sum(500, 2500) },
    ]);

    const rows = await getTrialBalance({ unitId: 'unit-1' });

    const kas = rows.find((r) => r.accountId === 'kas');
    const utang = rows.find((r) => r.accountId === 'utang');
    expect(kas?.balance).toBe(4000); // DEBIT: 5000 - 1000
    expect(utang?.balance).toBe(2000); // CREDIT: 2500 - 500
  });

  it('reports zero for an account with no journal entries', async () => {
    mocked.accountCode.findMany.mockResolvedValue([
      account({ id: 'kosong', code: '1103', normalBalance: 'DEBIT' }),
    ]);
    mocked.journalEntry.groupBy.mockResolvedValue([]);

    const [row] = await getTrialBalance({});

    expect(row.balance).toBe(0);
    expect(row.debit).toBe(0);
    expect(row.credit).toBe(0);
  });
});

describe('financial statements', () => {
  const ledger = () =>
    mocked.accountCode.findMany.mockResolvedValue([
      account({ id: 'kas', type: 'ASSET', normalBalance: 'DEBIT' }),
      account({ id: 'utang', type: 'LIABILITY', normalBalance: 'CREDIT' }),
      account({ id: 'modal', type: 'EQUITY', normalBalance: 'CREDIT' }),
      account({ id: 'spp', type: 'REVENUE', normalBalance: 'CREDIT' }),
      account({ id: 'gaji', type: 'EXPENSE', normalBalance: 'DEBIT' }),
    ]);

  const withJournal = () =>
    mocked.journalEntry.groupBy.mockResolvedValue([
      { accountId: 'kas', ...sum(10000, 0) },
      { accountId: 'utang', ...sum(0, 3000) },
      { accountId: 'modal', ...sum(0, 5000) },
      { accountId: 'spp', ...sum(0, 4000) },
      { accountId: 'gaji', ...sum(1500, 0) },
    ]);

  it('getIncomeStatement derives netIncome from revenue minus expense', async () => {
    ledger();
    withJournal();

    const result = await getIncomeStatement({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    });

    expect(result.totalRevenue).toBe(4000);
    expect(result.totalExpense).toBe(1500);
    expect(result.netIncome).toBe(2500);
  });

  it('getBalanceSheet folds netIncome into total equity', async () => {
    ledger();
    withJournal();

    const result = await getBalanceSheet({ endDate: new Date('2026-12-31') });

    expect(result.totalAssets).toBe(10000);
    expect(result.totalLiabilities).toBe(3000);
    // Equity accounts (5000) + the period's net income (4000 - 1500).
    expect(result.netIncome).toBe(2500);
    expect(result.totalEquity).toBe(7500);
  });
});

describe('deleteAccount', () => {
  it('refuses an account that has journal entries, without deleting', async () => {
    mocked.journalEntry.count.mockResolvedValue(3);

    await expect(deleteAccount('acc-1')).rejects.toThrow(/existing journal entries/i);
    expect(mocked.accountCode.delete).not.toHaveBeenCalled();
  });

  it('refuses an account that still has children, without deleting', async () => {
    mocked.journalEntry.count.mockResolvedValue(0);
    mocked.accountCode.count.mockResolvedValue(2);

    await expect(deleteAccount('acc-2')).rejects.toThrow(/child accounts/i);
    expect(mocked.accountCode.delete).not.toHaveBeenCalled();
  });

  it('deletes an account with no entries and no children', async () => {
    mocked.journalEntry.count.mockResolvedValue(0);
    mocked.accountCode.count.mockResolvedValue(0);
    mocked.accountCode.delete.mockResolvedValue({ id: 'acc-3' });

    await deleteAccount('acc-3');

    expect(mocked.accountCode.delete).toHaveBeenCalledWith({ where: { id: 'acc-3' } });
  });
});
