import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';

// ======================
// ENUMS
// ======================

export const CalendarEventCategory = z.enum([
  'ACADEMIC', // Kegiatan akademik (ujian, ulangan)
  'HOLIDAY', // Libur nasional/sekolah
  'EXTRACURRICULAR', // Kegiatan ekstrakurikuler
  'MEETING', // Rapat (guru, orang tua)
  'CEREMONY', // Upacara (bendera, wisuda)
  'RELIGIOUS', // Kegiatan keagamaan (pesantren)
  'COMPETITION', // Lomba/kompetisi
  'FIELD_TRIP', // Karyawisata/field trip
  'REGISTRATION', // Pendaftaran (PPDB, dll)
  'EXAM', // Ujian (PTS, PAS, UN)
  'WORKSHOP', // Workshop/pelatihan
  'PARENT_MEETING', // Pertemuan wali murid
  'GRADUATION', // Wisuda/kelulusan
  'ORIENTATION', // Orientasi siswa baru
  'OTHER', // Lainnya
]);

export const RecurrenceType = z.enum([
  'NONE', // Tidak berulang
  'DAILY', // Harian
  'WEEKLY', // Mingguan
  'MONTHLY', // Bulanan
  'YEARLY', // Tahunan
]);

export const EventVisibility = z.enum([
  'PUBLIC', // Semua bisa melihat
  'INTERNAL', // Hanya internal sekolah
  'STAFF_ONLY', // Hanya guru/staff
  'CLASS_SPECIFIC', // Kelas tertentu
]);

// ======================
// QUERY SCHEMAS
// ======================

export const listEventsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  category: CalendarEventCategory.optional(),
  visibility: EventVisibility.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2020).max(2100).optional(),
  isAllDay: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// ======================
// CREATE/UPDATE SCHEMAS
// ======================

export const createEventSchema = z.object({
  unitId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: CalendarEventCategory,
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  isAllDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  visibility: EventVisibility.default('PUBLIC'),

  // Target audience
  targetClassIds: z.array(z.string().uuid()).optional(),
  targetRoles: z.array(z.string()).optional(),

  // Recurrence
  recurrenceType: RecurrenceType.default('NONE'),
  recurrenceEndDate: z.string().datetime().optional(),
  recurrenceCount: z.number().int().positive().optional(),

  // Additional fields
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  isImportant: z.boolean().default(false),
  reminderMinutes: z.number().int().positive().optional(),
  attachments: z.array(z.string().url()).optional(),
  externalLink: z.string().url().optional(),

  // Metadata
  metadata: z.record(z.string(), z.any()).optional(),
});

export const updateEventSchema = partialUpdateSchema(createEventSchema).omit({
  unitId: true,
  academicYearId: true,
});

export const bulkCreateEventsSchema = z.object({
  events: z.array(createEventSchema).min(1).max(100),
});

// ======================
// ACADEMIC CALENDAR IMPORT
// ======================

export const importAcademicCalendarSchema = z.object({
  unitId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  events: z.array(
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      category: CalendarEventCategory,
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      isAllDay: z.boolean().default(true),
      isImportant: z.boolean().default(false),
    })
  ),
});

// ======================
// RECURRING EVENT
// ======================

export const generateRecurringEventsSchema = z.object({
  eventId: z.string().uuid(),
  until: z.string().datetime(),
});

// ======================
// CALENDAR SYNC
// ======================

export const syncCalendarSchema = z.object({
  provider: z.enum(['GOOGLE', 'OUTLOOK', 'ICAL']),
  calendarId: z.string(),
  syncDirection: z.enum(['IMPORT', 'EXPORT', 'BOTH']),
});

// ======================
// REMINDERS
// ======================

export const setReminderSchema = z.object({
  eventId: z.string().uuid(),
  reminderMinutes: z.number().int().positive(),
  notificationMethod: z.enum(['EMAIL', 'PUSH', 'SMS']).default('PUSH'),
});

// ======================
// STATISTICS
// ======================

export const calendarStatisticsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

// ======================
// TYPE EXPORTS
// ======================

export type CalendarEventCategoryEnum = z.infer<typeof CalendarEventCategory>;
export type RecurrenceTypeEnum = z.infer<typeof RecurrenceType>;
export type EventVisibilityEnum = z.infer<typeof EventVisibility>;

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type BulkCreateEventsInput = z.infer<typeof bulkCreateEventsSchema>;
export type ImportAcademicCalendarInput = z.infer<typeof importAcademicCalendarSchema>;
export type GenerateRecurringEventsInput = z.infer<typeof generateRecurringEventsSchema>;
export type SetReminderInput = z.infer<typeof setReminderSchema>;
export type CalendarStatisticsQuery = z.infer<typeof calendarStatisticsQuerySchema>;

// The list query contract lives in @cipansor/shared so the web hook and this
// validator cannot drift. `ListEventsQuery` above is the legacy academic-
// calendar schema, unused by the live `/calendar` route.
export {
  calendarEventsQuerySchema,
  type CalendarEventsQuery,
  type CalendarEventListParams,
} from '@cipansor/shared';
