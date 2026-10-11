import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { Prisma } from '@prisma/client';
import { CLASS_ENROLLMENT_STATUS } from '@cipansor/shared';
import {
  assertStudentInScope,
  onlyScopedStudents,
  studentScope,
  STUDENT_SAFE_SELECT,
  TEACHER_SAFE_SELECT,
} from '@/utils/student-scope';

// Status enum
type MuhadhorohStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

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

interface ListMuhadhorohQuery {
  unitId?: string;
  studentId?: string;
  evaluatorId?: string;
  status?: MuhadhorohStatus;
  language?: string;
  startDate?: string;
  endDate?: string;
  page: number;
  limit: number;
}

interface CreateMuhadhorohInput {
  /** Optional: the record takes the santri's unit; when given it must match. */
  unitId?: string;
  studentId: string;
  scheduledAt: string;
  topic: string;
  language?: string;
}

interface UpdateMuhadhorohInput {
  topic?: string;
  language?: string;
  scheduledAt?: string;
  status?: MuhadhorohStatus;
}

interface EvaluateMuhadhorohInput {
  contentScore: number;
  deliveryScore: number;
  languageScore: number;
  feedback?: string;
  videoUrl?: string;
  duration?: number;
}

/**
 * The records a reader may see: those of the santri they reach (`studentScope`
 * — a santri their own, a wali their children's, the pesantren's staff every
 * unit's, anyone else their unit's), narrowed to one unit on request.
 *
 * These reads took the unit from the query, defaulting to the reader's own,
 * and checked nothing else, so any account could read any unit by naming it.
 */
function readable(currentUser: AuthenticatedUser, unitId?: string): Prisma.MuhadhorohWhereInput {
  return {
    ...onlyScopedStudents(studentScope(currentUser)),
    ...(unitId ? { unitId } : {}),
  };
}

export class MuhadhorohService {
  // ==================
  // CRUD METHODS
  // ==================

