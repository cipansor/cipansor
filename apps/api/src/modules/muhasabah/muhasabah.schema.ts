import { z } from 'zod';

// =====================================
// MUHASABAH ENUMS (matching Prisma schema)
// =====================================

export const MuhasabahMoodEnum = z.enum(['EXCELLENT', 'GOOD', 'NEUTRAL', 'LOW', 'STRUGGLING']);

/**
 * A muhasabah day, "yyyy-MM-dd". The column is `@db.Date` and every reader
 * builds it with `dayOf()` on the WIB calendar, so a datetime here (or a bare
 * `z.string()`) would reach `new Date()` and shift the day.
 */
export const muhasabahDay = z.iso.date('Tanggal tidak valid (yyyy-MM-dd)');

// =====================================
// LIST/QUERY SCHEMAS
// =====================================

export const listMuhasabahQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  studentId: z.string().uuid().optional(),
  mood: MuhasabahMoodEnum.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// =====================================
// CREATE SCHEMAS
// =====================================

export const createMuhasabahSchema = z.object({
  studentId: z.string().uuid(),
  date: muhasabahDay,
  // Ibadah Wajib
  sholatSubuh: z.boolean().default(false),
  sholatDzuhur: z.boolean().default(false),
  sholatAshar: z.boolean().default(false),
  sholatMaghrib: z.boolean().default(false),
  sholatIsya: z.boolean().default(false),
  // Ibadah Sunnah
  sholatTahajud: z.boolean().default(false),
  sholatDhuha: z.boolean().default(false),
  sholatRawatib: z.number().min(0).default(0), // Jumlah rakaat
  puasaSunnah: z.boolean().default(false),
  // Tilawah & Dzikir
  tilawahPages: z.number().min(0).default(0),
  tilawahJuz: z.number().min(1).max(30).optional(),
  dzikirPagi: z.boolean().default(false),
  dzikirSore: z.boolean().default(false),
  istighfar: z.number().min(0).default(0),
  shalawat: z.number().min(0).default(0),
  // Hafalan
  murojaahJuz: z.number().min(1).max(30).optional(),
  murojaahPages: z.number().min(0).default(0),
  ziyadahAyat: z.number().min(0).default(0), // Ayat baru dihafal
  // Kebaikan
  sedekah: z.boolean().default(false),
  membantOrangTua: z.boolean().default(false),
  berbaikKeTeman: z.boolean().default(false),
  // Refleksi
  mood: MuhasabahMoodEnum.default('NEUTRAL'),
  gratitude: z.string().optional(), // Hal yang disyukuri
  improvement: z.string().optional(), // Hal yang perlu diperbaiki
  notes: z.string().optional(),
});

// =====================================
// UPDATE SCHEMAS
// =====================================

export const updateMuhasabahSchema = z.object({
  // Ibadah Wajib
  sholatSubuh: z.boolean().optional(),
  sholatDzuhur: z.boolean().optional(),
  sholatAshar: z.boolean().optional(),
  sholatMaghrib: z.boolean().optional(),
  sholatIsya: z.boolean().optional(),
  // Ibadah Sunnah
  sholatTahajud: z.boolean().optional(),
  sholatDhuha: z.boolean().optional(),
  sholatRawatib: z.number().min(0).optional(),
  puasaSunnah: z.boolean().optional(),
  // Tilawah & Dzikir
  tilawahPages: z.number().min(0).optional(),
  tilawahJuz: z.number().min(1).max(30).optional(),
  dzikirPagi: z.boolean().optional(),
  dzikirSore: z.boolean().optional(),
  istighfar: z.number().min(0).optional(),
  shalawat: z.number().min(0).optional(),
  // Hafalan
  murojaahJuz: z.number().min(1).max(30).optional(),
  murojaahPages: z.number().min(0).optional(),
  ziyadahAyat: z.number().min(0).optional(),
  // Kebaikan
  sedekah: z.boolean().optional(),
  membantOrangTua: z.boolean().optional(),
  berbaikKeTeman: z.boolean().optional(),
  // Refleksi
  mood: MuhasabahMoodEnum.optional(),
  gratitude: z.string().optional(),
  improvement: z.string().optional(),
  notes: z.string().optional(),
});

// =====================================
// STATS SCHEMAS
// =====================================

export const muhasabahStatsQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  days: z.coerce.number().min(1).max(365).default(30),
});

export const groupStatsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  halaqohId: z.string().uuid().optional(),
  days: z.coerce.number().min(1).max(365).default(7),
});

export const dailyReportQuerySchema = z.object({
  date: muhasabahDay.optional(),
  halaqohId: z.string().uuid().optional(),
});

/**
 * `POST /muhasabah/me` — the student's own entry. `date` is optional: omitted,
 * the server files it under today's WIB calendar day (`todayWib()`).
 */
export const createMineMuhasabahSchema = createMuhasabahSchema
  .omit({ studentId: true })
  .extend({ date: muhasabahDay.optional() });

// =====================================
// TYPE EXPORTS
// =====================================

export type ListMuhasabahQuery = z.infer<typeof listMuhasabahQuerySchema>;
export type CreateMuhasabahInput = z.infer<typeof createMuhasabahSchema>;
export type CreateMineMuhasabahInput = z.infer<typeof createMineMuhasabahSchema>;
export type UpdateMuhasabahInput = z.infer<typeof updateMuhasabahSchema>;
export type MuhasabahStatsQuery = z.infer<typeof muhasabahStatsQuerySchema>;
export type GroupStatsQuery = z.infer<typeof groupStatsQuerySchema>;
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;
