import { prisma } from '@/lib/prisma';
import { CreateCampaignInput, LogInteractionInput, UpdateCampaignInput } from './marketing.schema';
import { AdmissionStatus, Prisma, QuranAbility } from '@prisma/client';

export const createCampaign = async (data: CreateCampaignInput, userId: string) => {
  return prisma.marketingCampaign.create({
    data: {
      ...data,
      createdById: userId,
    } as Prisma.MarketingCampaignUncheckedCreateInput,
  });
};

export const updateCampaign = async (id: string, data: UpdateCampaignInput) => {
  return prisma.marketingCampaign.update({
    where: { id },
    data,
  });
};

export const getCampaigns = async (unitId?: string) => {
  const where: Prisma.MarketingCampaignWhereInput = {};
  if (unitId) {
    where.unitId = unitId;
  }
  return prisma.marketingCampaign.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { registrants: true },
      },
    },
  });
};

export const getCampaignById = async (id: string) => {
  return prisma.marketingCampaign.findUnique({
    where: { id },
    include: {
      registrants: {
        select: {
          id: true,
          fullName: true,
          status: true,
          createdAt: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: { registrants: true },
      },
    },
  });
};

export const getCampaignByCode = async (code: string) => {
  return prisma.marketingCampaign.findFirst({
    where: {
      code: {
        equals: code,
        mode: 'insensitive',
      },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
    },
  });
};

export const logInteraction = async (data: LogInteractionInput, userId: string) => {
  return prisma.marketingInteraction.create({
    data: {
      ...data,
      recordedById: userId,
    } as Prisma.MarketingInteractionUncheckedCreateInput,
  });
};

export const getInteractionsByRegistrant = async (registrantId: string) => {
  return prisma.marketingInteraction.findMany({
    where: { registrantId },
    orderBy: { date: 'desc' },
    include: {
      recordedBy: {
        select: { name: true },
      },
    },
  });
};

/**
 * Pendaftar yang persetujuannya masih berlaku.
 *
 * Penarikan persetujuan (UU PDP 27/2022 Pasal 40) berarti pemrosesan
 * pemasaran harus benar-benar berhenti — bukan sekadar dicatat waktunya. Baris
 * pendaftar yang sudah menarik persetujuannya tidak boleh lagi muncul sebagai
 * prospek, kontak tindak lanjut, atau angka di dasbor pemasaran.
 *
 * Dipakai juga oleh `roi.service.ts`. Batasnya: setiap kueri yang membaca baris
 * `Registrant` langsung (jumlah prospek, konversi, corong admisi, biaya daftar
 * ulang) ikut disaring — baris itu artefak pemasaran/persetujuan. Kueri yang
 * membaca `Invoice`/`Payment` tidak disentuh: itu catatan keuangan yang wajib
 * retensi (Pasal 43–44), bukan pemrosesan atas dasar persetujuan.
 */
export const marketingConsentHeld: Prisma.RegistrantWhereInput = { consentWithdrawnAt: null };

export const getDashboardStats = async (unitId?: string) => {
  const whereRegistrant: Prisma.RegistrantWhereInput = { ...marketingConsentHeld };

  // 1. Sources Distribution
  const sources = await prisma.registrant.groupBy({
    by: ['source'],
    where: {
      ...whereRegistrant,
      source: { not: null },
    },
    _count: {
      _all: true,
    },
  });

  // 2. Campaign Performance. Jumlah pendaftar pun disaring persetujuannya:
  // menghitung baris yang sudah menariknya sebagai hasil kampanye adalah
  // pemrosesan lanjutan atas data itu.
  const campaigns = await prisma.marketingCampaign.findMany({
    where: unitId ? { unitId } : {},
    select: {
      id: true,
      name: true,
      code: true,
      budget: true,
      _count: {
        select: { registrants: { where: marketingConsentHeld } },
      },
    },
    take: 5,
    orderBy: {
      registrants: {
        _count: 'desc',
      },
    },
  });

  // 3. Conversion Rates (Registered vs Accepted) by Source
  // This is complex, simplified here

  return {
    sources: sources.map((s) => ({ source: s.source, count: s._count._all })),
    topCampaigns: campaigns.map((c) => ({
      name: c.name,
      code: c.code,
      registrants: c._count.registrants,
      budget: c.budget,
    })),
  };
};

export const getRecentLeads = async (unitId?: string, limit: number = 5) => {
  const where: Prisma.RegistrantWhereInput = { ...marketingConsentHeld };
  if (unitId) {
    where.admissionPeriod = { unitId };
  }

  return prisma.registrant.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      fullName: true,
      createdAt: true,
      status: true,
      source: true,
      campaign: {
        select: { name: true, code: true },
      },
    },
  });
};

export const getHighPriorityLeads = async (unitId?: string, limit: number = 10) => {
  const where: Prisma.RegistrantWhereInput = {
    ...marketingConsentHeld,
    // Leads still in the admission funnel (not yet accepted/rejected/enrolled)
    status: {
      in: [
        AdmissionStatus.REGISTERED,
        AdmissionStatus.DOCUMENT_CHECK,
        AdmissionStatus.TEST_SCHEDULED,
        AdmissionStatus.TEST_COMPLETED,
      ],
    },
  };
  if (unitId) {
    where.admissionPeriod = { unitId };
  }

  // Fetch a pool of candidates so we can score and sort them
  const registrants = await prisma.registrant.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      fullName: true,
      createdAt: true,
      status: true,
      source: true,
      quranAbility: true,
      memorizedJuz: true,
      campaign: { select: { name: true, code: true } },
    },
  });

  // Compute a simple priority score: quranAbility + memorized juz bonus
  const quranAbilityScore: Record<QuranAbility, number> = {
    TAHFIDZ: 40,
    TARTIL: 25,
    LANCAR: 15,
    IQRA: 5,
    BELUM_BISA: 0,
  };

  const scored = registrants.map((r) => {
    const base = 50;
    const quranBonus = r.quranAbility ? (quranAbilityScore[r.quranAbility] ?? 0) : 0;
    const juzBonus = r.memorizedJuz ? Math.min(r.memorizedJuz * 2, 20) : 0;
    return { ...r, leadScore: Math.min(base + quranBonus + juzBonus, 100) };
  });

  return scored.sort((a, b) => b.leadScore - a.leadScore).slice(0, limit);
};

export const getUpcomingFollowUps = async (unitId?: string, limit: number = 5) => {
  const whereRegistrant: Prisma.RegistrantWhereInput = { ...marketingConsentHeld };
  if (unitId) {
    whereRegistrant.admissionPeriod = { unitId };
  }

  return prisma.marketingInteraction.findMany({
    where: {
      nextActionDate: { gte: new Date() },
      registrant: whereRegistrant,
    },
    orderBy: { nextActionDate: 'asc' },
    take: limit,
    include: {
      registrant: {
        select: {
          id: true,
          fullName: true,
          parentPhone: true,
          status: true,
        },
      },
    },
  });
};

export default {
  createCampaign,
  updateCampaign,
  getCampaigns,
  getCampaignById,
  getCampaignByCode,
  logInteraction,
  getInteractionsByRegistrant,
  getDashboardStats,
  getRecentLeads,
  getHighPriorityLeads,
  getUpcomingFollowUps,
};
