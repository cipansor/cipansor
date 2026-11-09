import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { UserRole, Prisma, DutyCategory, DutyStatus, DayOfWeek } from '@prisma/client';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { dayOf, todayWib } from '@/utils/wib';

// User type from JwtPayload
interface AuthenticatedUser {
  sub: string;
  role: string;
  /**
   * RoleCode granular. Wajib ada agar scoping bisa memakai seesAllUnits():
   * `role` legacy memetakan setiap YAYASAN_* menjadi 'UNIT_ADMIN', sehingga
   * pemeriksaan yang ditulis atas `role` menggolongkan pengurus yayasan
   * sebagai admin unit — itulah yang menyembunyikan datanya.
   */
  roleCode?: string | null;
  unitId: string | null;
}

interface ListTypesQuery {
  unitId?: string;
  category?: DutyCategory;
  isActive?: boolean;
  page: number;
  limit: number;
}

interface CreateTypeInput {
  unitId: string;
  name: string;
  code?: string;
  category: DutyCategory;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
}

interface UpdateTypeInput {
  name?: string;
  code?: string;
  category?: DutyCategory;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
}

interface ListRostersQuery {
  unitId?: string;
  dutyTypeId?: string;
  studentId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  status?: DutyStatus;
  page: number;
  limit: number;
}

interface CreateRosterInput {
  dutyTypeId: string;
  studentId: string;
  date: string;
  dayOfWeek: DayOfWeek;
  notes?: string;
}

interface UpdateRosterInput {
  status?: DutyStatus;
  notes?: string;
  substituteId?: string;
}

export class DutyRosterService {
  // ==================
  // DUTY TYPE METHODS
  // ==================

