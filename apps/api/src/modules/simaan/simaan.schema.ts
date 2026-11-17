import { z } from 'zod';
import {
  SimaanGradeEnum,
  SimaanTypeEnum,
  createSimaanSchema,
  updateSimaanSchema,
} from '@cipansor/shared';

// The simaan create/update contract is in @cipansor/shared (#1024), which the
// web forms read too; only the query, examiner and scoring schemas live here.
// The old local `SimaanTypeEnum` (`JUZ_AMMA`, `ONE_JUZ`, …) disagreed with the
// Prisma `SimaanType` enum the three forms sent (`BIN_NAZHR`, …), so every save
// was answered 400. Prisma is the source of truth for DB enums (AGENTS.md rule
// 2); `simaan-contract.guard.test.ts` pins the shared list to it.
export { SimaanTypeEnum, createSimaanSchema, updateSimaanSchema };
export type { CreateSimaanInput, UpdateSimaanInput } from '@cipansor/shared';

// ============================================
// Query Schemas
// ============================================

export const listSimaanQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  halaqohId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  simaanType: SimaanTypeEnum.optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  passed: z.coerce.boolean().optional(),
  search: z.string().min(1).optional(),
});

export const studentSimaanSummarySchema = z.object({
  studentId: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  simaanType: SimaanTypeEnum.optional(),
});

export const halaqohSimaanQuerySchema = z.object({
  halaqohId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// ============================================
// Examiner Schemas
// ============================================

export const createExaminerSchema = z.object({
  simaanId: z.string().uuid(),
  examinerId: z.string().uuid(),
  score: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const createExaminerForSimaanSchema = z.object({
  examinerId: z.string().uuid(),
  score: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateExaminerSchema = z.object({
  score: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// ============================================
// Scoring Schemas
// ============================================

export const submitScoresSchema = z.object({
  simaanId: z.string().uuid(),
  overallScore: z.number().min(0).max(100),
  tajwidScore: z.number().min(0).max(100).optional(),
  fashohaScore: z.number().min(0).max(100).optional(),
  tartilScore: z.number().min(0).max(100).optional(),
  grade: SimaanGradeEnum,
  passed: z.boolean(),
  notes: z.string().max(2000).optional(),
  recommendations: z.string().max(2000).optional(),
});

// ============================================
// Type Exports
// ============================================

export type ListSimaanQuery = z.infer<typeof listSimaanQuerySchema>;
export type CreateExaminerInput = z.infer<typeof createExaminerSchema>;
export type UpdateExaminerInput = z.infer<typeof updateExaminerSchema>;
export type SubmitScoresInput = z.infer<typeof submitScoresSchema>;
export type StudentSimaanSummaryQuery = z.infer<typeof studentSimaanSummarySchema>;
export type HalaqohSimaanQuery = z.infer<typeof halaqohSimaanQuerySchema>;
