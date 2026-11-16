import { prisma } from '@/lib/prisma';
import { Decimal } from '@prisma/client/runtime/client';
import {
  SharedPaginatedResponse,
  Exam,
  ExamType,
  ExamStatus,
  CreateExamInput,
  UpdateExamInput,
  Grade,
  GradeType,
  CreateGradeInput,
  UpdateGradeInput,
  BulkCreateGradesInput,
  ReportCard,
  CreateReportCardInput,
  UpdateReportCardInput,
  ReportCardDetail,
  calculateLetterGrade,
} from '@cipansor/shared';
import { Prisma } from '@prisma/client';
import type { ExamQuery, GradeQuery, ReportCardQuery } from './assessment.schema';
import {
  onlyScopedStudents,
  STUDENT_SAFE_SELECT,
  TEACHER_SAFE_SELECT,
} from '@/utils/student-scope';
import { ExamAnalyticsData } from '@cipansor/shared';
import { Errors } from '@/middleware/error';
import type { WriteActor } from '@/utils/write-scope';
import {
  actorExamSubjects,
  assertExamWritable,
  assertGradesWritable,
  assertReportCardsWritable,
  examReadWhere,
  isPenulisPenilaian,
} from './assessment-writer';

// =====================================
// EXAM SERVICES
// =====================================