  async listTypes(query: ListTypesQuery, currentUser: AuthenticatedUser) {
    const { page, limit, unitId, category, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.DutyTypeWhereInput = {};

    if (!seesAllUnits(currentUser)) {
      where.unitId = currentUser.unitId || 'none';
    } else if (unitId) {
      where.unitId = unitId;
    }

    if (category) {
      where.category = category;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [types, total] = await Promise.all([
      prisma.dutyType.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: {
          unit: { select: { id: true, name: true } },
          _count: { select: { rosters: true } },
        },
      }),
      prisma.dutyType.count({ where }),
    ]);

    return {
      data: types,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTypeById(id: string, currentUser: AuthenticatedUser) {
    const type = await prisma.dutyType.findUnique({
      where: { id },
      include: {
        unit: true,
        _count: { select: { rosters: true } },
      },
    });

    if (!type) {
      throw Errors.notFound('Duty type not found');
    }

    if (currentUser.role !== UserRole.SUPER_ADMIN && type.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    return type;
  }

  async createType(input: CreateTypeInput, currentUser: AuthenticatedUser) {
    if (currentUser.role !== UserRole.SUPER_ADMIN && input.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Cannot create duty type for another unit');
    }

    const type = await prisma.dutyType.create({
      data: {
        unitId: input.unitId,
        name: input.name,
        code: input.code,
        category: input.category,
        description: input.description,
        location: input.location,
        startTime: input.startTime,
        endTime: input.endTime,
        isActive: input.isActive ?? true,
      },
      include: { unit: { select: { id: true, name: true } } },
    });

    return type;
  }

  async updateType(id: string, input: UpdateTypeInput, currentUser: AuthenticatedUser) {
    await this.getTypeById(id, currentUser);

    const updated = await prisma.dutyType.update({
      where: { id },
      data: input,
    });

    return updated;
  }

  async deleteType(id: string, currentUser: AuthenticatedUser) {
    await this.getTypeById(id, currentUser);

    const rosterCount = await prisma.dutyRoster.count({ where: { dutyTypeId: id } });
    if (rosterCount > 0) {
      throw Errors.conflict('Cannot delete duty type with existing rosters');
    }

    await prisma.dutyType.delete({ where: { id } });
    return { success: true };
  }

  // ==================
  // ROSTER METHODS
  // ==================

  async listRosters(query: ListRostersQuery, currentUser: AuthenticatedUser) {
    const { page, limit, unitId, dutyTypeId, studentId, date, startDate, endDate, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.DutyRosterWhereInput = {};

    if (!seesAllUnits(currentUser)) {
      where.dutyType = { unitId: currentUser.unitId || 'none' };
    } else if (unitId) {
      where.dutyType = { unitId };
    }

    if (dutyTypeId) {
      where.dutyTypeId = dutyTypeId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (status) {
      where.status = status;
    }

    if (date) {
      where.date = new Date(date);
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [rosters, total] = await Promise.all([
      prisma.dutyRoster.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { dutyType: { name: 'asc' } }],
        include: {
          dutyType: { select: { id: true, name: true, category: true, location: true } },
          student: { include: { user: { select: { name: true } } } },
          substitute: { include: { user: { select: { name: true } } } },
          verifiedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.dutyRoster.count({ where }),
    ]);

    return {
      data: rosters,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getRosterById(id: string, currentUser: AuthenticatedUser) {
    const roster = await prisma.dutyRoster.findUnique({
      where: { id },
      include: {
        dutyType: { include: { unit: true } },
        student: { include: { user: { select: { name: true } } } },
        substitute: { include: { user: { select: { name: true } } } },
        verifiedBy: { select: { id: true, name: true } },
      },
    });

    if (!roster) {
      throw Errors.notFound('Roster not found');
    }

    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      roster.dutyType.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    return roster;
  }

  async createRoster(input: CreateRosterInput, currentUser: AuthenticatedUser) {
    const dutyType = await prisma.dutyType.findUnique({ where: { id: input.dutyTypeId } });
    if (!dutyType) {
      throw Errors.notFound('Duty type not found');
    }

    if (currentUser.role !== UserRole.SUPER_ADMIN && dutyType.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    const roster = await prisma.dutyRoster.create({
      data: {
        dutyTypeId: input.dutyTypeId,
        studentId: input.studentId,
        date: new Date(input.date),
        dayOfWeek: input.dayOfWeek,
        notes: input.notes,
        status: DutyStatus.PENDING,
      },
      include: {
        dutyType: { select: { name: true } },
        student: { include: { user: { select: { name: true } } } },
      },
    });

    return roster;
  }

  async bulkCreateRosters(rosters: CreateRosterInput[], currentUser: AuthenticatedUser) {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const input of rosters) {
      try {
        await this.createRoster(input, currentUser);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `${input.studentId}: ${error instanceof Error ? error.message : 'Failed'}`
        );
      }
    }

    return results;
  }

  async updateRoster(id: string, input: UpdateRosterInput, currentUser: AuthenticatedUser) {
    await this.getRosterById(id, currentUser);

    const updated = await prisma.dutyRoster.update({
      where: { id },
      data: input,
    });

    return updated;
  }

  async deleteRoster(id: string, currentUser: AuthenticatedUser) {
    await this.getRosterById(id, currentUser);
    await prisma.dutyRoster.delete({ where: { id } });
    return { success: true };
  }

  // ==================
  // ROSTER ACTIONS
  // ==================

  async completeDuty(id: string, currentUser: AuthenticatedUser) {
    await this.getRosterById(id, currentUser);

    const updated = await prisma.dutyRoster.update({
      where: { id },
      data: {
        status: DutyStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    return updated;
  }

  async markAbsent(id: string, notes: string, currentUser: AuthenticatedUser) {
    await this.getRosterById(id, currentUser);

    const updated = await prisma.dutyRoster.update({
      where: { id },
      data: {
        status: DutyStatus.ABSENT,
        notes,
      },
    });

    return updated;
  }

  async assignSubstitute(id: string, substituteId: string, currentUser: AuthenticatedUser) {
    await this.getRosterById(id, currentUser);

    const updated = await prisma.dutyRoster.update({
      where: { id },
      data: {
        substituteId,
        status: DutyStatus.SUBSTITUTED,
      },
    });

    return updated;
  }

  async verifyDuty(id: string, currentUser: AuthenticatedUser) {
    await this.getRosterById(id, currentUser);

    const updated = await prisma.dutyRoster.update({
      where: { id },
      data: {
        verifiedById: currentUser.sub,
        verifiedAt: new Date(),
      },
    });

    return updated;
  }

  // ==================
  // QUERIES
  // ==================

  async getTodayDuties(unitId: string, currentUser: AuthenticatedUser) {
    if (currentUser.role !== UserRole.SUPER_ADMIN && unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    const rosters = await prisma.dutyRoster.findMany({
      where: {
        dutyType: { unitId },
        date: dayOf(todayWib()),
      },
      orderBy: { dutyType: { name: 'asc' } },
      include: {
        dutyType: {
          select: { name: true, category: true, startTime: true, endTime: true, location: true },
        },
        student: { include: { user: { select: { name: true } } } },
      },
    });

    return rosters;
  }

  async getStudentHistory(studentId: string, currentUser: AuthenticatedUser, limit: number = 30) {
    const student = await prisma.student.findUnique({ where: { id: studentId, deletedAt: null } });
    if (!student) {
      throw Errors.notFound('Student not found');
    }

    if (currentUser.role !== UserRole.SUPER_ADMIN && student.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    const history = await prisma.dutyRoster.findMany({
      where: { studentId },
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        dutyType: { select: { name: true, category: true } },
      },
    });

    return history;
  }

  async getStatistics(unitId: string, startDate?: string, endDate?: string) {
    const where: Prisma.DutyRosterWhereInput = {
      dutyType: { unitId },
    };

    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [total, byStatus] = await Promise.all([
      prisma.dutyRoster.count({ where }),
      prisma.dutyRoster.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
    };
  }
}

export const dutyRosterService = new DutyRosterService();
