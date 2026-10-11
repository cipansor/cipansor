import { z } from 'zod';

// Activity type enum
const TahfidzActivityEnum = z.enum(['ZIYADAH', 'MUROJAAH', 'TASMI', 'ASSESSMENT']);

// Query params
export const listTahfidzQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  activityType: TahfidzActivityEnum.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  surah: z.string().optional(),
});

// Create tahfidz record
export const createTahfidzSchema = z
  .object({
    studentId: z.string().uuid('Invalid student ID'),
    activityType: TahfidzActivityEnum,
    surahNumber: z.number().int().min(1).max(114, 'Surah number must be between 1-114'),
    surahName: z.string().min(1, 'Surah name is required'),
    ayahStart: z.number().int().min(1, 'Ayah start must be at least 1'),
    ayahEnd: z.number().int().min(1, 'Ayah end must be at least 1'),
    juz: z.number().int().min(1).max(30, 'Juz must be between 1-30'),
    totalAyah: z.number().int().min(1).optional(),
    score: z.number().min(0).max(100).optional(), // For assessment
    notes: z.string().max(1000).optional(),
    audioUrl: z.string().url().optional(), // E-Simaan recording (uploaded via /upload)
    recordedAt: z.coerce.date().optional(),
  })
  .refine((data) => data.ayahEnd >= data.ayahStart, {
    message: 'Ayah end must be greater than or equal to ayah start',
    path: ['ayahEnd'],
  });

// Update tahfidz record
export const updateTahfidzSchema = z.object({
  activityType: TahfidzActivityEnum.optional(),
  surahNumber: z.number().int().min(1).max(114).optional(),
  surahName: z.string().min(1).optional(),
  ayahStart: z.number().int().min(1).optional(),
  ayahEnd: z.number().int().min(1).optional(),
  juz: z.number().int().min(1).max(30).optional(),
  totalAyah: z.number().int().min(1).optional(),
  score: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

// ID param
export const tahfidzIdParamSchema = z.object({
  id: z.string().uuid('Invalid tahfidz record ID'),
});

// Student param
export const studentIdParamSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
});

// Summary query
export const tahfidzSummaryQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
});

export const generateCertificateSchema = z.object({
  studentId: z.string().uuid(),
  certificateType: z.string(),
  issueDate: z.coerce.date().optional(),
  grade: z.string().optional(),
  completedJuz: z.array(z.number()).optional(),
  qiraahType: z.string().optional(),
  musyrifName: z.string().optional(),
  sanadChain: z.string().optional(),
  notes: z.string().optional(),
  // Whether the minted syahadah may be read on the public verification page.
  // Defaults to `true`: the row's printed URL points at
  // `/public/verify-sanad?code=…`, so a private row could never verify the
  // document it was printed on. An issuer minting an internal-only record
  // passes `false`.
  isPublic: z.boolean().default(true),
});

// Types
export type TahfidzActivityType = z.infer<typeof TahfidzActivityEnum>;
export type ListTahfidzQuery = z.infer<typeof listTahfidzQuerySchema>;
// export type CreateTahfidzInput = z.infer<typeof createTahfidzSchema>; // Moved to shared
// export type UpdateTahfidzInput = z.infer<typeof updateTahfidzSchema>; // Moved to shared
export type TahfidzSummaryQuery = z.infer<typeof tahfidzSummaryQuerySchema>;
export type GenerateCertificateInput = z.infer<typeof generateCertificateSchema>;
