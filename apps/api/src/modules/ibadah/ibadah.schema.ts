import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';

// ======================
// ENUMS
// ======================

export const IbadahCategory = z.enum([
  'SHOLAT_WAJIB', // Sholat 5 waktu
  'SHOLAT_SUNNAH', // Tahajud, Dhuha, Rawatib
  'TILAWAH', // Membaca Al-Qur'an
  'DZIKIR', // Dzikir pagi/petang
  'PUASA', // Puasa sunnah
  'SEDEKAH', // Sedekah/infaq
  'SHOLAT_JAMAAH', // Sholat berjamaah di masjid
  'QIYAMULLAIL', // Sholat malam
  'OTHER', // Lainnya
]);

export const TargetType = z.enum([
  'DAILY', // Target harian
  'WEEKLY', // Target mingguan
  'MONTHLY', // Target bulanan
]);

export const TargetUnit = z.enum([
  'TIMES', // Berapa kali (sholat)
  'MINUTES', // Berapa menit (dzikir)
  'PAGES', // Berapa halaman (tilawah)
  'JUZ', // Berapa juz (tilawah)
  'AYAT', // Berapa ayat
  'AMOUNT', // Jumlah nominal (sedekah)
]);

export const PeriodType = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'SEMESTER', 'YEARLY']);

// ======================
// TARGET SCHEMAS
// ======================

export const listTargetsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  category: IbadahCategory.optional(),
  targetType: TargetType.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  isOptional: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const createTargetSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1).max(200),
  category: IbadahCategory,
  description: z.string().max(500).optional(),
  points: z.number().int().min(0).default(10),
  bonusPoints: z.number().int().min(0).default(0),
  targetType: TargetType,
  targetCount: z.number().int().min(1).default(1),
  targetUnit: TargetUnit.optional(),
  isOptional: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateTargetSchema = partialUpdateSchema(createTargetSchema).omit({ unitId: true });

// ======================
// RECORD SCHEMAS
// ======================

export const listRecordsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  targetId: z.string().uuid().optional(),
  category: IbadahCategory.optional(),
  date: z.string().optional(), // YYYY-MM-DD
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isCompleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  isVerified: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const createRecordSchema = z.object({
  targetId: z.string().uuid(),
  studentId: z.string().uuid(),
  date: z.coerce.date(),
  isCompleted: z.boolean().default(false),
  actualCount: z.number().int().min(0).optional(),
  actualMinutes: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const updateRecordSchema = partialUpdateSchema(createRecordSchema).omit({
  targetId: true,
  studentId: true,
  date: true,
});

export const bulkCreateRecordsSchema = z.object({
  studentId: z.string().uuid(),
  date: z.coerce.date(),
  records: z.array(
    z.object({
      targetId: z.string().uuid(),
      isCompleted: z.boolean().default(false),
      actualCount: z.number().int().min(0).optional(),
      actualMinutes: z.number().int().min(0).optional(),
      notes: z.string().max(500).optional(),
    })
  ),
});

export const verifyRecordSchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1),
});

// ======================
// DAILY CHECK-IN SCHEMA
// ======================

export const dailyCheckInSchema = z.object({
  studentId: z.string().uuid(),
  date: z.coerce.date(),
  sholatSubuh: z.enum(['JAMAAH', 'MUNFARID', 'MISSED']).optional(),
  sholatDzuhur: z.enum(['JAMAAH', 'MUNFARID', 'MISSED']).optional(),
  sholatAshar: z.enum(['JAMAAH', 'MUNFARID', 'MISSED']).optional(),
  sholatMaghrib: z.enum(['JAMAAH', 'MUNFARID', 'MISSED']).optional(),
  sholatIsya: z.enum(['JAMAAH', 'MUNFARID', 'MISSED']).optional(),
  sholatTahajud: z.boolean().default(false),
  sholatDhuha: z.boolean().default(false),
  sholatRawatib: z.number().int().min(0).max(12).default(0), // Jumlah rakaat
  tilawahPages: z.number().int().min(0).default(0),
  tilawahMinutes: z.number().int().min(0).default(0),
  dzikirPagi: z.boolean().default(false),
  dzikirPetang: z.boolean().default(false),
  puasaSunnah: z.boolean().default(false),
  sedekahAmount: z.number().min(0).default(0),
  notes: z.string().max(500).optional(),
});

