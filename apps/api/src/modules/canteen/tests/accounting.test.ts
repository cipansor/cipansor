import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  Decimal.prototype.mul = function (v2: any) {
    return new Decimal(this.v * (v2.v !== undefined ? v2.v : Number(v2)));
  };
  Decimal.prototype.sub = function (v2: any) {
    return new Decimal(this.v - (v2.v !== undefined ? v2.v : Number(v2)));
  };
  Decimal.prototype.div = function (v2: any) {
    return new Decimal(this.v / (v2.v !== undefined ? v2.v : Number(v2)));
  };
  Decimal.prototype.greaterThan = function (v2: any) {
    return this.v > (v2.v !== undefined ? v2.v : Number(v2));
  };
  Decimal.prototype.gt = function (v2: any) {
    return this.v > (v2.v !== undefined ? v2.v : Number(v2));
  };
  Decimal.prototype.lessThan = function (v2: any) {
    return this.v < (v2.v !== undefined ? v2.v : Number(v2));
  };
  Decimal.prototype.lt = function (v2: any) {
    return this.v < (v2.v !== undefined ? v2.v : Number(v2));
  };
  Decimal.prototype.toFixed = function (n: number) {
    return this.v.toFixed(n);
  };

  return { MockDecimal: Decimal };
});

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return {
    ...actual,
    Prisma: { ...actual.Prisma, Decimal: MockDecimal },
  };
});

import { transactionService } from '../canteen.service';
import { prisma } from '@/lib/prisma';
import { JournalReferenceType } from '@cipansor/shared';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    canteenItem: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    canteenTransaction: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    journalEntry: {
      create: vi.fn(),
    },
    santriWallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    walletTransaction: {
      create: vi.fn(),
    },
    canteenStockMovement: {
      create: vi.fn(),
    },
    financialPeriod: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));

vi.mock('../../finance/accounting-config.service', () => ({
  getAccountOrFallback: vi.fn().mockResolvedValue({ id: 'acc-1' }),
  ACCOUNT_MAPPING_KEYS: {
    CASH: 'CASH',
    INVENTORY_ASSET: 'INVENTORY_ASSET',
    CANTEEN_REVENUE: 'CANTEEN_REVENUE',
    CANTEEN_COGS: 'CANTEEN_COGS',
  },
}));

describe('Canteen Transaction Accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'item-1' }]);
    (prisma.financialPeriod.findFirst as any).mockResolvedValue({ status: 'OPEN' });
  });

  it('should create journal entries on transaction', async () => {
    const mockItems = [
      {
        id: 'item-1',
        price: new MockDecimal(10000),
        costPrice: new MockDecimal(7000),
        stock: 10,
        name: 'Item 1',
      },
    ];
    (prisma.canteenItem.findMany as any).mockResolvedValue(mockItems);
    (prisma.canteenTransaction.create as any).mockResolvedValue({
      id: 'tx-1',
      transactionNo: 'TX-001',
    });

    await transactionService.create('unit-1', 'cashier-1', {
      items: [{ itemId: 'item-1', quantity: 2 }],
      paymentMethod: 'CASH',
      discount: 0,
    });

    // 2 Revenue journals (Debit Cash, Credit Revenue) + 2 COGS journals (Debit COGS, Credit Inventory)
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(4);
  });
});
