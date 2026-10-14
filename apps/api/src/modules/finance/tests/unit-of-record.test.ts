import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * Tagihan milik unit JENIS BAYARNYA, bukan unit santri sekarang (audit #489
 * bagian 3). `Invoice` tidak menyimpan unit sendiri; `PaymentType.unitId`
 * sudah menyimpannya (SPP SD IT unik per unit).
 *
 * Santri SD IT yang naik ke SMP IT dan melunasi SPP SD IT yang tertunggak dulu
 * dibukukan sebagai kas SMP IT yang mengkredit akun pendapatan SD IT, dan
 * tunggakannya pindah dari laporan SD IT ke laporan SMP IT.
 */

vi.mock('../../../lib/prisma', () => {
  const mockPrisma = {
    invoice: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    payment: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    journalEntry: { create: vi.fn() },
    unit: { findUnique: vi.fn() },
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
import { getAccountOrFallback } from '../accounting-config.service';
import { eventBus } from '@/lib/event-bus';
import {
  createPayment,
  getPendingVerifications,
  getStudentOutstandingBalances,
  getUnitFinanceStats,
} from '../finance.service';

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const SD = 'unit-sd';
const SMP = 'unit-smp';

/** SPP SD IT milik santri yang kini tercatat di SMP IT. */
const tagihanLama = {
  id: 'inv-1',
  studentId: 's1',
  invoiceNumber: 'INV-SD-2026-0007',
  amount: new Prisma.Decimal(350000),
  paidAmount: new Prisma.Decimal(0),
  student: { id: 's1', unitId: SMP, nis: 'SMP-0099', user: { name: 'Fulan' } },
  paymentType: { id: 'pt-spp-sd', name: 'SPP', accountId: 'akun-pendapatan-sd', unitId: SD },
};

beforeEach(() => {
  db.invoice.findUnique.mockResolvedValue(tagihanLama);
  db.payment.create.mockResolvedValue({
    id: 'pay-1',
    amount: new Prisma.Decimal(350000),
    method: 'CASH',
    invoiceId: 'inv-1',
    paidAt: new Date('2026-09-14'),
    invoice: { ...tagihanLama, studentId: 's1' },
  });
  db.unit.findUnique.mockResolvedValue({ id: SD, name: 'SD IT Cipansor' });
});

afterEach(() => {
  for (const model of Object.values(db)) {
    if (typeof model === 'function') continue;
    for (const fn of Object.values(model)) fn.mockClear();
  }
  vi.mocked(getAccountOrFallback).mockClear();
  vi.mocked(eventBus.emit).mockClear();
});

describe('createPayment', () => {
  it('jurnal kas dan pendapatan dicatat di unit TAGIHAN (SD IT), bukan unit santri sekarang', async () => {
    await createPayment({ invoiceId: 'inv-1', amount: 350000, method: 'CASH' } as never, 'kasir');

    expect(getAccountOrFallback).toHaveBeenCalledWith(SD, 'CASH', '1101', 'Kas');
    expect(db.journalEntry.create).toHaveBeenCalledTimes(2);
    const unitJurnal = db.journalEntry.create.mock.calls.map(([arg]) => arg.data.unitId);
    expect(unitJurnal).toEqual([SD, SD]);
    expect(db.journalEntry.create.mock.calls[1][0].data.accountId).toBe('akun-pendapatan-sd');
  });

  it('event pembayaran menyebut unit penerima = unit tagihan', async () => {
    await createPayment({ invoiceId: 'inv-1', amount: 350000, method: 'CASH' } as never, 'kasir');

    expect(eventBus.emit).toHaveBeenCalledWith(
      'finance:payment-received',
      expect.objectContaining({ unitId: SD, unitName: 'SD IT Cipansor' })
    );
  });
});

describe('laporan dan antrean per unit menyaring lewat jenis bayar', () => {
  it('antrean verifikasi TU SD IT memuat tagihan SD IT milik santri yang sudah pindah', async () => {
    db.payment.findMany.mockResolvedValue([]);
    db.payment.count.mockResolvedValue(0);
    await getPendingVerifications(
      { sub: 'tu-sd', role: 'STAFF', roleCode: 'SDIT_TATA_USAHA', unitId: SD },
      {}
    );

    expect(db.payment.findMany.mock.calls[0][0].where.invoice).toEqual({
      paymentType: { unitId: SD },
    });
  });

  it('statistik keuangan unit', async () => {
    db.invoice.findMany.mockResolvedValue([]);
    db.invoice.groupBy.mockResolvedValue([]);
    await getUnitFinanceStats(SD);

    expect(db.invoice.findMany.mock.calls[0][0].where).toEqual({ paymentType: { unitId: SD } });
    expect(db.invoice.groupBy.mock.calls[0][0].where).toEqual({ paymentType: { unitId: SD } });
  });

  it('daftar tunggakan SD IT: santri yang sudah pindah tetap ada, dengan NIS SD IT-nya', async () => {
    db.invoice.findMany.mockResolvedValue([
      {
        ...tagihanLama,
        dueDate: new Date('2026-06-10'),
        student: { ...tagihanLama.student, user: { id: 'u1', name: 'Fulan' }, enrollments: [] },
      },
    ]);
    db.studentUnitIdentifier.findMany.mockResolvedValue([
      { studentId: 's1', unitId: SD, nis: 'SD-0007' },
      { studentId: 's1', unitId: SMP, nis: 'SMP-0099' },
    ]);

    const hasil = await getStudentOutstandingBalances(SD);

    expect(db.invoice.findMany.mock.calls[0][0].where.paymentType).toEqual({ unitId: SD });
    expect(hasil).toEqual([
      expect.objectContaining({ studentId: 's1', nis: 'SD-0007', unpaid_amount: 350000 }),
    ]);
  });
});
