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
type MuhadatsahStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

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

interface ListMuhadatsahQuery {
  unitId?: string;
  studentId?: string;
  partnerId?: string;
  evaluatorId?: string;
  status?: MuhadatsahStatus;
  language?: string;
  startDate?: string;
  endDate?: string;
  page: number;
  limit: number;
}

interface CreateMuhadatsahInput {
  /** Optional: the record takes the santri's unit; when given it must match. */
  unitId?: string;
  studentId: string;
  partnerId?: string;
  scheduledAt: string;
  topic?: string;
  language: string; // Arabic, English
}

interface UpdateMuhadatsahInput {
  topic?: string;
  language?: string;
  partnerId?: string;
  scheduledAt?: string;
  status?: MuhadatsahStatus;
}

interface EvaluateMuhadatsahInput {
  fluencyScore: number;
  grammarScore: number;
  vocabularyScore: number;
  pronunciationScore: number;
  feedback?: string;
  recordingUrl?: string;
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
function readable(currentUser: AuthenticatedUser, unitId?: string): Prisma.MuhadatsahWhereInput {
  return {
    ...onlyScopedStudents(studentScope(currentUser)),
    ...(unitId ? { unitId } : {}),
  };
}

export class MuhadatsahService {
  // ==================
  // CRUD METHODS
  // ==================

  async list(query: ListMuhadatsahQuery, currentUser: AuthenticatedUser) {
    const {
      page,
      limit,
      unitId,
      studentId,
      partnerId,
      evaluatorId,
      status,
      language,
      startDate,
      endDate,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MuhadatsahWhereInput = {};

    Object.assign(where, readable(currentUser, unitId));

    if (studentId) {
      where.studentId = studentId;
    }

    if (partnerId) {
      where.partnerId = partnerId;
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
      prisma.muhadatsah.findMany({
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
          partner: { select: STUDENT_SAFE_SELECT },
          evaluator: { select: TEACHER_SAFE_SELECT },
        },
      }),
      prisma.muhadatsah.count({ where }),
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
        partner: r.partner
          ? {
              id: r.partner.id,
              nis: r.partner.nis,
              name: r.partner.user.name,
            }
          : null,
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
    const record = await prisma.muhadatsah.findUnique({
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
        partner: { select: STUDENT_SAFE_SELECT },
        evaluator: { select: TEACHER_SAFE_SELECT },
      },
    });

    if (!record) {
      throw Errors.notFound('Muhadatsah record not found');
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
      partner: record.partner
        ? {
            id: record.partner.id,
            nis: record.partner.nis,
            name: record.partner.user.name,
          }
        : null,
      evaluator: record.evaluator
        ? {
            id: record.evaluator.id,
            name: record.evaluator.user.name,
          }
        : null,
    };
  }

  async create(input: CreateMuhadatsahInput, currentUser: AuthenticatedUser) {
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

    // Verify partner if provided — a santri the writer reaches as well.
    if (input.partnerId) {
      const partner = await prisma.student.findFirst({
        where: { id: input.partnerId, deletedAt: null },
        select: { id: true },
      });
      if (!partner) {
        throw Errors.notFound('Partner student not found');
      }
      await assertStudentInScope(partner.id, currentUser);
    }

    const record = await prisma.muhadatsah.create({
      data: {
        unitId: student.unitId,
        studentId: input.studentId,
        partnerId: input.partnerId,
        scheduledAt: new Date(input.scheduledAt),
        topic: input.topic,
        language: input.language,
        status: 'SCHEDULED',
      },
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        partner: { select: STUDENT_SAFE_SELECT },
        unit: { select: { id: true, name: true } },
      },
    });

    return record;
  }

  async update(id: string, input: UpdateMuhadatsahInput, currentUser: AuthenticatedUser) {
    await this.getById(id, currentUser);

    const updated = await prisma.muhadatsah.update({
      where: { id },
      data: {
        topic: input.topic,
        language: input.language,
        partnerId: input.partnerId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        status: input.status,
      },
    });

    return updated;
  }

  async delete(id: string, currentUser: AuthenticatedUser) {
    await this.getById(id, currentUser);
    await prisma.muhadatsah.delete({ where: { id } });
    return { success: true };
  }

  // ==================
  // EVALUATION
  // ==================

