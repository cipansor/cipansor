import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { UserRole, Prisma, AttendanceStatus as PrismaAttendanceStatus } from '@prisma/client';
import type {
  ListExtracurricularsQuery,
  CreateExtracurricularInput,
  UpdateExtracurricularInput,
  EnrollStudentInput,
  BulkEnrollInput,
  UpdateEnrollmentInput,
  RecordAttendanceInput,
  CreateAchievementInput,
  ListEnrollmentsQuery,
  ListAttendanceQuery,
  ListAchievementsQuery,
} from './extracurricular.schema';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { assertStudentInScope, type ScopeActor } from '@/utils/student-scope';
import { EXTRACURRICULAR_CATEGORIES, type PublicExtracurricular } from '@cipansor/shared';

/**
 * A coach as an extracurricular shows one: the name. Select, never include —
 * an included relation carries every column (lessons/prisma-include-leaks-pii.md).
 */
const coachName = {
  select: { id: true, user: { select: { id: true, name: true } } },
} as const;

/** A member as an extracurricular lists one: number and name, nothing else of a child's record. */
const studentName = {
  select: { id: true, nis: true, user: { select: { id: true, name: true } } },
} as const;

/** The education units, in the order the public site lists them (TK → Takhosus). */
const PUBLIC_UNIT_ORDER = ['TK_QURAN', 'SD_IT', 'SMP_IT', 'SMA_QURAN', 'PESANTREN'] as const;

