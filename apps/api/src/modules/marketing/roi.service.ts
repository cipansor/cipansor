import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/**
 * Marketing ROI Service
 * Optimized implementation to avoid N+1 queries.
 */
export async function calculateCampaignROI(unitId?: string) {
  const campaigns = await prisma.marketingCampaign.findMany({
    where: unitId ? { unitId } : {},
    select: {
      id: true,
      name: true,
      code: true,
      budget: true,
      _count: {
        select: { registrants: true },
      },
    },
  });

  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c) => c.id);

  // 1. Get converted counts in one query
  const conversions = await prisma.registrant.groupBy({
    by: ['campaignId'],
    where: {
      campaignId: { in: campaignIds },
      studentId: { not: null },
    },
    _count: { _all: true },
  });

  const conversionMap = new Map(conversions.map((c) => [c.campaignId, c._count._all]));

  // 2. Get revenue in one query
  // Support both Registrant -> Student -> Invoice AND Registrant -> Invoice directly
  const [studentRevenueData, registrantRevenueData] = await Promise.all([
    // Path: Registrant -> Student -> Invoice
    prisma.invoice.findMany({
      where: {
        student: {
          // Satu santri kini boleh punya beberapa pendaftaran (progresi internal
          // antarunit), jadi penyaringnya `some`, bukan relasi tunggal.
          registrants: {
            some: { campaignId: { in: campaignIds } },
          },
        },
        status: 'PAID',
      },
      select: {
        paidAmount: true,
        student: {
          select: {
            // Pendapatannya diakui pada kampanye yang PERTAMA membawanya masuk,
            // supaya santri dengan dua pendaftaran tidak dihitung dua kali.
            registrants: {
              where: { campaignId: { in: campaignIds } },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { campaignId: true },
            },
          },
        },
      },
    }),
    // Path: Registrant -> Invoice (for registration fees paid before promotion to student)
    // Note: This requires an optional registrantId on the Invoice model
    (prisma.invoice as any)
      .findMany({
        where: {
          registrant: {
            campaignId: { in: campaignIds },
          },
          status: 'PAID',
        },
        select: {
          paidAmount: true,
          registrant: {
            select: { campaignId: true },
          },
        },
      })
      .catch(() => []), // Gracefully handle if registrantId isn't on Invoice yet
  ]);

  const revenueMap = new Map<string, number>();

  // Add revenue from students
  studentRevenueData.forEach((inv) => {
    const cid = inv.student?.registrants?.[0]?.campaignId;
    if (cid) {
      revenueMap.set(cid, (revenueMap.get(cid) || 0) + Number(inv.paidAmount));
    }
  });

  // Add revenue from direct registrants (e.g. registration fees)
  registrantRevenueData.forEach((inv: any) => {
    const cid = inv.registrant?.campaignId;
    if (cid) {
      revenueMap.set(cid, (revenueMap.get(cid) || 0) + Number(inv.paidAmount));
    }
  });

  const results = campaigns.map((campaign) => {
    const convertedCount = conversionMap.get(campaign.id) || 0;
    const revenue = revenueMap.get(campaign.id) || 0;
    const cost = Number(campaign.budget || 0);

    const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0;
    const conversionRate =
      campaign._count.registrants > 0 ? (convertedCount / campaign._count.registrants) * 100 : 0;

    return {
      campaignId: campaign.id,
      name: campaign.name,
      code: campaign.code,
      metrics: {
        totalLeads: campaign._count.registrants,
        convertedStudents: convertedCount,
        conversionRate: Math.round(conversionRate * 100) / 100,
        cost,
        revenue,
        roi: Math.round(roi * 100) / 100,
        costPerLead: campaign._count.registrants > 0 ? cost / campaign._count.registrants : 0,
        costPerAcquisition: convertedCount > 0 ? cost / convertedCount : 0,
      },
    };
  });

  return results.sort((a, b) => b.metrics.roi - a.metrics.roi);
}

/**
 * Admission funnel: how far registrants progress through the pipeline.
 * "Reached" counts are cumulative over the ordered stages; REJECTED and
 * CANCELLED are terminal drop-offs reported separately.
 */
export async function getAdmissionFunnel(unitId?: string) {
  const where: Prisma.RegistrantWhereInput = {};
  if (unitId) where.admissionPeriod = { unitId };
  const rows = await prisma.registrant.groupBy({
    by: ['status'],
    where,
    _count: true,
  });

  const countOf = (status: string) =>
    Number(rows.find((row) => row.status === status)?._count ?? 0);

  const stageOrder = [
    'REGISTERED',
    'DOCUMENT_CHECK',
    'TEST_SCHEDULED',
    'TEST_COMPLETED',
    'ACCEPTED',
    'ENROLLED',
  ] as const;
  const stageLabels: Record<(typeof stageOrder)[number], string> = {
    REGISTERED: 'Mendaftar',
    DOCUMENT_CHECK: 'Verifikasi Dokumen',
    TEST_SCHEDULED: 'Dijadwalkan Tes',
    TEST_COMPLETED: 'Selesai Tes',
    ACCEPTED: 'Diterima',
    ENROLLED: 'Daftar Ulang',
  };

  const reached = stageOrder.map((_, index) =>
    stageOrder.slice(index).reduce((sum, status) => sum + countOf(status), 0)
  );
  const totalActive = reached[0];

  return {
    stages: stageOrder.map((status, index) => ({
      stage: status,
      label: stageLabels[status],
      count: countOf(status),
      reached: reached[index],
      conversionFromStart:
        totalActive > 0 ? Math.round((reached[index] / totalActive) * 1000) / 10 : 0,
    })),
    dropOff: {
      rejected: countOf('REJECTED'),
      cancelled: countOf('CANCELLED'),
    },
  };
}

/**
 * Monthly marketing-attributed revenue: payments whose invoice belongs to a
 * student that came in through a campaign, bucketed per month.
 */
export async function getMonthlyAttributedRevenue(unitId?: string, months = 6) {
  const start = new Date();
  start.setMonth(start.getMonth() - (months - 1));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const payments = await prisma.payment.findMany({
    where: {
      paidAt: { gte: start },
      invoice: {
        student: {
          // A student may carry several registrations, so the campaign link is
          // a to-many relation (`registrants`), not a single `registrant`.
          registrants: {
            some: {
              campaignId: { not: null },
              ...(unitId ? { admissionPeriod: { unitId } } : {}),
            },
          },
        },
      },
    },
    select: { paidAt: true, amount: true },
    take: 5000,
  });

  const buckets = new Map<string, { revenue: number; count: number }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, {
      revenue: 0,
      count: 0,
    });
  }
  for (const payment of payments) {
    const key = `${payment.paidAt.getFullYear()}-${String(payment.paidAt.getMonth() + 1).padStart(
      2,
      '0'
    )}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.revenue += Number(payment.amount);
      bucket.count += 1;
    }
  }

  return [...buckets.entries()].map(([month, value]) => ({
    month,
    revenue: value.revenue,
    transactionCount: value.count,
  }));
}
