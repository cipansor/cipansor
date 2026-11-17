import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * Cakupan tulis dan baca modul keuangan (#988, PR-02 dari #1023).
 *
 * Setiap endpoint yang menerima id dari URL menjawab 404 — bentuk yang sama
 * dengan id yang tidak ada — ketika barisnya milik unit lain, dan tidak menulis
 * apa pun. Empat lapis: route guard, cakupan tulis (WriteActor dari token),
 * cakupan baca (ScopeActor), lalu query-nya sendiri.
 */

vi.mock('../../../lib/prisma', () => {
  const mockPrisma = {
    invoice: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    payment: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    journalEntry: { create: vi.fn() },
    unit: { findUnique: vi.fn() },
    student: { findFirst: vi.fn() },
    studentUnitIdentifier: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));
  return { prisma: mockPrisma };
});
vi.mock('../../notifications/notifications.service', () => ({
  createNotification: vi.fn().mockResolvedValue({}),
}));
vi.mock('../accounting-config.service', () => ({
  ACCOUNT_MAPPING_KEYS: { BANK: 'BANK', CASH: 'CASH' },
  getAccountOrFallback: vi.fn().mockResolvedValue({ id: 'akun-kas' }),
}));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));

import { prisma } from '../../../lib/prisma';
import {
  createPayment,
  getStudentFinanceSummary,
  getStudentOutstandingBalances,
  updateInvoice,
} from '../finance.service';

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const SD = 'unit-sd';
const SMP = 'unit-smp';

const adminSd = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: SD };
const superAdmin = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };

/** SPP SMP IT: tagihan milik unit SMP. */
const tagihanSmp = {
  id: 'inv-smp',
  studentId: 's1',
  invoiceNumber: 'INV-SMP-2026-0001',
  amount: new Prisma.Decimal(350000),
  paidAmount: new Prisma.Decimal(0),
  status: 'PENDING',
  dueDate: new Date('2026-06-10'),
  student: { id: 's1', unitId: SMP, user: { name: 'Fulan' } },
  paymentType: { id: 'pt-spp-smp', name: 'SPP', accountId: 'akun-smp', unitId: SMP },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.unit.findUnique.mockResolvedValue({ id: SD, name: 'SD IT Cipansor' });
  db.studentUnitIdentifier.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.mocked(db.invoice.findUnique).mockReset();
});

describe('updateInvoice menolak tagihan unit lain', () => {
  it('tagihan unit lain dijawab 404 dan tidak ada baris yang diubah', async () => {
    db.invoice.findUnique.mockResolvedValue({
      id: 'inv-smp',
      paymentType: { unitId: SMP },
    });

    await expect(updateInvoice(adminSd, 'inv-smp', { amount: 1 })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it('id yang tidak ada dijawab 404 yang sama', async () => {
    db.invoice.findUnique.mockResolvedValue(null);

    await expect(updateInvoice(adminSd, 'tidak-ada', { amount: 1 })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it('tagihan unit sendiri boleh diubah', async () => {
    db.invoice.findUnique.mockResolvedValue({ id: 'inv-sd', paymentType: { unitId: SD } });
    db.invoice.update.mockResolvedValue({ id: 'inv-sd' });

    await updateInvoice(adminSd, 'inv-sd', { amount: 1000 });

    expect(db.invoice.update).toHaveBeenCalledTimes(1);
  });

  it('Super_Admin menulis unit mana pun', async () => {
    db.invoice.findUnique.mockResolvedValue({ id: 'inv-smp', paymentType: { unitId: SMP } });
    db.invoice.update.mockResolvedValue({ id: 'inv-smp' });

    await updateInvoice(superAdmin, 'inv-smp', { amount: 1000 });

    expect(db.invoice.update).toHaveBeenCalledTimes(1);
  });
});

describe('createPayment menolak tagihan unit lain', () => {
  it('tidak ada pembayaran maupun jurnal yang ditulis untuk tagihan unit lain', async () => {
    db.invoice.findUnique.mockResolvedValue(tagihanSmp);

    await expect(
      createPayment(adminSd, { invoiceId: 'inv-smp', amount: 350000, method: 'CASH' } as never)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(db.payment.create).not.toHaveBeenCalled();
    expect(db.journalEntry.create).not.toHaveBeenCalled();
    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it('tagihan unit sendiri dicatat, jurnal di unit tagihan', async () => {
    db.invoice.findUnique.mockResolvedValue({
      ...tagihanSmp,
      id: 'inv-sd',
      paymentType: { ...tagihanSmp.paymentType, unitId: SD },
    });
    db.payment.create.mockResolvedValue({
      id: 'pay-1',
      amount: new Prisma.Decimal(350000),
      method: 'CASH',
      invoiceId: 'inv-sd',
      paidAt: new Date(),
      invoice: { ...tagihanSmp, paymentType: { ...tagihanSmp.paymentType, unitId: SD } },
    });
    db.invoice.update.mockResolvedValue({ id: 'inv-sd' });

    await createPayment(adminSd, { invoiceId: 'inv-sd', amount: 350000, method: 'CASH' } as never);

    expect(db.payment.create).toHaveBeenCalledTimes(1);
    const unitJurnal = db.journalEntry.create.mock.calls.map(([arg]) => arg.data.unitId);
    expect(unitJurnal).toEqual([SD, SD]);
  });
});

describe('getStudentFinanceSummary hanya untuk santri dalam cakupan', () => {
  it('santri unit lain dijawab 404 dan tidak ada tagihan yang dibaca', async () => {
    db.student.findFirst.mockResolvedValue(null);

    await expect(getStudentFinanceSummary('s-lain', adminSd)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it('santri dalam cakupan mengembalikan ringkasan', async () => {
    db.student.findFirst.mockResolvedValue({ id: 's1' });
    db.invoice.findMany.mockResolvedValue([
      {
        amount: new Prisma.Decimal(100),
        paidAmount: new Prisma.Decimal(40),
        status: 'PARTIAL',
        dueDate: new Date('2099-01-01'),
      },
    ]);

    const summary = await getStudentFinanceSummary('s1', adminSd);

    expect(summary.total).toBe(100);
    expect(summary.paid).toBe(40);
    expect(summary.pending).toBe(60);
  });
});

describe('getStudentOutstandingBalances hanya untuk unit dalam cakupan', () => {
  it('unit lain dijawab 404 dan tidak ada tagihan yang dibaca', async () => {
    db.unit.findUnique.mockResolvedValue({ id: SMP });

    await expect(getStudentOutstandingBalances(SMP, adminSd)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it('unit yang tidak ada dijawab 404 yang sama', async () => {
    db.unit.findUnique.mockResolvedValue(null);

    await expect(getStudentOutstandingBalances('tidak-ada', adminSd)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it('unit sendiri mengembalikan tunggakan', async () => {
    db.invoice.findMany.mockResolvedValue([]);

    await expect(getStudentOutstandingBalances(SD, adminSd)).resolves.toEqual([]);
  });
});
