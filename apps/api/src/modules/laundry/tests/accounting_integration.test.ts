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

vi.mock('@prisma/client', async (importOriginal) => ({
  // The real enums: the read scope recognises roles by RoleCode.
  RoleCode: (await importOriginal<typeof import('@prisma/client')>()).RoleCode,
  Prisma: {
    Decimal: MockDecimal,
  },
}));

import { transactionService } from '../laundry.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    laundryPricing: { findFirst: vi.fn() },
    santriWallet: { findUnique: vi.fn(), update: vi.fn() },
    laundryTransaction: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    walletTransaction: { create: vi.fn() },
    journalEntry: { create: vi.fn(), findMany: vi.fn() },
    laundryStatusLog: { create: vi.fn() },
    financialPeriod: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));

vi.mock('../../finance/accounting-config.service', () => ({
  getAccountOrFallback: vi.fn().mockResolvedValue({ id: 'acc-1' }),
  ACCOUNT_MAPPING_KEYS: {
    CASH: 'CASH',
    WALLET_LIABILITY: 'WALLET_LIABILITY',
    LAUNDRY_REVENUE: 'LAUNDRY_REVENUE',
  },
}));

vi.mock('../../finance-enhancement/period.service', () => ({
  isPeriodOpen: vi.fn().mockResolvedValue(true),
}));

describe('Laundry Accounting Integration', () => {
  const unitId = 'unit-1';
  const userId = 'user-1';
  const studentId = 'student-1';

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.laundryTransaction.findFirst as any).mockResolvedValue(null);
    (prisma.$queryRaw as any).mockResolvedValue([]);
  });

  it('should create journal entries when a laundry transaction is paid via WALLET', async () => {
    const pricingId = 'pricing-1';
    const mockPricing = {
      id: pricingId,
      name: 'Regular',
      pricePerKg: new MockDecimal(10000),
      minWeight: new MockDecimal(1),
      processDays: 2,
      isActive: true,
    };

    (prisma.laundryPricing.findFirst as any).mockResolvedValue(mockPricing);
    (prisma.santriWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      balance: new MockDecimal(50000),
    });

    (prisma.laundryTransaction.create as any).mockResolvedValue({
      id: 'tx-1',
      transactionNo: 'LDR-20240101-0001',
      total: new MockDecimal(20000),
    });

    const input = {
      studentId,
      pricingId,
      weight: 2,
      paymentMethod: 'WALLET' as const,
      items: [{ itemType: 'Shirt', quantity: 5 }],
    };

    await transactionService.create(unitId, userId, input as any);

    // Verify journal entries
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
  });

  it('should reverse journal entries when a paid laundry transaction is CANCELLED', async () => {
    const transactionId = 'tx-1';
    const mockTransaction = {
      id: transactionId,
      unitId,
      transactionNo: 'LDR-20240101-0001',
      status: 'RECEIVED',
      paymentStatus: 'PAID',
      walletId: 'wallet-1',
      total: new MockDecimal(20000),
    };

    (prisma.laundryTransaction.findFirst as any).mockResolvedValue(mockTransaction);
    (prisma.santriWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      balance: new MockDecimal(30000),
    });

    // Mock existing journal entries
    (prisma.journalEntry.findMany as any).mockResolvedValue([
      {
        accountId: 'acc-wallet',
        debit: new MockDecimal(20000),
        credit: new MockDecimal(0),
        description: 'Pendapatan Laundry',
      },
      {
        accountId: 'acc-revenue',
        debit: new MockDecimal(0),
        credit: new MockDecimal(20000),
        description: 'Pendapatan Laundry',
      },
    ]);

    await transactionService.updateStatus(transactionId, unitId, userId, {
      status: 'CANCELLED',
      notes: 'Cancel test',
    });

    // Verify reversing journal entries
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
  });
});
