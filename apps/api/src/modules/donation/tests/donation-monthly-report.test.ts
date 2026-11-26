/**
 * The monthly donation report buckets by the WIB calendar year and month (#1176).
 *
 * `getMonthlyReport` used `new Date(year, 0, 1)` / `getMonth()`, which read the
 * host clock. The container runs UTC, so a donation made 00:00–06:59 WIB was
 * filed in the previous UTC month — and on 1 January, in the previous year.
 *
 * The clock is pinned to UTC here on purpose: on a developer machine set to
 * Asia/Jakarta the old code happened to be right, so a test that only relied on
 * the container's timezone would pass before the fix and prove nothing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  donation: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { donationService } from '../donation.service';
import { donationController } from '../donation.controller';

const previousTz = process.env.TZ;
process.env.TZ = 'UTC';

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const donations = [
  // 1 Mar 2026 05:00 WIB — still 28 Feb on the UTC clock.
  { amount: 1_000_000, type: 'INFAK', donatedAt: new Date('2026-03-01T05:00:00+07:00') },
  // 1 Jan 2026 03:00 WIB — still 31 Dec 2025 on the UTC clock.
  { amount: 2_000_000, type: 'WAKAF', donatedAt: new Date('2026-01-01T03:00:00+07:00') },
];

type DonatedAtFilter = { gte: Date; lt?: Date; lte?: Date };

/** Behave like the column filter the real query would run. */
function filterByDonatedAt({ where }: { where: { donatedAt: DonatedAtFilter } }) {
  const { gte, lt, lte } = where.donatedAt;
  return donations.filter(
    (d) => d.donatedAt >= gte && (lt ? d.donatedAt < lt : d.donatedAt <= lte!)
  );
}

describe('the monthly donation report follows the WIB calendar', () => {
  beforeEach(() => {
    prismaMock.donation.findMany.mockReset();
    prismaMock.donation.findMany.mockImplementation((args) =>
      Promise.resolve(filterByDonatedAt(args as { where: { donatedAt: DonatedAtFilter } }))
    );
  });

  it('bounds the year from 00:00 WIB on 1 January to 23:59:59.999 WIB on 31 December', async () => {
    await donationService.getMonthlyReport(2026);

    const { where } = prismaMock.donation.findMany.mock.calls[0][0] as {
      where: { donatedAt: DonatedAtFilter };
    };
    expect(where.donatedAt.gte.toISOString()).toBe('2025-12-31T17:00:00.000Z');
    expect(where.donatedAt.lte!.toISOString()).toBe('2026-12-31T16:59:59.999Z');
  });

  it('files a 1 January 03:00 WIB gift under January 2026', async () => {
    const report = await donationService.getMonthlyReport(2026);

    expect(report.months).toHaveLength(12);
    expect(report.months[0]).toMatchObject({ month: 1, monthName: 'Januari', total: 2_000_000 });
    expect(report.months[0].byType).toEqual({ WAKAF: 2_000_000 });
  });

  it('files a 1 March 05:00 WIB gift under March, not February', async () => {
    const report = await donationService.getMonthlyReport(2026);

    expect(report.months[2]).toMatchObject({ month: 3, monthName: 'Maret', total: 1_000_000 });
    expect(report.months[1].total).toBe(0);
  });

  it('counts both gifts in the 2026 total', async () => {
    const report = await donationService.getMonthlyReport(2026);
    expect(report.yearTotal).toBe(3_000_000);
  });

  it('leaves the 1 January gift out of 2025', async () => {
    const report = await donationService.getMonthlyReport(2025);
    expect(report.yearTotal).toBe(0);
    expect(report.months.every((m) => m.total === 0)).toBe(true);
  });
});

describe('the default report year is the running WIB year', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serves 2026 at 1 January 02:00 WIB, while the UTC clock still reads 2025', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T02:00:00+07:00')); // = 2025-12-31T19:00Z

    const spy = vi.spyOn(donationService, 'getMonthlyReport').mockResolvedValue({
      year: 2026,
      months: [],
      yearTotal: 0,
    } as never);
    const res = { json: vi.fn() };
    const next = vi.fn();

    await donationController.getMonthlyReport({ query: {} } as never, res as never, next);

    expect(spy).toHaveBeenCalledWith(2026);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