export async function getExams(
  query: ExamQuery,
  actor: WriteActor
): Promise<SharedPaginatedResponse<Exam>> {
  const {
    page,
    limit,
    unitId,
    academicYearId,
    subjectId,
    classId,
    teacherId,
    type,
    status,
    startDate,
    endDate,
  } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.ExamWhereInput = { ...examReadWhere(actor) };
  // A request may narrow to a unit, never widen past the read scope: the
  // scope's own unit wins when it pins one (R25.7).
  if (unitId) where.unitId = where.unitId ?? unitId;
  if (academicYearId) where.academicYearId = academicYearId;
  if (subjectId) where.subjectId = subjectId;
  if (classId) where.classId = classId;
  if (teacherId) where.teacherId = teacherId;
  if (type) where.type = type as any; // Cast to Prisma enum
  if (status) where.status = status as any; // Cast to Prisma enum
  if (startDate || endDate) {
    where.scheduledAt = {};
    if (startDate) where.scheduledAt.gte = new Date(startDate);
    if (endDate) where.scheduledAt.lte = new Date(endDate);
  }

  const [exams, total] = await Promise.all([
    prisma.exam.findMany({
      where,
      skip,
      take: limit,
      include: {
        subject: { select: { id: true, name: true, code: true } },
        class: { select: { id: true, name: true, level: true } },
        teacher: { select: TEACHER_SAFE_SELECT },
        _count: { select: { grades: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    }),
    prisma.exam.count({ where }),
  ]);

  return {
    success: true,
    data: exams.map(mapToExam),
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

export async function getExamById(
  id: string,
  scope: Prisma.StudentWhereInput,
  actor: WriteActor
): Promise<Exam | null> {
  const exam = await prisma.exam.findFirst({
    where: { AND: [{ id }, examReadWhere(actor)] },
    include: {
      unit: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true, code: true } },
      class: { select: { id: true, name: true, level: true } },
      teacher: { select: TEACHER_SAFE_SELECT },
      // A santri opening an exam to take it must not receive the class's scores.
      grades: {
        where: onlyScopedStudents(scope),
        include: {
          student: { select: STUDENT_SAFE_SELECT },
        },
        orderBy: { score: 'desc' },
      },
    },
  });

  if (!exam) return null;
  return mapToExam(exam);
}

export async function createExam(data: CreateExamInput, actor: WriteActor): Promise<Exam> {
  // The record is written to the actor's own unit; only Super_Admin names one
  // (R25.1, R25.2). A non-Super_Admin never writes another unit, whatever the
  // body says.
  const unitId = actor.roleCode === 'SUPER_ADMIN' ? (data.unitId ?? actor.unitId) : actor.unitId;
  if (!unitId) throw Errors.badRequest('Pilih unit');
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) throw Errors.badRequest('Pilih unit');

  // The class and subject must be in that unit, and the actor must be a
  // Penulis_Penilaian of the exam — otherwise 404, as for a class that is not
  // there (R25.3).
  const cls = await prisma.class.findUnique({
    where: { id: data.classId },
    select: { unitId: true },
  });
  const subject = await prisma.subject.findUnique({
    where: { id: data.subjectId },
    select: { unitId: true },
  });
  if (!cls || !subject || cls.unitId !== unitId || subject.unitId !== unitId) {
    throw Errors.notFound('Class');
  }
  const teacher = await prisma.teacher.findUnique({
    where: { id: data.teacherId },
    select: { unitId: true },
  });
  if (!teacher || teacher.unitId !== unitId) throw Errors.notFound('Teacher');

  const actorSubjects = await actorExamSubjects(actor);
  const allowed = isPenulisPenilaian(actor, {
    kind: 'EXAM',
    unitId,
    subjectId: data.subjectId,
    classId: data.classId,
    actorSubjects,
  });
  if (!allowed) throw Errors.notFound('Class');

  const exam = await prisma.exam.create({
    data: {
      unitId,
      academicYearId: data.academicYearId,
      subjectId: data.subjectId,
      classId: data.classId,
      teacherId: data.teacherId,
      type: data.type as any, // Prisma enum
      title: data.title,
      description: data.description,
      scheduledAt: new Date(data.scheduledAt),
      duration: data.duration ?? 60,
      maxScore: new Decimal(data.maxScore ?? 100),
      passingScore: new Decimal(data.passingScore ?? 70),
      weight: new Decimal(data.weight ?? 1),
      instructions: data.instructions,
      status: 'SCHEDULED' as any, // Default status
    },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      class: { select: { id: true, name: true, level: true } },
      teacher: { select: TEACHER_SAFE_SELECT },
    },
  });

  return mapToExam(exam);
}

export async function getExamAnalytics(
  id: string,
  actor: WriteActor
): Promise<ExamAnalyticsData | null> {
  const exam = await prisma.exam.findFirst({
    where: { AND: [{ id }, examReadWhere(actor)] },
    include: {
      grades: {
        include: {
          student: { select: STUDENT_SAFE_SELECT },
        },
      },
      class: {
        include: {
          _count: {
            select: { enrollments: { where: { status: 'active' } } },
          },
        },
      },
    },
  });

  if (!exam) {
    return null;
  }

  const passingScore = Number(exam.passingScore || 70);
  const maxScore = Number(exam.maxScore || 100);
  const grades = exam.grades;

  const totalStudents = exam.class?._count?.enrollments ?? grades.length;
  const gradedCount = grades.length;

  if (gradedCount === 0) {
    return {
      examId: id,
      totalStudents,
      gradedCount: 0,
      averageScore: 0,
      highestScore: 0,
      lowestScore: 0,
      passCount: 0,
      failCount: 0,
      passRate: 0,
      scoreDistribution: [
        { range: '0-59%', count: 0 },
        { range: '60-69%', count: 0 },
        { range: '70-79%', count: 0 },
        { range: '80-89%', count: 0 },
        { range: '90-100%', count: 0 },
      ],
      topStudents: [],
    };
  }

  let totalScore = 0;
  let highestScore = -1;
  let lowestScore = Infinity;
  let passCount = 0;

  const distributionCounts = {
    '0-59%': 0,
    '60-69%': 0,
    '70-79%': 0,
    '80-89%': 0,
    '90-100%': 0,
  };

  const studentScores: { studentId: string; studentName: string; score: number }[] = [];

  for (const grade of grades) {
    const score = Number(grade.score);
    totalScore += score;

    if (score > highestScore) highestScore = score;
    if (score < lowestScore) lowestScore = score;
    if (score >= passingScore) passCount++;

    // Distribution logic assuming 100 is max score typical
    const pct = (score / maxScore) * 100;
    if (pct < 60) distributionCounts['0-59%']++;
    else if (pct < 70) distributionCounts['60-69%']++;
    else if (pct < 80) distributionCounts['70-79%']++;
    else if (pct < 90) distributionCounts['80-89%']++;
    else distributionCounts['90-100%']++;

    studentScores.push({
      studentId: grade.studentId,
      studentName: grade.student?.user?.name || grade.studentId,
      score,
    });
  }

  const averageScore = Number((totalScore / gradedCount).toFixed(2));
  const failCount = gradedCount - passCount;
  const passRate = Number(((passCount / gradedCount) * 100).toFixed(2));

  // Sort and get top 5
  studentScores.sort((a, b) => b.score - a.score);
  const topStudents = studentScores.slice(0, 5);

  const scoreDistribution = [
    { range: '0-59%', count: distributionCounts['0-59%'] },
    { range: '60-69%', count: distributionCounts['60-69%'] },
    { range: '70-79%', count: distributionCounts['70-79%'] },
    { range: '80-89%', count: distributionCounts['80-89%'] },
    { range: '90-100%', count: distributionCounts['90-100%'] },
  ];

  return {
    examId: id,
    totalStudents,
    gradedCount,
    averageScore,
    highestScore,
    lowestScore,
    passCount,
    failCount,
    passRate,
    scoreDistribution,
    topStudents,
  };
}

export async function updateExam(
  id: string,
  data: UpdateExamInput,
  actor: WriteActor
): Promise<Exam> {
  await assertExamWritable(actor, id);
  const updateData: Prisma.ExamUpdateInput = {};

  if (data.title) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt);
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.maxScore !== undefined) updateData.maxScore = new Decimal(data.maxScore);
  if (data.passingScore !== undefined) updateData.passingScore = new Decimal(data.passingScore);
  if (data.weight !== undefined) updateData.weight = new Decimal(data.weight);
  if (data.instructions !== undefined) updateData.instructions = data.instructions;
  if (data.status) updateData.status = data.status as any;
  if (data.type) updateData.type = data.type as any;

  const exam = await prisma.exam.update({
    where: { id },
    data: updateData,
    include: {
      subject: { select: { id: true, name: true, code: true } },
      class: { select: { id: true, name: true, level: true } },
      teacher: { select: TEACHER_SAFE_SELECT },
    },
  });

  return mapToExam(exam);
}

