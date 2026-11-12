import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registrant: { groupBy: vi.fn(), findMany: vi.fn() },
    payment: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getAdmissionFunnel, getMonthlyAttributedRevenue } from '../roi.service';

const mocked = prisma as any;

describe('getAdmissionFunnel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes cumulative reached counts and drop-offs', async () => {
    mocked.registrant.groupBy.mockResolvedValue([
      { status: 'REGISTERED', _count: 40 },
      { status: 'TEST_COMPLETED', _count: 25 },
      { status: 'ACCEPTED', _count: 20 },
      { status: 'ENROLLED', _count: 15 },
      { status: 'REJECTED', _count: 8 },
      { status: 'CANCELLED', _count: 2 },
    ]);

    const funnel = await getAdmissionFunnel('unit-1');

    // total active pipeline = 40+25+20+15 = 100
    expect(funnel.stages[0]).toMatchObject({
      stage: 'REGISTERED',
      reached: 100,
      conversionFromStart: 100,
    });
    const enrolled = funnel.stages.find((s) => s.stage === 'ENROLLED');
    expect(enrolled).toMatchObject({ reached: 15, conversionFromStart: 15 });
    const accepted = funnel.stages.find((s) => s.stage === 'ACCEPTED');
    expect(accepted).toMatchObject({ reached: 35 }); // 20 + 15
    expect(funnel.dropOff).toEqual({ rejected: 8, cancelled: 2 });

    expect(mocked.registrant.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { admissionPeriod: { unitId: 'unit-1' } },
      })
    );
  });

  it('handles an empty pipeline', async () => {
    mocked.registrant.groupBy.mockResolvedValue([]);
    const funnel = await getAdmissionFunnel();
    expect(funnel.stages.every((s) => s.reached === 0 && s.conversionFromStart === 0)).toBe(true);
  });
});

describe('getMonthlyAttributedRevenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.registrant.findMany.mockResolvedValue([]);
  });

  it('buckets campaign-attributed payments per month with zero-filled series', async () => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    mocked.payment.findMany.mockResolvedValue([
      { paidAt: now, amount: 250000 },
      { paidAt: now, amount: 100000 },
    ]);

    const trend = await getMonthlyAttributedRevenue(undefined, 3);

    expect(trend).toHaveLength(3);
    const current = trend.find((t) => t.month === thisMonthKey);
    expect(current).toEqual({ month: thisMonthKey, revenue: 350000, transactionCount: 2 });
    // Older months exist but are zero
    expect(trend.filter((t) => t.month !== thisMonthKey).every((t) => t.revenue === 0)).toBe(true);

    // The campaign link hangs off the to-many `registrants` relation on
    // Student; a bare `registrant` is not a relation and Prisma rejects it.
    // A non-REG_FEE payment always counts; a REG_FEE payment counts only when
    // the student has no registration-fee record (read from the Registrant),
    // so the fee is never counted twice.
    expect(mocked.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoice: expect.objectContaining({
            student: { registrants: { some: { campaignId: { not: null } } } },
            OR: [
              { NOT: { paymentType: { code: 'REG_FEE' } } },
              {
                paymentType: { code: 'REG_FEE' },
                student: { registrants: { none: { registrationFeePaidAt: { not: null } } } },
              },
            ],
          }),
        }),
      })
    );
  });

  it('menghitung pembayaran tagihan REG_FEE saat pendaftar belum mencatat biayanya', async () => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Staf melunasi tagihan REG_FEE lewat createPayment; registrationFeePaidAt
    // tidak terisi. Pembayaran ini satu-satunya bukti, jadi harus dihitung.
    mocked.payment.findMany.mockResolvedValue([{ paidAt: now, amount: 500000 }]);
    mocked.registrant.findMany.mockResolvedValue([]);

    const trend = await getMonthlyAttributedRevenue(undefined, 3);

    const current = trend.find((t) => t.month === thisMonthKey);
    expect(current).toEqual({ month: thisMonthKey, revenue: 500000, transactionCount: 1 });
  });

  it('menambahkan biaya daftar ulang lunas, per bulan registrationFeePaidAt', async () => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    mocked.payment.findMany.mockResolvedValue([]);
    mocked.registrant.findMany.mockResolvedValue([
      { registrationFeePaidAt: now, registrationFeeAmount: 750000 },
    ]);

    const trend = await getMonthlyAttributedRevenue(undefined, 3);

    const current = trend.find((t) => t.month === thisMonthKey);
    expect(current).toEqual({ month: thisMonthKey, revenue: 750000, transactionCount: 1 });
  });

  it('membatasi biaya daftar ulang dan pembayaran pada unit yang diminta', async () => {
    mocked.payment.findMany.mockResolvedValue([]);
    mocked.registrant.findMany.mockResolvedValue([]);

    await getMonthlyAttributedRevenue('unit-7', 3);

    expect(mocked.registrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: { not: null },
          admissionPeriod: { unitId: 'unit-7' },
        }),
      })
    );
  });

  it('membaca seluruh halaman pembayaran dan biaya daftar ulang (bukan `take` tunggal)', async () => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const halamanPenuh = Array.from({ length: 5000 }, () => ({ id: 'p', paidAt: now, amount: 1 }));
    mocked.payment.findMany
      .mockResolvedValueOnce(halamanPenuh)
      .mockResolvedValueOnce([{ id: 'z', paidAt: now, amount: 1 }]);
    mocked.registrant.findMany.mockResolvedValue([]);

    const trend = await getMonthlyAttributedRevenue(undefined, 3);

    // Halaman penuh memicu halaman berikutnya; tidak ada baris yang dibuang.
    expect(mocked.payment.findMany).toHaveBeenCalledTimes(2);
    const current = trend.find((t) => t.month === thisMonthKey);
    expect(current).toEqual({ month: thisMonthKey, revenue: 5001, transactionCount: 5001 });
  });

  it('membaca seluruh halaman biaya daftar ulang pada grafik (cabang paginasi kedua)', async () => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    mocked.payment.findMany.mockResolvedValue([]);
    // Cabang biaya daftar ulang punya paginasi sendiri; uji pembayaran di atas
    // hanya mengisi halaman pertama sumber pembayaran.
    const halamanPenuh = Array.from({ length: 5000 }, (_, i) => ({
      id: `r${i}`,
      registrationFeePaidAt: now,
      registrationFeeAmount: 1,
    }));
    mocked.registrant.findMany
      .mockResolvedValueOnce(halamanPenuh)
      .mockResolvedValueOnce([{ id: 'z', registrationFeePaidAt: now, registrationFeeAmount: 1 }]);

    const trend = await getMonthlyAttributedRevenue(undefined, 3);

    // Halaman penuh memicu halaman berikutnya; biaya tidak terpotong di 5.000.
    expect(mocked.registrant.findMany).toHaveBeenCalledTimes(2);
    const current = trend.find((t) => t.month === thisMonthKey);
    expect(current).toEqual({ month: thisMonthKey, revenue: 5001, transactionCount: 5001 });
  });
});
