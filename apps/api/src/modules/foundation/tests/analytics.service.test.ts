import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    journalEntry: { aggregate: vi.fn(), groupBy: vi.fn() },
    unit: { findMany: vi.fn(), count: vi.fn() },
    student: { groupBy: vi.fn(), count: vi.fn() },
    accountCode: { findMany: vi.fn() },
    userRoleAssignment: { count: vi.fn() },
    registrant: { count: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getExecutiveSummary, getFinancialOverview } from '../analytics.service';

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
  vi.mocked(prisma.unit.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.student.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.userRoleAssignment.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.registrant.count).mockResolvedValue(0 as never);
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

// The executive summary's student growth compares the active total now against
// the active total at the start of the current WIB calendar month. It used to
// count "students last month" with `new Date(); setMonth(getMonth() - 1)`, whose
// overflow landed the baseline in the *current* month on the 29th–31st (31 March
// → 3 March). It then based the baseline a whole month back, so `total - baseline`
// spanned TWO months: a month that added nobody still read positive because last
// month's additions were counted (#930 review). The baseline is the start of the
// current WIB month, which also rolls the year correctly.
const growthBaseline = () => {
  const calls = vi.mocked(prisma.student.count).mock.calls as Array<
    [{ where: { createdAt?: { lt: Date } } }]
  >;
  return calls.find((c) => c[0]?.where?.createdAt)![0].where.createdAt!.lt;
};

describe('getExecutiveSummary student growth baseline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is the start of the current WIB month on the 31st, not a day in this one', async () => {
    vi.useFakeTimers();
    // 31 March 2026 09:00 WIB (02:00Z) — the issue's reproduction instant.
    vi.setSystemTime(new Date('2026-03-31T02:00:00.000Z'));

    await getExecutiveSummary();

    expect(growthBaseline()?.toISOString()).toBe('2026-02-28T17:00:00.000Z');
  });

  it('rolls over the year boundary in WIB (1 January → start of January)', async () => {
    vi.useFakeTimers();
    // 31 January 2026 09:00 WIB (02:00Z).
    vi.setSystemTime(new Date('2026-01-31T02:00:00.000Z'));

    await getExecutiveSummary();

    expect(growthBaseline()?.toISOString()).toBe('2025-12-31T17:00:00.000Z');
  });

  it('uses the WIB month in the first hours of the 1st, not the previous UTC month', async () => {
    vi.useFakeTimers();
    // 1 April 2026 02:00 WIB (31 March 19:00Z) — WIB already April.
    vi.setSystemTime(new Date('2026-03-31T19:00:00.000Z'));

    await getExecutiveSummary();

    expect(growthBaseline()?.toISOString()).toBe('2026-03-31T17:00:00.000Z');
  });

  it('reads 0% for a month that added nobody, not last month’s additions', async () => {
    // The reviewer's case (#930 review): students joined last month, none this
    // month. A baseline one month back counts only those who were there BEFORE
    // last month (1 of the 3), so `total - baseline` read +200% — last month's
    // additions leaked in. With the baseline at the start of THIS month the count
    // is the whole 3 and the growth is 0%. The mock counts real createdAt
    // instants, so it discriminates the two baselines rather than restating one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T02:00:00.000Z')); // 15 March 2026 WIB
    const createdAt = [
      new Date('2025-06-01T00:00:00.000Z'), // long before last month
      new Date('2026-02-10T00:00:00.000Z'), // last month
      new Date('2026-02-20T00:00:00.000Z'), // last month
    ];
    vi.mocked(prisma.student.count).mockImplementation((async (args: never) => {
      const lt = (args as { where?: { createdAt?: { lt: Date } } })?.where?.createdAt?.lt;
      return lt ? createdAt.filter((d) => d < lt).length : createdAt.length;
    }) as never);

    const summary = await getExecutiveSummary();

    expect(summary.growth.students).toBe(0);
  });
});
