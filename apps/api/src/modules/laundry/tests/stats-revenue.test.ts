import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The income card is money received, not money billed (#1010 review). A Bayar
 * Nanti order is `UNPAID` and still belongs to the period's transactions and
 * weight; only a `PAID` one may raise `totalRevenue`.
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.laundryTransaction.groupBy.mockResolvedValue([]);
  prismaMock.laundryTransaction.count.mockResolvedValue(0);
});

describe('laundry stats — revenue excludes unpaid orders', () => {
  it('sums only PAID totals, while unpaid orders stay in transactions and weight', async () => {
    prismaMock.laundryTransaction.aggregate
      .mockResolvedValueOnce({
        _sum: { weight: { toNumber: () => 4 } },
        _count: { id: 2 },
      })
      .mockResolvedValueOnce({
        _sum: { total: { toNumber: () => 20000 } },
      });

    const stats = await transactionService.getStats({ unitId: 'unit-smp' });

    expect(stats.summary).toMatchObject({
      totalRevenue: 20000,
      totalWeight: 4,
      totalTransactions: 2,
    });

    const periodWhere = prismaMock.laundryTransaction.aggregate.mock.calls[0][0].where;
    expect(periodWhere).not.toHaveProperty('paymentStatus');

    const revenueWhere = prismaMock.laundryTransaction.aggregate.mock.calls[1][0].where;
    expect(revenueWhere).toMatchObject({
      unitId: 'unit-smp',
      status: { not: 'CANCELLED' },
      paymentStatus: 'PAID',
    });
  });

  it('reports zero revenue when no order was paid', async () => {
    prismaMock.laundryTransaction.aggregate
      .mockResolvedValueOnce({
        _sum: { weight: { toNumber: () => 1.5 } },
        _count: { id: 1 },
      })
      .mockResolvedValueOnce({ _sum: { total: null } });

    const stats = await transactionService.getStats({ unitId: 'unit-smp' });

    expect(stats.summary.totalRevenue).toBe(0);
    expect(stats.summary.totalTransactions).toBe(1);
  });
});
