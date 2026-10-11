import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SharedPaginatedResponse } from '@cipansor/shared';

export const contractService = {
  async create(data: {
    userId: string;
    contractNumber: string;
    type: string;
    startDate: Date;
    endDate?: Date;
    documentUrl?: string;
    notes?: string;
  }) {
    return prisma.employmentContract.create({
      data: {
        user: { connect: { id: data.userId } },
        contractNumber: data.contractNumber,
        type: data.type,
        startDate: data.startDate,
        endDate: data.endDate,
        documentUrl: data.documentUrl,
        notes: data.notes,
      },
    });
  },

  async update(
    id: string,
    data: {
      type?: string;
      startDate?: Date;
      endDate?: Date;
      status?: any;
      documentUrl?: string;
      notes?: string;
    }
  ) {
    return prisma.employmentContract.update({
      where: { id },
      data,
    });
  },

  async findAll(
    unitId: string | undefined,
    params: { page: number; limit: number; search?: string; status?: string }
  ): Promise<SharedPaginatedResponse<unknown>> {
    const { page, limit, search, status } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.EmploymentContractWhereInput = {
      // Omitted for a super admin aggregating the whole yayasan.
      user: {
        ...(unitId ? { unitId } : {}), // Filter contracts by users in the unit
        name: search ? { contains: search, mode: 'insensitive' } : undefined,
      },
      status: status ? (status as any) : undefined,
    };

    const [total, data] = await Promise.all([
      prisma.employmentContract.count({ where }),
      prisma.employmentContract.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
        skip,
        take: limit,
        orderBy: { startDate: 'desc' },
      }),
    ]);

    return {
      success: true,
      data,
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  },

  async findByUser(userId: string) {
    return prisma.employmentContract.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });
  },

  async findExpiring(unitId: string | undefined, days: number = 30) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    return prisma.employmentContract.findMany({
      where: {
        // Omitted for a super admin aggregating the whole yayasan.
        ...(unitId ? { user: { unitId } } : {}),
        endDate: {
          lte: expiryDate,
          gte: new Date(),
        },
        status: 'ACTIVE',
      },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { endDate: 'asc' },
    });
  },
};
