import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { Prisma, MealType, MealAttendanceStatus } from '@prisma/client';
import { MEALS_ATTENDANCE_WRITER_ROLE_CODES, MEALS_MANAGER_ROLE_CODES } from '@cipansor/shared';
import {
  actorReachesUnit,
  actorSeesUnit,
  seesAllUnits,
  writeUnitScopeFor,
} from '@/utils/resolve-unit-id';
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

    // A menu of a unit the actor does not reach answers 404, exactly as for an
    // id that does not exist, so the answer never confirms another unit's menu
    // (K10, decisions/akses-data-pegawai.md). The reach is the read-side one
    // (`actorSeesUnit`, widened by `seesAllUnits`): a musyrif who serves santri
    // across units is shown this menu by `listMenus`, so opening it must not
    // answer 404 — the same rows, one answer.
    if (!menu || !actorSeesUnit(currentUser, menu.unitId)) {
      throw Errors.notFound('Menu');
    }

    return menu;
  }

  /**
   * The menu a write may target, for `writers` only.
   *
   * Two questions, two answers. *May this role change a menu?* — the caller
   * passes the writer list (`MEALS_MANAGER_ROLE_CODES` for menus,
   * `MEALS_ATTENDANCE_WRITER_ROLE_CODES` for attendance); a governance role
   * whose permission list is read-only is refused with 403. *May it touch
   * *this* menu?* — `actorReachesUnit`, which gives a foundation role every
   * unit's breadth; the role gate is what turns breadth into authority, and it
   * lives here as well as on the route, so the service is correct on its own.
   * A menu outside the actor's reach answers 404, as for an id that does not
   * exist (K10).
   */
  private assertMenuWriter(currentUser: AuthenticatedUser, writers: readonly string[]) {
    if (!currentUser.roleCode || !writers.includes(currentUser.roleCode)) {
      throw Errors.forbidden('Anda tidak berwenang mengubah data makan');
    }
  }

  private async assertMenuWritable(
    id: string,
    currentUser: AuthenticatedUser,
    writers: readonly string[]
  ) {
    this.assertMenuWriter(currentUser, writers);

    const menu = await prisma.mealMenu.findUnique({
      where: { id },
      select: { id: true, unitId: true },
    });

    if (!menu || !actorReachesUnit(currentUser, menu.unitId)) {
      throw Errors.notFound('Menu');
    }

    return menu;
  }

  /**
   * Create menu
   */
  async createMenu(input: CreateMenuInput, currentUser: AuthenticatedUser) {
    this.assertMenuWriter(currentUser, MEALS_MANAGER_ROLE_CODES);

    // The body's `unitId` is a request, not a grant: a unit admin writes to
    // their own unit whatever the body says, a foundation role names the unit.
    const unitId = writeUnitScopeFor(currentUser, input.unitId);

    // Check for existing menu on same date/type
    const existing = await prisma.mealMenu.findUnique({
      where: {
        unitId_date_mealType: {
          unitId,
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
        unitId,
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
    await this.assertMenuWritable(id, currentUser, MEALS_MANAGER_ROLE_CODES);

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
    await this.assertMenuWritable(id, currentUser, MEALS_MANAGER_ROLE_CODES);

    await prisma.mealMenu.delete({ where: { id } });

    return { success: true };
  }

  /**
   * Get today's menu
   */
  async getTodayMenu(unitId: string, currentUser: AuthenticatedUser) {
    if (!actorSeesUnit(currentUser, unitId)) {
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
    await this.assertMenuWritable(input.menuId, currentUser, MEALS_ATTENDANCE_WRITER_ROLE_CODES);

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
    await this.assertMenuWritable(menuId, currentUser, MEALS_ATTENDANCE_WRITER_ROLE_CODES);

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

    // Out of reach answers 404, as for an id that does not exist, so the answer
    // never confirms another unit's attendance row (K10).
    if (!attendance || !actorReachesUnit(currentUser, attendance.menu.unitId)) {
      throw Errors.notFound('Attendance record');
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
  async getStatistics(
    currentUser: AuthenticatedUser,
    unitId?: string,
    startDate?: string,
    endDate?: string
  ) {
    const where: Prisma.MealMenuWhereInput = {};

    // The `?unitId=` query is a request, not a grant: a unit-bound account is
    // pinned to its own unit whatever the query says, so the statistics never
    // count another unit's menus (K10). A role that sees every unit may narrow
    // to one, exactly as `listMenus` does.
    if (!seesAllUnits(currentUser)) {
      where.unitId = currentUser.unitId || 'none';
    } else if (unitId) {
      where.unitId = unitId;
    }

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

    if (!student || !actorSeesUnit(currentUser, student.unitId)) {
      throw Errors.notFound('Student');
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
