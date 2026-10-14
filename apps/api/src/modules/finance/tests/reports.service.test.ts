import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    accountCode: { findMany: vi.fn() },
    journalEntry: { aggregate: vi.fn() },
    budget: { findMany: vi.fn() },
    reportNote: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    reportTemplate: { findFirst: vi.fn() },
  },
}));

vi.mock('../accounting.service', () => ({
  getTrialBalance: vi.fn(),
}));

import { prisma } from '../../../lib/prisma';
import { getTrialBalance } from '../accounting.service';
import * as reportsService from '../reports.service';

const mockedTB = vi.mocked(getTrialBalance);
const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe('finance reports (ISAK 35 / PSAK 109)', () => {
  const unitId = 'unit-1';
  const startDate = new Date('2026-01-01');
  const endDate = new Date('2026-12-31');

  beforeEach(() => vi.clearAllMocks());

  describe('getStatementOfActivities', () => {
    it('splits revenues/expenses by restriction and derives change in net assets', async () => {
      mockedTB.mockResolvedValue([
        { accountId: 'r1', type: 'REVENUE', normalBalance: 'CREDIT', credit: 1000, debit: 0 },
        { accountId: 'r2', type: 'REVENUE', normalBalance: 'CREDIT', credit: 500, debit: 0 },
        { accountId: 'e1', type: 'EXPENSE', normalBalance: 'DEBIT', credit: 0, debit: 400 },
      ] as never);
      mocked.accountCode.findMany.mockResolvedValue([
        { id: 'r1', netAssetCategory: 'UNRESTRICTED' },
        { id: 'r2', netAssetCategory: 'TEMPORARILY_RESTRICTED' },
        { id: 'e1', netAssetCategory: null }, // untagged defaults to UNRESTRICTED
      ]);
      mocked.journalEntry.aggregate.mockResolvedValue({
        _sum: { debit: { toNumber: () => 100 }, credit: { toNumber: () => 350 } },
      });

      const result = await reportsService.getStatementOfActivities({
        unitId,
        startDate,
        endDate,
      });

      expect(result.revenues.unrestricted.total).toBe(1000);
      expect(result.revenues.restricted.total).toBe(500);
      expect(result.expenses.unrestricted.total).toBe(400);
      expect(result.changeInNetAssets).toEqual({
        unrestricted: 600,
        restricted: 500,
        total: 1100,
      });
      // Beginning net assets = prior credit - debit = 250
      expect(result.netAssets.beginning).toBe(250);
      expect(result.netAssets.ending).toBe(1350);
    });
  });

  describe('getZiswafReport', () => {
    it('groups receipts and distributions by fund type, one row per fund', async () => {
      mockedTB.mockResolvedValue([
        { accountId: 'z-rev', type: 'REVENUE', normalBalance: 'CREDIT', credit: 1000, debit: 0 },
        { accountId: 'z-exp', type: 'EXPENSE', normalBalance: 'DEBIT', credit: 0, debit: 200 },
        { accountId: 'plain', type: 'REVENUE', normalBalance: 'CREDIT', credit: 999, debit: 0 },
      ] as never);
      mocked.accountCode.findMany.mockResolvedValue([
        { id: 'z-rev', ziswafFundType: 'ZAKAT' },
        { id: 'z-exp', ziswafFundType: 'ZAKAT' },
      ]);

      const result = await reportsService.getZiswafReport({ unitId, startDate, endDate });

      expect(result).toHaveLength(5);
      const zakat = result.find((r) => r.type === 'ZAKAT');
      expect(zakat).toEqual({
        type: 'ZAKAT',
        receipts: 1000,
        distributions: 200,
        netChange: 800,
      });
      // Untagged accounts never leak into the ZISWAF report.
      const others = result.filter((r) => r.type !== 'ZAKAT');
      for (const row of others) {
        expect(row.receipts).toBe(0);
        expect(row.distributions).toBe(0);
      }
    });
  });

  describe('getBudgetVsActualReport', () => {
    it('compares budget amounts with trial-balance actuals', async () => {
      mocked.budget.findMany.mockResolvedValue([
        {
          accountId: 'e1',
          amount: { toNumber: () => 1000 },
          account: { code: '5-1-01', name: 'Beban Operasional' },
        },
      ]);
      mockedTB.mockResolvedValue([
        { accountId: 'e1', type: 'EXPENSE', normalBalance: 'DEBIT', credit: 100, debit: 850 },
      ] as never);

      const [row] = await reportsService.getBudgetVsActualReport({
        unitId,
        academicYearId: 'ay-1',
      });

      expect(row.budget).toBe(1000);
      expect(row.actual).toBe(750);
      expect(row.variance).toBe(250);
      expect(row.percentage).toBe(75);
    });
  });

  describe('saveReportNote', () => {
    it('updates the existing note for a period-less section instead of duplicating', async () => {
      mocked.reportNote.findFirst.mockResolvedValue({ id: 'note-1' });
      mocked.reportNote.update.mockResolvedValue({ id: 'note-1', content: 'baru' });

      await reportsService.saveReportNote({
        unitId,
        reportType: 'CALK',
        sectionKey: 'kebijakan-akuntansi',
        content: 'baru',
      });

      // NULL periodId must be matched explicitly — Prisma upsert on the
      // composite unique would always insert because NULL != NULL.
      expect(mocked.reportNote.findFirst.mock.calls[0][0].where.periodId).toBeNull();
      expect(mocked.reportNote.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { content: 'baru' },
      });
      expect(mocked.reportNote.create).not.toHaveBeenCalled();
    });

    it('creates a note when none exists yet', async () => {
      mocked.reportNote.findFirst.mockResolvedValue(null);
      mocked.reportNote.create.mockResolvedValue({ id: 'note-2' });

      await reportsService.saveReportNote({
        unitId,
        periodId: 'per-1',
        reportType: 'CALK',
        sectionKey: 'aset-tetap',
        content: 'Penjelasan aset tetap.',
      });

      expect(mocked.reportNote.create).toHaveBeenCalledWith({
        data: {
          unitId,
          periodId: 'per-1',
          reportType: 'CALK',
          sectionKey: 'aset-tetap',
          content: 'Penjelasan aset tetap.',
        },
      });
    });
  });
});