export async function deleteExam(id: string, actor: WriteActor): Promise<Exam> {
  await assertExamWritable(actor, id);
  // First delete all grades for this exam to ensure referential integrity
  await prisma.grade.deleteMany({ where: { examId: id } });
  const exam = await prisma.exam.delete({ where: { id } });
  return mapToExam(exam);
}

export async function updateExamStatus(
  id: string,
  status: string,
  actor: WriteActor
): Promise<Exam> {
  await assertExamWritable(actor, id);
  const exam = await prisma.exam.update({
    where: { id },
    data: { status: status as any },
  });
  return mapToExam(exam);
}

// =====================================
// GRADE SERVICES
// =====================================

export async function getGrades(
  query: GradeQuery,
  scope: Prisma.StudentWhereInput
): Promise<SharedPaginatedResponse<Grade>> {
  const { page, limit, studentId, subjectId, examId, academicYearId, type } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.GradeWhereInput = { ...onlyScopedStudents(scope) };
  if (studentId) where.studentId = studentId;
  if (subjectId) where.subjectId = subjectId;
  if (examId) where.examId = examId;
  if (academicYearId) where.academicYearId = academicYearId;
  if (type) where.type = type as any;

  const [grades, total] = await Promise.all([
    prisma.grade.findMany({
      where,
      skip,
      take: limit,
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        subject: { select: { id: true, name: true, code: true } },
        exam: { select: { id: true, title: true, type: true } },
        gradedBy: { select: { id: true, name: true } },
      },
      orderBy: { gradedAt: 'desc' },
    }),
    prisma.grade.count({ where }),
  ]);

  return {
    success: true,
    data: grades.map(mapToGrade),
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

export async function getGradeById(
  id: string,
  scope: Prisma.StudentWhereInput
): Promise<Grade | null> {
  const grade = await prisma.grade.findFirst({
    where: { id, ...onlyScopedStudents(scope) },
    include: {
      student: { select: STUDENT_SAFE_SELECT },
      subject: { select: { id: true, name: true, code: true } },
      exam: { select: { id: true, title: true, type: true } },
      gradedBy: { select: { id: true, name: true } },
    },
  });

  if (!grade) return null;
  return mapToGrade(grade);
}

export async function createGrade(data: CreateGradeInput, actor: WriteActor): Promise<Grade> {
  await assertGradesWritable(actor, [data.studentId], data.examId ? [data.examId] : []);
  const percentage = (data.score / (data.maxScore ?? 100)) * 100;
  const letterGrade = calculateLetterGrade(percentage);

  const gradeData = {
    studentId: data.studentId,
    subjectId: data.subjectId,
    examId: data.examId,
    academicYearId: data.academicYearId,
    type: data.type as any,
    score: new Decimal(data.score),
    maxScore: new Decimal(data.maxScore ?? 100),
    percentage: new Decimal(percentage),
    letterGrade,
    notes: data.notes,
    gradedById: data.gradedById,
  };

  const includeRelations = {
    student: { select: STUDENT_SAFE_SELECT },
    subject: { select: { id: true, name: true, code: true } },
    exam: { select: { id: true, title: true, type: true } },
    gradedBy: { select: { id: true, name: true } },
  };

  if (data.examId) {
    const grade = await prisma.grade.upsert({
      where: {
        studentId_examId: {
          studentId: data.studentId,
          examId: data.examId,
        },
      },
      create: gradeData,
      update: {
        score: gradeData.score,
        maxScore: gradeData.maxScore,
        percentage: gradeData.percentage,
        letterGrade: gradeData.letterGrade,
        notes: gradeData.notes,
        gradedById: gradeData.gradedById,
        gradedAt: new Date(),
      },
      include: includeRelations,
    });
    return mapToGrade(grade);
  }

  const grade = await prisma.grade.create({
    data: gradeData,
    include: includeRelations,
  });

  return mapToGrade(grade);
}

export async function updateGrade(
  id: string,
  data: UpdateGradeInput,
  actor: WriteActor
): Promise<Grade> {
  // A grade of another unit, or of a santri the actor does not teach, answers
  // 404 — as does an id that does not exist (R13.2). This used to answer 500.
  const existing = await prisma.grade.findUnique({
    where: { id },
    select: { studentId: true, score: true, maxScore: true },
  });
  if (!existing) throw Errors.notFound('Grade');
  // R13.2/R13.6: an existing grade is written through the actor's relation with
  // its santri alone — the exam is not re-checked here (that is a create-time
  // rule, R25.4).
  await assertGradesWritable(actor, [existing.studentId], [], 'Grade');

  const updateData: Prisma.GradeUpdateInput = {};

  if (data.notes !== undefined) updateData.notes = data.notes;

  // If scores change, we need to recalculate percentage and letter grade
  if (data.score !== undefined || data.maxScore !== undefined) {
    const score = data.score !== undefined ? data.score : Number(existing.score);
    const maxScore = data.maxScore !== undefined ? data.maxScore : Number(existing.maxScore);

    const percentage = (score / maxScore) * 100;

    updateData.score = new Decimal(score);
    updateData.maxScore = new Decimal(maxScore);
    updateData.percentage = new Decimal(percentage);
    updateData.letterGrade = calculateLetterGrade(percentage);
  }

  const grade = await prisma.grade.update({
    where: { id },
    data: updateData,
    include: {
      student: { select: STUDENT_SAFE_SELECT },
      subject: { select: { id: true, name: true, code: true } },
      exam: { select: { id: true, title: true, type: true } },
      gradedBy: { select: { id: true, name: true } },
    },
  });

  return mapToGrade(grade);
}

export async function deleteGrade(id: string, actor: WriteActor): Promise<Grade> {
  const existing = await prisma.grade.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!existing) throw Errors.notFound('Grade');
  await assertGradesWritable(actor, [existing.studentId], [], 'Grade');

  const grade = await prisma.grade.delete({ where: { id } });
  return mapToGrade(grade);
}