// ======================
// LEADERBOARD SCHEMAS
// ======================

export const leaderboardQuerySchema = z.object({
  // Narrows within the reader's santri; without it, the ranking is over all of them.
  unitId: z.string().uuid().optional(),
  periodType: PeriodType,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  classId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// ======================
// STATISTICS SCHEMAS
// ======================

export const studentIbadahStatsQuerySchema = z.object({
  studentId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const unitIbadahStatsQuerySchema = z.object({
  unitId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  groupBy: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
});

export const classIbadahStatsQuerySchema = z.object({
  classId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

// ======================
// ISLAMIC EVENT SCHEMAS
// ======================

export const IslamicEventType = z.enum([
  'HARI_BESAR', // Idul Fitri, Idul Adha, Maulid, Isra Miraj, dll
  'PUASA_SUNNAH', // Senin-Kamis, Ayyamul Bidh, Asyura, dll
  'KAJIAN_RUTIN', // Kajian mingguan/bulanan
  'RAMADAN', // Kegiatan khusus Ramadan
  'DZULHIJJAH', // Kegiatan khusus Dzulhijjah
  'OTHER',
]);

export const listIslamicEventsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  type: IslamicEventType.optional(),
  hijriMonth: z.coerce.number().min(1).max(12).optional(),
  gregorianYear: z.coerce.number().optional(),
  isHoliday: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const createIslamicEventSchema = z.object({
  unitId: z.string().uuid().optional(), // null = semua unit
  name: z.string().min(1).max(200),
  nameArabic: z.string().max(200).optional(),
  type: IslamicEventType,
  hijriMonth: z.number().int().min(1).max(12),
  hijriDay: z.number().int().min(1).max(30),
  gregorianDate: z.coerce.date().optional(),
  gregorianYear: z.number().int().optional(),
  description: z.string().max(2000).optional(),
  activities: z.string().max(2000).optional(),
  isHoliday: z.boolean().default(false),
  isRecurring: z.boolean().default(true),
  scheduleAdjustment: z.record(z.string(), z.any()).optional(),
});

export const updateIslamicEventSchema = partialUpdateSchema(createIslamicEventSchema);

// ======================
// HIJRI DATE CONVERSION
// ======================

export const convertDateSchema = z
  .object({
    gregorianDate: z.coerce.date().optional(),
    hijriDate: z
      .object({
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(30),
      })
      .optional(),
  })
  .refine((data) => data.gregorianDate || data.hijriDate, {
    message: 'Either gregorianDate or hijriDate must be provided',
  });

// ======================
// TYPE EXPORTS
// ======================

export type IbadahCategoryEnum = z.infer<typeof IbadahCategory>;
export type TargetTypeEnum = z.infer<typeof TargetType>;
export type TargetUnitEnum = z.infer<typeof TargetUnit>;
export type PeriodTypeEnum = z.infer<typeof PeriodType>;
export type IslamicEventTypeEnum = z.infer<typeof IslamicEventType>;

export type ListTargetsQuery = z.infer<typeof listTargetsQuerySchema>;
export type CreateTargetInput = z.infer<typeof createTargetSchema>;
export type UpdateTargetInput = z.infer<typeof updateTargetSchema>;

export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
export type CreateRecordInput = z.infer<typeof createRecordSchema>;
export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;
export type BulkCreateRecordsInput = z.infer<typeof bulkCreateRecordsSchema>;
export type VerifyRecordInput = z.infer<typeof verifyRecordSchema>;
export type DailyCheckInInput = z.infer<typeof dailyCheckInSchema>;

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type StudentIbadahStatsQuery = z.infer<typeof studentIbadahStatsQuerySchema>;
export type UnitIbadahStatsQuery = z.infer<typeof unitIbadahStatsQuerySchema>;
export type ClassIbadahStatsQuery = z.infer<typeof classIbadahStatsQuerySchema>;

export type ListIslamicEventsQuery = z.infer<typeof listIslamicEventsQuerySchema>;
export type CreateIslamicEventInput = z.infer<typeof createIslamicEventSchema>;
export type UpdateIslamicEventInput = z.infer<typeof updateIslamicEventSchema>;
