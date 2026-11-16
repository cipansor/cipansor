import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';
import { bulkCreateMenusSchema, createMenuSchema, updateMenuSchema } from '@cipansor/shared';

// The menu create/update contracts are in @cipansor/shared (#1081), which the
// web form reads too; only the query, schedule and attendance schemas live
// here. The old local menu schemas described `mealScheduleId`, `menuItems`,
// `sideDishes`, `beverage`, `nutritionalInfo`, `isVegetarian` and `allergens`
// — none of which is a column of `MealMenu` — and were never wired to a route,
// so the Edit form's payload reached Prisma unchecked and answered 500.
export { bulkCreateMenusSchema, createMenuSchema, updateMenuSchema };
export type { BulkCreateMenusInput, CreateMenuInput, UpdateMenuInput } from '@cipansor/shared';

// ======================
// ENUMS
// ======================

export const MealType = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);

export const AttendanceStatus = z.enum(['PRESENT', 'ABSENT', 'EXCUSED']);

// ======================
// MEAL SCHEDULE SCHEMAS
// ======================

export const listMealSchedulesQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  type: MealType.optional(),
  dayOfWeek: z.coerce.number().min(0).max(6).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const createMealScheduleSchema = z.object({
  unitId: z.string().uuid(),
  type: MealType,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  dayOfWeek: z.number().min(0).max(6), // 0 = Sunday, 6 = Saturday
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'),
  location: z.string().max(200).optional(),
  capacity: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});

export const updateMealScheduleSchema = partialUpdateSchema(createMealScheduleSchema).omit({
  unitId: true,
});

// ======================
// MENU SCHEMAS
// ======================

export const listMenusQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  date: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// ======================
// ATTENDANCE SCHEMAS
// ======================

export const listAttendanceQuerySchema = z.object({
  mealMenuId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  date: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  status: AttendanceStatus.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const recordAttendanceSchema = z.object({
  mealMenuId: z.string().uuid(),
  studentId: z.string().uuid(),
  status: AttendanceStatus.default('PRESENT'),
  portion: z.number().positive().default(1),
  notes: z.string().max(500).optional(),
});

export const bulkRecordAttendanceSchema = z.object({
  mealMenuId: z.string().uuid(),
  attendances: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: AttendanceStatus.default('PRESENT'),
        portion: z.number().positive().default(1),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1),
});

export const updateAttendanceSchema = z.object({
  status: AttendanceStatus.optional(),
  portion: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
});

// ======================
// STUDENT HISTORY
// ======================

export const studentMealHistorySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  type: MealType.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// ======================
// STATISTICS
// ======================

export const mealStatisticsQuerySchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  unitId: z.string().uuid().optional(),
  type: MealType.optional(),
});

// ======================
// TYPE EXPORTS
// ======================

export type MealTypeEnum = z.infer<typeof MealType>;
export type AttendanceStatusEnum = z.infer<typeof AttendanceStatus>;

export type ListMealSchedulesQuery = z.infer<typeof listMealSchedulesQuerySchema>;
export type CreateMealScheduleInput = z.infer<typeof createMealScheduleSchema>;
export type UpdateMealScheduleInput = z.infer<typeof updateMealScheduleSchema>;

export type ListMenusQuery = z.infer<typeof listMenusQuerySchema>;

export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
export type BulkRecordAttendanceInput = z.infer<typeof bulkRecordAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;

export type StudentMealHistoryQuery = z.infer<typeof studentMealHistorySchema>;
export type MealStatisticsQuery = z.infer<typeof mealStatisticsQuerySchema>;