export async function bulkCreateGrades(
  data: BulkCreateGradesInput,
  actor: WriteActor
): Promise<number> {
  // Every santri and every exam is checked before anything is written, so a
  // request that names one target out of reach changes nothing (R25.4).
  await assertGradesWritable(
    actor,
    data.grades.map((g) => g.studentId),
    data.examId ? [data.examId] : []
  );
  const maxScore = data.maxScore ?? 100;

  if (data.examId) {
    const examId = data.examId;
    const operations = data.grades.map((g) => {
      const percentage = (g.score / maxScore) * 100;
      const letterGrade = calculateLetterGrade(percentage);

      return prisma.grade.upsert({
        where: {
          studentId_examId: {
            studentId: g.studentId,
            examId,
          },
        },
        create: {
          studentId: g.studentId,
          subjectId: data.subjectId,
          examId,
          academicYearId: data.academicYearId,
          type: data.type as any,
          score: new Decimal(g.score),
          maxScore: new Decimal(maxScore),
          percentage: new Decimal(percentage),
          letterGrade,
          notes: g.notes,
          gradedById: data.gradedById,
        },
        update: {
          score: new Decimal(g.score),
          maxScore: new Decimal(maxScore),
          percentage: new Decimal(percentage),
          letterGrade,
          notes: g.notes,
          gradedById: data.gradedById,
          gradedAt: new Date(),
        },
      });
    });

    const results = await prisma.$transaction(operations);
    return results.length;
  }

  const grades = data.grades.map((g) => {
    const percentage = (g.score / maxScore) * 100;

    return {
      studentId: g.studentId,
      subjectId: data.subjectId,
      examId: data.examId,
      academicYearId: data.academicYearId,
      type: data.type as any,
      score: new Decimal(g.score),
      maxScore: new Decimal(maxScore),
      percentage: new Decimal(percentage),
      letterGrade: calculateLetterGrade(percentage),
      notes: g.notes,
      gradedById: data.gradedById,
    };
  });

  const result = await prisma.grade.createMany({ data: grades });
  return result.count;
}

