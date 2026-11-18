import { prisma, type Db } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { simaanStatusWhere } from '@cipansor/shared';
import { dayDate, wibDayOf } from '@/utils/wib';
import { studentScope, type ScopeActor } from '@/utils/student-scope';
import { assertStudentsWritable, type WriteActor } from '@/utils/write-scope';
import { mayWriteGradeVia, teachingRelationReach } from '@/utils/teaching-relation';
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
 * 404 unless `actor` may *write* a simaan of `studentId` (owner decision
 * 2026-11-09, #1025): Super Admin any santri, everyone else a santri of their
 * own unit, or one reached through a Relasi_Pengajaran (a)–(c). The read
 * breadth a cross-unit account has (`seesAllUnits`) is deliberately not
 * consulted — a musyrif who reads every unit writes only their own, or a santri
 * they teach. Relation (d) (wali kelas) is not a simaan relation, so
 * `mayWriteGradeVia` excludes it, as it does for grades (R13.2). Not-found
 * rather than forbidden, so the answer does not confirm the santri.
 */
async function assertSimaanStudentWritable(
  studentId: string,
  actor: WriteActor,
  resource = 'Simaan exam',
  db: Db = prisma
): Promise<void> {
  await assertStudentsWritable(
    [studentId],
    actor,
    teachingRelationReach(actor.sub, mayWriteGradeVia, db),
    resource,
    db
  );
}

/**
 * The exam with `id`, or 404 when it is missing *or* its santri is outside the
 * caller's write reach — the same answer for both, so the id is not confirmed.
 * For writes that do not open a transaction (`addExaminer`); the transactional
 * writes read the row inside their transaction instead (`findExamInScope`).
 *
 * `update`/`delete` used to run `prisma.simaanExam.update({ where: { id } })`
 * unscoped, so a teacher could change or delete another unit's exam by guessing
 * its id, and a missing id surfaced as a 500 (P2025) rather than 404. The lookup
 * reads the row by id alone (a write must reach a santri of another unit through
 * a relation, which no `where` on the exam can express), then the santri is
 * checked against the caller's write scope.
 */
async function assertExamWritable(id: string, actor: WriteActor, db: Db = prisma): Promise<void> {
  const found = await db.simaanExam.findFirst({
    where: { id },
    select: { studentId: true },
  });
  if (!found) throw Errors.notFound('Simaan exam');
  await assertSimaanStudentWritable(found.studentId, actor, 'Simaan exam', db);
}

/** The examiner row with `id`, or 404 unless its exam's santri is writable. */
async function assertExaminerWritable(
  id: string,
  actor: WriteActor,
  db: Db = prisma
): Promise<void> {
  const found = await db.simaanExaminer.findFirst({
    where: { id },
    select: { id: true, simaan: { select: { studentId: true } } },
  });
  if (!found) throw Errors.notFound('Examiner');
  await assertSimaanStudentWritable(found.simaan.studentId, actor, 'Examiner', db);
}

type ExamForEffects = { id: string; studentId: string; juzStart: number; juzEnd: number };

/**
 * The Takhosus progress a passing simaan moves, and a re-grade or delete undoes.
 *
 * This lived only on `/takhosus/simaan/:id/grade` (`updateResult`), so a dialog
 * that saved `passed: true` through `PATCH /simaan/:id` marked the exam passed
 * and left the enrollment ACTIVE with no hafidz record — the same exam reaching
 * two different states depending on the door it came through (#1125). It now
 * lives here, called from every simaan write, inside the write's transaction.
 *
 * Both helpers take the `tx` handle, so the enrollment/hafidz/juz change commits
 * with the exam row or not at all.
 */
async function applyPassEffects(
  tx: Prisma.TransactionClient,
  exam: Pick<ExamForEffects, 'studentId' | 'juzStart' | 'juzEnd'>
): Promise<void> {
  const enrollment = await tx.takhosusEnrollment.findUnique({
    where: { studentId: exam.studentId },
  });
  if (!enrollment) return;

  // A pass of the whole Qur'an completes the programme.
  if (exam.juzStart === 1 && exam.juzEnd === 30) {
    if (enrollment.status !== 'COMPLETED') {
      await tx.takhosusEnrollment.update({
        where: { studentId: exam.studentId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          currentJuz: 30,
          completedJuz: enrollment.targetJuz,
          notes: `Lulus Simaan 30 Juz pada ${new Date().toLocaleDateString()}`,
        },
      });
    }
    const existingHafidz = await tx.hafidzStudent.findUnique({
      where: { studentId: exam.studentId },
      select: { id: true },
    });
    if (!existingHafidz) {
      await tx.hafidzStudent.create({
        data: {
          studentId: exam.studentId,
          completedAt: new Date(),
          notes: 'Lulus program Takhosus',
        },
      });
    }
    return;
  }

  // Advance only on a contiguous pass that covers the student's frontier:
  // a non-sequential exam (juz 20–25 when currentJuz is 5) must not skip juz.
  const currentJuz = enrollment.currentJuz || 1;
  if (exam.juzStart <= currentJuz && exam.juzEnd >= currentJuz) {
    await tx.takhosusEnrollment.update({
      where: { studentId: exam.studentId },
      data: { currentJuz: Math.min(30, exam.juzEnd + 1) },
    });
  }
}

/**
 * Undo `applyPassEffects` when a passed simaan is re-graded to failed or
 * deleted. Only reverts when no other passed simaan (or enough sanad records)
 * still justifies the progress, so a second 30-juz pass is not thrown away.
 */
async function revertPassEffects(
  tx: Prisma.TransactionClient,
  exam: ExamForEffects,
  /** A delete has already removed the row — skip the `id: { not: exam.id }` filter. */
  examAlreadyDeleted = false
): Promise<void> {
  const enrollment = await tx.takhosusEnrollment.findUnique({
    where: { studentId: exam.studentId },
  });
  if (!enrollment) return;

  const idFilter = examAlreadyDeleted ? {} : { id: { not: exam.id } };

  if (exam.juzStart === 1 && exam.juzEnd === 30) {
    const otherPassed30Juz = await tx.simaanExam.findFirst({
      where: { studentId: exam.studentId, ...idFilter, passed: true, juzStart: 1, juzEnd: 30 },
      select: { id: true },
    });
    if (otherPassed30Juz) return;

    const sanadCount = await tx.sanadRecord.count({ where: { enrollmentId: enrollment.id } });
    const sanadJustifiesCompletion = sanadCount >= enrollment.targetJuz;

    if (enrollment.status === 'COMPLETED' && !sanadJustifiesCompletion) {
      const otherPassedExams = await tx.simaanExam.findMany({
        where: { studentId: exam.studentId, ...idFilter, passed: true },
        select: { juzEnd: true },
        orderBy: { juzEnd: 'desc' },
        take: 1,
      });
      const derivedCurrentJuz =
        otherPassedExams.length > 0 ? Math.min(30, otherPassedExams[0].juzEnd + 1) : 1;
      // Only clear notes the completion itself wrote; keep a manually edited one.
      const isAutoGeneratedNote = enrollment.notes?.startsWith('Lulus Simaan 30 Juz pada ');

      await tx.takhosusEnrollment.update({
        where: { studentId: exam.studentId },
        data: {
          status: 'ACTIVE',
          completedAt: null,
          currentJuz: derivedCurrentJuz,
          completedJuz: sanadCount,
          ...(isAutoGeneratedNote && { notes: null }),
        },
      });
    }

    if (!sanadJustifiesCompletion) {
      await tx.hafidzStudent.deleteMany({ where: { studentId: exam.studentId } });
    }
    return;
  }

  if (enrollment.currentJuz === Math.min(30, exam.juzEnd + 1)) {
    const otherPassedExams = await tx.simaanExam.findMany({
      where: { studentId: exam.studentId, ...idFilter, passed: true },
      select: { juzEnd: true },
      orderBy: { juzEnd: 'desc' },
      take: 1,
    });
    const derivedCurrentJuz =
      otherPassedExams.length > 0 ? Math.min(30, otherPassedExams[0].juzEnd + 1) : 1;

    await tx.takhosusEnrollment.update({
      where: { studentId: exam.studentId },
      data: { currentJuz: derivedCurrentJuz },
    });
  }
}

/** The scoped exam a write targets, or 404 — read inside the write's transaction. */
async function findExamInScope(
  tx: Prisma.TransactionClient,
  id: string,
  actor: WriteActor
): Promise<ExamForEffects & { passed: boolean }> {
  const found = await tx.simaanExam.findFirst({
    where: { id },
    select: { id: true, studentId: true, juzStart: true, juzEnd: true, passed: true },
  });
  if (!found) throw Errors.notFound('Simaan exam');
  await assertSimaanStudentWritable(found.studentId, actor, 'Simaan exam', tx);
  return found;
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
      status,
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

    // The derived status, on the same rule the web badge reads. It is pushed
    // into `AND` (not a bare `OR`) because `search` also writes `where.OR`; two
    // top-level `OR` keys would silently drop one of them.
    if (status) {
      const existingAnd = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
      where.AND = [...existingAnd, simaanStatusWhere(status)];
    }

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

  async create(data: CreateSimaanInput, context: WriteActor) {
    // The santri named in the body must be one the caller may *write* — their
    // own unit, or one reached through a Relasi_Pengajaran (a)–(c); Super Admin
    // any. A teacher filing an exam against another unit's santri by its id is
    // refused (404, not 403, so the answer does not confirm the id).
    await assertSimaanStudentWritable(data.studentId, context);

    const examDate = dayDate(data.examDate);
    const passed = data.passed || false;

    return prisma.$transaction(async (tx) => {
      const record = await tx.simaanExam.create({
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
          passed,
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

      // A form that creates the exam already passed moves the Takhosus progress
      // here too — otherwise the same `passed: true` produced a completed
      // enrollment through the grade endpoint and nothing through this one.
      if (passed) await applyPassEffects(tx, record);

      return record;
    });
  },

  // ============================================
  // UPDATE
  // ============================================

  async update(id: string, data: UpdateSimaanInput, context: WriteActor) {
    return prisma.$transaction(async (tx) => {
      const before = await findExamInScope(tx, id, context);
      const nowPassed = data.passed !== undefined ? data.passed : before.passed;

      const record = await tx.simaanExam.update({
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

      // The effects must follow the pass, not every edit. A record that stays
      // passed over an unchanged range needs no reconciliation — running it on a
      // notes-only edit deleted and recreated the hafidz record, wiping its
      // custom notes and resetting `completedAt` to the edit's date (#1125).
      if (nowPassed && !before.passed) {
        await applyPassEffects(tx, record);
      } else if (!nowPassed && before.passed) {
        // Undo the pass that *was* standing, against the range it covered — a
        // PATCH that both un-passes and corrects 1–30 to a partial range must
        // still revoke the completion the old 1–30 pass justified.
        await revertPassEffects(tx, before);
      } else if (
        nowPassed &&
        (before.juzStart !== record.juzStart || before.juzEnd !== record.juzEnd)
      ) {
        // Still passed, but the covered range moved — reconcile both.
        await revertPassEffects(tx, before);
        await applyPassEffects(tx, record);
      }

      return record;
    });
  },

  // ============================================
  // DELETE
  // ============================================

  async delete(id: string, context: WriteActor) {
    return prisma.$transaction(async (tx) => {
      const before = await findExamInScope(tx, id, context);
      await tx.simaanExam.delete({ where: { id } });
      if (before.passed) await revertPassEffects(tx, before, true);
      return { message: 'Simaan exam deleted successfully' };
    });
  },

  // ============================================
  // EXAMINER MANAGEMENT
  // ============================================

  async addExaminer(data: CreateExaminerInput, context: WriteActor) {
    await assertExamWritable(data.simaanId, context);

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

  async updateExaminer(id: string, data: UpdateExaminerInput, context: WriteActor) {
    await assertExaminerWritable(id, context);

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

  async deleteExaminer(id: string, context: WriteActor) {
    await assertExaminerWritable(id, context);
    await prisma.simaanExaminer.delete({ where: { id } });
    return { message: 'Examiner removed successfully' };
  },

  // ============================================
  // SUBMIT SCORES
  // ============================================

  async submitScores(data: SubmitScoresInput, context: WriteActor) {
    return prisma.$transaction(async (tx) => {
      const before = await findExamInScope(tx, data.simaanId, context);

      const record = await tx.simaanExam.update({
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

      // Grading is the same write surface as create/update: a pass here must
      // move the enrollment and hafidz record, a re-grade to failed must undo it.
      if (data.passed && !before.passed) {
        await applyPassEffects(tx, record);
      } else if (!data.passed && before.passed) {
        await revertPassEffects(tx, before);
      }

      return record;
    });
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
