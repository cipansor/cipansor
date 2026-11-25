import { prisma } from '@/lib/prisma';
import { Prisma, QuestionType } from '@prisma/client';
import type { Question as QuestionModel } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { Errors } from '@/middleware/error';
import {
  canonicalAnswer,
  isAnswerCorrect,
  normalizeAnswerKeyForStorage,
  optionIdentifiers,
} from './answer-key';
import type { SecurityEventType } from '@cipansor/shared';
import { calculateLetterGrade } from '@cipansor/shared';
import type { JwtPayload } from '@/lib/jwt';

/** Authenticated caller shape used for unit-scoping checks. */
type AuthUser = Pick<JwtPayload, 'id' | 'role'> & { unitId?: string | null };

/**
 * Minutes a student may still act after the exam duration has elapsed, to absorb
 * clock skew and a slow last request. One constant because the rule is enforced
 * in two places — saving an answer and finishing the attempt — and two copies of
 * one rule diverge at the next edit.
 */
export const EXAM_GRACE_PERIOD_MINUTES = 2;

/**
 * `normalizeAnswerKeyForStorage` in the shape a nullable Json column accepts:
 * `Prisma.DbNull` writes SQL NULL ("this question has no key yet"), which is the
 * meaning here — `Prisma.JsonNull` would store the JSON value `null` instead,
 * and the two are different rows to query against.
 */
function answerKeyForPrisma(
  type: QuestionType,
  answerKey: unknown,
  options: unknown
): string | typeof Prisma.DbNull {
  const normalized = normalizeAnswerKeyForStorage(type, answerKey, options);
  return normalized === null ? Prisma.DbNull : normalized;
}

/**
 * Validate and canonicalise a student's answer on the way in.
 *
 * A non-essay answer is an option identifier, not a free-form payload: storing
 * the raw request body let an examiner read prose (including personal data)
 * hidden beside the chosen option. Essays stay text; every other type is
 * reduced to its canonical choice, and a value that names no option is
 * refused. The ERASURE sweep relies on this shape — valid choices survive as
 * option ids, while anything that cannot be proved to be one is cleared.
 */
function studentAnswerForStorage(
  type: QuestionType,
  options: Prisma.JsonValue | null,
  raw: unknown
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (raw === null || raw === undefined) return Prisma.DbNull;
  if (type === QuestionType.ESSAY) {
    if (typeof raw !== 'string') {
      throw Errors.badRequest('Jawaban esai harus berupa teks.');
    }
    return raw;
  }
  if (raw === '') return '';
  const canonical = canonicalAnswer(type, raw);
  if (canonical === null) {
    throw Errors.badRequest(
      type === QuestionType.TRUE_FALSE
        ? 'Jawaban benar-salah harus bernilai benar atau salah.'
        : 'Jawaban pilihan ganda harus berupa id salah satu opsi.'
    );
  }
  if (type === QuestionType.MULTIPLE_CHOICE) {
    const ids = optionIdentifiers(options);
    if (!ids.includes(canonical)) {
      // Jangan mengutip nilai kiriman: teks itu bisa berisi data pribadi, dan
      // `errorHandler` mencatat pesan galat ke log yang tidak disapu ERASURE.
      throw Errors.badRequest(
        `Jawaban harus berupa id salah satu opsi soal ini (${ids.join(', ')}).`
      );
    }
  }
  return canonical;
}