  async list(query: ListMuhadhorohQuery, currentUser: AuthenticatedUser) {
    const { page, limit, unitId, studentId, evaluatorId, status, language, startDate, endDate } =
      query;
    const skip = (page - 1) * limit;

    const where: Prisma.MuhadhorohWhereInput = {};

    Object.assign(where, readable(currentUser, unitId));

    if (studentId) {
      where.studentId = studentId;
    }

    if (evaluatorId) {
      where.evaluatorId = evaluatorId;
    }

    if (status) {
      where.status = status;
    }

    if (language) {
      where.language = language;
    }

    if (startDate || endDate) {
      where.scheduledAt = {};
      if (startDate) where.scheduledAt.gte = new Date(startDate);
      if (endDate) where.scheduledAt.lte = new Date(endDate);
    }

    const [records, total] = await Promise.all([
      prisma.muhadhoroh.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'desc' },
        include: {
          unit: { select: { id: true, name: true } },
          student: {
            select: {
              id: true,
              nis: true,
              user: { select: { name: true } },
              enrollments: {
                where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
                select: { class: { select: { id: true, name: true, level: true } } },
                take: 1,
              },
            },
          },
          evaluator: { select: TEACHER_SAFE_SELECT },
        },
      }),
      prisma.muhadhoroh.count({ where }),
    ]);

    return {
      data: records.map((r) => ({
        ...r,
        student: {
          id: r.student.id,
          nis: r.student.nis,
          name: r.student.user.name,
          class: r.student.enrollments[0]?.class || null,
        },
        evaluator: r.evaluator
          ? {
              id: r.evaluator.id,
              name: r.evaluator.user.name,
            }
          : null,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getById(id: string, currentUser: AuthenticatedUser) {
    const record = await prisma.muhadhoroh.findUnique({
      where: { id },
      include: {
        unit: true,
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { name: true, email: true } },
            enrollments: {
              where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
              select: { class: true },
              take: 1,
            },
          },
        },
        evaluator: { select: TEACHER_SAFE_SELECT },
      },
    });

    if (!record) {
      throw Errors.notFound('Muhadhoroh record not found');
    }

    await assertStudentInScope(record.studentId, currentUser);

    return {
      ...record,
      student: {
        id: record.student.id,
        nis: record.student.nis,
        name: record.student.user.name,
        email: record.student.user.email,
        class: record.student.enrollments[0]?.class || null,
      },
      evaluator: record.evaluator
        ? {
            id: record.evaluator.id,
            name: record.evaluator.user.name,
          }
        : null,
    };
  }

  async create(input: CreateMuhadhorohInput, currentUser: AuthenticatedUser) {
    const student = await prisma.student.findFirst({
      where: { id: input.studentId, deletedAt: null },
      select: { id: true, unitId: true },
    });
    if (!student) {
      throw Errors.notFound('Student not found');
    }
    // A santri the writer reaches — any unit's for the pesantren's staff. The
    // record belongs to the santri's unit, not the writer's: a musyrif's unit
    // is the pesantren, the santri's is their school.
    await assertStudentInScope(student.id, currentUser);
    if (input.unitId && input.unitId !== student.unitId) {
      throw Errors.badRequest('Santri ini bukan santri unit yang dipilih');
    }

    const record = await prisma.muhadhoroh.create({
      data: {
        unitId: student.unitId,
        studentId: input.studentId,
        scheduledAt: new Date(input.scheduledAt),
        topic: input.topic,
        language: input.language || 'Indonesian',
        status: 'SCHEDULED',
      },
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        unit: { select: { id: true, name: true } },
      },
    });

    return record;
  }

  async update(id: string, input: UpdateMuhadhorohInput, currentUser: AuthenticatedUser) {
    await this.getById(id, currentUser);

    const updated = await prisma.muhadhoroh.update({
      where: { id },
      data: {
        topic: input.topic,
        language: input.language,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        status: input.status,
      },
    });

    return updated;
  }

  async delete(id: string, currentUser: AuthenticatedUser) {
    await this.getById(id, currentUser);
    await prisma.muhadhoroh.delete({ where: { id } });
    return { success: true };
  }

  // ==================
  // EVALUATION
  // ==================

  async evaluate(id: string, input: EvaluateMuhadhorohInput, currentUser: AuthenticatedUser) {
    const record = await this.getById(id, currentUser);

    if (record.status === 'COMPLETED') {
      throw Errors.conflict('This muhadhoroh has already been evaluated');
    }

    if (record.status === 'CANCELLED') {
      throw Errors.conflict('Cannot evaluate a cancelled muhadhoroh');
    }

    // Calculate total score and grade
    const totalScore = Math.round(
      (input.contentScore + input.deliveryScore + input.languageScore) / 3
    );
    const grade = this.calculateGrade(totalScore);

    // Get evaluator's teacher ID
    const teacher = await prisma.teacher.findFirst({
      where: { userId: currentUser.sub },
    });

    const updated = await prisma.muhadhoroh.update({
      where: { id },
      data: {
        contentScore: input.contentScore,
        deliveryScore: input.deliveryScore,
        languageScore: input.languageScore,
        totalScore,
        grade,
        feedback: input.feedback,
        videoUrl: input.videoUrl,
        duration: input.duration,
        evaluatorId: teacher?.id || null,
        evaluatedAt: new Date(),
        status: 'COMPLETED',
      },
    });

    return updated;
  }

  async cancel(id: string, currentUser: AuthenticatedUser) {
    const record = await this.getById(id, currentUser);

    if (record.status !== 'SCHEDULED') {
      throw Errors.conflict('Only scheduled muhadhoroh can be cancelled');
    }

    const updated = await prisma.muhadhoroh.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    return updated;
  }

  // ==================
  // QUERIES
  // ==================

  async getUpcoming(currentUser: AuthenticatedUser, unitId?: string, limit: number = 10) {
    const now = new Date();

    const records = await prisma.muhadhoroh.findMany({
      where: {
        ...readable(currentUser, unitId),
        status: 'SCHEDULED',
        scheduledAt: { gte: now },
      },
      take: limit,
      orderBy: { scheduledAt: 'asc' },
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { name: true } },
            enrollments: {
              where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
              select: { class: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
    });

    return records.map((r) => ({
      ...r,
      student: {
        id: r.student.id,
        nis: r.student.nis,
        name: r.student.user.name,
        class: r.student.enrollments[0]?.class?.name || null,
      },
    }));
  }

  async getStudentHistory(currentUser: AuthenticatedUser, studentId: string, limit: number = 20) {
    await assertStudentInScope(studentId, currentUser);
    const records = await prisma.muhadhoroh.findMany({
      where: { studentId },
      take: limit,
      orderBy: { scheduledAt: 'desc' },
      include: {
        evaluator: { select: TEACHER_SAFE_SELECT },
      },
    });

    return records;
  }

  async getStatistics(
    currentUser: AuthenticatedUser,
    unitId?: string,
    startDate?: string,
    endDate?: string
  ) {
    const where: Prisma.MuhadhorohWhereInput = readable(currentUser, unitId);

    if (startDate && endDate) {
      where.scheduledAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [total, byStatus, byLanguage, avgScores] = await Promise.all([
      prisma.muhadhoroh.count({ where }),
      prisma.muhadhoroh.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      prisma.muhadhoroh.groupBy({
        by: ['language'],
        where,
        _count: { language: true },
      }),
      prisma.muhadhoroh.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _avg: {
          contentScore: true,
          deliveryScore: true,
          languageScore: true,
          totalScore: true,
        },
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.status })),
      byLanguage: byLanguage.map((l) => ({ language: l.language, count: l._count.language })),
      averages: {
        content: avgScores._avg.contentScore || 0,
        delivery: avgScores._avg.deliveryScore || 0,
        language: avgScores._avg.languageScore || 0,
        total: avgScores._avg.totalScore || 0,
      },
    };
  }

  async getTopPerformers(currentUser: AuthenticatedUser, unitId?: string, limit: number = 10) {
    const performers = await prisma.muhadhoroh.groupBy({
      by: ['studentId'],
      where: {
        ...readable(currentUser, unitId),
        status: 'COMPLETED',
        totalScore: { not: null },
      },
      _avg: { totalScore: true },
      _count: { id: true },
      orderBy: { _avg: { totalScore: 'desc' } },
      take: limit,
    });

    const studentIds = performers.map((p) => p.studentId);
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        nis: true,
        user: { select: { name: true } },
        enrollments: {
          where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
          include: { class: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const studentMap = new Map(students.map((s) => [s.id, s]));

    return performers.map((p) => {
      const student = studentMap.get(p.studentId);
      return {
        studentId: p.studentId,
        name: student?.user.name || 'Unknown',
        nis: student?.nis || '',
        class: student?.enrollments[0]?.class?.name || null,
        averageScore: p._avg.totalScore || 0,
        totalSessions: p._count.id,
      };
    });
  }

  // ==================
  // HELPERS
  // ==================

  private calculateGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'E';
  }
}

export const muhadhorohService = new MuhadhorohService();