export async function getStudentGrades(
  studentId: string,
  scope: Prisma.StudentWhereInput,
  academicYearId?: string
): Promise<Grade[]> {
  const where: Prisma.GradeWhereInput = { studentId, ...onlyScopedStudents(scope) };
  if (academicYearId) where.academicYearId = academicYearId;

  const grades = await prisma.grade.findMany({
    where,
    include: {
      subject: { select: { id: true, name: true, code: true } },
      exam: { select: { id: true, title: true, type: true } },
      gradedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ subjectId: 'asc' }, { gradedAt: 'desc' }],
  });

  return grades.map(mapToGrade);
}

export async function getExamGrades(
  examId: string,
  scope: Prisma.StudentWhereInput
): Promise<Grade[]> {
  const grades = await prisma.grade.findMany({
    where: { examId, ...onlyScopedStudents(scope) },
    include: {
      student: { select: STUDENT_SAFE_SELECT },
      subject: { select: { id: true, name: true, code: true } },
      exam: { select: { id: true, title: true, type: true } },
      gradedBy: { select: { id: true, name: true } },
    },
    orderBy: { score: 'desc' },
  });

  return grades.map(mapToGrade);
}

// =====================================
// REPORT CARD SERVICES
// =====================================

export async function getReportCards(
  query: ReportCardQuery,
  scope: Prisma.StudentWhereInput
): Promise<SharedPaginatedResponse<ReportCard>> {
  const { page, limit, studentId, classId, academicYearId, semester, isPublished } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.ReportCardWhereInput = { ...onlyScopedStudents(scope) };
  if (studentId) where.studentId = studentId;
  if (classId) where.classId = classId;
  if (academicYearId) where.academicYearId = academicYearId;
  if (semester) where.semester = semester;
  if (isPublished !== undefined) where.isPublished = isPublished;

  const [reportCards, total] = await Promise.all([
    prisma.reportCard.findMany({
      where,
      skip,
      take: limit,
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        class: { select: { id: true, name: true, level: true } },
        academicYear: { select: { id: true, name: true } },
        _count: { select: { details: true } },
      },
      orderBy: [{ academicYearId: 'desc' }, { semester: 'desc' }],
    }),
    prisma.reportCard.count({ where }),
  ]);

  return {
    success: true,
    data: reportCards.map(mapToReportCard),
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

export async function getReportCardById(
  id: string,
  scope: Prisma.StudentWhereInput
): Promise<ReportCard | null> {
  const reportCard = await prisma.reportCard.findFirst({
    where: { id, ...onlyScopedStudents(scope) },
    include: {
      student: { select: STUDENT_SAFE_SELECT },
      // The print page signs with the issuing unit's head and the wali kelas.
      class: {
        select: {
          id: true,
          name: true,
          level: true,
          unitId: true,
          homeroomTeacher: { select: { id: true, user: { select: { name: true } } } },
        },
      },
      academicYear: { select: { id: true, name: true } },
      details: { orderBy: { subjectName: 'asc' } },
    },
  });

  if (!reportCard) return null;
  return mapToReportCard(reportCard);
}

export async function createReportCard(
  data: CreateReportCardInput,
  actor: WriteActor
): Promise<ReportCard> {
  await assertReportCardsWritable(actor, [data.studentId]);
  const reportCard = await prisma.reportCard.create({
    data: {
      studentId: data.studentId,
      classId: data.classId,
      academicYearId: data.academicYearId,
      semester: data.semester,
      teacherNotes: data.teacherNotes,
      principalNotes: data.principalNotes,
    },
    include: {
      student: { select: STUDENT_SAFE_SELECT },
      class: { select: { id: true, name: true, level: true } },
      academicYear: { select: { id: true, name: true } },
    },
  });

  return mapToReportCard(reportCard);
}

export async function updateReportCard(
  id: string,
  data: UpdateReportCardInput,
  actor: WriteActor
): Promise<ReportCard> {
  const existing = await prisma.reportCard.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!existing) throw Errors.notFound('ReportCard');
  await assertReportCardsWritable(actor, [existing.studentId], 'ReportCard');

  const updateData: Prisma.ReportCardUpdateInput = {};

  if (data.teacherNotes !== undefined) updateData.teacherNotes = data.teacherNotes;
  if (data.principalNotes !== undefined) updateData.principalNotes = data.principalNotes;

  if (data.isPublished) {
    updateData.isPublished = true;
    updateData.publishedAt = new Date();
  } else if (data.isPublished === false) {
    updateData.isPublished = false;
    updateData.publishedAt = null;
  }

  const reportCard = await prisma.reportCard.update({
    where: { id },
    data: updateData,
    include: {
      student: { select: STUDENT_SAFE_SELECT },
      class: { select: { id: true, name: true, level: true } },
      academicYear: { select: { id: true, name: true } },
      details: true,
    },
  });

  return mapToReportCard(reportCard);
}