export class ExtracurricularService {
  /**
   * What the public site lists on *Kegiatan*
   * (decisions/fasilitas-dan-kegiatan-situs-publik.md): every active
   * extracurricular of an education unit, once per name, with the units that
   * run it, by category then name. Name, translations, category and unit type
   * are all it selects — no coach, schedule or member leaves through here.
   */
  async publicList(): Promise<PublicExtracurricular[]> {
    const rows = await prisma.extracurricular.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        unit: { deletedAt: null, type: { in: [...PUBLIC_UNIT_ORDER] } },
      },
      select: {
        name: true,
        nameEn: true,
        nameAr: true,
        category: true,
        unit: { select: { type: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const byName = new Map<string, PublicExtracurricular>();
    for (const row of rows) {
      const name = row.name.trim();
      const key = name.toLocaleLowerCase('id');
      const entry = byName.get(key) ?? {
        name,
        nameEn: null,
        nameAr: null,
        category: row.category,
        unitTypes: [],
      };
      entry.nameEn ??= row.nameEn?.trim() || null;
      entry.nameAr ??= row.nameAr?.trim() || null;
      if (!entry.unitTypes.includes(row.unit.type)) entry.unitTypes.push(row.unit.type);
      byName.set(key, entry);
    }

    const categoryOrder = (e: PublicExtracurricular) =>
      EXTRACURRICULAR_CATEGORIES.indexOf(e.category);
    return [...byName.values()]
      .map((e) => ({
        ...e,
        unitTypes: PUBLIC_UNIT_ORDER.filter((t) => e.unitTypes.includes(t)),
      }))
      .sort((a, b) => categoryOrder(a) - categoryOrder(b) || a.name.localeCompare(b.name, 'id'));
  }

  /**
   * Get all extracurriculars with pagination
   */
  async findAll(
    query: ListExtracurricularsQuery,
    currentUser: { role: string; unitId: string | null }
  ) {
    const { page, limit, search, unitId, category, status, academicYearId, isCompulsory } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ExtracurricularWhereInput = {
      deletedAt: null,
    };

    // Filter by unit based on role
    if (!seesAllUnits(currentUser)) {
      where.unitId = currentUser.unitId || 'none';
    } else if (unitId) {
      where.unitId = unitId;
    }

    if (category) {
      where.category = category;
    }

    if (status) {
      where.status = status;
    }

    if (academicYearId) {
      where.academicYearId = academicYearId;
    }

    if (isCompulsory !== undefined) {
      where.isCompulsory = isCompulsory;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [extracurriculars, total] = await Promise.all([
      prisma.extracurricular.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          unit: {
            select: { id: true, name: true, type: true },
          },
          coach: coachName,
          assistantCoach: coachName,
          academicYear: {
            select: { id: true, name: true, isActive: true },
          },
          _count: {
            select: {
              enrollments: { where: { status: 'ACTIVE' } },
              achievements: true,
            },
          },
        },
      }),
      prisma.extracurricular.count({ where }),
    ]);

    return {
      data: extracurriculars,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get extracurricular by ID
   */
  async findById(id: string, currentUser: { role: string; unitId: string | null }) {
    const extracurricular = await prisma.extracurricular.findUnique({
      where: { id, deletedAt: null },
      include: {
        unit: { select: { id: true, name: true, type: true } },
        coach: coachName,
        assistantCoach: coachName,
        academicYear: { select: { id: true, name: true, isActive: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            status: true,
            enrolledAt: true,
            student: {
              select: {
                id: true,
                nis: true,
                user: { select: { id: true, name: true } },
                enrollments: {
                  where: { status: 'active' },
                  select: { class: { select: { id: true, name: true } } },
                  take: 1,
                },
              },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        },
        achievements: {
          orderBy: { eventDate: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } },
            attendances: true,
            achievements: true,
          },
        },
      },
    });

    if (!extracurricular) {
      throw Errors.notFound('Extracurricular not found');
    }

    // Check access
    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      extracurricular.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    return extracurricular;
  }

  /**
   * Create new extracurricular
   */
  async create(
    input: CreateExtracurricularInput,
    currentUser: { role: string; unitId: string | null }
  ) {
    // Validate unit access
    if (currentUser.role !== UserRole.SUPER_ADMIN && input.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Cannot create extracurricular for another unit');
    }

    // Check for duplicate code in same unit
    if (input.code) {
      const existing = await prisma.extracurricular.findFirst({
        where: {
          unitId: input.unitId,
          code: input.code,
          deletedAt: null,
        },
      });

      if (existing) {
        throw Errors.conflict('Extracurricular code already exists in this unit');
      }
    }

    const extracurricular = await prisma.extracurricular.create({
      data: {
        ...input,
        status: 'ACTIVE',
      },
      include: {
        unit: { select: { id: true, name: true } },
        coach: coachName,
        academicYear: { select: { id: true, name: true } },
      },
    });

    return extracurricular;
  }

  /**
   * Update extracurricular
   */
  async update(
    id: string,
    input: UpdateExtracurricularInput,
    currentUser: { role: string; unitId: string | null }
  ) {
    const extracurricular = await this.findById(id, currentUser);

    // Check for duplicate code
    if (input.code && input.code !== extracurricular.code) {
      const existing = await prisma.extracurricular.findFirst({
        where: {
          unitId: extracurricular.unitId,
          code: input.code,
          id: { not: id },
          deletedAt: null,
        },
      });

      if (existing) {
        throw Errors.conflict('Extracurricular code already exists');
      }
    }

    const updated = await prisma.extracurricular.update({
      where: { id },
      data: input,
      include: {
        unit: { select: { id: true, name: true } },
        coach: coachName,
        academicYear: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  /**
   * Soft delete extracurricular
   */
  async delete(id: string, currentUser: { role: string; unitId: string | null }) {
    await this.findById(id, currentUser);

    await prisma.extracurricular.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }

  // ==================
  // ENROLLMENT METHODS
  // ==================

  /**
   * Enroll student to extracurricular
   */
  async enrollStudent(
    input: EnrollStudentInput,
    currentUser: { role: string; unitId: string | null }
  ) {
    const { extracurricularId, studentId, notes } = input;

    // Check extracurricular exists
    const extracurricular = await this.findById(extracurricularId, currentUser);

    // Check student exists and is from same unit
    const student = await prisma.student.findUnique({
      where: { id: studentId, deletedAt: null },
    });

    if (!student) {
      throw Errors.notFound('Student not found');
    }

    if (student.unitId !== extracurricular.unitId) {
      throw Errors.badRequest('Student is not from the same unit');
    }

    // Check if already enrolled
    const existingEnrollment = await prisma.extracurricularEnrollment.findUnique({
      where: {
        extracurricularId_studentId: {
          extracurricularId,
          studentId,
        },
      },
    });

    if (existingEnrollment) {
      if (existingEnrollment.status === 'ACTIVE') {
        throw Errors.conflict('Student is already enrolled in this extracurricular');
      }
      // Reactivate if previously withdrawn
      const updated = await prisma.extracurricularEnrollment.update({
        where: { id: existingEnrollment.id },
        data: { status: 'ACTIVE', notes },
        include: {
          student: studentName,
          extracurricular: { select: { name: true } },
        },
      });
      return updated;
    }

    // Check capacity
    if (extracurricular.maxParticipants) {
      const currentCount = await prisma.extracurricularEnrollment.count({
        where: { extracurricularId, status: 'ACTIVE' },
      });

      if (currentCount >= extracurricular.maxParticipants) {
        throw Errors.badRequest('Extracurricular has reached maximum capacity');
      }
    }

    const enrollment = await prisma.extracurricularEnrollment.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        extracurricularId,
        studentId,
        notes,
        status: 'ACTIVE',
      } as any,
      include: {
        student: studentName,
        extracurricular: { select: { name: true } },
      },
    });

    return enrollment;
  }

  /**
   * Bulk enroll students
   */
  async bulkEnroll(input: BulkEnrollInput, currentUser: { role: string; unitId: string | null }) {
    const { extracurricularId, studentIds } = input;

    if (!studentIds || studentIds.length === 0) {
      throw Errors.badRequest('No students to enroll');
    }

    // 1. Validate extracurricular and permissions
    const extracurricular = await this.findById(extracurricularId, currentUser);

    // 2. Fetch all students in one go
    const students = await prisma.student.findMany({
      where: {
        id: { in: studentIds },
        deletedAt: null,
      },
      select: { id: true, unitId: true },
    });

    const studentMap = new Map(students.map((s) => [s.id, s]));
    const errors: string[] = [];

    // 3. Validate students
    for (const studentId of studentIds) {
      const student = studentMap.get(studentId);
      if (!student) {
        errors.push(`Student ${studentId}: Not found`);
      } else if (student.unitId !== extracurricular.unitId) {
        errors.push(`Student ${studentId}: Not in the same unit`);
      }
    }

    if (errors.length > 0) {
      return { success: 0, failed: studentIds.length, errors };
    }

    // 4. Check for existing enrollments
    const existingEnrollments = await prisma.extracurricularEnrollment.findMany({
      where: {
        extracurricularId,
        studentId: { in: studentIds },
      },
      select: { studentId: true, status: true },
    });

    const existingEnrollmentMap = new Map(existingEnrollments.map((e) => [e.studentId, e.status]));
    const studentsToEnroll: string[] = [];
    const studentsToReactivate: string[] = [];

    for (const studentId of studentIds) {
      const status = existingEnrollmentMap.get(studentId);
      if (!status) {
        studentsToEnroll.push(studentId);
      } else if (status !== 'ACTIVE') {
        studentsToReactivate.push(studentId);
      } else {
        errors.push(`Student ${studentId}: Already actively enrolled`);
      }
    }

    // 5. Check capacity
    const currentCount = await prisma.extracurricularEnrollment.count({
      where: { extracurricularId, status: 'ACTIVE' },
    });
    const totalJoining = studentsToEnroll.length + studentsToReactivate.length;
    if (
      extracurricular.maxParticipants &&
      currentCount + totalJoining > extracurricular.maxParticipants
    ) {
      throw Errors.badRequest(
        `Cannot enroll/reactivate ${totalJoining} students. Exceeds maximum capacity of ${extracurricular.maxParticipants}.`
      );
    }

    // 6. Perform bulk operations
    const createPromise =
      studentsToEnroll.length > 0
        ? prisma.extracurricularEnrollment.createMany({
            data: studentsToEnroll.map((studentId) => ({
              extracurricularId,
              studentId,
              status: 'ACTIVE',
            })),
            skipDuplicates: true,
          })
        : Promise.resolve({ count: 0 });

    const reactivatePromise =
      studentsToReactivate.length > 0
        ? prisma.extracurricularEnrollment.updateMany({
            where: {
              extracurricularId,
              studentId: { in: studentsToReactivate },
            },
            data: { status: 'ACTIVE' },
          })
        : Promise.resolve({ count: 0 });

    const [createResult, reactivateResult] = await Promise.all([createPromise, reactivatePromise]);

    const successCount = createResult.count + reactivateResult.count;

    return {
      success: successCount,
      failed: studentIds.length - successCount,
      errors,
    };
  }

  /**
   * Update enrollment
   */
  async updateEnrollment(
    id: string,
    input: UpdateEnrollmentInput,
    currentUser: { role: string; unitId: string | null }
  ) {
    const enrollment = await prisma.extracurricularEnrollment.findUnique({
      where: { id },
      include: {
        extracurricular: { select: { unitId: true } },
      },
    });

    if (!enrollment) {
      throw Errors.notFound('Enrollment not found');
    }

    // Check access
    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      enrollment.extracurricular.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    const updated = await prisma.extracurricularEnrollment.update({
      where: { id },
      data: {
        ...input,
        graduatedAt: input.status === 'GRADUATED' ? new Date() : undefined,
      },
    });

    return updated;
  }

  /**
   * List enrollments
   */
  async listEnrollments(
    query: ListEnrollmentsQuery,
    currentUser: { role: string; unitId: string | null }
  ) {
    const { page, limit, extracurricularId, studentId, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ExtracurricularEnrollmentWhereInput = {};

    if (extracurricularId) {
      where.extracurricularId = extracurricularId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (status) {
      where.status = status;
    }

    // Filter by unit
    if (!seesAllUnits(currentUser)) {
      where.extracurricular = { unitId: currentUser.unitId || 'none' };
    }

    const [enrollments, total] = await Promise.all([
      prisma.extracurricularEnrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { enrolledAt: 'desc' },
        include: {
          student: {
            select: {
              ...studentName.select,
              enrollments: {
                where: { status: 'active' },
                select: { class: { select: { name: true } } },
                take: 1,
              },
            },
          },
          extracurricular: { select: { id: true, name: true, category: true } },
        },
      }),
      prisma.extracurricularEnrollment.count({ where }),
    ]);

    return {
      data: enrollments,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ==================
  // ATTENDANCE METHODS
  // ==================

  /**
   * Record attendance for an extracurricular session
   */
  async recordAttendance(
    input: RecordAttendanceInput,
    currentUser: { sub: string; role: string; unitId: string | null }
  ) {
    const { extracurricularId, date, attendances } = input;

    // Verify extracurricular
    const extracurricular = await this.findById(extracurricularId, currentUser);

    const recordDate = new Date(date);

    // Fetch active enrollments for all students
    const studentIds = attendances.map((att) => att.studentId);
    const enrollments = await prisma.extracurricularEnrollment.findMany({
      where: {
        extracurricularId,
        studentId: { in: studentIds },
        status: 'ACTIVE',
      },
      select: { studentId: true },
    });

    const enrolledStudentIds = new Set(enrollments.map((e) => e.studentId));

    // Create or update attendance records
    const results = await Promise.all(
      attendances.map(async (att) => {
        // Verify student is enrolled
        if (!enrolledStudentIds.has(att.studentId)) {
          throw Errors.badRequest(
            `Student ${att.studentId} is not enrolled in this extracurricular`
          );
        }

        return prisma.extracurricularAttendance.upsert({
          where: {
            extracurricularId_studentId_date: {
              extracurricularId,
              studentId: att.studentId,
              date: recordDate,
            },
          },
          update: {
            status: att.status as PrismaAttendanceStatus,
            notes: att.notes,
            recordedById: currentUser.sub,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: {
            extracurricularId,
            studentId: att.studentId,
            date: recordDate,
            status: att.status as PrismaAttendanceStatus,
            notes: att.notes,
            recordedById: currentUser.sub,
          } as any,
        });
      })
    );

    return {
      recorded: results.length,
      date: recordDate,
      extracurricularId,
    };
  }

  /**
   * List attendance records
   */
  async listAttendance(
    query: ListAttendanceQuery,
    currentUser: { role: string; unitId: string | null }
  ) {
    const { page, limit, extracurricularId, studentId, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ExtracurricularAttendanceWhereInput = {};

    if (extracurricularId) {
      where.extracurricularId = extracurricularId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Filter by unit
    if (!seesAllUnits(currentUser)) {
      where.extracurricular = { unitId: currentUser.unitId || 'none' };
    }

    const [attendances, total] = await Promise.all([
      prisma.extracurricularAttendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: {
          student: studentName,
          extracurricular: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.extracurricularAttendance.count({ where }),
    ]);

    return {
      data: attendances,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get attendance summary for an extracurricular
   */
  async getAttendanceSummary(
    extracurricularId: string,
    currentUser: { role: string; unitId: string | null }
  ) {
    await this.findById(extracurricularId, currentUser);

    const summary = await prisma.extracurricularAttendance.groupBy({
      by: ['status'],
      where: { extracurricularId },
      _count: { status: true },
    });

    const byStudent = await prisma.extracurricularAttendance.groupBy({
      by: ['studentId', 'status'],
      where: { extracurricularId },
      _count: { status: true },
    });

    return {
      overall: summary,
      byStudent,
    };
  }

  // ====================
  // ACHIEVEMENT METHODS
  // ====================

  /**
   * Create achievement
   */
  async createAchievement(
    input: CreateAchievementInput,
    currentUser: { role: string; unitId: string | null }
  ) {
    // Verify extracurricular
    await this.findById(input.extracurricularId, currentUser);

    const achievement = await prisma.extracurricularAchievement.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...input,
        eventDate: new Date(input.eventDate),
      } as any,
      include: {
        extracurricular: { select: { id: true, name: true } },
        student: studentName,
      },
    });

    return achievement;
  }

  /**
   * List achievements
   */
  async listAchievements(
    query: ListAchievementsQuery,
    currentUser: { role: string; unitId: string | null }
  ) {
    const { page, limit, extracurricularId, studentId, level } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ExtracurricularAchievementWhereInput = {};

    if (extracurricularId) {
      where.extracurricularId = extracurricularId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (level) {
      where.level = level;
    }

    // Filter by unit
    if (!seesAllUnits(currentUser)) {
      where.extracurricular = { unitId: currentUser.unitId || 'none' };
    }

    const [achievements, total] = await Promise.all([
      prisma.extracurricularAchievement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { eventDate: 'desc' },
        include: {
          extracurricular: { select: { id: true, name: true, category: true } },
          student: studentName,
        },
      }),
      prisma.extracurricularAchievement.count({ where }),
    ]);

    return {
      data: achievements,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Delete achievement
   */
  async deleteAchievement(id: string, currentUser: { role: string; unitId: string | null }) {
    const achievement = await prisma.extracurricularAchievement.findUnique({
      where: { id },
      include: { extracurricular: { select: { unitId: true } } },
    });

    if (!achievement) {
      throw Errors.notFound('Achievement not found');
    }

    if (
      currentUser.role !== UserRole.SUPER_ADMIN &&
      achievement.extracurricular.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    await prisma.extracurricularAchievement.delete({ where: { id } });

    return { success: true };
  }

  // =================
  // HELPER METHODS
  // =================

  /**
   * Get student's extracurricular activities. The santri must be inside the
   * caller's Cakupan_Santri (`studentScope`): a santri their own, a wali their
   * children's, a cross-unit staff member every unit's, anyone else their own
   * unit's (R27.4). A santri outside it is answered 404, the same as one that
   * does not exist — not the 403 the old unit check returned (R27.5).
   */
  async getStudentExtracurriculars(studentId: string, actor: ScopeActor) {
    await assertStudentInScope(studentId, actor);

    const enrollments = await prisma.extracurricularEnrollment.findMany({
      where: { studentId },
      include: {
        extracurricular: {
          include: {
            coach: coachName,
            academicYear: { select: { name: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    const achievements = await prisma.extracurricularAchievement.findMany({
      where: { studentId },
      include: {
        extracurricular: { select: { name: true } },
      },
      orderBy: { eventDate: 'desc' },
    });

    return {
      enrollments,
      achievements,
    };
  }

  /**
   * Get extracurricular statistics for a unit
   */
  async getStatistics(unitId: string, academicYearId?: string) {
    const where: Prisma.ExtracurricularWhereInput = {
      unitId,
      deletedAt: null,
    };

    if (academicYearId) {
      where.academicYearId = academicYearId;
    }

    const [totalExtracurriculars, totalEnrollments, categoryStats, recentAchievements] =
      await Promise.all([
        prisma.extracurricular.count({ where }),
        prisma.extracurricularEnrollment.count({
          where: {
            extracurricular: where,
            status: 'ACTIVE',
          },
        }),
        prisma.extracurricular.groupBy({
          by: ['category'],
          where,
          _count: { category: true },
        }),
        prisma.extracurricularAchievement.findMany({
          where: { extracurricular: where },
          orderBy: { eventDate: 'desc' },
          take: 5,
          include: {
            extracurricular: { select: { name: true } },
            student: studentName,
          },
        }),
      ]);

    return {
      totalExtracurriculars,
      totalEnrollments,
      categoryStats,
      recentAchievements,
    };
  }
}

export const extracurricularService = new ExtracurricularService();
