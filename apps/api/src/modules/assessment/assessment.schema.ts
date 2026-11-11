import { z } from 'zod';
import { ExamType, ExamStatus, GradeType } from '@cipansor/shared';
import { partialUpdateSchema } from '@/lib/partial';

// Exam schemas
export const createExamSchema = z.object({
  unitId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  subjectId: z.string().uuid(),
  classId: z.string().uuid(),
  teacherId: z.string().uuid(),
  type: z.nativeEnum(ExamType),
  title: z.string().min(3).max(200),
  semester: z.number().int().min(1).max(2).optional(),
  description: z.string().optional(),
  scheduledAt: z.string().datetime(),
  duration: z.number().int().min(5).max(240).default(60),
  maxScore: z.number().min(0).max(1000).default(100),
  passingScore: z.number().min(0).max(1000).default(70),
  weight: z.number().min(0).max(10).default(1),
  instructions: z.string().optional(),
});

export const updateExamSchema = partialUpdateSchema(createExamSchema).extend({
  status: z.nativeEnum(ExamStatus).optional(),
});

/** `PATCH /assessment/exams/:id/status`: one of the exam's states, nothing else. */
export const updateExamStatusSchema = z.object({
  status: z.nativeEnum(ExamStatus),
});

export const examQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unitId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  type: z.nativeEnum(ExamType).optional(),
  status: z.nativeEnum(ExamStatus).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// Grade schemas
export const createGradeSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  examId: z.string().uuid().optional(),
  academicYearId: z.string().uuid(),
  type: z.nativeEnum(GradeType),
  score: z.number().min(0).max(1000),
  maxScore: z.number().min(0).max(1000).default(100),
  notes: z.string().optional(),
  gradedById: z.string().uuid(),
});

export const updateGradeSchema = partialUpdateSchema(createGradeSchema);

export const bulkCreateGradesSchema = z.object({
  examId: z.string().uuid().optional(),
  subjectId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  type: z.nativeEnum(GradeType),
  maxScore: z.number().min(0).max(1000).default(100),
  gradedById: z.string().uuid(),
  grades: z.array(
    z.object({
      studentId: z.string().uuid(),
      score: z.number().min(0).max(1000),
      notes: z.string().optional(),
    })
  ),
});

export const gradeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  studentId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  examId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  type: z.nativeEnum(GradeType).optional(),
});

// Report Card schemas
export const createReportCardSchema = z.object({
  studentId: z.string().uuid(),
  classId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  semester: z.number().int().min(1).max(2),
  teacherNotes: z.string().optional(),
  principalNotes: z.string().optional(),
});

export const updateReportCardSchema = createReportCardSchema.partial().extend({
  isPublished: z.boolean().optional(),
});

export const reportCardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  semester: z.coerce.number().int().min(1).max(2).optional(),
  isPublished: z.coerce.boolean().optional(),
});

// Types (Query types are specific to API filtering, so they stay here or could be moved to shared if reused in frontend hooks)
export type ExamQuery = z.infer<typeof examQuerySchema>;
export type GradeQuery = z.infer<typeof gradeQuerySchema>;
export type ReportCardQuery = z.infer<typeof reportCardQuerySchema>;
