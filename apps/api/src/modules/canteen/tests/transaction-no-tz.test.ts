import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { MockDecimal } = vi.hoisted(() => {
  const Decimal = function (this: any, v: any) {
    this.v = Number(v);
  } as any;
  Decimal.prototype.toNumber = function () {
    return this.v;
  };
  Decimal.prototype.toString = function () {
    return String(this.v);
  };
  Decimal.prototype.add = function (v2: any) {
    return new Decimal(this.v + (v2.v !== undefined ? v2.v : Number(v2)));
  };
  Decimal.prototype.sub = function (v2: any) {
    return new Decimal(this.v - (v2.v !== undefined ? v2.v : Number(v2)));
  };
  Decimal.prototype.mul = function (v2: any) {
    return new Decimal(this.v * (v2.v !== undefined ? v2.v : Number(v2)));
  };
  Decimal.prototype.greaterThan = function (v2: any) {
    return this.v > (v2.v !== undefined ? v2.v : Number(v2));
  };
  Decimal.prototype.lessThan = function (v2: any) {
    return this.v < (v2.v !== undefined ? v2.v : Number(v2));
  };
  return { MockDecimal: Decimal };
});

vi.mock('@prisma/client', () => ({ Prisma: { Decimal: MockDecimal } }));

import { transactionService } from '../canteen.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    canteenItem: { findMany: vi.fn(), update: vi.fn() },
    canteenTransaction: { create: vi.fn(), findFirst: vi.fn() },
    journalEntry: { create: vi.fn(), findMany: vi.fn() },
    santriWallet: { findUnique: vi.fn(), update: vi.fn() },
    walletTransaction: { create: vi.fn() },
    canteenStockMovement: { create: vi.fn() },
    financialPeriod: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));

vi.mock('../../finance/accounting-config.service', () => ({
  getAccountOrFallback: vi.fn().mockResolvedValue(null),
  ACCOUNT_MAPPING_KEYS: {
    CASH: 'CASH',
    INVENTORY_ASSET: 'INVENTORY_ASSET',
    SALES_REVENUE: 'SALES_REVENUE',
    COGS: 'COGS',
    WALLET_LIABILITY: 'WALLET_LIABILITY',
  },
}));

vi.mock('../../finance-enhancement/period.service', () => ({
  isPeriodOpen: vi.fn().mockResolvedValue(false),
}));

const RealDate = Date;

/** Freeze the clock so the service sees a UTC instant that is a different WIB day. */
function withUtcNow(iso: string, fn: () => Promise<void>) {
  const fixed = Date.parse(iso);
  class MockDate extends RealDate {
    constructor(...args: any[]) {
      // @ts-expect-error spread of the Date constructor's overloads
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  vi.stubGlobal('Date', MockDate);
  return fn();
}

describe('canteen transaction number follows the WIB calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'item-1' }]);
    (prisma.canteenItem.findMany as any).mockResolvedValue([
      {
        id: 'item-1',
        price: new MockDecimal(10000),
        costPrice: new MockDecimal(7000),
        stock: 10,
        name: 'Item 1',
      },
    ]);
    (prisma.canteenTransaction.findFirst as any).mockResolvedValue(null);
    (prisma.canteenTransaction.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'tx-1',
      ...data,
    }));
  });

  afterAll(() => vi.unstubAllGlobals());

  const input = {
    items: [{ itemId: 'item-1', quantity: 2 }],
    paymentMethod: 'CASH' as const,
    discount: 0,
  };

  it('numbers a 00:30 WIB sale with the WIB day, not the UTC day', async () => {
    await withUtcNow('2026-10-31T17:30:00Z', async () => {
      await transactionService.create('unit-1', 'cashier-1', input as any);
    });
    const created = (prisma.canteenTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('CNT-20261101-0001');
  });

  it('crosses the new year on the WIB calendar', async () => {
    await withUtcNow('2026-12-31T17:30:00Z', async () => {
      await transactionService.create('unit-1', 'cashier-1', input as any);
    });
    const created = (prisma.canteenTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('CNT-20270101-0001');
  });

  it('keys the advisory lock and the sequence query to the WIB day', async () => {
    (prisma.canteenTransaction.findFirst as any).mockResolvedValue({
      transactionNo: 'CNT-20261101-0003',
    });
    await withUtcNow('2026-10-31T17:30:00Z', async () => {
      await transactionService.create('unit-1', 'cashier-1', input as any);
    });

    // The advisory lock is keyed to the same WIB date the prefix is built from:
    // the tagged-template call records the interpolated date as an argument.
    const lockCall = (prisma.$queryRaw as any).mock.calls.find((c: any[]) =>
      c.includes('20261101')
    );
    expect(lockCall).toBeDefined();

    const where = (prisma.canteenTransaction.findFirst as any).mock.calls[0][0].where;
    expect(where.transactionNo.startsWith).toBe('CNT-20261101');

    const created = (prisma.canteenTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('CNT-20261101-0004');
  });
});
