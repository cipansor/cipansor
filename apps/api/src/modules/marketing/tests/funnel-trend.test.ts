import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registrant: { groupBy: vi.fn() },
    payment: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getAdmissionFunnel, getMonthlyAttributedRevenue } from '../roi.service';

const mocked = prisma as any;

describe('getAdmissionFunnel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes cumulative reached counts and drop-offs', async () => {
    mocked.registrant.groupBy.mockResolvedValue([
      { status: 'REGISTERED', _count: 40 },
      { status: 'TEST_COMPLETED', _count: 25 },
      { status: 'ACCEPTED', _count: 20 },
      { status: 'ENROLLED', _count: 15 },
      { status: 'REJECTED', _count: 8 },
      { status: 'CANCELLED', _count: 2 },
    ]);

    const funnel = await getAdmissionFunnel('unit-1');

    // total active pipeline = 40+25+20+15 = 100
    expect(funnel.stages[0]).toMatchObject({
      stage: 'REGISTERED',
      reached: 100,
      conversionFromStart: 100,
    });
    const enrolled = funnel.stages.find((s) => s.stage === 'ENROLLED');
    expect(enrolled).toMatchObject({ reached: 15, conversionFromStart: 15 });
    const accepted = funnel.stages.find((s) => s.stage === 'ACCEPTED');
    expect(accepted).toMatchObject({ reached: 35 }); // 20 + 15
    expect(funnel.dropOff).toEqual({ rejected: 8, cancelled: 2 });

    expect(mocked.registrant.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { admissionPeriod: { unitId: 'unit-1' } },
      })
    );
  });

  it('handles an empty pipeline', async () => {
    mocked.registrant.groupBy.mockResolvedValue([]);
    const funnel = await getAdmissionFunnel();
    expect(funnel.stages.every((s) => s.reached === 0 && s.conversionFromStart === 0)).toBe(true);
  });
});

describe('getMonthlyAttributedRevenue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('buckets campaign-attributed payments per month with zero-filled series', async () => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    mocked.payment.findMany.mockResolvedValue([
      { paidAt: now, amount: 250000 },
      { paidAt: now, amount: 100000 },
    ]);

    const trend = await getMonthlyAttributedRevenue(undefined, 3);

    expect(trend).toHaveLength(3);
    const current = trend.find((t) => t.month === thisMonthKey);
    expect(current).toEqual({ month: thisMonthKey, revenue: 350000, transactionCount: 2 });
    // Older months exist but are zero
    expect(trend.filter((t) => t.month !== thisMonthKey).every((t) => t.revenue === 0)).toBe(true);

    // The campaign link hangs off the to-many `registrants` relation on
    // Student; a bare `registrant` is not a relation and Prisma rejects it.
    expect(mocked.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoice: { student: { registrants: { some: { campaignId: { not: null } } } } },
        }),
      })
    );
  });
});
