import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../finance-enhancement.service', () => ({
  financeEnhancementService: {
    getJournalEntries: vi.fn().mockResolvedValue({ success: true, data: [], pagination: {} }),
  },
}));

vi.mock('../reporting.service', () => ({
  getBalanceSheet: vi.fn().mockResolvedValue({}),
  getIncomeStatement: vi.fn().mockResolvedValue({}),
  getTrialBalance: vi.fn().mockResolvedValue([]),
  getGeneralLedger: vi.fn().mockResolvedValue([]),
  getCashFlowStatement: vi.fn().mockResolvedValue({}),
  getBudgetRealizationReport: vi.fn().mockResolvedValue({}),
  getCashFlowForecast: vi.fn().mockResolvedValue({}),
}));

import { financeEnhancementService } from '../finance-enhancement.service';
import {
  getIncomeStatement,
  getBalanceSheet,
  getTrialBalance,
  getGeneralLedger,
  getCashFlowStatement,
} from '../reporting.service';
import { financeEnhancementController } from '../finance-enhancement.controller';

function mockReqRes(query: Record<string, string> = {}) {
  const req = { query, params: {}, body: {}, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    statusCode: 200,
    jsonPayload: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.jsonPayload = payload;
      return res;
    },
  };
  return { req, res: res as unknown as Response };
}

async function run(
  handler: (req: Request, res: Response, next: any) => Promise<unknown>,
  req: Request,
  res: Response
) {
  const next = vi.fn();
  await handler(req, res, next);
  return next;
}

// The report pages send date-only bounds (`YYYY-MM-DD`). Read as UTC midnight
// they are 07:00 WIB, so an `lte` on the end bound dropped the whole last WIB
// day of the period — the month's final entries never reached the report.
const wibEnd = new Date('2026-01-31T16:59:59.999Z'); // 2026-01-31 23:59:59.999 WIB
const wibStart = new Date('2025-12-31T17:00:00.000Z'); // 2026-01-01 00:00 WIB

beforeEach(() => vi.clearAllMocks());

describe('finance-enhancement report date bounds (WIB)', () => {
  it('ends the journal list on the last instant of the chosen WIB day', async () => {
    const { req, res } = mockReqRes({ startDate: '2026-01-01', endDate: '2026-01-31' });
    const next = await run(
      financeEnhancementController.getJournalEntries.bind(financeEnhancementController),
      req,
      res
    );

    expect(next).not.toHaveBeenCalled();
    const args = vi.mocked(financeEnhancementService.getJournalEntries).mock.calls[0][0];
    expect(args.startDate?.getTime()).toBe(wibStart.getTime());
    expect(args.endDate?.getTime()).toBe(wibEnd.getTime());
  });

  it('ends the trial balance on the last instant of the chosen WIB day', async () => {
    const { req, res } = mockReqRes({
      unitId: 'unit-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await run(
      financeEnhancementController.getTrialBalance.bind(financeEnhancementController),
      req,
      res
    );

    const [unitId, start, end] = vi.mocked(getTrialBalance).mock.calls[0];
    expect(unitId).toBe('unit-1');
    expect((start as Date).getTime()).toBe(wibStart.getTime());
    expect((end as Date).getTime()).toBe(wibEnd.getTime());
  });

  it('ends the income statement on the last instant of the chosen WIB day', async () => {
    const { req, res } = mockReqRes({
      unitId: 'unit-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await run(
      financeEnhancementController.getIncomeExpenseReport.bind(financeEnhancementController),
      req,
      res
    );

    const [unitId, start, end] = vi.mocked(getIncomeStatement).mock.calls[0];
    expect(unitId).toBe('unit-1');
    expect((start as Date).getTime()).toBe(wibStart.getTime());
    expect((end as Date).getTime()).toBe(wibEnd.getTime());
  });

  it('ends the balance sheet on the last instant of the chosen WIB day', async () => {
    const { req, res } = mockReqRes({ unitId: 'unit-1', date: '2026-01-31' });
    await run(
      financeEnhancementController.getBalanceSheet.bind(financeEnhancementController),
      req,
      res
    );

    const [unitId, date] = vi.mocked(getBalanceSheet).mock.calls[0];
    expect(unitId).toBe('unit-1');
    expect((date as Date).getTime()).toBe(wibEnd.getTime());
  });

  it('bounds the general ledger and the cash flow statement by WIB days too', async () => {
    const range = { unitId: 'unit-1', startDate: '2026-01-01', endDate: '2026-01-31' };

    const gl = mockReqRes({ ...range, accountId: 'acc-1' });
    await run(
      financeEnhancementController.getGeneralLedger.bind(financeEnhancementController),
      gl.req,
      gl.res
    );
    expect(vi.mocked(getGeneralLedger)).toHaveBeenCalledWith('unit-1', 'acc-1', wibStart, wibEnd);

    const cf = mockReqRes(range);
    await run(
      financeEnhancementController.getCashFlowStatement.bind(financeEnhancementController),
      cf.req,
      cf.res
    );
    expect(vi.mocked(getCashFlowStatement)).toHaveBeenCalledWith('unit-1', wibStart, wibEnd);
  });
});
