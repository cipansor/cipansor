import { z } from 'zod';

/**
 * A murojaah day as a date input writes it ("2026-10-28") or as a full
 * datetime. `murojaahDate` is a `@db.Date` column and the form's picker
 * produces a date-only string, so requiring a datetime made every create —
 * and every date filter — fail with 400 before it reached the service.
 */
const murojaahDay = z.union([
  z.iso.date({ message: 'Format tanggal harus yyyy-MM-dd' }),
  z.iso.datetime({ offset: true, message: 'Format tanggal tidak valid' }),
]);

// Murojaah Type enum
export const MurojaahTypeEnum = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'EXAM_PREP']);

// Tahfidz Mistake Type enum
export const TahfidzMistakeTypeEnum = z.enum([
  'LAHN_JALI', // Kesalahan berat (merubah makna)
  'LAHN_KHAFI', // Kesalahan ringan (tajwid)
  'GHUNNAH', // Kesalahan ghunnah
  'MAD', // Kesalahan panjang/pendek
  'WAQF', // Kesalahan waqaf
  'IBTIDA', // Kesalahan memulai
]);

// ============================================
// Murojaah Record Query Schemas
// ============================================

export const listMurojaahQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  halaqohId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  murojaahType: MurojaahTypeEnum.optional(),
  dateFrom: murojaahDay.optional(),
  dateTo: murojaahDay.optional(),
  juz: z.coerce.number().int().min(1).max(30).optional(),
  search: z.string().optional(),
});

// ============================================
// Murojaah Record Create/Update Schemas
// ============================================

export const createMurojaahSchema = z
  .object({
    studentId: z.string().uuid(),
    enrollmentId: z.string().uuid().optional().nullable(),
    halaqohId: z.string().uuid().optional().nullable(),
    murojaahType: MurojaahTypeEnum,
    murojaahDate: murojaahDay,
    juzStart: z.number().int().min(1).max(30),
    juzEnd: z.number().int().min(1).max(30),
    pagesReviewed: z.number().int().min(1).max(620),
    durationMinutes: z.number().int().min(1).max(480),
    qualityScore: z.number().int().min(0).max(100),
    fluencyLevel: z.number().int().min(1).max(5).default(3),
    tajwidScore: z.number().int().min(0).max(100).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    improvementAreas: z.string().max(1000).optional().nullable(),
    mistakes: z
      .array(
        z.object({
          mistakeType: TahfidzMistakeTypeEnum,
          juz: z.number().int().min(1).max(30),
          surahNumber: z.number().int().min(1).max(114),
          ayahNumber: z.number().int().min(1).optional().nullable(),
          description: z.string().max(500).optional().nullable(),
        })
      )
      .optional()
      .default([]),
  })
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: 'juzEnd must be greater than or equal to juzStart',
    path: ['juzEnd'],
  });

export const updateMurojaahSchema = z.object({
  murojaahType: MurojaahTypeEnum.optional(),
  juzStart: z.number().int().min(1).max(30).optional(),
  juzEnd: z.number().int().min(1).max(30).optional(),
  pagesReviewed: z.number().int().min(1).max(620).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  qualityScore: z.number().int().min(0).max(100).optional(),
  fluencyLevel: z.number().int().min(1).max(5).optional(),
  tajwidScore: z.number().int().min(0).max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  improvementAreas: z.string().max(1000).optional().nullable(),
});

// ============================================
// Murojaah Mistake Schemas
// ============================================

export const createMistakeSchema = z.object({
  murojaahId: z.string().uuid(),
  mistakeType: TahfidzMistakeTypeEnum,
  juz: z.number().int().min(1).max(30),
  surahNumber: z.number().int().min(1).max(114),
  ayahNumber: z.number().int().min(1).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

// ============================================
// Student Summary Schemas
// ============================================

export const studentMurojaahSummarySchema = z.object({
  studentId: z.string().uuid(),
  startDate: murojaahDay.optional(),
  endDate: murojaahDay.optional(),
  murojaahType: MurojaahTypeEnum.optional(),
});

export const halaqohMurojaahQuerySchema = z.object({
  halaqohId: z.string().uuid(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  dateFrom: murojaahDay.optional(),
  dateTo: murojaahDay.optional(),
});

// ============================================
// Murojaah Schedule Schemas
// ============================================

export const murojaahScheduleQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  halaqohId: z.string().uuid().optional(),
});

// ============================================
// Type Exports
// ============================================

export type ListMurojaahQuery = z.infer<typeof listMurojaahQuerySchema>;
export type CreateMurojaahInput = z.infer<typeof createMurojaahSchema>;
export type UpdateMurojaahInput = z.infer<typeof updateMurojaahSchema>;
export type CreateMistakeInput = z.infer<typeof createMistakeSchema>;
export type StudentMurojaahSummaryQuery = z.infer<typeof studentMurojaahSummarySchema>;
export type HalaqohMurojaahQuery = z.infer<typeof halaqohMurojaahQuerySchema>;
export type MurojaahScheduleQuery = z.infer<typeof murojaahScheduleQuerySchema>;
