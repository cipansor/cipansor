import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

/**
 * The accounting report endpoints bound `JournalEntry.date`, a real instant,
 * by WIB calendar days (#931). A date-only `endDate` read as UTC midnight is
 * 07:00 WIB, so an `lte` on it dropped the whole last WIB day; and a default
 * period derived from the server clock sat on the UTC month or year, which is
 * still the previous one for the first seven WIB hours of the 1st.
 *
 * The services are mocked: these cases assert the bounds the controller hands
 * them, under `TZ=UTC` with the clock frozen at 1 Feb 2026 05:00 WIB.
 */

vi.mock('../accounting.service', () => ({
  getJournals: vi.fn().mockResolvedValue({ data: [] }),
  getTrialBalance: vi.fn().mockResolvedValue([]),
  getBalanceSheet: vi.fn().mockResolvedValue({}),
  getIncomeStatement: vi.fn().mockResolvedValue({}),
}));
vi.mock('../reports.service', () => ({
  getStatementOfActivities: vi.fn().mockResolvedValue({}),
  getZiswafReport: vi.fn().mockResolvedValue({}),
}));
vi.mock('../accounting-config.service', () => ({}));

import * as service from '../accounting.service';
import * as reportsService from '../reports.service';
import {
  getJournals,
  getTrialBalance,
  getBalanceSheet,
  getIncomeStatement,
  getStatementOfActivities,
  getZiswafReport,
} from '../accounting.controller';

type Handler = (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>;

async function call(handler: Handler, query: Record<string, string> = {}) {
  const req = { query } as unknown as Request;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn();
  await handler(req, res, next);
  expect(next).not.toHaveBeenCalled();
}

/** The first argument the mocked service function was called with. */
const argOf = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls[0][0];

const iso = (d: Date) => d.toISOString();

// 2026-01-31 00:00 WIB and 23:59:59.999 WIB.
const JAN31_START = '2026-01-30T17:00:00.000Z';
const JAN31_END = '2026-01-31T16:59:59.999Z';

const prevTz = process.env.TZ;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'UTC';
  vi.useFakeTimers({ toFake: ['Date'] });
  // 2026-02-01 05:00 WIB — still 31 January on a UTC clock.
  vi.setSystemTime(new Date('2026-01-31T22:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

describe('accounting report bounds follow the WIB calendar', () => {
  it('a chosen day runs from its first to its last WIB instant (journals, trial balance)', async () => {
    const range = { startDate: '2026-01-31', endDate: '2026-01-31' };

    await call(getJournals as Handler, range);
    expect(iso(argOf(service.getJournals).startDate)).toBe(JAN31_START);
    expect(iso(argOf(service.getJournals).endDate)).toBe(JAN31_END);

    await call(getTrialBalance as Handler, range);
    expect(iso(argOf(service.getTrialBalance).startDate)).toBe(JAN31_START);
    expect(iso(argOf(service.getTrialBalance).endDate)).toBe(JAN31_END);
  });

  it('keeps an entry posted at 14:00 WIB on the last day inside the period', async () => {
    await call(getIncomeStatement as Handler, { startDate: '2026-01-01', endDate: '2026-01-31' });
    const entry = new Date('2026-01-31T14:00:00+07:00');
    expect(entry.getTime()).toBeLessThanOrEqual(
      argOf(service.getIncomeStatement).endDate.getTime()
    );
  });

  it('defaults the income statement to the current WIB month, not the UTC one', async () => {
    await call(getIncomeStatement as Handler);
    const { startDate, endDate } = argOf(service.getIncomeStatement);
    // February 2026 in WIB: 1 Feb 00:00 WIB .. 28 Feb 23:59:59.999 WIB.
    expect(iso(startDate)).toBe('2026-01-31T17:00:00.000Z');
    expect(iso(endDate)).toBe('2026-02-28T16:59:59.999Z');
  });

  it('defaults the balance sheet to the end of today WIB', async () => {
    await call(getBalanceSheet as Handler);
    expect(iso(argOf(service.getBalanceSheet).endDate)).toBe('2026-02-01T16:59:59.999Z');
  });

  it('defaults the ISAK 35 and ZISWAF reports to the WIB year so far', async () => {
    // On 1 Jan 2027 05:00 WIB the UTC year is still 2026.
    vi.setSystemTime(new Date('2026-12-31T22:00:00.000Z'));

    await call(getStatementOfActivities as Handler);
    const activities = argOf(reportsService.getStatementOfActivities);
    expect(iso(activities.startDate)).toBe('2026-12-31T17:00:00.000Z');
    expect(iso(activities.endDate)).toBe('2027-01-01T16:59:59.999Z');

    await call(getZiswafReport as Handler);
    expect(iso(argOf(reportsService.getZiswafReport).startDate)).toBe('2026-12-31T17:00:00.000Z');
  });
});
