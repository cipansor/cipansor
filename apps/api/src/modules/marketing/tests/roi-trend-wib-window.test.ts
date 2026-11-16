import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { payment: { findMany: vi.fn() }, registrant: { findMany: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { getMonthlyAttributedRevenue } from '../roi.service';

const mocked = prisma as any;

/**
 * The window and its buckets follow the WIB calendar (Asia/Jakarta, UTC+7), not
 * the host clock. The API container runs UTC, so `setMonth`/`getMonth` on the
 * raw date scrolled the window on the 29th–31st and filed a payment made in the
 * first seven hours of a WIB month under the previous one (#1086).
 */
describe('getMonthlyAttributedRevenue — WIB window and buckets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.payment.findMany.mockResolvedValue([]);
    mocked.registrant.findMany.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('run on the 31st: the 6-month window starts 5 months back, not overflowed', async () => {
    vi.setSystemTime(new Date('2026-07-31T02:00:00.000Z')); // 2026-07-31 09:00 WIB
    const trend = await getMonthlyAttributedRevenue(undefined, 6);
    expect(trend.map((t) => t.month)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
  });

  it('buckets a payment by the WIB month it was paid in, not the previous UTC month', async () => {
    vi.setSystemTime(new Date('2026-08-15T02:00:00.000Z')); // window 2026-03 … 2026-08
    // 2026-08-01 01:00 WIB = 2026-07-31T18:00Z — UTC July, WIB August.
    mocked.payment.findMany.mockResolvedValue([
      { paidAt: new Date('2026-07-31T18:00:00.000Z'), amount: 100000, invoice: null },
    ]);
    const trend = await getMonthlyAttributedRevenue(undefined, 6);
    expect(trend.find((t) => t.month === '2026-08')?.revenue).toBe(100000);
    expect(trend.find((t) => t.month === '2026-07')?.revenue).toBe(0);
  });

  it('does not drop a payment in the first seven hours of the window’s first WIB month', async () => {
    vi.setSystemTime(new Date('2026-08-15T02:00:00.000Z')); // window 2026-03 … 2026-08
    // 2026-03-01 01:00 WIB = 2026-02-28T18:00Z — inside the window’s first WIB month.
    mocked.payment.findMany.mockResolvedValue([
      { paidAt: new Date('2026-02-28T18:00:00.000Z'), amount: 50000, invoice: null },
    ]);
    const trend = await getMonthlyAttributedRevenue(undefined, 6);
    expect(trend.find((t) => t.month === '2026-03')?.revenue).toBe(50000);
  });

  it('queries from the WIB month start, not UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-08-15T02:00:00.000Z')); // window 2026-03 … 2026-08
    // 2026-03-01 00:00 WIB = 2026-02-28T17:00Z. A UTC-midnight bound
    // (2026-03-01T00:00Z) would drop the first seven WIB hours of the month, but
    // `mockResolvedValue` ignores the filter, so the bucket tests above cannot
    // see it — the bound itself must be asserted.
    const monthStart = new Date('2026-02-28T17:00:00.000Z');
    await getMonthlyAttributedRevenue(undefined, 6);
    expect(mocked.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paidAt: { gte: monthStart } }),
      })
    );
    expect(mocked.registrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ registrationFeePaidAt: { gte: monthStart } }),
      })
    );
  });
});