  async evaluate(id: string, input: EvaluateMuhadatsahInput, currentUser: AuthenticatedUser) {
    const record = await this.getById(id, currentUser);

    if (record.status === 'COMPLETED') {
      throw Errors.conflict('This muhadatsah has already been evaluated');
    }

    if (record.status === 'CANCELLED') {
      throw Errors.conflict('Cannot evaluate a cancelled muhadatsah');
    }

    // Calculate total score and grade
    const totalScore = Math.round(
      (input.fluencyScore + input.grammarScore + input.vocabularyScore + input.pronunciationScore) /
        4
    );
    const grade = this.calculateGrade(totalScore);

    // Get evaluator's teacher ID
    const teacher = await prisma.teacher.findFirst({
      where: { userId: currentUser.sub },
    });

    const updated = await prisma.muhadatsah.update({
      where: { id },
      data: {
        fluencyScore: input.fluencyScore,
        grammarScore: input.grammarScore,
        vocabularyScore: input.vocabularyScore,
        pronunciationScore: input.pronunciationScore,
        totalScore,
        grade,
        feedback: input.feedback,
        recordingUrl: input.recordingUrl,
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
      throw Errors.conflict('Only scheduled muhadatsah can be cancelled');
    }

    const updated = await prisma.muhadatsah.update({
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

    const records = await prisma.muhadatsah.findMany({
      where: {
        ...readable(currentUser, unitId),
        status: 'SCHEDULED',
        scheduledAt: { gte: now },
      },
      take: limit,
      orderBy: { scheduledAt: 'asc' },
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        partner: { select: STUDENT_SAFE_SELECT },
      },
    });

    return records.map((r) => ({
      ...r,
      student: {
        id: r.student.id,
        nis: r.student.nis,
        name: r.student.user.name,
      },
      partner: r.partner
        ? {
            id: r.partner.id,
            nis: r.partner.nis,
            name: r.partner.user.name,
          }
        : null,
    }));
  }

  async getStudentHistory(currentUser: AuthenticatedUser, studentId: string, limit: number = 20) {
    await assertStudentInScope(studentId, currentUser);
    const records = await prisma.muhadatsah.findMany({
      where: {
        OR: [{ studentId }, { partnerId: studentId }],
      },
      take: limit,
      orderBy: { scheduledAt: 'desc' },
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        partner: { select: STUDENT_SAFE_SELECT },
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
    const where: Prisma.MuhadatsahWhereInput = readable(currentUser, unitId);

    if (startDate && endDate) {
      where.scheduledAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [total, byStatus, byLanguage, avgScores] = await Promise.all([
      prisma.muhadatsah.count({ where }),
      prisma.muhadatsah.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      prisma.muhadatsah.groupBy({
        by: ['language'],
        where,
        _count: { language: true },
      }),
      prisma.muhadatsah.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _avg: {
          fluencyScore: true,
          grammarScore: true,
          vocabularyScore: true,
          pronunciationScore: true,
          totalScore: true,
        },
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.status })),
      byLanguage: byLanguage.map((l) => ({ language: l.language, count: l._count.language })),
      averages: {
        fluency: avgScores._avg.fluencyScore || 0,
        grammar: avgScores._avg.grammarScore || 0,
        vocabulary: avgScores._avg.vocabularyScore || 0,
        pronunciation: avgScores._avg.pronunciationScore || 0,
        total: avgScores._avg.totalScore || 0,
      },
    };
  }

  async getTopPerformers(
    currentUser: AuthenticatedUser,
    unitId?: string,
    language?: string,
    limit: number = 10
  ) {
    const where: Prisma.MuhadatsahWhereInput = {
      ...readable(currentUser, unitId),
      status: 'COMPLETED',
      totalScore: { not: null },
    };

    if (language) {
      where.language = language;
    }

    const performers = await prisma.muhadatsah.groupBy({
      by: ['studentId'],
      where,
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

  async matchPartners(
    currentUser: AuthenticatedUser,
    unitId: string | undefined,
    language: string
  ) {
    // Find students who don't have a scheduled muhadatsah yet this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Get students who already have muhadatsah this week
    const scheduledThisWeek = await prisma.muhadatsah.findMany({
      where: {
        ...readable(currentUser, unitId),
        language,
        status: 'SCHEDULED',
        scheduledAt: { gte: weekStart, lte: weekEnd },
      },
      select: { studentId: true, partnerId: true },
    });

    const scheduledStudentIds = new Set<string>();
    scheduledThisWeek.forEach((s) => {
      scheduledStudentIds.add(s.studentId);
      if (s.partnerId) scheduledStudentIds.add(s.partnerId);
    });

    // Get available students
    // Santri the reader reaches — every unit's for the pesantren's staff,
    // who pair santri across the asrama — narrowed to one unit on request.
    const availableStudents = await prisma.student.findMany({
      where: {
        AND: [studentScope(currentUser), unitId ? { unitId } : {}],
        deletedAt: null,
        id: { notIn: Array.from(scheduledStudentIds) },
      },
      select: {
        id: true,
        nis: true,
        user: { select: { name: true } },
        enrollments: {
          where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
          include: { class: { select: { name: true, level: true } } },
          take: 1,
        },
      },
    });

    return availableStudents.map((s) => ({
      id: s.id,
      nis: s.nis,
      name: s.user.name,
      class: s.enrollments[0]?.class || null,
    }));
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

export const muhadatsahService = new MuhadatsahService();
