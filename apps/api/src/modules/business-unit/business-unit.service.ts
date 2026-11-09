import { prisma } from '../../lib/prisma';
import { Prisma, BusinessUnitType } from '@prisma/client';
import { Errors } from '@/middleware/error';
import { wibMonthYear, wibDayStart } from '@/utils/wib-day';

export const businessUnitService = {
  async list(params: { unitId?: string; type?: BusinessUnitType; isActive?: boolean }) {
    const where: Prisma.BusinessUnitWhereInput = {
      ...(params.unitId && { unitId: params.unitId }),
      ...(params.type && { type: params.type }),
      ...(params.isActive !== undefined && { isActive: params.isActive }),
    };

    // Current WIB month, not the host clock's month: at 00:00–06:59 WIB on the
    // 1st a UTC server is still in the previous month (and, in January, the
    // previous year), which would show last month's revenue. `createdAt` is a
    // real instant, so the bound is 00:00 WIB on the 1st (17:00Z the day
    // before), not midnight UTC, which would drop the month's first 7 hours.
    const { year, month } = wibMonthYear(new Date());
    const monthStart = wibDayStart(`${year}-${String(month + 1).padStart(2, '0')}-01`);

    const [units, canteenMonth, laundryMonth] = await Promise.all([
      prisma.businessUnit.findMany({
        where,
        include: {
          unit: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true } },
          _count: {
            select: {
              canteenItems: true,
              canteenTransactions: true,
              laundryTransactions: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      // Current-month revenue per unit (settled transactions only)
      prisma.canteenTransaction.groupBy({
        by: ['businessUnitId'],
        where: { status: 'COMPLETED', createdAt: { gte: monthStart } },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.laundryTransaction.groupBy({
        by: ['businessUnitId'],
        where: { status: 'DELIVERED', paymentStatus: 'PAID', createdAt: { gte: monthStart } },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const revenueByUnit = new Map<string, { revenue: number; transactions: number }>();
    for (const row of [...canteenMonth, ...laundryMonth]) {
      if (!row.businessUnitId) continue;
      const entry = revenueByUnit.get(row.businessUnitId) ?? { revenue: 0, transactions: 0 };
      entry.revenue += Number(row._sum.total ?? 0);
      entry.transactions += row._count.id;
      revenueByUnit.set(row.businessUnitId, entry);
    }

    return units.map((bu) => ({
      ...bu,
      monthlyRevenue: revenueByUnit.get(bu.id)?.revenue ?? 0,
      monthlyTransactions: revenueByUnit.get(bu.id)?.transactions ?? 0,
    }));
  },

  async getById(id: string, unitId?: string) {
    const where: Prisma.BusinessUnitWhereInput = { id };
    if (unitId) where.unitId = unitId;

    const bu = await prisma.businessUnit.findFirst({
      where,
      include: {
        unit: { select: { id: true, name: true } },
        _count: true,
      },
    });

    if (!bu) throw Errors.notFound('Business Unit');
    return bu;
  },

  async create(data: {
    unitId: string;
    name: string;
    code: string;
    type: BusinessUnitType;
    description?: string;
    managerId?: string;
  }) {
    const existing = await prisma.businessUnit.findUnique({
      where: { unitId_code: { unitId: data.unitId, code: data.code } },
    });

    if (existing) {
      throw Errors.badRequest('Business unit code already exists');
    }

    return prisma.businessUnit.create({
      data,
      include: { unit: { select: { name: true } } },
    });
  },

  async update(
    id: string,
    unitId: string | undefined,
    data: Partial<{
      name: string;
      code: string;
      type: BusinessUnitType;
      description: string;
      managerId: string;
      isActive: boolean;
    }>
  ) {
    // Verify the business unit exists (and belongs to this unit when unitId is provided)
    const where: Prisma.BusinessUnitWhereInput = { id };
    if (unitId) where.unitId = unitId;

    const bu = await prisma.businessUnit.findFirst({ where });
    if (!bu) throw Errors.notFound('Business Unit');

    if (data.code) {
      const existing = await prisma.businessUnit.findUnique({
        where: { unitId_code: { unitId: bu.unitId, code: data.code } },
      });

      if (existing && existing.id !== id) {
        throw Errors.badRequest('Business unit code already exists');
      }
    }

    return prisma.businessUnit.update({
      where: { id },
      data,
    });
  },

  async delete(id: string, unitId?: string) {
    const where: Prisma.BusinessUnitWhereInput = { id };
    if (unitId) where.unitId = unitId;

    const bu = await prisma.businessUnit.findFirst({
      where,
      include: {
        _count: {
          select: {
            canteenCategories: true,
            canteenItems: true,
            canteenTransactions: true,
            laundryPricings: true,
            laundryTransactions: true,
          },
        },
      },
    });

    if (!bu) throw Errors.notFound('Business Unit');

    if (bu._count.canteenTransactions > 0 || bu._count.laundryTransactions > 0) {
      throw Errors.badRequest('Cannot delete business unit with existing transactions');
    }

    if (
      bu._count.canteenCategories > 0 ||
      bu._count.canteenItems > 0 ||
      bu._count.laundryPricings > 0
    ) {
      throw Errors.badRequest(
        'Cannot delete business unit with linked categories, items, or pricings. Remove them first.'
      );
    }

    return prisma.businessUnit.delete({ where: { id } });
  },

  async getPerformance(id: string, unitId: string | undefined, startDate: Date, endDate: Date) {
    const where: Prisma.BusinessUnitWhereInput = { id };
    if (unitId) where.unitId = unitId;

    const bu = await prisma.businessUnit.findFirst({ where });
    if (!bu) throw Errors.notFound('Business Unit');

    if (bu.type === 'CANTEEN') {
      const stats = await prisma.canteenTransaction.aggregate({
        where: {
          businessUnitId: id,
          status: 'COMPLETED',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { total: true },
        _count: { id: true },
      });

      return {
        revenue: Number(stats._sum.total || 0),
        transactionCount: stats._count.id,
      };
    }

    if (bu.type === 'LAUNDRY') {
      const stats = await prisma.laundryTransaction.aggregate({
        where: {
          businessUnitId: id,
          status: 'DELIVERED',
          paymentStatus: 'PAID',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { total: true },
        _count: { id: true },
      });

      return {
        revenue: Number(stats._sum.total || 0),
        transactionCount: stats._count.id,
      };
    }

    return { revenue: 0, transactionCount: 0 };
  },

  /**
   * Get business efficiency metrics.
   * Best Practice: Analyzing operational performance beyond simple revenue.
   */
  async getBusinessEfficiency(id: string, unitId: string | undefined) {
    const where: Prisma.BusinessUnitWhereInput = { id };
    if (unitId) where.unitId = unitId;

    const bu = await prisma.businessUnit.findFirst({
      where,
      include: {
        canteenItems: {
          select: {
            id: true,
            name: true,
            stock: true,
            _count: { select: { transactionItems: true } },
          },
        },
      },
    });

    if (!bu) throw Errors.notFound('Business Unit');

    if (bu.type === 'CANTEEN') {
      const itemEfficiency = bu.canteenItems.map((item) => {
        const turnover = item._count.transactionItems;
        // Efficiency Score: (Turnover / Stock) * 100 - simple proxy for stock velocity
        const score = item.stock > 0 ? (turnover / item.stock) * 100 : turnover > 0 ? 100 : 0;
        return {
          id: item.id,
          name: item.name,
          stock: item.stock,
          turnover,
          efficiencyScore: Math.round(score * 10) / 10,
        };
      });

      const avgEfficiency =
        itemEfficiency.length > 0
          ? itemEfficiency.reduce((sum, i) => sum + i.efficiencyScore, 0) / itemEfficiency.length
          : 0;

      return {
        unitId: bu.unitId,
        type: bu.type,
        overallEfficiency: Math.round(avgEfficiency * 10) / 10,
        topItems: itemEfficiency.sort((a, b) => b.efficiencyScore - a.efficiencyScore).slice(0, 5),
        lowItems: itemEfficiency.sort((a, b) => a.efficiencyScore - b.efficiencyScore).slice(0, 5),
      };
    }

    return {
      unitId: bu.unitId,
      type: bu.type,
      overallEfficiency: 100,
      message: 'Efficiency metrics currently only available for CANTEEN',
    };
  },
};