/** Deterministic pseudo-random number generator for attempt-level shuffling */
function seededRandom(seedStr: string) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
  }
  return function () {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher-Yates array shuffling */
function shuffleWithSeed<T>(array: T[], seedStr: string): T[] {
  const result = [...array];
  const rand = seededRandom(seedStr);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Types for inputs (can be moved to shared types later)
interface CreateQuestionBankInput {
  unitId: string;
  teacherId: string;
  title: string;
  description?: string;
  subjectId?: string;
}

interface CreateQuestionInput {
  bankId: string;
  type: QuestionType;
  content: string;
  options?: any;
  answerKey?: any;
  explanation?: string;
  points?: number;
  order?: number;
}

interface UpdateQuestionInput {
  content?: string;
  options?: any;
  answerKey?: any;
  explanation?: string;
  points?: number;
  order?: number;
}

interface CreateExamInput {
  unitId: string;
  academicYearId: string;
  subjectId: string;
  classId: string;
  teacherId: string;
  type: any; // ExamType
  title: string;
  description?: string;
  scheduledAt: Date | string;
  duration?: number;
  maxScore?: number;
  passingScore?: number;
  weight?: number;
  status?: any; // ExamStatus
  instructions?: string;
  questionBankId: string;
}

export class CBTService {
  // --- Question Banks ---

  static async createQuestionBank(data: CreateQuestionBankInput) {
    return prisma.questionBank.create({
      data: {
        unitId: data.unitId,
        teacherId: data.teacherId,
        title: data.title,
        description: data.description,
        subjectId: data.subjectId,
      },
    });
  }

  static async getQuestionBanks(query: {
    unitId?: string;
    teacherUserId?: string;
    subjectId?: string;
    search?: string;
  }) {
    const where: Prisma.QuestionBankWhereInput = {
      isActive: true,
    };

    // Always apply unitId filter when provided for data isolation
    if (query.unitId) where.unitId = query.unitId;
    // If teacherUserId is set (non-admin), unitId must also be set for isolation
    if (query.teacherUserId && !query.unitId) {
      throw Errors.badRequest('unitId is required for data isolation');
    }
    if (query.teacherUserId) where.teacher = { userId: query.teacherUserId };
    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    return prisma.questionBank.findMany({
      where,
      include: {
        teacher: { select: { user: { select: { name: true } } } },
        subject: { select: { name: true, code: true } },
        _count: { select: { questions: true, exams: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  static async getQuestionBankById(id: string, user: AuthUser) {
    const bank = await prisma.questionBank.findUnique({
      where: { id },
      include: {
        questions: { orderBy: { order: 'asc' } },
        teacher: { select: { userId: true, user: { select: { name: true } } } },
        subject: { select: { name: true, code: true } },
      },
    });

    if (!bank) throw Errors.notFound('Question Bank');

    if (user.role === 'UNIT_ADMIN' && bank.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to view Question Banks outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      bank.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to view this Question Bank');
    }

    return bank;
  }

  static async deleteQuestionBank(id: string, user: AuthUser) {
    const bank = await prisma.questionBank.findUnique({
      where: { id },
      include: { teacher: { select: { userId: true } } },
    });
    if (!bank) throw Errors.notFound('Question Bank');

    if (user.role === 'UNIT_ADMIN' && bank.unitId !== user.unitId) {
      throw Errors.forbidden(
        'You do not have permission to delete Question Banks outside your unit'
      );
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      bank.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to delete this Question Bank');
    }

    // Soft delete
    return prisma.questionBank.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // --- Questions ---

  static async addQuestion(data: CreateQuestionInput, user: AuthUser) {
    const bank = await prisma.questionBank.findUnique({
      where: { id: data.bankId },
      include: { teacher: { select: { userId: true } } },
    });
    if (!bank) throw Errors.notFound('Question Bank');

    if (user.role === 'UNIT_ADMIN' && bank.unitId !== user.unitId) {
      throw Errors.forbidden(
        'You do not have permission to modify Question Banks outside your unit'
      );
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      bank.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to add questions to this Question Bank');
    }

    return prisma.question.create({
      data: {
        bankId: data.bankId,
        type: data.type,
        content: data.content,
        options: data.options,
        // Normalised and checked against this question's own options here, so a
        // key that can never match is refused while the teacher is writing it
        // instead of surfacing as every student's zero on exam day.
        answerKey: answerKeyForPrisma(data.type, data.answerKey, data.options),
        explanation: data.explanation,
        points: data.points ?? 1,
        order: data.order ?? 0,
      },
    });
  }

  static async updateQuestion(id: string, data: UpdateQuestionInput, user: AuthUser) {
    const question = await prisma.question.findUnique({
      where: { id },
      include: { bank: { include: { teacher: { select: { userId: true } } } } },
    });
    if (!question) throw Errors.notFound('Question');

    if (user.role === 'UNIT_ADMIN' && question.bank.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to modify questions outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      question.bank.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to update this question');
    }

    // The same contract on update, evaluated against the values this call leaves
    // behind: replacing the options can make a previously valid key unusable, so
    // the stored key is re-checked even when the caller did not send one. The
    // question type is not editable here (it is absent from UpdateQuestionInput),
    // so it always comes from the stored row.
    const nextOptions = data.options ?? question.options;
    const nextKey = 'answerKey' in data ? data.answerKey : question.answerKey;

    return prisma.question.update({
      where: { id },
      data: { ...data, answerKey: answerKeyForPrisma(question.type, nextKey, nextOptions) },
    });
  }

  static async deleteQuestion(id: string, user: AuthUser) {
    const question = await prisma.question.findUnique({
      where: { id },
      include: { bank: { include: { teacher: { select: { userId: true } } } } },
    });
    if (!question) throw Errors.notFound('Question');

    if (user.role === 'UNIT_ADMIN' && question.bank.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to modify questions outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      question.bank.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to delete this question');
    }

    return prisma.question.delete({
      where: { id },
    });
  }

  // --- Exam Scheduling ---

  static async getExams(query: {
    page?: number;
    limit?: number;
    unitId?: string;
    academicYearId?: string;
    subjectId?: string;
    teacherUserId?: string;
    search?: string;
    status?: any;
    requireUnitScope?: boolean;
  }) {
    const where: Prisma.ExamWhereInput = {};

    // unitId is required for all non-SUPER_ADMIN queries for data isolation
    if (query.teacherUserId && !query.unitId) {
      throw Errors.badRequest('unitId is required for data isolation');
    }
    if (query.requireUnitScope && !query.unitId) {
      throw Errors.badRequest('unitId is required for data isolation');
    }
    // Always apply unitId filter when provided for data isolation
    if (query.unitId) where.unitId = query.unitId;
    if (query.academicYearId) where.academicYearId = query.academicYearId;
    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.teacherUserId) where.teacher = { userId: query.teacherUserId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, data] = await prisma.$transaction([
      prisma.exam.count({ where }),
      prisma.exam.findMany({
        where,
        include: {
          subject: { select: { name: true } },
          class: { select: { name: true } },
          questionBank: { select: { title: true, _count: { select: { questions: true } } } },
          _count: { select: { attempts: true } },
        },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
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
  }

  static async createExam(data: CreateExamInput, user: AuthUser) {
    // Enforce unit scope for non-SUPER_ADMIN users
    if (user.role === 'UNIT_ADMIN' && data.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to create exams outside your unit');
    }

    if (user.role !== 'SUPER_ADMIN' && user.role !== 'UNIT_ADMIN' && data.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to create exams outside your unit');
    }

    // Check question bank
    const bank = await prisma.questionBank.findUnique({
      where: { id: data.questionBankId },
      include: { teacher: { select: { userId: true } } },
    });
    if (!bank) throw Errors.notFound('Question Bank');

    if (!bank.isActive) {
      throw Errors.badRequest('This Question Bank has been deactivated');
    }

    if (user.role === 'UNIT_ADMIN' && bank.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to use Question Banks outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      bank.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to use this Question Bank');
    }

    // Validate status before creating
    const validStatuses = ['DRAFT', 'SCHEDULED'];
    if (data.status && !validStatuses.includes(data.status)) {
      throw Errors.badRequest(`Invalid exam status: ${data.status}. Must be DRAFT or SCHEDULED.`);
    }
    const status = data.status || 'DRAFT';

    return prisma.exam.create({
      data: {
        unitId: data.unitId,
        academicYearId: data.academicYearId,
        subjectId: data.subjectId,
        classId: data.classId,
        teacherId: data.teacherId,
        type: data.type || 'MIDTERM',
        title: data.title,
        description: data.description,
        scheduledAt: new Date(data.scheduledAt),
        duration: data.duration ?? 60,
        maxScore: new Decimal(data.maxScore ?? 100),
        passingScore: new Decimal(data.passingScore ?? 70),
        weight: new Decimal(data.weight ?? 1),
        status,
        instructions: data.instructions,
        questionBankId: data.questionBankId,
      },
    });
  }

  static async deleteExam(examId: string, user: AuthUser) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        _count: { select: { attempts: true } },
        teacher: { select: { userId: true } },
      },
    });
    if (!exam) throw Errors.notFound('Exam');

    if (user.role === 'UNIT_ADMIN' && exam.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to delete exams outside your unit');
    }
    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      exam.teacher?.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to delete this exam');
    }

    // Refuse to delete once students have started/submitted attempts — their
    // results must not silently disappear.
    if (exam._count.attempts > 0) {
      throw Errors.badRequest('Cannot delete an exam that already has student attempts');
    }

    await prisma.exam.delete({ where: { id: examId } });
    return { id: examId };
  }

  static async getExamMonitoring(examId: string, user: AuthUser) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        teacher: { select: { userId: true } },
        // Question/answer counts let the monitoring UI show per-student
        // progress (answered / total) without shipping answer contents.
        questionBank: { select: { _count: { select: { questions: true } } } },
        attempts: {
          include: {
            student: { select: { id: true, user: { select: { name: true } } } },
            _count: { select: { answers: true } },
          },
        },
      },
    });

    if (!exam) throw Errors.notFound('Exam');

    if (user.role === 'UNIT_ADMIN' && exam.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to view exams outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      exam.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to view this exam');
    }

    return exam;
  }

  // --- Teacher Grading ---

  static async getAttemptForGrading(attemptId: string, user: AuthUser) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        exam: {
          include: {
            teacher: { select: { userId: true } },
            questionBank: {
              include: { questions: { orderBy: { order: 'asc' } } },
            },
          },
        },
        answers: true,
      },
    });

    if (!attempt) throw Errors.notFound('Attempt');

    if (user.role === 'UNIT_ADMIN' && attempt.exam.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to grade exams outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      attempt.exam.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to grade this attempt');
    }

    return attempt;
  }

  static async gradeEssayAnswer(
    attemptId: string,
    questionId: string,
    grading: { score: number; isCorrect: boolean },
    user: AuthUser
  ) {
    // Fetch attempt outside the transaction for authorization checks.
    // The status check is repeated inside the transaction to close the TOCTOU gap.
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          select: { unitId: true, questionBankId: true, teacher: { select: { userId: true } } },
        },
      },
    });

    if (!attempt) throw Errors.notFound('Attempt');

    if (attempt.status === 'IN_PROGRESS') {
      throw Errors.badRequest('Cannot grade an attempt that is still in progress');
    }

    if (attempt.status === 'EXPIRED') {
      throw Errors.badRequest('Cannot grade an expired attempt');
    }

    if (user.role === 'UNIT_ADMIN' && attempt.exam.unitId !== user.unitId) {
      throw Errors.forbidden('You do not have permission to grade exams outside your unit');
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'UNIT_ADMIN' &&
      attempt.exam.teacher.userId !== user.id
    ) {
      throw Errors.forbidden('You do not have permission to grade this attempt');
    }

    // Use SERIALIZABLE isolation to prevent concurrent grading calls from
    // reading stale answer data and overwriting each other's total score.
    // Retry up to 2 times on serialization failures (deadlocks/conflicts).
    const MAX_RETRIES = 2;
    let lastError: any;

    for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            // Re-check status inside the transaction to close the TOCTOU gap:
            // between the check above and entering this serializable transaction,
            // a concurrent operation could have changed the attempt's status.
            const freshAttempt = await tx.examAttempt.findUnique({
              where: { id: attemptId },
              select: { status: true },
            });
            if (!freshAttempt) throw Errors.notFound('Attempt');
            if (freshAttempt.status === 'IN_PROGRESS') {
              throw Errors.badRequest('Cannot grade an attempt that is still in progress');
            }
            if (freshAttempt.status === 'EXPIRED') {
              throw Errors.badRequest('Cannot grade an expired attempt');
            }

            const question = await tx.question.findUnique({ where: { id: questionId } });
            if (!question) throw Errors.notFound('Question');

            if (question.bankId !== attempt.exam.questionBankId) {
              throw Errors.badRequest('Question does not belong to this exam');
            }

            if (question.type !== 'ESSAY') {
              throw Errors.badRequest('Only ESSAY questions can be manually graded');
            }

            if (
              typeof grading.score !== 'number' ||
              Number.isNaN(grading.score) ||
              grading.score < 0 ||
              grading.score > question.points
            ) {
              throw Errors.badRequest(
                `Score must be a valid number between 0 and ${question.points}`
              );
            }

            // Ensure answer exists
            const existingAnswer = await tx.examAnswer.findUnique({
              where: { attemptId_questionId: { attemptId, questionId } },
            });

            if (!existingAnswer) {
              throw Errors.badRequest('Cannot grade an unanswered question');
            }

            // Update the answer
            await tx.examAnswer.update({
              where: {
                attemptId_questionId: { attemptId, questionId },
              },
              data: {
                isCorrect: grading.isCorrect,
                score: new Decimal(grading.score),
              },
            });

            // Recalculate total score for attempt
            const allAnswers = await tx.examAnswer.findMany({
              where: { attemptId },
              include: { question: true },
            });

            const totalScore = allAnswers.reduce((sum, ans) => {
              const s = ans.score !== null ? Number(ans.score) : 0;
              return sum + s;
            }, 0);

            // Check if any ESSAY answer is still lacking a score to decide status
            const hasUngradedEssay = allAnswers.some(
              (ans) => ans.question.type === 'ESSAY' && ans.score === null
            );

            const updatedAttempt = await tx.examAttempt.update({
              where: { id: attemptId },
              data: {
                score: new Decimal(totalScore),
                status: hasUngradedEssay ? 'NEEDS_REVIEW' : 'COMPLETED',
              },
            });

            if (!hasUngradedEssay) {
              await CBTService.syncGradeToAcademicGradebook(attemptId, { forceUpdate: true }, tx);
            }

            return updatedAttempt;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error: any) {
        lastError = error;
        // Retry only on serialization failures (P2034) or deadlocks (40001/40P01)
        const isSerializationError =
          error?.code === 'P2034' || error?.meta?.code === '40001' || error?.meta?.code === '40P01';
        if (isSerializationError && retryCount < MAX_RETRIES) {
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  // --- Exam Attempts (Student) ---

  static async startExamAttempt(examId: string, studentId: string) {
    // 1. Check if exam exists and is open
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questionBank: { select: { id: true } },
      },
    });

    if (!exam) throw Errors.notFound('Exam');
    if (!exam.questionBank)
      throw Errors.badRequest('This exam is not configured for CBT (no Question Bank)');

    // Check timing (simplified, ideally check scheduledAt + duration)
    // For now, allow starting if status is not COMPLETED/GRADED (assuming generic exam status)
    // Or check if current time is within window.

    // Check if attempt already exists
    const existingAttempt = await prisma.examAttempt.findUnique({
      where: {
        examId_studentId: { examId, studentId },
      },
    });

    if (existingAttempt) {
      if (existingAttempt.status === 'IN_PROGRESS') {
        return existingAttempt; // Resume
      }
      // If expired or completed, maybe allow retake? For now, block.
      // throw Errors.badRequest('You have already taken this exam');
      // Let's just return it, frontend can handle status.
      return existingAttempt;
    }

    // Create new attempt. Catch unique constraint violation (P2002) from
    // concurrent requests (e.g. double-click) and return the existing attempt.
    try {
      return await prisma.examAttempt.create({
        data: {
          examId,
          studentId,
          startedAt: new Date(),
          status: 'IN_PROGRESS',
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existing = await prisma.examAttempt.findUnique({
          where: { examId_studentId: { examId, studentId } },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  static async getAttempt(attemptId: string, studentId: string) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        answers: true,
        exam: {
          include: {
            questionBank: {
              include: {
                questions: {
                  select: {
                    id: true,
                    type: true,
                    content: true,
                    options: true,
                    points: true,
                    order: true,
                    // NO ANSWER KEY
                  },
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!attempt) throw Errors.notFound('Attempt');
    if (attempt.studentId !== studentId) throw Errors.forbidden('Access denied');

    // Best Practice Enhancement: Seed-based deterministic shuffling per attempt
    // Keeps same order on page refresh while randomizing across different students.
    if (attempt.exam?.questionBank?.questions) {
      // Deep clone questions array to avoid mutating cached Prisma model in-place
      let questions = attempt.exam.questionBank.questions.map((q) => ({
        ...q,
        options: Array.isArray(q.options) ? [...q.options] : q.options,
      }));

      // Shuffle question order using attemptId seed
      questions = shuffleWithSeed(questions, attemptId);

      // Shuffle options order for each MCQ question using attemptId + questionId seed
      questions = questions.map((q) => {
        if (Array.isArray(q.options) && q.options.length > 0) {
          return {
            ...q,
            options: shuffleWithSeed(q.options as unknown[] as string[], `${attemptId}_${q.id}`),
          };
        }
        return q;
      });

      attempt.exam.questionBank.questions = questions as unknown as QuestionModel[];
    }

    return attempt;
  }

  static async recordSecurityLog(
    attemptId: string,
    userId: string,
    event: { type: SecurityEventType; details?: Record<string, unknown> | null }
  ) {
    // The allowed list used to be a third copy hardcoded right here — five
    // values, so it would have rejected FULLSCREEN_EXIT and DEV_TOOLS the moment
    // the client started sending them. The list now lives once, in
    // `SECURITY_EVENT_TYPES`: the zod schema rejects an unknown name at the
    // boundary with a 400, the type above stops the server writing one, and the
    // CHECK constraint is the last line in the database.

    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Errors.unauthorized('User is not a student');

    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw Errors.notFound('Attempt');
    if (attempt.studentId !== student.id) throw Errors.forbidden('Access denied');

    if (attempt.status !== 'IN_PROGRESS') {
      throw Errors.badRequest(
        'Cannot record security events for an attempt that is not in progress'
      );
    }

    const isTabSwitch = event.type === 'TAB_SWITCH' || event.type === 'FOCUS_LOST';

    const [log] = await prisma.$transaction([
      prisma.examSecurityLog.create({
        data: {
          attemptId,
          type: event.type,
          details: (event.details ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      }),
      ...(isTabSwitch
        ? [
            prisma.examAttempt.update({
              where: { id: attemptId },
              data: {
                tabSwitchCount: { increment: 1 },
              },
            }),
          ]
        : []),
    ]);

    return log;
  }

  static async submitAnswer(attemptId: string, questionId: string, answer: any, studentId: string) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { select: { questionBankId: true, duration: true } } },
    });
    if (!attempt) throw Errors.notFound('Attempt');
    if (attempt.studentId !== studentId) throw Errors.forbidden('Access denied');

    if (attempt.status !== 'IN_PROGRESS') {
      throw Errors.badRequest('Cannot submit answer for a completed or expired attempt');
    }

    // Strict time limit check with 2 minute grace period
    if (attempt.startedAt && attempt.exam.duration) {
      const allowedDurationMs = (attempt.exam.duration + EXAM_GRACE_PERIOD_MINUTES) * 60 * 1000;
      const elapsedMs = Date.now() - new Date(attempt.startedAt).getTime();

      if (elapsedMs > allowedDurationMs) {
        // This answer is late and is refused. The attempt itself is finished and
        // graded on the answers that did arrive in time, so running out of time
        // costs the student this one answer rather than the whole exam.
        await CBTService.finishExamAttempt(attemptId, studentId);
        throw Errors.badRequest(
          'Waktu pengerjaan ujian telah habis. Jawaban yang sudah tersimpan sudah dinilai.'
        );
      }
    }

    // Validate that the question belongs to this exam's question bank
    if (!attempt.exam.questionBankId) {
      throw Errors.badRequest('This exam is not configured for CBT (no Question Bank)');
    }

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw Errors.notFound('Question');
    if (question.bankId !== attempt.exam.questionBankId) {
      throw Errors.badRequest('Question does not belong to this exam');
    }

    const storedAnswer = studentAnswerForStorage(question.type, question.options, answer);

    // Upsert answer
    return prisma.examAnswer.upsert({
      where: {
        attemptId_questionId: { attemptId, questionId },
      },
      create: {
        attemptId,
        questionId,
        answer: storedAnswer,
      },
      update: {
        answer: storedAnswer,
      },
    });
  }

  static async getTopicMasteryAnalytics(examId: string) {
    // Topic mastery analytics: aggregate per-question performance across all
    // completed and needs-review attempts.  NEEDS_REVIEW attempts are included
    // because their MC/TF answers are already auto-graded; ungraded essay
    // answers (score === null) are safely skipped by the aggregation loop.
    // We compute two views: (1) per-question mastery, and (2) curriculum-aligned
    // mastery grouped by Learning Objective (TP) when questions are linked.
    //
    // NOTE: This eagerly loads all answers for all matching attempts into memory.
    // For exams with very large numbers of students, consider migrating to a
    // database-level aggregation (groupBy or raw SQL) for better scalability.
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questionBank: {
          include: {
            questions: {
              orderBy: { order: 'asc' },
            },
          },
        },
        attempts: {
          where: { status: { in: ['COMPLETED', 'NEEDS_REVIEW'] } },
          orderBy: { createdAt: 'desc' },
          take: 1000, // Safety limit to prevent excessive memory usage
          include: {
            answers: {
              include: {
                question: {
                  include: {
                    learningObjective: {
                      select: { id: true, code: true, description: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!exam || !exam.questionBank) return null;
    if (exam.attempts.length === 0) return { items: [], _meta: { truncated: false } };

    // Warn if the safety limit was hit — analytics may be based on a subset
    const truncated = exam.attempts.length >= 1000;

    const topicMastery: Record<
      string,
      {
        objectiveId: string;
        code: string;
        description: string;
        totalPoints: number;
        earnedPoints: number;
        gradedCount: number;
      }
    > = {};

    // Group by individual question (each question acts as its own "topic")
    exam.questionBank.questions.forEach((q, idx) => {
      topicMastery[q.id] = {
        objectiveId: q.id,
        code: `Q${idx + 1}`,
        description: q.content.substring(0, 100),
        totalPoints: 0,
        earnedPoints: 0,
        gradedCount: 0,
      };
    });

    // Aggregate earned points and totalPoints only for graded answers
    // (skip answers with null score to avoid counting ungraded essay
    // questions as 0, which would distort mastery)
    exam.attempts.forEach((attempt) => {
      attempt.answers.forEach((answer) => {
        const entry = topicMastery[answer.questionId];
        if (entry && answer.score !== null) {
          entry.earnedPoints += Number(answer.score);
          entry.gradedCount += 1;
        }
      });
    });

    // Compute totalPoints from gradedCount so the denominator only
    // reflects attempts that were actually scored.
    const questions = exam.questionBank.questions;
    questions.forEach((q) => {
      const entry = topicMastery[q.id];
      if (entry) {
        entry.totalPoints = q.points * entry.gradedCount;
      }
    });

    const results = Object.values(topicMastery)
      .map(({ gradedCount: _gc, ...m }) => ({
        ...m,
        masteryLevel: m.totalPoints > 0 ? (m.earnedPoints / m.totalPoints) * 100 : 0,
      }))
      .sort((a, b) => a.masteryLevel - b.masteryLevel); // Weakest topics first

    // Enhanced Best Practice: Analyze Topic Mastery from Learning Objectives (TP) if linked.
    // Grouping by TP gives teachers curriculum-aligned insights rather than just question
    // performance. Reuses the attempts loaded above (bounded by take: 1000) to avoid a
    // second unbounded query with deeply nested relations.
    const tpMastery: Record<string, any> = {};
    exam.attempts.forEach((attempt) => {
      attempt.answers.forEach((answer) => {
        const tp = answer.question.learningObjective;
        if (tp && answer.score !== null) {
          if (!tpMastery[tp.id]) {
            tpMastery[tp.id] = {
              objectiveId: tp.id,
              code: tp.code,
              description: tp.description,
              totalPoints: 0,
              earnedPoints: 0,
            };
          }
          tpMastery[tp.id].totalPoints += answer.question.points;
          tpMastery[tp.id].earnedPoints += Number(answer.score);
        }
      });
    });

    const tpResults = Object.values(tpMastery)
      .map((m: any) => ({
        ...m,
        masteryLevel: m.totalPoints > 0 ? (m.earnedPoints / m.totalPoints) * 100 : 0,
      }))
      .sort((a, b) => a.masteryLevel - b.masteryLevel);

    // Return an object with items and metadata so truncation info survives
    // JSON serialization (named properties on arrays are silently dropped
    // by JSON.stringify).
    return {
      items: results,
      topicMastery: tpResults.length > 0 ? tpResults : undefined,
      _meta: truncated
        ? {
            truncated: true,
            analyzedAttempts: exam.attempts.length,
            message: 'Results based on first 1000 attempts only',
          }
        : { truncated: false },
    };
  }

  static async finishExamAttempt(attemptId: string, studentId: string) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: { questionBank: { include: { questions: { orderBy: { order: 'asc' } } } } },
        },
        answers: true,
      },
    });

    if (!attempt) throw Errors.notFound('Attempt');
    if (attempt.studentId !== studentId) throw Errors.forbidden('Access denied');

    // An attempt the old behaviour left as EXPIRED with no score was a dead end:
    // its answers sat graded-never in the database and no Grade was ever issued.
    // Treat those as unfinished and grade them below instead of returning them.
    const staleExpired = attempt.status === 'EXPIRED' && attempt.score === null;

    if (attempt.status !== 'IN_PROGRESS' && !staleExpired) {
      // Strip sensitive fields before returning to the student to prevent leaking
      // correct answers and explanations. Only expose the same fields as getAttempt.
      if (attempt.exam?.questionBank?.questions) {
        attempt.exam.questionBank.questions = attempt.exam.questionBank.questions
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(({ id, type, content, options, points }) => ({
            id,
            type,
            content,
            options,
            points,
          })) as unknown as QuestionModel[];
      }

      // Idempotent catch-up sync: ensure completed attempts have a Grade record created
      if (attempt.status === 'COMPLETED') {
        await CBTService.syncGradeToAcademicGradebook(attemptId);
      }

      return attempt;
    }

    // Past the deadline the paper is closed, not shredded: the answers already
    // saved are graded exactly as they stand and a Grade is issued like any
    // other attempt. Throwing here (the previous behaviour) left the student's
    // saved answers forever ungraded with no way back — a dropped connection in
    // the last minutes cost an entire exam. Late ANSWERS are still refused, in
    // submitAnswer; this only decides what happens to the ones that arrived in
    // time.
    const closedByTimeLimit =
      attempt.startedAt && attempt.exam?.duration
        ? Date.now() - new Date(attempt.startedAt).getTime() >
          (attempt.exam.duration + EXAM_GRACE_PERIOD_MINUTES) * 60 * 1000
        : false;

    // Auto grading
    let totalScore = 0;
    let hasEssay = false;
    const questions = attempt.exam.questionBank?.questions || [];

    const gradedAnswers = [];

    for (const question of questions) {
      const studentAnswer = attempt.answers.find((a) => a.questionId === question.id);
      let isCorrect = false;
      let score = 0;

      if (question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') {
        // One rule decides this, shared with the question-write validation and
        // the distractor analysis (`answer-key.ts`). It replaced a
        // `JSON.stringify(key) === JSON.stringify(answer)` comparison, which
        // marked every true/false question wrong whenever the teacher's key was
        // stored as the JSON boolean `true` and the client sent the string
        // "true" — silently, and straight into the academic gradebook.
        if (isAnswerCorrect(question.type, question.answerKey, studentAnswer?.answer)) {
          isCorrect = true;
          score = question.points;
        }
      } else if (question.type === 'ESSAY') {
        hasEssay = true;
      }
      // Essay needs manual grading, score remains 0 or null.

      if (studentAnswer) {
        const isEssay = question.type === 'ESSAY';
        gradedAnswers.push(
          prisma.examAnswer.update({
            where: { id: studentAnswer.id },
            data: {
              isCorrect: isEssay ? null : isCorrect,
              score: isEssay ? null : score,
            },
          })
        );
      } else if (question.type === 'ESSAY') {
        // Upsert an empty answer record for unanswered essay questions
        // so teachers can grade them later via gradeEssayAnswer.
        // Using upsert instead of create to be idempotent if finishExamAttempt
        // is called concurrently (avoids unique constraint violation).
        gradedAnswers.push(
          prisma.examAnswer.upsert({
            where: {
              attemptId_questionId: { attemptId, questionId: question.id },
            },
            create: {
              attemptId,
              questionId: question.id,
              answer: Prisma.JsonNull,
              isCorrect: null,
              score: null,
            },
            update: {},
          })
        );
      }

      totalScore += score;
    }

    // Include the attempt status update in the same transaction as answer grading
    // to avoid a race condition where answers are graded but the attempt stays IN_PROGRESS.
    gradedAnswers.push(
      prisma.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: hasEssay ? 'NEEDS_REVIEW' : 'COMPLETED',
          finishedAt: new Date(),
          score: new Decimal(totalScore),
        },
      })
    );

    // An attempt closed by the clock is scored like any other, so the status no
    // longer says which of the two happened. The distinction matters to whoever
    // reviews the exam afterwards, so it is written where the rest of the
    // attempt's history already lives — append-only, in the same transaction as
    // the grading it describes.
    if (closedByTimeLimit) {
      gradedAnswers.push(
        prisma.examSecurityLog.create({
          data: {
            attemptId,
            type: 'TIME_EXPIRED_AUTO_SUBMIT' satisfies SecurityEventType,
            details: {
              closedBy: 'SYSTEM',
              examDurationMinutes: attempt.exam?.duration ?? null,
              graceMinutes: EXAM_GRACE_PERIOD_MINUTES,
              gradedAnswers: attempt.answers.length,
              note: 'Ditutup sistem karena waktu habis; jawaban yang sudah masuk dinilai apa adanya.',
            },
          },
        })
      );
    }

    await prisma.$transaction(gradedAnswers);

    // Re-fetch the attempt using Prisma `select` on questions to avoid
    // leaking sensitive fields (answerKey, explanation) to the student.
    // This matches the same shape used by getAttempt.
    const finishedAttempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        answers: true,
        exam: {
          include: {
            questionBank: {
              include: {
                questions: {
                  select: {
                    id: true,
                    type: true,
                    content: true,
                    options: true,
                    points: true,
                  },
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!finishedAttempt) throw Errors.notFound('Attempt');

    // Auto-sync score to academic Gradebook if completed (no pending essay grading)
    if (finishedAttempt.status === 'COMPLETED') {
      await CBTService.syncGradeToAcademicGradebook(attemptId);
    }

    return finishedAttempt;
  }

  /**
   * Automatically synchronizes CBT attempt scores into the academic Gradebook (`Grade` model).
   *
   * Thread-safe and atomic: uses `upsert` with compound key `studentId_examId`.
   * Both the new-record path and any update path always refresh the score fields so a freshly
   * finished CBT attempt lands in the gradebook even when the grade row already exists.
   * `forceUpdate` (after teacher grades essay questions) additionally notes the post-grading refresh.
   *
   * The update is inherently scoped to exam grades: `examId` is only non-null for `EXAM`-type
   * grades (`schema.prisma`: "null untuk nilai non-ujian"), and the compound unique key only
   * matches rows whose `examId` equals this exam — so grades originating from other modules
   * (assignments, projects, …) can never be touched here.
   */
  static async syncGradeToAcademicGradebook(
    attemptId: string,
    options?: { forceUpdate?: boolean },
    tx?: any
  ) {
    const db = tx || prisma;
    const attempt = await db.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            questionBank: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
    });

    if (
      !attempt ||
      attempt.score === null ||
      attempt.status !== 'COMPLETED' ||
      !attempt.exam?.teacherId
    )
      return null;

    const teacher = await db.teacher.findUnique({
      where: { id: attempt.exam.teacherId },
      select: { userId: true },
    });

    if (!teacher) return null;

    const questions = attempt.exam.questionBank?.questions || [];
    const totalPossiblePoints = questions.reduce(
      (sum: number, q: { points?: number | null }) => sum + Number(q.points || 0),
      0
    );
    const denominator =
      totalPossiblePoints > 0
        ? totalPossiblePoints
        : attempt.exam.maxScore
          ? Number(attempt.exam.maxScore)
          : 100;

    const numericScore = Number(attempt.score);
    const percentage =
      denominator > 0 ? Math.min(100, Math.max(0, (numericScore / denominator) * 100)) : 0;
    const letterGrade = calculateLetterGrade(percentage);

    const createPayload = {
      studentId: attempt.studentId,
      examId: attempt.examId,
      subjectId: attempt.exam.subjectId,
      academicYearId: attempt.exam.academicYearId,
      type: 'EXAM' as const,
      score: attempt.score,
      maxScore: new Decimal(denominator),
      percentage: new Decimal(percentage),
      letterGrade,
      notes: `Nilai CBT Ujian Online (${attempt.exam.title})`,
      gradedById: teacher.userId,
    };

    // Always refresh the score fields so a freshly finished CBT attempt lands in the
    // gradebook even when the grade row already exists (exam without essay grading).
    // Only the EXAM-type grade whose `examId` matches can be selected by the compound
    // unique key below, so historical grades from other modules are never overwritten.
    const updatePayload: Prisma.GradeUpdateInput = {
      score: attempt.score,
      maxScore: new Decimal(denominator),
      percentage: new Decimal(percentage),
      letterGrade,
      gradedAt: new Date(),
    };

    if (options?.forceUpdate) {
      updatePayload.notes = `Nilai CBT (${attempt.exam.title}) - Diperbarui Pasca Koreksi Esai`;
    }

    return db.grade.upsert({
      where: {
        studentId_examId: {
          studentId: attempt.studentId,
          examId: attempt.examId,
        },
      },
      create: createPayload,
      update: updatePayload,
    });
  }

  /**
   * Item analysis per question (classical test theory):
   * - Difficulty index (P): proportion of graded answers that were correct.
   *   P < 0.3 hard, 0.3–0.7 medium, > 0.7 easy.
   * - Discrimination index (D): how well the item separates high scorers from
   *   low scorers, computed with the standard upper/lower 27% groups:
   *   D = (correct in upper group − correct in lower group) / group size.
   *   D ≥ 0.4 excellent, 0.3–0.39 good, 0.2–0.29 marginal, < 0.2 poor.
   *   Only computed with ≥ 10 finished attempts; null otherwise.
   * Also flags "killer questions" (high failure rate with enough data).
   */
  static async getExamDifficultyInsights(examId: string) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questionBank: {
          include: {
            questions: {
              orderBy: { order: 'asc' },
            },
          },
        },
        attempts: {
          where: { status: { in: ['COMPLETED', 'NEEDS_REVIEW'] } },
          include: {
            answers: true,
          },
        },
      },
    });

    if (!exam || !exam.questionBank) return null;

    // Rank attempts by total score in memory (score may be null for
    // NEEDS_REVIEW attempts; treat those as 0 for ranking purposes).
    const rankedAttempts = [...exam.attempts].sort(
      (a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)
    );
    const attemptsCount = rankedAttempts.length;
    const canDiscriminate = attemptsCount >= 10;
    const groupSize = Math.max(1, Math.floor(attemptsCount * 0.27));
    const upperGroup = rankedAttempts.slice(0, groupSize);
    const lowerGroup = rankedAttempts.slice(-groupSize);

    const countCorrect = (group: typeof rankedAttempts, questionId: string) =>
      group.filter((a) => a.answers.find((ans) => ans.questionId === questionId)?.isCorrect).length;

    const insights = exam.questionBank.questions.map((q) => {
      const answers = exam.attempts
        .map((a) => a.answers.find((ans) => ans.questionId === q.id))
        .filter((ans) => ans && ans.score !== null);

      const totalGraded = answers.length;
      const totalCorrect = answers.filter((ans) => ans?.isCorrect).length;
      const successRate = totalGraded > 0 ? (totalCorrect / totalGraded) * 100 : 0;

      const discriminationIndex = canDiscriminate
        ? (countCorrect(upperGroup, q.id) - countCorrect(lowerGroup, q.id)) / groupSize
        : null;

      // Best Practice: Distractor analysis for multiple choice questions
      let distractorAnalysis:
        | Array<{
            option: Prisma.JsonValue;
            count: number;
            percentage: number;
            ambiguous?: boolean;
            options?: Prisma.JsonValue[];
          }>
        | undefined;
      if (q.type === 'MULTIPLE_CHOICE' && Array.isArray(q.options)) {
        // Counted through the same canonical form the grader uses. These two
        // used to normalise differently — the analysis unwrapped `{ id: … }`
        // wrappers and the grader did not — so they could disagree about which
        // option a student had picked.
        //
        // The denominator is the answers whose choice still maps to a current
        // option, not every graded answer. ERASURE clears the content of an
        // answer whose option a teacher later removed but keeps its historical
        // score; counting that answer in the denominator would make the
        // displayed shares stop summing to 100%.
        const optionKeys = (q.options as Prisma.JsonValue[])
          .map((opt) => canonicalAnswer(q.type, opt))
          .filter((key): key is string => key !== null);
        const currentOptions = new Set(optionKeys);
        const optionCounts: Record<string, number> = {};
        let mappableAnswers = 0;
        answers.forEach((ans) => {
          if (ans && ans.answer != null) {
            const keyStr = canonicalAnswer(q.type, ans.answer);
            if (keyStr !== null && currentOptions.has(keyStr)) {
              optionCounts[keyStr] = (optionCounts[keyStr] || 0) + 1;
              mappableAnswers += 1;
            }
          }
        });

        // A question can end up with two options sharing an id after a teacher
        // removes one and adds another. The student form submits only the id,
        // so the count belongs to the id, not to either text. Report one row
        // per id and mark it ambiguous with every text that shares it; silently
        // attaching the combined count to the first text would hide that.
        const optionsById = new Map<string, Prisma.JsonValue[]>();
        for (const opt of q.options as Prisma.JsonValue[]) {
          const keyStr = canonicalAnswer(q.type, opt);
          if (keyStr === null) continue;
          const group = optionsById.get(keyStr) ?? [];
          group.push(opt);
          optionsById.set(keyStr, group);
        }

        const seenOptions = new Set<string>();
        distractorAnalysis = [];
        for (const opt of q.options as Prisma.JsonValue[]) {
          const keyStr = canonicalAnswer(q.type, opt);
          if (keyStr === null) {
            distractorAnalysis.push({ option: opt, count: 0, percentage: 0 });
            continue;
          }
          if (seenOptions.has(keyStr)) continue;
          seenOptions.add(keyStr);
          const count = optionCounts[keyStr] || 0;
          const group = optionsById.get(keyStr) ?? [opt];
          distractorAnalysis.push({
            option: opt,
            count,
            percentage: mappableAnswers > 0 ? (count / mappableAnswers) * 100 : 0,
            ...(group.length > 1 ? { ambiguous: true, options: group } : {}),
          });
        }
      }

      return {
        questionId: q.id,
        content: q.content.substring(0, 100),
        successRate,
        difficultyIndex: totalGraded > 0 ? totalCorrect / totalGraded : null,
        discriminationIndex,
        distractorAnalysis,
        totalGraded,
        isKiller: successRate < 30 && totalGraded > 5,
        needsReview:
          (totalGraded > 5 && successRate < 20) ||
          (discriminationIndex !== null && discriminationIndex < 0.2),
      };
    });

    return {
      examId,
      title: exam.title,
      questionInsights: insights.sort((a, b) => a.successRate - b.successRate),
      averageSuccessRate:
        insights.length > 0
          ? insights.reduce((sum, i) => sum + i.successRate, 0) / insights.length
          : 0,
      totalParticipants: attemptsCount,
      discriminationGroupSize: canDiscriminate ? groupSize : null,
    };
  }
}
