import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { getAccountOrFallback } from '../../finance/accounting-config.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    laundryPricing: { findFirst: vi.fn() },
    businessUnit: { findFirst: vi.fn() },
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

  afterEach(() => {
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));
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

  it('derives the business unit from the pricing tier, never from the caller', async () => {
    (prisma.laundryPricing.findFirst as any).mockResolvedValue({
      id: 'pricing-1',
      name: 'Regular',
      pricePerKg: new MockDecimal(10000),
      minWeight: new MockDecimal(1),
      processDays: 2,
      isActive: true,
      businessUnitId: 'bu-1',
    });
    (prisma.santriWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      balance: new MockDecimal(50000),
    });
    (prisma.businessUnit.findFirst as any).mockResolvedValue({ id: 'bu-1' });
    (prisma.laundryTransaction.create as any).mockResolvedValue({
      id: 'tx-1',
      transactionNo: 'LDR-20240101-0001',
      total: new MockDecimal(20000),
    });

    await transactionService.create(unitId, userId, {
      studentId,
      pricingId: 'pricing-1',
      weight: 2,
      paymentMethod: 'WALLET',
      items: [{ itemType: 'Shirt', quantity: 5 }],
      // A caller-supplied id is ignored: only the tier chooses the unit.
      businessUnitId: 'bu-other',
    } as any);

    expect(prisma.laundryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessUnit: { connect: { id: 'bu-1' } },
        }),
      })
    );
    expect(prisma.businessUnit.findFirst).toHaveBeenCalledWith({
      where: { id: 'bu-1', unitId },
      select: { id: true },
    });
    expect(getAccountOrFallback).toHaveBeenCalledWith(
      unitId,
      ['BU_bu-1_LAUNDRY_REVENUE', 'LAUNDRY_REVENUE'],
      '4102',
      'Pendapatan Laundry',
      prisma
    );
  });

  it('refuses a pricing tier whose business unit belongs to another unit', async () => {
    (prisma.laundryPricing.findFirst as any).mockResolvedValue({
      id: 'pricing-1',
      name: 'Regular',
      pricePerKg: new MockDecimal(10000),
      minWeight: new MockDecimal(1),
      processDays: 2,
      isActive: true,
      businessUnitId: 'bu-other',
    });
    (prisma.businessUnit.findFirst as any).mockResolvedValue(null);

    await expect(
      transactionService.create(unitId, userId, {
        studentId,
        pricingId: 'pricing-1',
        weight: 2,
        paymentMethod: 'CASH',
        items: [{ itemType: 'Shirt', quantity: 5 }],
      } as any)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Unit usaha tarif tidak ditemukan'),
    });
    expect(prisma.laundryTransaction.create).not.toHaveBeenCalled();
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

  it('checks reach before locking, then locks before re-reading the row', async () => {
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
      let reads = 0;
      (prisma.$queryRaw as any).mockImplementation(async () => {
        order.push('lock');
        return [];
      });
      (prisma.laundryTransaction.findFirst as any).mockImplementation(async () => {
        reads += 1;
        if (reads === 1) {
          order.push('reach');
          return { unitId };
        }
        order.push('read');
        return null;
      });

      await expect(operation()).rejects.toMatchObject({ statusCode: 404 });
      expect(order).toEqual(['reach', 'lock', 'read']);
    }
  });

  it('does not lock a row outside the actor unit', async () => {
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
      (prisma.laundryTransaction.findFirst as any).mockResolvedValue({
        unitId: 'unit-other',
      });

      await expect(operation()).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    }
  });

  it('restores the wallet and leaves one refund when cancellation meets an in-flight payment', async () => {
    const state = {
      tx: {
        id: 'tx-1',
        unitId,
        studentId,
        transactionNo: 'LDR-20240101-0001',
        status: 'RECEIVED',
        paymentStatus: 'UNPAID',
        paymentMethod: 'PENDING',
        walletId: null as string | null,
        total: new MockDecimal(20000),
      },
      wallet: { id: 'wallet-1', balance: new MockDecimal(50000) },
      walletEntries: [] as Array<{ type: string; amount: { toString(): string } }>,
    };

    // The mock row lock serialises only at `$queryRaw`, as Postgres does. The
    // two transaction callbacks run concurrently; the payment is held just
    // before its write so the cancellation reaches the lock first. Without the
    // lock the cancellation would read UNPAID and skip the refund.
    let releaseLock: (() => void) | undefined;
    let locked: Promise<void> = Promise.resolve();
    const acquireLock = () => {
      let release!: () => void;
      const previous = locked;
      locked = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous.then(() => release);
    };
    let lockAttempts = 0;
    let cancellationWaiting!: () => void;
    const cancellationAtLock = new Promise<void>((resolve) => {
      cancellationWaiting = resolve;
    });
    let paymentAtWrite!: () => void;
    const paymentReachedWrite = new Promise<void>((resolve) => {
      paymentAtWrite = resolve;
    });
    let releasePaymentWrite: () => void = () => {};
    const paymentWriteGate = new Promise<void>((resolve) => {
      releasePaymentWrite = resolve;
    });

    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      try {
        return await cb(prisma);
      } finally {
        releaseLock?.();
        releaseLock = undefined;
      }
    });
    const lockQueries: string[] = [];
    (prisma.$queryRaw as any).mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      lockQueries.push(sql);
      // Only a real `FOR UPDATE` locks. A query without it must not make
      // this test pass, or the test would not notice the clause going away.
      if (!/\bFOR\s+UPDATE\b/i.test(sql)) return [];
      lockAttempts += 1;
      if (lockAttempts === 2) cancellationWaiting();
      const release = await acquireLock();
      releaseLock = release;
      return [];
    });
    (prisma.laundryTransaction.findFirst as any).mockImplementation(async () => state.tx);
    (prisma.laundryTransaction.update as any).mockImplementation(async ({ data }: any) => {
      if (data.paymentStatus === 'PAID') {
        paymentAtWrite();
        await paymentWriteGate;
      }
      state.tx = { ...state.tx, ...data };
      return state.tx;
    });
    (prisma.santriWallet.findUnique as any).mockImplementation(async () => state.wallet);
    (prisma.santriWallet.update as any).mockImplementation(async ({ data }: any) => {
      state.wallet = { ...state.wallet, balance: data.balance };
      return state.wallet;
    });
    (prisma.walletTransaction.create as any).mockImplementation(async ({ data }: any) => {
      state.walletEntries.push({ type: data.type, amount: data.amount });
      return data;
    });
    (prisma.journalEntry.findMany as any).mockResolvedValue([]);

    const actor = { sub: userId, roleCode: 'SMPIT_ADMIN', unitId };
    const payment = transactionService.processPayment('tx-1', actor, {
      paymentMethod: 'WALLET',
    });
    await paymentReachedWrite;

    const cancellation = transactionService.updateStatus('tx-1', actor, {
      status: 'CANCELLED',
    });
    // Wait for the cancellation to reach the lock. If the service stopped
    // taking it, let the test proceed to its assertions instead of timing out.
    await Promise.race([cancellationAtLock, new Promise((resolve) => setTimeout(resolve, 100))]);
    releasePaymentWrite();

    await expect(Promise.all([payment, cancellation])).resolves.toHaveLength(2);
    expect(lockQueries).toHaveLength(2);
    for (const sql of lockQueries) {
      expect(sql).toMatch(/laundry_transactions/i);
      expect(sql).toMatch(/\bFOR\s+UPDATE\b/i);
    }
    expect(state.tx.status).toBe('CANCELLED');
    expect(state.tx.paymentStatus).toBe('REFUNDED');
    expect(state.wallet.balance.toString()).toBe('50000');
    expect(state.walletEntries.map((entry) => entry.type)).toEqual(['PURCHASE', 'REFUND']);
    expect(state.walletEntries.map((entry) => entry.amount.toString())).toEqual(['20000', '20000']);
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