export async function deleteReportCard(id: string, actor: WriteActor): Promise<ReportCard> {
  const existing = await prisma.reportCard.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!existing) throw Errors.notFound('ReportCard');
  await assertReportCardsWritable(actor, [existing.studentId], 'ReportCard');

  // Delete details first
  await prisma.reportCardDetail.deleteMany({ where: { reportCardId: id } });
  const reportCard = await prisma.reportCard.delete({ where: { id } });
  return mapToReportCard(reportCard);
}

export async function generateReportCard(
  studentId: string,
  classId: string,
  academicYearId: string,
  semester: number,
  actor: WriteActor
): Promise<ReportCard | null> {
  await assertReportCardsWritable(actor, [studentId]);
  // Optimization: Use Promise.all to fetch data concurrently
  // Optimization: Use database aggregation instead of in-memory loop for subject averages

  // Execute independent queries concurrently
  const [subjectAggregates, attendance, tahfidzRecord, totalAyahResult] = await Promise.all([
    // 1. Calculate Averages per Subject using Raw SQL for performance
    // We need to group by subject and calculate averages for Daily, Midterm, Final
    // Then average those components
    prisma.$queryRaw<
      Array<{
        subject_id: string;
        subject_name: string;
        avg_daily: number | null;
        avg_midterm: number | null;
        avg_final: number | null;
      }>
    >`
      SELECT
        s.id as subject_id,
        s.name as subject_name,
        AVG(CASE WHEN e.type = 'DAILY_TEST' THEN g.percentage END) as avg_daily,
        AVG(CASE WHEN e.type = 'MIDTERM' THEN g.percentage END) as avg_midterm,
        AVG(CASE WHEN e.type = 'FINAL' THEN g.percentage END) as avg_final
      FROM "grades" g
      JOIN "exams" e ON g.exam_id = e.id
      JOIN "subjects" s ON g.subject_id = s.id
      WHERE g.student_id = ${studentId}
        AND g.academic_year_id = ${academicYearId}
        AND g.type = 'EXAM'
      GROUP BY s.id, s.name
    `,

    // 2. Fetch Attendance Summary
    // Use count with CASE inside aggregation or Prisma GroupBy
    prisma.attendance.groupBy({
      by: ['status'],
      where: {
        studentId,
        class: { academicYearId }, // Filter by class associated with academic year? Or just academicYearId on attendance?
      },
      _count: true,
    }),

    // 3. Fetch Tahfidz Summary
    // Optimized: Use single query to get latest record
    prisma.tahfidzRecord.findFirst({
      where: { studentId },
      orderBy: { juz: 'desc' },
    }),

    // Optimized: Calculate total ayah with aggregation
    prisma.tahfidzRecord.aggregate({
      where: { studentId, activityType: 'ZIYADAH' },
      _sum: { totalAyah: true },
    }),
  ]);

  const details = subjectAggregates.map((sub) => {
    const daily = sub.avg_daily ? Number(sub.avg_daily) : null;
    const midterm = sub.avg_midterm ? Number(sub.avg_midterm) : null;
    const final = sub.avg_final ? Number(sub.avg_final) : null;

    // Calculate weighted average (simple average for now, but could be weighted)
    // Formula: Average of available components
    const components = [daily, midterm, final].filter((c) => c !== null) as number[];
    const avgScore =
      components.length > 0 ? components.reduce((a, b) => a + b, 0) / components.length : null;

    return {
      subjectName: sub.subject_name,
      dailyScore: daily ? new Decimal(daily) : null,
      midtermScore: midterm ? new Decimal(midterm) : null,
      finalScore: final ? new Decimal(final) : null,
      averageScore: avgScore ? new Decimal(avgScore) : null,
      letterGrade: avgScore ? calculateLetterGrade(avgScore) : null,
    };
  });

  const attendanceSummary = {
    present:
      (attendance.find((a) => a.status === 'PRESENT')?._count || 0) +
      (attendance.find((a) => a.status === 'LATE')?._count || 0),
    absent: attendance.find((a) => a.status === 'ABSENT')?._count || 0,
    sick: attendance.find((a) => a.status === 'SICK')?._count || 0,
    excused: attendance.find((a) => a.status === 'EXCUSED')?._count || 0,
  };

  const tahfidzSummary = tahfidzRecord
    ? {
        lastJuz: tahfidzRecord.juz,
        lastSurah: tahfidzRecord.surahName,
        totalAyah: totalAyahResult._sum.totalAyah || 0,
      }
    : undefined; // Prisma JSON needs null/undefined handling carefully

  // 4. Calculate Overall Average
  const validSubjects = details.filter((d) => d.averageScore !== null);
  const overallAverage =
    validSubjects.length > 0
      ? validSubjects.reduce((sum, d) => sum + Number(d.averageScore), 0) / validSubjects.length
      : null;

  // 5. Upsert Report Card
  // Transaction to ensure atomicity
  const reportCard = await prisma.$transaction(async (tx) => {
    // Upsert Report Card Header
    const rc = await tx.reportCard.upsert({
      where: {
        studentId_classId_academicYearId_semester: {
          studentId,
          classId,
          academicYearId,
          semester,
        },
      },
      create: {
        studentId,
        classId,
        academicYearId,
        semester,
        averageScore: overallAverage ? new Decimal(overallAverage) : null,
        attendance: attendanceSummary,
        tahfidzSummary: tahfidzSummary ?? Prisma.JsonNull,
        // Create details inline
        details: {
          create: details.map((d) => ({
            subjectName: d.subjectName,
            dailyScore: d.dailyScore,
            midtermScore: d.midtermScore,
            finalScore: d.finalScore,
            averageScore: d.averageScore,
            letterGrade: d.letterGrade,
          })),
        },
      },
      update: {
        averageScore: overallAverage ? new Decimal(overallAverage) : null,
        attendance: attendanceSummary,
        tahfidzSummary: tahfidzSummary ?? Prisma.JsonNull,
        updatedAt: new Date(),
      },
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        class: { select: { id: true, name: true, level: true } },
        academicYear: { select: { id: true, name: true } },
      },
    });

    // If it was an update, we need to replace details
    // We can't know if it was create or update easily with upsert return
    // So we just delete and recreate details for this ID (except if we just created it, but this is safe)
    // Actually, upsert `create` handles creation. `update` doesn't handle nested delete-create well in one go without deleteMany.
    // So we run deleteMany and createMany for the details separately if we are in update path.
    // However, since we can't distinguish, a common pattern is to always replace details.

    await tx.reportCardDetail.deleteMany({ where: { reportCardId: rc.id } });
    await tx.reportCardDetail.createMany({
      data: details.map((d) => ({
        reportCardId: rc.id,
        subjectName: d.subjectName,
        dailyScore: d.dailyScore,
        midtermScore: d.midtermScore,
        finalScore: d.finalScore,
        averageScore: d.averageScore,
        letterGrade: d.letterGrade,
      })),
    });

    return rc;
  });

  // Re-fetch with details to return full object. The caller just wrote this
  // card (a teacher-only route), so no santri scope applies.
  return getReportCardById(reportCard.id, {});
}

