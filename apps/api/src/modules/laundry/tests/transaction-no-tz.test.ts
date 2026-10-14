import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// The service imports `Prisma` from `@prisma/client`; only `Prisma.Decimal` is
// reached on this path, so the real client (which needs a generated engine) is
// not loaded.
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
  Decimal.prototype.lessThan = function (v2: any) {
    return this.v < (v2.v !== undefined ? v2.v : Number(v2));
  };
  return { MockDecimal: Decimal };
});

vi.mock('@prisma/client', async (importOriginal) => ({
  // The real enums: the read scope recognises roles by RoleCode.
  RoleCode: (await importOriginal<typeof import('@prisma/client')>()).RoleCode,
  Prisma: { Decimal: MockDecimal },
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
  getAccountOrFallback: vi.fn().mockResolvedValue(null),
  ACCOUNT_MAPPING_KEYS: {
    CASH: 'CASH',
    WALLET_LIABILITY: 'WALLET_LIABILITY',
    LAUNDRY_REVENUE: 'LAUNDRY_REVENUE',
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

describe('laundry transaction number follows the WIB calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.laundryPricing.findFirst as any).mockResolvedValue({
      id: 'pricing-1',
      name: 'Regular',
      pricePerKg: new MockDecimal(10000),
      minWeight: new MockDecimal(1),
      processDays: 2,
      isActive: true,
    });
    (prisma.laundryTransaction.findFirst as any).mockResolvedValue(null);
    (prisma.laundryTransaction.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'tx-1',
      ...data,
    }));
  });

  afterAll(() => vi.unstubAllGlobals());

  const input = {
    studentId: 'student-1',
    pricingId: 'pricing-1',
    weight: 2,
    paymentMethod: 'CASH' as const,
    items: [{ itemType: 'Shirt', quantity: 5 }],
  };

  it('numbers a 00:30 WIB transaction with the WIB day, not the UTC day', async () => {
    await withUtcNow('2026-10-31T17:30:00Z', async () => {
      await transactionService.create('unit-1', 'user-1', input as any);
    });
    const created = (prisma.laundryTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('LDR-20261101-0001');
  });

  it('crosses the new year on the WIB calendar', async () => {
    await withUtcNow('2026-12-31T17:30:00Z', async () => {
      await transactionService.create('unit-1', 'user-1', input as any);
    });
    const created = (prisma.laundryTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('LDR-20270101-0001');
  });

  it('keeps the WIB day for an ordinary afternoon transaction', async () => {
    await withUtcNow('2026-06-15T05:00:00Z', async () => {
      await transactionService.create('unit-1', 'user-1', input as any);
    });
    const created = (prisma.laundryTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('LDR-20260615-0001');
  });

  it('continues the sequence within the WIB day', async () => {
    (prisma.laundryTransaction.findFirst as any).mockResolvedValue({
      transactionNo: 'LDR-20261101-0007',
    });
    await withUtcNow('2026-10-31T17:30:00Z', async () => {
      await transactionService.create('unit-1', 'user-1', input as any);
    });
    const created = (prisma.laundryTransaction.create as any).mock.calls[0][0].data;
    expect(created.transactionNo).toBe('LDR-20261101-0008');
  });
});
