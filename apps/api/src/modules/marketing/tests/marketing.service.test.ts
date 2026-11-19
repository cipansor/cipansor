import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import marketingService from '../marketing.service';

// Mock all external dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketingCampaign: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    marketingInteraction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    registrant: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('Marketing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCampaign', () => {
    it('should create a new campaign', async () => {
      const dto = {
        name: 'Early Bird 2026',
        code: 'EB2026',
        description: 'Diskon 10%',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
        unitId: 'unit-1',
        budget: 5000000,
        expectedLeads: 100,
      };

      const mockCampaign = { id: 'camp-1', ...dto, createdById: 'user-1' };
      vi.mocked(prisma.marketingCampaign.create).mockResolvedValue(mockCampaign as any);

      const result = await marketingService.createCampaign(dto as any, 'user-1');

      expect(prisma.marketingCampaign.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          createdById: 'user-1',
        },
      });
      expect(result).toEqual(mockCampaign);
    });
  });

  describe('logInteraction', () => {
    it('should log a marketing interaction', async () => {
      const dto = {
        registrantId: 'reg-1',
        type: 'PHONE_CALL' as any,
        date: new Date(),
        notes: 'Follow up payment',
        nextAction: 'Kirim invoice',
        nextActionDate: new Date('2026-03-01'),
      };

      const mockInteraction = { id: 'int-1', ...dto, recordedById: 'user-1' };
      vi.mocked(prisma.marketingInteraction.create).mockResolvedValue(mockInteraction as any);

      const result = await marketingService.logInteraction(dto as any, 'user-1');

      expect(prisma.marketingInteraction.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          recordedById: 'user-1',
        },
      });
      expect(result).toEqual(mockInteraction);
    });
  });

  describe('getDashboardStats', () => {
    it('should aggregate statistics correctly', async () => {
      vi.mocked(prisma.registrant.groupBy).mockResolvedValue([
        { source: 'FACEBOOK', _count: { _all: 50 } },
        { source: 'INSTAGRAM', _count: { _all: 30 } },
      ] as any);

      vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
        { name: 'Camp 1', code: 'C1', budget: 1000, _count: { registrants: 20 } },
      ] as any);

      const result = await marketingService.getDashboardStats('unit-1');

      expect(prisma.registrant.groupBy).toHaveBeenCalled();
      expect(prisma.marketingCampaign.findMany).toHaveBeenCalled();

      expect(result).toEqual({
        sources: [
          { source: 'FACEBOOK', count: 50 },
          { source: 'INSTAGRAM', count: 30 },
        ],
        topCampaigns: [{ name: 'Camp 1', code: 'C1', budget: 1000, registrants: 20 }],
      });
    });

    it('mengecualikan pendaftar yang sudah menarik persetujuannya', async () => {
      // Penarikan persetujuan (Pasal 40) menuntut pemrosesan berhenti; menghitung
      // pendaftar itu dalam distribusi sumber dan hasil kampanye adalah
      // pemrosesan lanjutan atas datanya.
      vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
      vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([] as any);

      await marketingService.getDashboardStats('unit-1');

      expect(prisma.registrant.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ consentWithdrawnAt: null }),
        })
      );
      const campaigns = vi.mocked(prisma.marketingCampaign.findMany).mock.calls[0][0] as any;
      expect(campaigns.select._count.select.registrants.where).toEqual({
        consentWithdrawnAt: null,
      });
    });

    it('memeringkat lima kampanye teratas dari jumlah pendaftar TERSARING, bukan jumlah total', async () => {
      // Prisma tidak dapat mengurutkan relasi `_count` menurut penyaringnya:
      // `orderBy.registrants._count` memakai jumlah SELURUH pendaftar. Kalau
      // pemeringkatan diserahkan ke basis data, lima kampanye teratas bisa
      // terpilih dari jumlah total sementara angka yang ditampilkan sudah
      // tersaring — kampanye dengan prospek aktif lebih banyak terbuang.
      // Karena itu layanan harus membaca seluruh kampanye cakupan, mengurutkan
      // menurut jumlah tersaring, baru mengambil lima.
      vi.mocked(prisma.registrant.groupBy).mockResolvedValue([] as any);
      // Enam kampanye: total pendaftar A–E = 100, F = 50 (F terkecil menurut
      // total), tetapi jumlah TERSARING F = 50 sedangkan A–E hanya 1.
      const withFiltered = (name: string, registrants: number) => ({
        id: name,
        name,
        code: name,
        budget: 1000,
        _count: { registrants },
      });
      vi.mocked(prisma.marketingCampaign.findMany).mockResolvedValue([
        withFiltered('A', 1),
        withFiltered('B', 1),
        withFiltered('C', 1),
        withFiltered('D', 1),
        withFiltered('E', 1),
        withFiltered('F', 50),
      ] as any);

      const result = await marketingService.getDashboardStats('unit-1');

      // F memimpin meski total pendaftarnya terkecil; satu kampanye bernilai 1
      // tersisih karena hanya lima yang diambil.
      expect(result.topCampaigns.map((c) => c.name)).toEqual(['F', 'A', 'B', 'C', 'D']);
      expect(result.topCampaigns[0].registrants).toBe(50);

      // Pemeringkatan tidak diserahkan ke basis data (yang tak bisa menyaring
      // `_count`): kueri tidak boleh membawa `orderBy`/`take` yang salah itu.
      const args = vi.mocked(prisma.marketingCampaign.findMany).mock.calls[0][0] as any;
      expect(args.orderBy).toBeUndefined();
      expect(args.take).toBeUndefined();
    });
  });

  describe('getRecentLeads', () => {
    it('baris yang dihapus (nama penanda) tidak lagi muncul sebagai prospek aktif', async () => {
      // Penghapusan (Pasal 35, 43) adalah bentuk terkuat "berhenti memproses".
      // Saringan pemasaran hanya membaca `consentWithdrawnAt`, jadi penghapusan
      // WAJIB mengisinya — kalau tidak, baris ber-`fullName` penanda tetap
      // dihitung sebagai prospek dan tetap muncul di daftar tindak lanjut.
      //
      // Diperiksa pada kueri yang dikirim ke basis data, bukan pada hasil yang
      // disaring tiruan: tiruan yang menyaring sendiri akan lulus walaupun
      // layanannya berhenti menyaring — hijau palsu yang justru dicari uji ini.
      vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);

      await marketingService.getRecentLeads('unit-1', 10);

      expect(prisma.registrant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ consentWithdrawnAt: null }),
        })
      );
    });
  });

  describe('getHighPriorityLeads', () => {
    it('should filter on valid AdmissionStatus funnel values and score leads', async () => {
      vi.mocked(prisma.registrant.findMany).mockResolvedValue([
        { id: 'r-1', fullName: 'Lead Iqra', quranAbility: 'IQRA', memorizedJuz: null },
        { id: 'r-2', fullName: 'Lead Tahfidz', quranAbility: 'TAHFIDZ', memorizedJuz: 10 },
      ] as any);

      const result = await marketingService.getHighPriorityLeads(undefined, 10);

      expect(prisma.registrant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            consentWithdrawnAt: null,
            status: {
              in: ['REGISTERED', 'DOCUMENT_CHECK', 'TEST_SCHEDULED', 'TEST_COMPLETED'],
            },
          },
        })
      );
      // Sorted by score desc; tahfidz + juz bonus capped at 100
      expect(result[0]).toMatchObject({ id: 'r-2', leadScore: 100 });
      expect(result[1]).toMatchObject({ id: 'r-1', leadScore: 55 });
    });
  });

  describe('getUpcomingFollowUps', () => {
    it('should fetch interactions with future nextActionDate', async () => {
      vi.mocked(prisma.marketingInteraction.findMany).mockResolvedValue([
        { id: 'int-1', nextActionDate: new Date('2026-03-01') },
      ] as any);

      await marketingService.getUpcomingFollowUps('unit-1', 5);

      expect(prisma.marketingInteraction.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          nextActionDate: { gte: expect.any(Date) },
          registrant: expect.objectContaining({
            consentWithdrawnAt: null,
            admissionPeriod: { unitId: 'unit-1' },
          }),
        }),
        orderBy: { nextActionDate: 'asc' },
        take: 5,
        include: expect.any(Object),
      });
    });
  });
});
