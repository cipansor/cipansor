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
    // antarunit), jadi relasinya jamak.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
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
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any);
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

  it('mengecualikan tagihan REG_FEE agar tidak menghitung ganda biaya daftar ulang', async () => {
    // Biaya daftar ulang sudah dicatat di Registrant; tagihan REG_FEE untuk
    // santri yang sama menuliskannya ulang. Sumber invoice harus mengecualikan
    // REG_FEE supaya keduanya tidak dijumlahkan.
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 1000, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);

    await calculateCampaignROI();

    const pilihInvoice = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any;
    expect(pilihInvoice.where.NOT).toEqual({ paymentType: { code: 'REG_FEE' } });
  });

  it('membaca seluruh halaman biaya daftar ulang, bukan hanya 5.000 baris pertama', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'X', code: 'X', budget: 1, _count: { registrants: 1 } },
    ] as any);
    vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any);
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
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any);

    await calculateCampaignROI();

    // Tanpa `take: 1` yang berurutan, santri dengan dua pendaftaran membuat
    // pendapatan yang sama dihitung di dua kampanye.
    const pilih = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any;
    expect(pilih.select.student.select.registrants).toMatchObject({
      take: 1,
      orderBy: { createdAt: 'asc' },
    });
    expect(pilih.where.student.registrants.some).toBeDefined();
  });

  it('should return empty array when no campaigns exist', async () => {
    vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([]);
    const result = await calculateCampaignROI();
    expect(result).toEqual([]);
  });
});
