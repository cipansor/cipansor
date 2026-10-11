import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';

export const createRewardSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
  category: z.string().min(2, 'Category is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  points: z.number().int().nonnegative().default(0),
  givenAt: z.string().datetime().optional(),
});

export const updateRewardSchema = partialUpdateSchema(createRewardSchema).omit({
  studentId: true,
});

export const queryRewardSchema = z.object({
  studentId: z.string().uuid().optional(),
  category: z.string().optional(),
  categoryId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateRewardDto = z.infer<typeof createRewardSchema>;
export type UpdateRewardDto = z.infer<typeof updateRewardSchema>;
export type QueryRewardDto = z.infer<typeof queryRewardSchema>;
