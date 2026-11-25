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

  it('rounds the total once so the wallet debit and the bill agree', async () => {
    const wallet = { id: 'wallet-1', balance: new MockDecimal(10000) };
    (prisma.laundryPricing.findFirst as any).mockResolvedValue({
      id: 'pricing-1',
      name: 'Regular',
      pricePerKg: new MockDecimal(6000.5),
      minWeight: new MockDecimal(1),
      processDays: 2,
      isActive: true,
    });
    (prisma.santriWallet.findUnique as any)
      .mockResolvedValueOnce(wallet)
      .mockResolvedValueOnce({ ...wallet, balance: new MockDecimal(2499.37) });
    (prisma.laundryTransaction.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'tx-1',
      transactionNo: 'LDR-20240101-0001',
      total: data.total,
    }));

    await transactionService.create(unitId, userId, {
      studentId,
      pricingId: 'pricing-1',
      weight: 1.25,
      paymentMethod: 'WALLET',
    } as any);

    const createData = (prisma.laundryTransaction.create as any).mock.calls[0][0].data;
    expect(createData.total.toString()).toBe('7500.63');

    const debit = (prisma.santriWallet.update as any).mock.calls[0][0].data;
    expect(debit.balance.toString()).toBe('2499.37');

    const walletEntry = (prisma.walletTransaction.create as any).mock.calls[0][0].data;
    expect(walletEntry.amount.toString()).toBe('7500.63');
  });

  it('refunds the rounded bill, restoring the exact opening balance', async () => {
    (prisma.laundryTransaction.findFirst as any).mockResolvedValue({
      id: 'tx-1',
      unitId,
      transactionNo: 'LDR-20240101-0001',
      status: 'RECEIVED',
      paymentStatus: 'PAID',
      walletId: 'wallet-1',
      total: new MockDecimal(7500.63),
    });
    (prisma.santriWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      balance: new MockDecimal(2499.37),
    });
    (prisma.journalEntry.findMany as any).mockResolvedValue([]);

    await transactionService.updateStatus(
      'tx-1',
      { sub: userId, roleCode: 'SMPIT_ADMIN', unitId },
      { status: 'CANCELLED' }
    );

    const refundUpdate = (prisma.santriWallet.update as any).mock.calls[0][0].data;
    expect(refundUpdate.balance.toString()).toBe('10000');

    const refundEntry = (prisma.walletTransaction.create as any).mock.calls[0][0].data;
    expect(refundEntry.amount.toString()).toBe('7500.63');
  });

  it('locks the transaction before reading it, so payment and cancellation serialise', async () => {
    for (const operation of [
      () =>
        transactionService.updateStatus(
          'tx-1',
          { sub: userId, roleCode: 'SMPIT_ADMIN', unitId },
          { status: 'CANCELLED' }
        ),
      () =>
        transactionService.processPayment(
          'tx-1',
          { sub: userId, roleCode: 'SMPIT_ADMIN', unitId },
          { paymentMethod: 'CASH' }
        ),
    ]) {
      const order: string[] = [];
      (prisma.$queryRaw as any).mockImplementation(async () => {
        order.push('lock');
        return [];
      });
      (prisma.laundryTransaction.findFirst as any).mockImplementation(async () => {
        order.push('read');
        return null;
      });

      await expect(operation()).rejects.toMatchObject({ statusCode: 404 });
      expect(order).toEqual(['lock', 'read']);
    }
  });

  it('rejects a wallet payment with 400 when the balance is short', async () => {
    (prisma.laundryTransaction.findFirst as any).mockResolvedValue({
      id: 'tx-1',
      unitId,
      studentId,
      transactionNo: 'LDR-20240101-0001',
      status: 'RECEIVED',
      paymentStatus: 'UNPAID',
      total: new MockDecimal(20000),
    });
    (prisma.santriWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      balance: new MockDecimal(5000),
    });

    await expect(
      transactionService.processPayment(
        'tx-1',
        { sub: userId, roleCode: 'SMPIT_ADMIN', unitId },
        { paymentMethod: 'WALLET' }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Saldo wallet tidak mencukupi'),
    });
    expect(prisma.santriWallet.update).not.toHaveBeenCalled();
  });

  it('records paidAt and debits exactly the stored bill', async () => {
    const total = new MockDecimal(20000);
    (prisma.laundryTransaction.findFirst as any).mockResolvedValue({
      id: 'tx-1',
      unitId,
      studentId,
      transactionNo: 'LDR-20240101-0001',
      status: 'RECEIVED',
      paymentStatus: 'UNPAID',
      total,
    });
    (prisma.santriWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      balance: new MockDecimal(50000),
    });
    (prisma.laundryTransaction.update as any).mockResolvedValue({
      id: 'tx-1',
      transactionNo: 'LDR-20240101-0001',
      total,
      businessUnitId: null,
    });

    await transactionService.processPayment(
      'tx-1',
      { sub: userId, roleCode: 'SMPIT_ADMIN', unitId },
      { paymentMethod: 'WALLET' }
    );

    const update = (prisma.laundryTransaction.update as any).mock.calls[0][0].data;
    expect(update.paymentStatus).toBe('PAID');
    expect(update.paidAt).toBeInstanceOf(Date);

    const debit = (prisma.santriWallet.update as any).mock.calls[0][0].data;
    expect(debit.balance.toString()).toBe('30000');

    const walletEntry = (prisma.walletTransaction.create as any).mock.calls[0][0].data;
    expect(walletEntry.amount.toString()).toBe('20000');
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

    await transactionService.updateStatus(
      transactionId,
      { sub: userId, roleCode: 'SMPIT_ADMIN', unitId },
      {
        status: 'CANCELLED',
        notes: 'Cancel test',
      }
    );

    // Verify reversing journal entries
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
  });
});
