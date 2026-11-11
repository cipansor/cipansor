import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/** Page size for the row-by-row reads below; every page is read, so it is a
 * transport detail, not a cap on how much revenue is counted. */
const READ_PAGE_SIZE = 5000;

/**
 * Read every row of a query by paging over a stable `id` order, so a result set
 * larger than one page is not silently truncated (a `take` alone drops the rows
 * after it, and without an `orderBy` the rows that survive are unspecified).
 */
async function readAllPages<T>(
  fetchPage: (args: { skip: number; take: number }) => Promise<T[]>
): Promise<T[]> {
  const all: T[] = [];
  for (let skip = 0; ; skip += READ_PAGE_SIZE) {
    const page = await fetchPage({ skip, take: READ_PAGE_SIZE });
    all.push(...page);
    if (page.length < READ_PAGE_SIZE) return all;
  }
}

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

  // 2. Revenue from settled student invoices. Only the campaign that FIRST
  // brought the student in is credited, so a student carrying two registrations
  // does not count the same revenue twice. A REG_FEE invoice restates the
  // registration fee already recorded on the Registrant (read below), so it is
  // excluded here to keep the two sources disjoint.
  const studentRevenueData = await prisma.invoice.findMany({
    where: {
      student: {
        // Satu santri kini boleh punya beberapa pendaftaran (progresi internal
        // antarunit), jadi penyaringnya `some`, bukan relasi tunggal.
        registrants: {
          some: { campaignId: { in: campaignIds } },
        },
      },
      status: 'PAID',
      NOT: { paymentType: { code: 'REG_FEE' } },
    },
    select: {
      paidAmount: true,
      student: {
        select: {
          registrants: {
            where: { campaignId: { in: campaignIds } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { campaignId: true },
          },
        },
      },
    },
  });

  // Registration fees live on the Registrant (`registrationFeeAmount`, recognised
  // once `registrationFeePaidAt` is set). A REG_FEE *invoice* for the same fee can
  // also exist — `enrollRegistrant` generates one, and staff can raise another via
  // `createInvoice` — so the invoice source above excludes REG_FEE to keep this
  // Registrant source the single canonical home for the registration fee.
  const registrationFeeRows = await readAllPages(({ skip, take }) =>
    prisma.registrant.findMany({
      where: {
        campaignId: { in: campaignIds },
        registrationFeePaidAt: { not: null },
      },
      select: { id: true, campaignId: true, registrationFeeAmount: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    })
  );

  const revenueMap = new Map<string, number>();
  const addRevenue = (campaignId: string | null | undefined, amount: unknown) => {
    if (!campaignId) return;
    revenueMap.set(campaignId, (revenueMap.get(campaignId) || 0) + Number(amount ?? 0));
  };

  studentRevenueData.forEach((inv) =>
    addRevenue(inv.student?.registrants?.[0]?.campaignId, inv.paidAmount)
  );
  registrationFeeRows.forEach((row) => addRevenue(row.campaignId, row.registrationFeeAmount));

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

  const payments = await readAllPages(({ skip, take }) =>
    prisma.payment.findMany({
      where: {
        paidAt: { gte: start },
        invoice: {
          // A REG_FEE invoice restates the registration fee already recorded on
          // the Registrant (read below), so it is excluded here to keep the two
          // sources disjoint.
          NOT: { paymentType: { code: 'REG_FEE' } },
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
      select: { id: true, paidAt: true, amount: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    })
  );

  // Registration fees are recognised on the Registrant itself (no Invoice), so
  // they are a separate source from the payments above — the same rule the
  // campaign ROI uses, bucketed by `registrationFeePaidAt`.
  const registrationFees = await readAllPages(({ skip, take }) =>
    prisma.registrant.findMany({
      where: {
        campaignId: { not: null },
        registrationFeePaidAt: { gte: start },
        ...(unitId ? { admissionPeriod: { unitId } } : {}),
      },
      select: { id: true, registrationFeePaidAt: true, registrationFeeAmount: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    })
  );

  const buckets = new Map<string, { revenue: number; count: number }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, {
      revenue: 0,
      count: 0,
    });
  }
  const bucketKey = (at: Date) =>
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;

  for (const payment of payments) {
    const bucket = buckets.get(bucketKey(payment.paidAt));
    if (bucket) {
      bucket.revenue += Number(payment.amount);
      bucket.count += 1;
    }
  }
  for (const fee of registrationFees) {
    if (!fee.registrationFeePaidAt) continue;
    const bucket = buckets.get(bucketKey(fee.registrationFeePaidAt));
    if (bucket) {
      bucket.revenue += Number(fee.registrationFeeAmount ?? 0);
      bucket.count += 1;
    }
  }

  return [...buckets.entries()].map(([month, value]) => ({
    month,
    revenue: value.revenue,
    transactionCount: value.count,
  }));
}
