import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  laundryTransaction: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { transactionService } from '../laundry.service';

const gteOfLastAggregate = () =>
  (prismaMock.laundryTransaction.aggregate.mock.calls.at(-1)![0] as any).where.createdAt.gte;

describe('laundry getStats bounds "today" on the WIB calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.laundryTransaction.aggregate.mockResolvedValue({
      _sum: { total: null, weight: null },
      _count: { id: 0 },
    });
    prismaMock.laundryTransaction.groupBy.mockResolvedValue([]);
    prismaMock.laundryTransaction.count.mockResolvedValue(0);
  });

  afterEach(() => vi.useRealTimers());

  it('starts the default window at WIB midnight, not UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z')); // 2026-11-01 00:30 WIB
    let stats;
    try {
      stats = await transactionService.getStats({ unitId: 'unit-1' });
    } finally {
      vi.useRealTimers();
    }

    expect(gteOfLastAggregate()).toEqual(new Date('2026-10-31T17:00:00.000Z'));
    expect(stats.period.startDate).toBe('2026-11-01');
    expect(stats.period.endDate).toBe('2026-11-01');
  });
});
