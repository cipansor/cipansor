import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The laundry stats cards bound `LaundryTransaction.createdAt` (a real instant)
 * by WIB calendar days (#896). On the UTC container `setHours(0, 0, 0, 0)` is
 * UTC midnight, 07:00 WIB, so every order taken between 00:00 and 06:59 WIB
 * was counted with yesterday's figures; and `new Date('YYYY-MM-DD')` read a
 * chosen range seven hours late at both ends.
 */

const prismaMock = vi.hoisted(() => ({
  laundryTransaction: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { transactionService } from '../laundry.service';

const prevTz = process.env.TZ;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'UTC';
  vi.useFakeTimers({ toFake: ['Date'] });
  prismaMock.laundryTransaction.aggregate.mockResolvedValue({
    _sum: { total: null, weight: null },
    _count: { id: 0 },
  });
  prismaMock.laundryTransaction.groupBy.mockResolvedValue([]);
  prismaMock.laundryTransaction.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

const periodWhere = () => prismaMock.laundryTransaction.aggregate.mock.calls[0][0].where.createdAt;

describe('laundry stats on the WIB day', () => {
  it('opens "today" at 00:00 WIB, so a 05:00 WIB order counts today', async () => {
    vi.setSystemTime(new Date('2026-10-31T22:00:00.000Z')); // 1 Nov 2026 05:00 WIB

    const stats = await transactionService.getStats({ unitId: 'u' });

    expect(periodWhere().gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(stats.period).toEqual({ startDate: '2026-11-01', endDate: '2026-11-01' });
  });

  it('bounds a chosen range from 00:00 WIB of the first day to 23:59:59.999 WIB of the last', async () => {
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));

    await transactionService.getStats({ unitId: 'u' }, '2026-11-01', '2026-11-30');

    expect(periodWhere().gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(periodWhere().lte.toISOString()).toBe('2026-11-30T16:59:59.999Z');
  });
});
