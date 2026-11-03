import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    journalEntry: { aggregate: vi.fn(), groupBy: vi.fn() },
    unit: { findMany: vi.fn() },
    student: { groupBy: vi.fn() },
    accountCode: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getFinancialOverview } from '../analytics.service';

// The yayasan "Ringkasan Keuangan" month window used to be built from the
// server clock (`new Date(y, m + 1, 0)` → midnight UTC of the last day), so a
// journal entry posted on the last day — or in the first seven hours of the 1st
// — fell outside it and the total was short. The container runs UTC. These
// cases pin the window to the WIB calendar month, whole last day included.
const monthWindows = () =>
  vi
    .mocked(prisma.journalEntry.aggregate)
    .mock.calls.map((c) => (c[0] as { where?: { date?: { gte: Date; lte: Date } } })?.where?.date)
    .filter((d): d is { gte: Date; lte: Date } => !!d?.gte && !!d?.lte);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.journalEntry.aggregate).mockResolvedValue({
    _sum: { debit: 0, credit: 0 },
  } as never);
  vi.mocked(prisma.journalEntry.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.unit.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.student.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.accountCode.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getFinancialOverview month windows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 15 November 2026 09:00 WIB (02:00Z), the issue's reproduction instant.
    vi.setSystemTime(new Date('2026-11-15T02:00:00.000Z'));
  });

  it('covers the whole of 30 November WIB, not just its midnight', async () => {
    await getFinancialOverview();

    const november = monthWindows().find((w) => w.gte.toISOString() === '2026-10-31T17:00:00.000Z');
    expect(november).toBeTruthy();

    const lastDayPayment = new Date('2026-11-30T03:00:00.000Z'); // 30 Nov 10:00 WIB
    expect(lastDayPayment >= november!.gte && lastDayPayment <= november!.lte).toBe(true);
    expect(november!.lte.toISOString()).toBe('2026-11-30T16:59:59.999Z');
  });

  it('counts a 1st-of-month 02:00 WIB entry stored on the previous UTC day', async () => {
    await getFinancialOverview();

    const november = monthWindows().find((w) => w.gte.toISOString() === '2026-10-31T17:00:00.000Z');
    const earlyFirstDay = new Date('2026-10-31T19:00:00.000Z'); // 1 Nov 02:00 WIB
    expect(earlyFirstDay >= november!.gte && earlyFirstDay <= november!.lte).toBe(true);
  });

  it('bounds last month on the same WIB clock', async () => {
    await getFinancialOverview();

    const october = monthWindows().find((w) => w.gte.toISOString() === '2026-09-30T17:00:00.000Z');
    expect(october).toBeTruthy();
    expect(october!.lte.toISOString()).toBe('2026-10-31T16:59:59.999Z');
  });
});

describe('getFinancialOverview trend and rollover', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses WIB months for the trailing six, oldest first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T02:00:00.000Z'));

    const result = await getFinancialOverview();

    const trend = result.monthlyTrend ?? [];
    expect(trend).toHaveLength(6);
    expect(trend[5].month.toLowerCase()).toContain('nov');
    expect(trend[0].month.toLowerCase()).toContain('jun');
  });

  it('rolls last month and the trend over the year boundary in WIB', async () => {
    vi.useFakeTimers();
    // 15 January 2026 09:00 WIB (02:00Z).
    vi.setSystemTime(new Date('2026-01-15T02:00:00.000Z'));

    await getFinancialOverview();

    const december = monthWindows().find((w) => w.gte.toISOString() === '2025-11-30T17:00:00.000Z');
    expect(december).toBeTruthy();
    expect(december!.lte.toISOString()).toBe('2025-12-31T16:59:59.999Z');
  });
});
