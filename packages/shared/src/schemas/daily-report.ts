import { z } from "zod";
import {
  ADMIN_ROLE_CODES,
  PARENT_ROLE_CODES,
  PESANTREN_EDUCATOR_ROLE_CODES,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
} from "../roles";

/**
 * Laporan harian — a pupil's day as the teacher records it for the family
 * (TK) and the Mutabaah Yaumiyah (SD and up). One contract for the API and
 * the web.
 *
 * Until 2026-09-26 the two sides disagreed on every write: the forms sent the
 * date as "yyyy-MM-dd" where the API wanted a datetime, and a unit and an
 * academic year read from a user object that carries neither, so no report
 * could be made from the TK form, the homeroom page or Mutabaah. The unit and
 * the year now come from the pupil and the date; the client sends neither.
 */

/**
 * Who keeps a pupil's daily report: the people who spend the day with them —
 * their teachers and the unit's kepala sekolah, the pesantren's educators for
 * boarders — and its admin unit for corrections. Each is held to the
 * pupils they may see (`studentScope` in the API).
 */
export const DAILY_REPORT_STAFF_ROLE_CODES: readonly string[] = [
  ...ADMIN_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PESANTREN_LEADER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
];

/**
 * Who reads daily reports: the staff above, and a wali — their own child's
 * only, which the API enforces per row. The yayasan organs are not here: a
 * daily report is a child's health, meals and moods, not a figure for the
 * board.
 */
export const DAILY_REPORT_READER_ROLE_CODES: readonly string[] = [
  ...DAILY_REPORT_STAFF_ROLE_CODES,
  ...PARENT_ROLE_CODES,
];

/** Only a wali acknowledges a report, and only their own child's. */
export const DAILY_REPORT_CONFIRMER_ROLE_CODES: readonly string[] =
  PARENT_ROLE_CODES;

/** `DailyMood` in Prisma; a contract test pins the two together. */
export const DAILY_MOOD_VALUES = [
  "HAPPY",
  "NEUTRAL",
  "SAD",
  "SICK",
  "TIRED",
  "EXCITED",
] as const;

/** `MealConsumption` in Prisma. */
export const MEAL_CONSUMPTION_VALUES = [
  "HABIS",
  "SETENGAH",
  "SEDIKIT",
  "TIDAK_MAU",
] as const;

/** At most this many photos on one report. */
export const DAILY_REPORT_MAX_PHOTOS = 5;

/**
 * A calendar day, "yyyy-MM-dd", as the teacher picked it. Not a datetime: a
 * report made at 06:30 WIB is dated that day, which `toISOString()` would
 * move to the day before.
 */
export const reportDay = z.iso.date("Tanggal tidak valid (yyyy-MM-dd)");

const optionalText = (max: number) => z.string().trim().max(max).nullish();

const mood = z.enum(DAILY_MOOD_VALUES).nullish();
const meal = z.enum(MEAL_CONSUMPTION_VALUES).nullish();

/**
 * A file this API stored through POST /upload (which answers with an absolute
 * URL ending in /uploads/<file>), never a link to somewhere else.
 */
