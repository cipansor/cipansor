import { z } from 'zod';
import { ViolationType } from '@prisma/client';
import { partialUpdateSchema } from '@/lib/partial';

export const createViolationSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
  type: z.nativeEnum(ViolationType),
  category: z.string().min(2, 'Category is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  occurredAt: z.string().datetime('Invalid date'),
  points: z.number().int().nonnegative().default(0),
  action: z.string().optional(),
});

export const updateViolationSchema = partialUpdateSchema(createViolationSchema).omit({
  studentId: true,
});

export const queryViolationSchema = z.object({
  studentId: z.string().uuid().optional(),
  type: z.nativeEnum(ViolationType).optional(),
  category: z.string().optional(),
  categoryId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateViolationDto = z.infer<typeof createViolationSchema>;
export type UpdateViolationDto = z.infer<typeof updateViolationSchema>;
export type QueryViolationDto = z.infer<typeof queryViolationSchema>;
