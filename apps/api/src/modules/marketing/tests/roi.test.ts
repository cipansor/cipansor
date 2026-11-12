import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateCampaignROI } from '../roi.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketingCampaign: {
      findMany: vi.fn(),
    },
    registrant: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
    },
  },
}));

describe('Marketing ROI Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any);
  });

  it('should calculate ROI correctly for multiple campaigns', async () => {
    const mockCampaigns = [
      { id: 'c1', name: 'Facebook Ads', code: 'FB01', budget: 1000, _count: { registrants: 100 } },
    ];

    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue(mockCampaigns as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([
      { campaignId: 'c1', _count: { _all: 20 } },
    ] as any);
    // Satu santri kini boleh punya beberapa pendaftaran (progresi internal
    // antarunit), jadi relasinya jamak. Panggilan pertama membaca tagihan
    // santri; panggilan kedua (tagihan REG_FEE) tetap kosong (default).
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
      { paidAmount: 5000, student: { registrants: [{ campaignId: 'c1' }] } },
    ] as any);

    const result = await calculateCampaignROI();

    expect(result).toHaveLength(1);
    expect(result[0].metrics.roi).toBe(400);
    expect(result[0].metrics.conversionRate).toBe(20);
  });

  it('menghitung biaya daftar ulang yang lunas sebagai pendapatan kampanye', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'Facebook Ads', code: 'FB01', budget: 1000, _count: { registrants: 100 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    // Biaya daftar ulang ada di Registrant, bukan Invoice.
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([
      { campaignId: 'c1', registrationFeeAmount: 2500 },
    ] as any);

    const result = await calculateCampaignROI();

    // revenue 2500, cost 1000 -> roi 150%
    expect(result[0].metrics.revenue).toBe(2500);
    expect(result[0].metrics.roi).toBe(150);
    // Hanya biaya yang sudah lunas, dari kampanye dalam daftar, yang dihitung.
    expect(vi.mocked(prisma.registrant.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: { in: ['c1'] }, registrationFeePaidAt: { not: null } },
      })
    );
  });

  it('menghitung tagihan REG_FEE lunas saat unit penagih belum mencatat biayanya', async () => {
    // Staf dapat menerbitkan tagihan REG_FEE dan melunasinya lewat createPayment,
    // yang tidak menulis registrationFeePaidAt. Tagihan itu satu-satunya bukti
    // biaya sudah diterima, jadi harus dihitung.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 1000, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        {
          paidAmount: 500000,
          paymentType: { unitId: 'unit-smp' },
          student: {
            registrants: [
              {
                campaignId: 'c1',
                registrationFeePaidAt: null,
                admissionPeriod: { unitId: 'unit-smp' },
              },
            ],
          },
        },
      ] as any);

    const result = await calculateCampaignROI();

    expect(result[0].metrics.revenue).toBe(500000);

    const pilihRegFee = vi.mocked(prisma.invoice.findMany).mock.calls[1][0] as any;
    expect(pilihRegFee.where.paymentType).toEqual({ code: 'REG_FEE' });
    // Tagihan yang sudah menerima uang: lunas maupun sebagian.
    expect(pilihRegFee.where.status).toEqual({ in: ['PAID', 'PARTIAL'] });
    // Kandidat: santri yang punya pendaftaran dari kampanye. Dedup dilakukan per
    // unit saat menjumlahkan (lihat uji berikutnya), bukan lewat `none` se-santri.
    expect(pilihRegFee.where.student.registrants).toEqual({
      some: { campaignId: { in: ['c1'] } },
    });
  });

  it('mengecualikan tagihan REG_FEE dari sumber tagihan santri biasa', async () => {
    // Biaya daftar ulang dibaca dari Registrant (dan dari tagihan REG_FEE tanpa
    // catatan pendaftar), jadi sumber tagihan biasa harus mengecualikan REG_FEE
    // agar tidak ada sumber yang dihitung dua kali.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 1000, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);

    await calculateCampaignROI();

    const pilihInvoice = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any;
    expect(pilihInvoice.where.NOT).toEqual({ paymentType: { code: 'REG_FEE' } });
  });

  it('membaca seluruh halaman biaya daftar ulang, bukan hanya 5.000 baris pertama', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 1, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    const halamanPenuh = Array.from({ length: 5000 }, (_, i) => ({
      id: `r${i}`,
      campaignId: 'c1',
      registrationFeeAmount: 1,
    }));
    vi.mocked(prisma.registrant.findMany)
      .mockResolvedValueOnce(halamanPenuh as any)
      .mockResolvedValueOnce([{ id: 'z', campaignId: 'c1', registrationFeeAmount: 1 }] as any);

    const result = await calculateCampaignROI();

    // Halaman penuh memicu halaman berikutnya; barisnya tidak terpotong.
    expect(vi.mocked(prisma.registrant.findMany)).toHaveBeenCalledTimes(2);
    expect(result[0].metrics.revenue).toBe(5001);
  });

  it('mengakui pendapatan pada kampanye yang PERTAMA membawa santri itu masuk', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'Facebook Ads', code: 'FB01', budget: 1000, _count: { registrants: 100 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([
      { campaignId: 'c1', _count: { _all: 20 } },
    ] as any);

    await calculateCampaignROI();

    // Pilihan pendaftaran tertua TIDAK difilter `campaignIds` (cakupan hanya
    // diterapkan saat menjumlahkan), tetapi pendaftaran TANPA kampanye
    // dikecualikan agar pendaftaran organik yang lebih tua tidak menyembunyikan
    // kampanye yang membawa santri masuk.
    const pilih = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any;
    expect(pilih.select.student.select.registrants).toMatchObject({
      where: { campaignId: { not: null } },
      take: 1,
      orderBy: { createdAt: 'asc' },
    });
    expect(pilih.where.student.registrants.some).toBeDefined();
  });

  it('mengaitkan pendapatan ke kampanye meski ada pendaftaran organik yang lebih tua', async () => {
    // Santri punya pendaftaran Januari TANPA kampanye dan pendaftaran Juli dari
    // kampanye c1. Tagihan lunas harus tetap masuk c1, bukan hilang.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 0, _count: { registrants: 2 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([
        { paidAmount: 500000, student: { registrants: [{ campaignId: 'c1' }] } },
      ] as any)
      .mockResolvedValueOnce([] as any);

    const result = await calculateCampaignROI();

    expect(result[0].metrics.revenue).toBe(500000);
  });

  it('menghitung biaya daftar ulang unit lain yang ditagihkan lewat tagihan REG_FEE', async () => {
    // Santri membayar biaya masuk SD (tercatat di pendaftaran SD) dan bulan ini
    // ditagihkan biaya masuk SMP lewat tagihan REG_FEE; pendaftaran SMP belum
    // mencatat pembayaran. Catatan SD tidak boleh menelan biaya SMP.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 0, _count: { registrants: 2 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        {
          paidAmount: 1000000,
          paymentType: { unitId: 'unit-smp' },
          student: {
            registrants: [
              {
                campaignId: 'c1',
                createdAt: new Date('2025-01-01'),
                registrationFeePaidAt: new Date('2025-01-05'),
                admissionPeriod: { unitId: 'unit-sd' },
              },
              {
                campaignId: 'c1',
                createdAt: new Date('2026-07-01'),
                registrationFeePaidAt: null,
                admissionPeriod: { unitId: 'unit-smp' },
              },
            ],
          },
        },
      ] as any);

    const result = await calculateCampaignROI();

    // unit-smp belum punya catatan biaya -> tagihan dihitung.
    expect(result[0].metrics.revenue).toBe(1000000);
  });

  it('mengabaikan tagihan REG_FEE bila ada pendaftaran lunas di unit yang sama', async () => {
    // Invoice tidak menyimpan tautan ke pendaftaran, jadi tagihan daftar ulang
    // ulang di unit yang sama tak bisa dibedakan dari milik pendaftaran lama yang
    // sudah lunas; demi jaminan tanpa hitung ganda, tagihan itu diabaikan.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 0, _count: { registrants: 2 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        {
          paidAmount: 500000,
          paymentType: { unitId: 'unit-smp' },
          student: {
            registrants: [
              {
                campaignId: 'c1',
                createdAt: new Date('2025-01-01'),
                registrationFeePaidAt: new Date('2025-01-05'),
                admissionPeriod: { unitId: 'unit-smp' },
              },
              {
                campaignId: 'c1',
                createdAt: new Date('2026-07-01'),
                registrationFeePaidAt: null,
                admissionPeriod: { unitId: 'unit-smp' },
              },
            ],
          },
        },
      ] as any);

    const result = await calculateCampaignROI();

    expect(result[0].metrics.revenue).toBe(0);
  });

  it('tidak menghitung ganda tagihan REG_FEE yang unitnya sudah mencatat biaya', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 0, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        {
          paidAmount: 500000,
          paymentType: { unitId: 'unit-smp' },
          student: {
            registrants: [
              {
                campaignId: 'c1',
                createdAt: new Date('2026-07-01'),
                registrationFeePaidAt: new Date('2026-07-02'),
                admissionPeriod: { unitId: 'unit-smp' },
              },
            ],
          },
        },
      ] as any);

    const result = await calculateCampaignROI();

    // Registrant adalah sumber kanonik; tagihan unit yang sama dikecualikan.
    expect(result[0].metrics.revenue).toBe(0);
  });

  it('menghitung tagihan biasa yang baru dibayar sebagian', async () => {
    // Tagihan non-REG_FEE yang berstatus PARTIAL sudah menerima uang; ROI harus
    // menghitung paidAmount-nya, selaras dengan grafik bulanan.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 0, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([
        { paidAmount: 400000, student: { registrants: [{ campaignId: 'c1' }] } },
      ] as any)
      .mockResolvedValueOnce([] as any);

    const result = await calculateCampaignROI();

    expect(result[0].metrics.revenue).toBe(400000);
    const pilihInvoice = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any;
    expect(pilihInvoice.where.status).toEqual({ in: ['PAID', 'PARTIAL'] });
  });

  it('should return empty array when no campaigns exist', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([]);
    const result = await calculateCampaignROI();
    expect(result).toEqual([]);
  });
});