const uploadedFileUrl = z
  .string()
  .regex(
    /^https?:\/\/[^/?#\s]+\/uploads\/[^/?#\s]+$/,
    "Foto harus diunggah lewat aplikasi",
  );

export const dailyReportPhotoSchema = z.object({
  url: uploadedFileUrl,
  caption: z.string().trim().max(200).optional(),
});

const homeworkSchema = z.object({
  subjectName: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  dueDate: reportDay.nullish(),
});

/**
 * What a teacher records about the day; every field is optional. Each one has
 * a column (`DailyStudentReport`); a field with nowhere to go is not offered,
 * because the API would accept it and keep nothing.
 */
const reportFields = {
  morningMood: mood,
  afternoonMood: mood,
  healthNotes: optionalText(500),
  temperature: z.number().min(30).max(45).nullish(),

  sholatDhuha: z.boolean().optional(),
  sholatDzuhur: z.boolean().optional(),
  sholatAshar: z.boolean().optional(),
  sholatJamaah: z.boolean().optional(),

  breakfastConsumption: meal,
  lunchConsumption: meal,
  snackConsumption: meal,

  napDurationMinutes: z.number().int().min(0).max(240).nullish(),
  toiletingNotes: optionalText(200),

  activitiesSummary: optionalText(1000),
  learningAchievements: optionalText(500),
  /** Tahfidz and ibadah that day. */
  surahPractice: optionalText(200),
  behaviorNotes: optionalText(500),

  parentNotes: optionalText(500),
  homeworkSuggestion: optionalText(500),

  homework: z.array(homeworkSchema).max(20).optional(),
  photos: z
    .array(dailyReportPhotoSchema)
    .max(DAILY_REPORT_MAX_PHOTOS, `Maksimal ${DAILY_REPORT_MAX_PHOTOS} foto`)
    .optional(),
};

/** A time of day, "HH:mm", in WIB. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam tidak valid (HH:mm)");

export const createDailyReportSchema = z.object({
  studentId: z.uuid("Santri wajib dipilih"),
  reportDate: reportDay,
  /** When the child arrived that day. */
  arrivalTime: timeOfDay.nullish(),
  ...reportFields,
});
export type CreateDailyReportInput = z.input<typeof createDailyReportSchema>;

/** A report's day and pupil are fixed; `homework` and `photos` replace the old lists. */
export const updateDailyReportSchema = z.object(reportFields);
export type UpdateDailyReportInput = z.input<typeof updateDailyReportSchema>;

export const confirmDailyReportSchema = z.object({
  parentFeedback: optionalText(500),
});
export type ConfirmDailyReportInput = z.input<typeof confirmDailyReportSchema>;

export const bulkCreateDailyReportsSchema = z.object({
  reportDate: reportDay,
  reports: z
    .array(
      z.object({
        studentId: z.uuid(),
        arrivalTime: timeOfDay.nullish(),
        morningMood: mood,
        afternoonMood: mood,
        healthNotes: optionalText(500),
        breakfastConsumption: meal,
        lunchConsumption: meal,
        napDurationMinutes: z.number().int().min(0).max(240).nullish(),
        activitiesSummary: optionalText(1000),
        learningAchievements: optionalText(500),
        surahPractice: optionalText(200),
        behaviorNotes: optionalText(500),
        parentNotes: optionalText(500),
        homeworkSuggestion: optionalText(500),
        sholatDhuha: z.boolean().optional(),
        sholatDzuhur: z.boolean().optional(),
        sholatAshar: z.boolean().optional(),
        sholatJamaah: z.boolean().optional(),
        readingProgress: z
          .object({ bookId: z.uuid(), page: z.number().int().min(1) })
          .optional(),
        tahfidzProgress: z
          .object({
            surahName: z.string().trim().min(1),
            surahNumber: z.number().int().min(1).max(114),
            ayahStart: z.number().int().min(1),
            ayahEnd: z.number().int().min(1),
          })
          .refine((data) => data.ayahEnd >= data.ayahStart, {
            message: "Ayat akhir tidak boleh sebelum ayat awal",
          })
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type BulkCreateDailyReportsInput = z.input<
  typeof bulkCreateDailyReportsSchema
>;

export const listDailyReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  classId: z.uuid().optional(),
  academicYearId: z.uuid().optional(),
  date: reportDay.optional(),
  dateFrom: reportDay.optional(),
  dateTo: reportDay.optional(),
  mood: z.enum(DAILY_MOOD_VALUES).optional(),
  /** "true" | "false" — read after Express's own query parsing. */
  isConfirmedByParent: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(100).optional(),
});
export type ListDailyReportsQuery = z.output<
  typeof listDailyReportsQuerySchema
>;

/** One pupil's month. The academic year follows from the month. */
export const studentDailySummaryQuerySchema = z.object({
  studentId: z.uuid(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});
export type StudentDailySummaryQuery = z.output<
  typeof studentDailySummaryQuerySchema
>;

/** A class (or a unit) on one day. */
export const classDailySummaryQuerySchema = z.object({
  unitId: z.uuid().optional(),
  classId: z.uuid().optional(),
  date: reportDay.optional(),
});
export type ClassDailySummaryQuery = z.output<
  typeof classDailySummaryQuerySchema
>;
