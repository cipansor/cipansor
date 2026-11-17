import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { dayDate, wibDayOf } from '@/utils/wib';
import { assertStudentInScope, studentScope, type ScopeActor } from '@/utils/student-scope';
import { Errors } from '@/middleware/error';
import type {
  ListSimaanQuery,
  CreateSimaanInput,
  UpdateSimaanInput,
  CreateExaminerInput,
  UpdateExaminerInput,
  SubmitScoresInput,
  StudentSimaanSummaryQuery,
  HalaqohSimaanQuery,
} from './simaan.schema';

// ============================================
// Simaan Service
// ============================================

/**
 * The exam with `id`, or 404 when it is not one the caller may touch.
 *
 * Every write goes through here: `update`/`delete` used to run
 * `prisma.simaanExam.update({ where: { id } })` unscoped, so a teacher could
 * change or delete another unit's exam by guessing its id, and a missing id
 * surfaced as a 500 (P2025) rather than 404. Not-found rather than forbidden,
 * so the answer does not confirm the id.
 */
async function assertExamInScope(id: string, actor: ScopeActor): Promise<void> {
  const found = await prisma.simaanExam.findFirst({
    where: { id, student: studentScope(actor) },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Simaan exam');
}

/** The examiner row with `id`, or 404 unless its exam's santri is in scope. */
async function assertExaminerInScope(id: string, actor: ScopeActor): Promise<void> {
  const found = await prisma.simaanExaminer.findFirst({
    where: { id, simaan: { student: studentScope(actor) } },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Examiner');
}

export const simaanService = {
  // ============================================
  // LIST & READ
  // ============================================

  async findAll(query: ListSimaanQuery, context: ScopeActor) {
    const {
      page = 1,
      limit = 20,
      studentId,
      enrollmentId,
      halaqohId,
      unitId,
      simaanType,
      dateFrom,
      dateTo,
      passed,
      search,
    } = query;

    // Scoped like murojaah.findAll: staff their unit (the yayasan board and the
    // boarding/shared-service staff, whose santri span units, all of them), a
    // santri their own records, a wali their children's. `?unitId=` narrows
    // within that scope; it used to replace it, so a unit account could reopen
    // any unit's exam list — scores and NISN included.
    const scope = studentScope(context);
    const where: Prisma.SimaanExamWhereInput = {
      student: unitId ? { AND: [scope, { unitId }] } : scope,
    };

    if (studentId) where.studentId = studentId;
    if (enrollmentId) where.enrollmentId = enrollmentId;
    if (halaqohId) where.halaqohId = halaqohId;
    if (simaanType) where.simaanType = simaanType;
    if (passed !== undefined) where.passed = passed;

    if (dateFrom || dateTo) {
      where.examDate = {};
      if (dateFrom) where.examDate.gte = new Date(dateFrom);
      if (dateTo) where.examDate.lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { notes: { contains: search, mode: 'insensitive' } },
        { recommendations: { contains: search, mode: 'insensitive' } },
        { student: { user: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [records, total] = await Promise.all([
      prisma.simaanExam.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              nis: true,
              user: { select: { id: true, name: true } },
            },
          },
          enrollment: {
            select: { id: true, status: true },
          },
          halaqoh: {
            select: { id: true, name: true },
          },
          examiners: {
            include: {
              examiner: { select: { id: true, name: true } },
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ examDate: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.simaanExam.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async findById(id: string, context: ScopeActor) {
    const record = await prisma.simaanExam.findFirstOrThrow({
      where: { id, student: studentScope(context) },
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            nisn: true,
            user: { select: { id: true, name: true } },
          },
        },
        enrollment: {
          select: { id: true, status: true },
        },
        halaqoh: {
          select: { id: true, name: true, level: true },
        },
        examiners: {
          include: {
            examiner: { select: { id: true, name: true } },
          },
        },
      },
    });

    return record;
  },

  // ============================================
  // CREATE
  // ============================================

  async create(data: CreateSimaanInput, context: ScopeActor) {
    // The santri named in the body must be one the caller may see, or a teacher
    // could file an exam against another unit's santri by its id (404, not 403,
    // so the answer does not confirm the id).
    await assertStudentInScope(data.studentId, context);

    const examDate = dayDate(data.examDate);

    const record = await prisma.simaanExam.create({
      data: {
        studentId: data.studentId,
        enrollmentId: data.enrollmentId,
        halaqohId: data.halaqohId,
        simaanType: data.simaanType,
        examDate,
        sessionNumber: data.sessionNumber || 1,
        totalSessions: data.totalSessions || 1,
        juzStart: data.juzStart,
        juzEnd: data.juzEnd,
        overallScore: data.overallScore,
        tajwidScore: data.tajwidScore,
        fashohaScore: data.fashohaScore,
        tartilScore: data.tartilScore,
        grade: data.grade,
        passed: data.passed || false,
        notes: data.notes,
        recommendations: data.recommendations,
        examiners:
          data.examinerIds && data.examinerIds.length > 0
            ? {
                create: data.examinerIds.map((examinerId) => ({
                  examinerId,
                })),
              }
            : undefined,
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        halaqoh: { select: { id: true, name: true } },
        examiners: {
          include: { examiner: { select: { id: true, name: true } } },
        },
      },
    });

    return record;
  },

  // ============================================
  // UPDATE
  // ============================================

  async update(id: string, data: UpdateSimaanInput, context: ScopeActor) {
    await assertExamInScope(id, context);

    const record = await prisma.simaanExam.update({
      where: { id },
      data: {
        ...(data.simaanType && { simaanType: data.simaanType }),
        ...(data.examDate && { examDate: dayDate(data.examDate) }),
        ...(data.sessionNumber !== undefined && { sessionNumber: data.sessionNumber }),
        ...(data.totalSessions !== undefined && { totalSessions: data.totalSessions }),
        ...(data.juzStart !== undefined && { juzStart: data.juzStart }),
        ...(data.juzEnd !== undefined && { juzEnd: data.juzEnd }),
        ...(data.overallScore !== undefined && { overallScore: data.overallScore }),
        ...(data.tajwidScore !== undefined && { tajwidScore: data.tajwidScore }),
        ...(data.fashohaScore !== undefined && { fashohaScore: data.fashohaScore }),
        ...(data.tartilScore !== undefined && { tartilScore: data.tartilScore }),
        ...(data.grade !== undefined && { grade: data.grade }),
        ...(data.passed !== undefined && { passed: data.passed }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.recommendations !== undefined && { recommendations: data.recommendations }),
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        examiners: {
          include: { examiner: { select: { id: true, name: true } } },
        },
      },
    });

    return record;
  },

  // ============================================
  // DELETE
  // ============================================

  async delete(id: string, context: ScopeActor) {
    await assertExamInScope(id, context);
    await prisma.simaanExam.delete({ where: { id } });
    return { message: 'Simaan exam deleted successfully' };
  },

  // ============================================
  // EXAMINER MANAGEMENT
  // ============================================

  async addExaminer(data: CreateExaminerInput, context: ScopeActor) {
    await assertExamInScope(data.simaanId, context);

    const examiner = await prisma.simaanExaminer.create({
      data: {
        simaanId: data.simaanId,
        examinerId: data.examinerId,
        score: data.score,
        notes: data.notes,
      },
      include: {
        examiner: { select: { id: true, name: true } },
      },
    });

    return examiner;
  },

  async updateExaminer(id: string, data: UpdateExaminerInput, context: ScopeActor) {
    await assertExaminerInScope(id, context);

    const examiner = await prisma.simaanExaminer.update({
      where: { id },
      data: {
        ...(data.score !== undefined && { score: data.score }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: {
        examiner: { select: { id: true, name: true } },
      },
    });

    return examiner;
  },

  async deleteExaminer(id: string, context: ScopeActor) {
    await assertExaminerInScope(id, context);
    await prisma.simaanExaminer.delete({ where: { id } });
    return { message: 'Examiner removed successfully' };
  },

  // ============================================
  // SUBMIT SCORES
  // ============================================

  async submitScores(data: SubmitScoresInput, context: ScopeActor) {
    await assertExamInScope(data.simaanId, context);

    const record = await prisma.simaanExam.update({
      where: { id: data.simaanId },
      data: {
        overallScore: data.overallScore,
        tajwidScore: data.tajwidScore,
        fashohaScore: data.fashohaScore,
        tartilScore: data.tartilScore,
        grade: data.grade,
        passed: data.passed,
        notes: data.notes,
        recommendations: data.recommendations,
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        examiners: {
          include: { examiner: { select: { id: true, name: true } } },
        },
      },
    });

    return record;
  },

  // ============================================
  // STUDENT SUMMARY
  // ============================================

  async getStudentSummary(query: StudentSimaanSummaryQuery) {
    const { studentId, startDate, endDate, simaanType } = query;

    const where: Prisma.SimaanExamWhereInput = { studentId };

    if (startDate || endDate) {
      where.examDate = {};
      if (startDate) where.examDate.gte = new Date(startDate);
      if (endDate) where.examDate.lte = new Date(endDate);
    }

    if (simaanType) {
      where.simaanType = simaanType;
    }

    const records = await prisma.simaanExam.findMany({
      where,
      include: { examiners: true },
      orderBy: { examDate: 'desc' },
    });

    const totalExams = records.length;
    const passedExams = records.filter((r) => r.passed).length;
    const avgOverall =
      totalExams > 0
        ? Math.round(records.reduce((sum, r) => sum + (r.overallScore || 0), 0) / totalExams)
        : 0;
    const avgTajwid =
      totalExams > 0
        ? Math.round(records.reduce((sum, r) => sum + (r.tajwidScore || 0), 0) / totalExams)
        : 0;

    // Breakdown by type
    const typeBreakdown: Record<string, { total: number; passed: number }> = {};
    records.forEach((r) => {
      if (!typeBreakdown[r.simaanType]) {
        typeBreakdown[r.simaanType] = { total: 0, passed: 0 };
      }
      typeBreakdown[r.simaanType].total++;
      if (r.passed) typeBreakdown[r.simaanType].passed++;
    });

    // Juz coverage
    const juzTested = new Set<number>();
    records.forEach((r) => {
      for (let j = r.juzStart; j <= r.juzEnd; j++) {
        juzTested.add(j);
      }
    });

    // Recent exams
    const recentExams = records.slice(0, 10).map((r) => ({
      id: r.id,
      date: r.examDate,
      type: r.simaanType,
      juzRange: `${r.juzStart}-${r.juzEnd}`,
      overallScore: r.overallScore,
      grade: r.grade,
      passed: r.passed,
    }));

    return {
      student: await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, nis: true, user: { select: { name: true } } },
      }),
      summary: {
        totalExams,
        passedExams,
        failedExams: totalExams - passedExams,
        passRate: totalExams > 0 ? Math.round((passedExams / totalExams) * 100) : 0,
        avgOverallScore: avgOverall,
        avgTajwidScore: avgTajwid,
      },
      typeBreakdown,
      juzCoverage: {
        testedCount: juzTested.size,
        testedJuz: Array.from(juzTested).sort((a, b) => a - b),
      },
      recentExams,
    };
  },

  // ============================================
  // HALAQOH RECORDS
  // ============================================

  async getHalaqohRecords(query: HalaqohSimaanQuery, context: ScopeActor) {
    const { halaqohId, page = 1, limit = 20, dateFrom, dateTo } = query;

    // A halaqoh's records are about its santri, so the caller's santri scope
    // applies on top of the halaqoh filter — an unrestricted read listed every
    // unit's exam scores for a halaqoh id the caller did not belong to.
    const where: Prisma.SimaanExamWhereInput = {
      halaqohId,
      student: studentScope(context),
    };

    if (dateFrom || dateTo) {
      where.examDate = {};
      if (dateFrom) where.examDate.gte = new Date(dateFrom);
      if (dateTo) where.examDate.lte = new Date(dateTo);
    }

    const [records, total, halaqoh] = await Promise.all([
      prisma.simaanExam.findMany({
        where,
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          examiners: {
            include: { examiner: { select: { id: true, name: true } } },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ examDate: 'desc' }],
      }),
      prisma.simaanExam.count({ where }),
      prisma.halaqoh.findUnique({
        where: { id: halaqohId },
        select: { id: true, name: true, level: true },
      }),
    ]);

    return {
      halaqoh,
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // ============================================
  // UPCOMING EXAMS
  // ============================================

  async getUpcomingExams(context: ScopeActor, halaqohId?: string, days: number = 7) {
    // A date-only column stored at midnight UTC: the window's lower bound is
    // today's *WIB* day (a UTC-midnight "today" is still yesterday for the
    // first seven hours of a WIB day, so yesterday's exam read as upcoming),
    // and the upper bound closes on the WIB day `days` ahead, inclusive.
    const today = dayDate(wibDayOf(new Date()));
    const lastDay = new Date(today.getTime() + days * 86_400_000);

    const where: Prisma.SimaanExamWhereInput = {
      student: studentScope(context),
      examDate: { gte: today, lte: lastDay },
    };

    if (halaqohId) where.halaqohId = halaqohId;

    const exams = await prisma.simaanExam.findMany({
      where,
      include: {
        student: {
          select: { id: true, nis: true, user: { select: { name: true } } },
        },
        halaqoh: { select: { id: true, name: true } },
      },
      orderBy: { examDate: 'asc' },
    });

    return exams;
  },
};