export async function generateClassReportCards(
  classId: string,
  academicYearId: string,
  semester: number,
  actor: WriteActor
): Promise<ReportCard[]> {
  // Get all active students in class
  const enrollments = await prisma.classEnrollment.findMany({
    where: { classId, status: 'active' },
    select: { studentId: true },
  });

  // The whole class is checked before any card is written, so one santri out
  // of reach leaves the request with nothing changed (R25.5).
  await assertReportCardsWritable(
    actor,
    enrollments.map((e) => e.studentId)
  );

  // Generate for each student concurrently
  // Using Promise.all is efficient for typical class sizes (30-40)
  const results = await Promise.all(
    enrollments.map((e) =>
      generateReportCard(e.studentId, classId, academicYearId, semester, actor)
    )
  );

  return results.filter((r): r is ReportCard => r !== null);
}

export async function publishReportCard(id: string, actor: WriteActor): Promise<ReportCard> {
  const existing = await prisma.reportCard.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!existing) throw Errors.notFound('ReportCard');
  await assertReportCardsWritable(actor, [existing.studentId], 'ReportCard');

  const reportCard = await prisma.reportCard.update({
    where: { id },
    data: { isPublished: true, publishedAt: new Date() },
  });
  return mapToReportCard(reportCard);
}

// =====================================
// MAPPERS
// =====================================

