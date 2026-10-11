import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SharedPaginatedResponse } from '@cipansor/shared';

export const departmentService = {
  async create(data: {
    unitId: string;
    code: string;
    name: string;
    description?: string;
    managerId?: string;
  }) {
    return prisma.department.create({
      data: {
        unit: { connect: { id: data.unitId } },
        code: data.code,
        name: data.name,
        description: data.description,
        manager: data.managerId ? { connect: { id: data.managerId } } : undefined,
      },
    });
  },

  async update(
    id: string,
    data: {
      code?: string;
      name?: string;
      description?: string;
      managerId?: string;
      isActive?: boolean;
    }
  ) {
    return prisma.department.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        manager: data.managerId
          ? { connect: { id: data.managerId } }
          : data.managerId === null
            ? { disconnect: true }
            : undefined,
        isActive: data.isActive,
      },
    });
  },

  async findAll(
    unitId: string | undefined,
    params: { page: number; limit: number; search?: string }
  ): Promise<SharedPaginatedResponse<unknown>> {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;

    // A super admin with no unit scopes to the whole yayasan; a unit-scoped
    // user is pinned to their own unit. Passing `undefined` for unitId must
    // therefore omit the filter rather than match nothing.
    const where: Prisma.DepartmentWhereInput = {
      ...(unitId ? { unitId } : {}),
      OR: search
        ? [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [total, data] = await Promise.all([
      prisma.department.count({ where }),
      prisma.department.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true } },
          _count: { select: { staff: true, teachers: true } },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
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

  async findOne(id: string) {
    return prisma.department.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, name: true } },
        staff: {
          select: { id: true, userId: true, user: { select: { name: true } }, position: true },
        },
        teachers: { select: { id: true, userId: true, user: { select: { name: true } } } },
      },
    });
  },

  async delete(id: string) {
    return prisma.department.delete({ where: { id } });
  },
};
