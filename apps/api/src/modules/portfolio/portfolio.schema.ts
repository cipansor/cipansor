import { z } from 'zod';

const portfolioType = z.enum([
  'ACADEMIC',
  'P5_PROJECT',
  'EXTRACURRICULAR',
  'ACHIEVEMENT',
  'ARTWORK',
  'TAHFIDZ',
  'OTHER',
]);

// The schemas are flat: `validate()` (apps/api/src/middleware/validate.ts)
// parses `req.body` directly, so a top-level `z.object({ body: … })` would make
// Zod look for `req.body.body` and answer every write with 400.
export const createPortfolioSchema = z.object({
  studentId: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: portfolioType,
  category: z.string().optional(),
  description: z.string().optional(),
  reflection: z.string().optional(),
  academicYearId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  isPublic: z.boolean().optional(),
  isShowcase: z.boolean().optional(),
});

export const updatePortfolioSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: portfolioType.optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  reflection: z.string().optional(),
  isPublic: z.boolean().optional(),
  isShowcase: z.boolean().optional(),
});

export const addFileSchema = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  fileType: z.string().min(1),
  fileSize: z.number().optional(),
  isCover: z.boolean().optional(),
});

export const addCommentSchema = z.object({
  content: z.string().min(1).max(1000),
});

export const reviewPortfolioSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  feedback: z.string().optional(),
});

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;
export type UpdatePortfolioInput = z.infer<typeof updatePortfolioSchema>;
export type AddFileInput = z.infer<typeof addFileSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type ReviewPortfolioInput = z.infer<typeof reviewPortfolioSchema>;
