import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@prisma/client', () => ({ Prisma: { Decimal: class {} } }));

const prismaMock = vi.hoisted(() => ({
  canteenTransaction: {
    aggregate: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  canteenTransactionItem: {
    groupBy: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('../../finance/accounting-config.service', () => ({
  getAccountOrFallback: vi.fn(),
  ACCOUNT_MAPPING_KEYS: {},
}));

vi.mock('../../finance-enhancement/period.service', () => ({
  isPeriodOpen: vi.fn().mockResolvedValue(true),
}));

import { transactionService } from '../canteen.service';

/** Freeze the clock at a UTC instant whose WIB calendar day differs. */
async function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  try {
    return await transactionService.getStats('unit-1');
  } finally {
    vi.useRealTimers();
  }
}

const gteOfLastAggregate = () =>
  (prismaMock.canteenTransaction.aggregate.mock.calls.at(-1)![0] as any).where.createdAt.gte;

describe('canteen getStats bounds "today" on the WIB calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.canteenTransaction.aggregate.mockResolvedValue({
      _sum: { total: null },
      _count: { id: 0 },
    });
    prismaMock.canteenTransaction.count.mockResolvedValue(0);
    prismaMock.canteenTransaction.groupBy.mockResolvedValue([]);
    prismaMock.canteenTransactionItem.groupBy.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it('starts the default window at WIB midnight, not UTC midnight', async () => {
    // 2026-10-31T17:30Z is 2026-11-01 00:30 WIB.
    const stats = await at('2026-10-31T17:30:00.000Z');

    expect(gteOfLastAggregate()).toEqual(new Date('2026-10-31T17:00:00.000Z'));
    expect(stats.period.startDate).toBe('2026-11-01');
    expect(stats.period.endDate).toBe('2026-11-01');
  });

  it('still uses the WIB day late in the UTC evening', async () => {
    // 2026-10-31T16:30Z is 2026-10-31 23:30 WIB — still the 31st in WIB.
    const stats = await at('2026-10-31T16:30:00.000Z');

    expect(gteOfLastAggregate()).toEqual(new Date('2026-10-30T17:00:00.000Z'));
    expect(stats.period.startDate).toBe('2026-10-31');
  });

  it('leaves an explicit date range untouched', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z'));
    try {
      await transactionService.getStats('unit-1', '2026-10-01', '2026-10-31');
    } finally {
      vi.useRealTimers();
    }

    expect(gteOfLastAggregate()).toEqual(new Date('2026-10-01'));
    expect(
      prismaMock.canteenTransaction.aggregate.mock.calls.at(-1)![0].where.createdAt.lte
    ).toEqual(new Date('2026-10-31T23:59:59.999Z'));
  });
});
