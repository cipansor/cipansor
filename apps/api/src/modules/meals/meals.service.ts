import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { UserRole, Prisma, MealType, MealAttendanceStatus } from '@prisma/client';
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

interface ListMenusQuery {
  unitId?: string;
  mealType?: MealType;
  date?: string;
  startDate?: string;
  endDate?: string;
  page: number;
  limit: number;
}

interface CreateMenuInput {
  unitId: string;
  date: string;
  mealType: MealType;
  mainDish: string;
  sideDish?: string;
  vegetable?: string;
  soup?: string;
  dessert?: string;
  drink?: string;
  notes?: string;
  calories?: number;
}

interface UpdateMenuInput {
  mainDish?: string;
  sideDish?: string;
  vegetable?: string;
  soup?: string;
  dessert?: string;
  drink?: string;
  notes?: string;
  calories?: number;
}

interface ListAttendanceQuery {
  menuId?: string;
  studentId?: string;
  status?: MealAttendanceStatus;
  date?: string;
  page: number;
  limit: number;
}

interface RecordAttendanceInput {
  menuId: string;
  studentId: string;
  status: MealAttendanceStatus;
  portions?: number;
  notes?: string;
}

export class MealsService {
  // ==================
  // MENU METHODS
  // ==================

  /**
   * List menus
   */
  async listMenus(query: ListMenusQuery, currentUser: AuthenticatedUser) {
    const { page, limit, unitId, mealType, date, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MealMenuWhereInput = {};

    // Filter by unit
    if (!seesAllUnits(currentUser)) {
      where.unitId = currentUser.unitId || 'none';
    } else if (unitId) {
      where.unitId = unitId;
    }

    if (mealType) {
      where.mealType = mealType;
    }

    if (date) {
      where.date = new Date(date);
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [menus, total] = await Promise.all([
      prisma.mealMenu.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { mealType: 'asc' }],
        include: {
          unit: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { attendances: true } },
        },
      }),
      prisma.mealMenu.count({ where }),
    ]);

    return {
      data: menus,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get menu by ID
   */
  async getMenuById(id: string, currentUser: AuthenticatedUser) {
    const menu = await prisma.mealMenu.findUnique({
      where: { id },
      include: {
        unit: true,
        createdBy: { select: { id: true, name: true } },
        attendances: {
          include: {
            student: { include: { user: { select: { name: true } } } },
          },
        },
      },
    });

    if (!menu) {
      throw Errors.notFound('Menu not found');
    }

    if (currentUser.role !== UserRole.SUPER_ADMIN && menu.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    return menu;
  }

  /**
   * Create menu
   */
  async createMenu(input: CreateMenuInput, currentUser: AuthenticatedUser) {
    if (currentUser.role !== UserRole.SUPER_ADMIN && input.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Cannot create menu for another unit');
    }

    // Check for existing menu on same date/type
    const existing = await prisma.mealMenu.findUnique({
      where: {
        unitId_date_mealType: {
          unitId: input.unitId,
          date: new Date(input.date),
          mealType: input.mealType,
        },
      },
    });

    if (existing) {
      throw Errors.conflict('Menu already exists for this date and meal type');
    }

    const menu = await prisma.mealMenu.create({
      data: {
        unitId: input.unitId,
        date: new Date(input.date),
        mealType: input.mealType,
        mainDish: input.mainDish,
        sideDish: input.sideDish,
        vegetable: input.vegetable,
        soup: input.soup,
        dessert: input.dessert,
        drink: input.drink,
        notes: input.notes,
        calories: input.calories,
        createdById: currentUser.sub,
      },
      include: {
        unit: { select: { id: true, name: true } },
      },
    });

    return menu;
  }

  /**
   * Update menu
   */
  async updateMenu(id: string, input: UpdateMenuInput, currentUser: AuthenticatedUser) {
    await this.getMenuById(id, currentUser);

    const updated = await prisma.mealMenu.update({
      where: { id },
      data: input,
      include: {
        unit: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  /**
   * Delete menu
   */
  async deleteMenu(id: string, currentUser: AuthenticatedUser) {
    await this.getMenuById(id, currentUser);

    await prisma.mealMenu.delete({ where: { id } });

    return { success: true };
  }

  /**
   * Get today's menu
   */
  async getTodayMenu(unitId: string, currentUser: AuthenticatedUser) {
    if (currentUser.role !== UserRole.SUPER_ADMIN && unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    const menus = await prisma.mealMenu.findMany({
      where: {
        unitId,
        date: dayOf(todayWib()),
      },
      orderBy: { mealType: 'asc' },
    });

    return menus;
  }

  // ==================
  // ATTENDANCE METHODS
  // ==================

  /**
   * List attendance
   */
  async listAttendance(query: ListAttendanceQuery, currentUser: AuthenticatedUser) {
    const { page, limit, menuId, studentId, status, date } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MealAttendanceWhereInput = {};

    if (menuId) {
      where.menuId = menuId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (status) {
      where.status = status;
    }

    // Filter by unit
    if (!seesAllUnits(currentUser)) {
      where.menu = { unitId: currentUser.unitId || 'none' };
    }

    const [attendances, total] = await Promise.all([
      prisma.mealAttendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { recordedAt: 'desc' },
        include: {
          student: { include: { user: { select: { name: true } } } },
          menu: { select: { date: true, mealType: true } },
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.mealAttendance.count({ where }),
    ]);

    return {
      data: attendances,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Record attendance
   */
  async recordAttendance(input: RecordAttendanceInput, currentUser: AuthenticatedUser) {
    const menu = await this.getMenuById(input.menuId, currentUser);

    // Check if student exists
    const student = await prisma.student.findUnique({
      where: { id: input.studentId, deletedAt: null },
    });

    if (!student) {
      throw Errors.notFound('Student not found');
    }

    // Upsert attendance
    const attendance = await prisma.mealAttendance.upsert({
      where: {
        menuId_studentId: {
          menuId: input.menuId,
          studentId: input.studentId,
        },
      },
      update: {
        status: input.status,
        portions: input.portions || 1,
        notes: input.notes,
        recordedById: currentUser.sub,
      },
      create: {
        menuId: input.menuId,
        studentId: input.studentId,
        status: input.status,
        portions: input.portions || 1,
        notes: input.notes,
        recordedById: currentUser.sub,
      },
      include: {
        student: { include: { user: { select: { name: true } } } },
        menu: { select: { date: true, mealType: true } },
      },
    });

    return attendance;
  }

  /**
   * Bulk record attendance
   */
  async bulkRecordAttendance(
    menuId: string,
    records: {
      studentId: string;
      status: MealAttendanceStatus;
      portions?: number;
      notes?: string;
    }[],
    currentUser: AuthenticatedUser
  ) {
    await this.getMenuById(menuId, currentUser);

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const record of records) {
      try {
        await this.recordAttendance({ menuId, ...record }, currentUser);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `${record.studentId}: ${error instanceof Error ? error.message : 'Failed'}`
        );
      }
    }

    return results;
  }

  /**
   * Update attendance
   */
  async updateAttendance(
    id: string,
    input: { status?: MealAttendanceStatus; portions?: number; notes?: string },
    currentUser: AuthenticatedUser
  ) {
    const attendance = await prisma.mealAttendance.findUnique({
      where: { id },
      include: { menu: { select: { unitId: true } } },
    });

    if (!attendance) {
      throw Errors.notFound('Attendance record not found');
    }

    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      attendance.menu.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    const updated = await prisma.mealAttendance.update({
      where: { id },
      data: {
        status: input.status,
        portions: input.portions,
        notes: input.notes,
      },
    });

    return updated;
  }

  // ==================
  // STATISTICS
  // ==================

  /**
   * Get meal statistics
   */
  async getStatistics(unitId: string, startDate?: string, endDate?: string) {
    const where: Prisma.MealMenuWhereInput = { unitId };

    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [totalMenus, attendanceStats] = await Promise.all([
      prisma.mealMenu.count({ where }),
      prisma.mealAttendance.groupBy({
        by: ['status'],
        where: { menu: where },
        _count: { status: true },
      }),
    ]);

    return {
      totalMenus,
      attendanceByStatus: attendanceStats.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
    };
  }

  /**
   * Get student meal history
   */
  async getStudentHistory(studentId: string, currentUser: AuthenticatedUser, limit: number = 30) {
    const student = await prisma.student.findUnique({
      where: { id: studentId, deletedAt: null },
    });

    if (!student) {
      throw Errors.notFound('Student not found');
    }

    if (currentUser.role !== UserRole.SUPER_ADMIN && student.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied');
    }

    const history = await prisma.mealAttendance.findMany({
      where: { studentId },
      take: limit,
      orderBy: { recordedAt: 'desc' },
      include: {
        menu: { select: { date: true, mealType: true, mainDish: true } },
      },
    });

    return history;
  }
}

export const mealsService = new MealsService();