function mapToExam(data: any): Exam {
  return {
    id: data.id,
    unitId: data.unitId,
    academicYearId: data.academicYearId,
    subjectId: data.subjectId,
    classId: data.classId,
    teacherId: data.teacherId,
    type: data.type as ExamType,
    title: data.title,
    semester: data.semester,
    description: data.description ?? undefined,
    scheduledAt: data.scheduledAt,
    duration: data.duration,
    maxScore: Number(data.maxScore),
    passingScore: Number(data.passingScore),
    weight: Number(data.weight),
    instructions: data.instructions ?? undefined,
    status: data.status as ExamStatus,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,

    subject: data.subject,
    class: data.class,
    teacher: data.teacher,
    academicYear: data.academicYear,
    grades: data.grades ? data.grades.map(mapToGrade) : undefined,
    _count: data._count,
  };
}

function mapToGrade(data: any): Grade {
  return {
    id: data.id,
    studentId: data.studentId,
    subjectId: data.subjectId,
    examId: data.examId,
    academicYearId: data.academicYearId,
    type: data.type as GradeType,
    score: Number(data.score),
    maxScore: Number(data.maxScore),
    percentage: Number(data.percentage),
    letterGrade: data.letterGrade,
    notes: data.notes ?? undefined,
    gradedById: data.gradedById,
    gradedAt: data.gradedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,

    student: data.student,
    subject: data.subject,
    exam: data.exam
      ? {
          id: data.exam.id,
          title: data.exam.title,
          type: data.exam.type as ExamType,
        }
      : undefined,
    gradedBy: data.gradedBy,
  };
}

function mapToReportCard(data: any): ReportCard {
  return {
    id: data.id,
    studentId: data.studentId,
    classId: data.classId,
    academicYearId: data.academicYearId,
    semester: data.semester,
    averageScore: data.averageScore ? Number(data.averageScore) : null,
    rank: data.rank,
    attendance: data.attendance as any, // Typed in shared
    tahfidzSummary: data.tahfidzSummary as any,
    teacherNotes: data.teacherNotes ?? undefined,
    principalNotes: data.principalNotes ?? undefined,
    isPublished: data.isPublished,
    publishedAt: data.publishedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,

    student: data.student,
    class: data.class && {
      id: data.class.id,
      name: data.class.name,
      level: data.class.level,
      unitId: data.class.unitId,
      teacher: data.class.homeroomTeacher
        ? { id: data.class.homeroomTeacher.id, name: data.class.homeroomTeacher.user.name }
        : undefined,
    },
    academicYear: data.academicYear,
    details: data.details
      ? data.details.map((d: any) => ({
          id: d.id,
          reportCardId: d.reportCardId,
          subjectName: d.subjectName,
          dailyScore: d.dailyScore ? Number(d.dailyScore) : null,
          midtermScore: d.midtermScore ? Number(d.midtermScore) : null,
          finalScore: d.finalScore ? Number(d.finalScore) : null,
          averageScore: d.averageScore ? Number(d.averageScore) : null,
          letterGrade: d.letterGrade,
          comments: d.comments ?? undefined,
        }))
      : undefined,
  };
}
