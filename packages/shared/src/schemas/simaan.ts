import { z } from "zod";

/**
 * The simaan contract, read by both the API and the web (#1024).
 *
 * The API's `SimaanTypeEnum` (`JUZ_AMMA`, `ONE_JUZ`, …) and the web's
 * `SIMAAN_TYPES` (`BIN_NAZHR`, …) disagreed on every value, so the three
 * simaan forms were answered 400 the moment they were saved. The canonical set
 * is the Prisma `SimaanType` enum as it stands (AGENTS.md rule 2 — Prisma is
 * the source of truth for DB enums); `simaan-contract.guard.test.ts` pins the
 * two lists to each other in both directions. Cakupan juz is *not* in the enum:
 * it is the `juzStart`–`juzEnd` range, shown with `simaanCoverageLabel`.
 */
export const SIMAAN_TYPE_VALUES = [
  "BIN_NAZHR",
  "BIL_GHAIB",
  "TAHDIR",
  "TASMI",
  "KHATAM",
] as const;
export type SimaanTypeCode = (typeof SIMAAN_TYPE_VALUES)[number];

export const SimaanTypeEnum = z.enum(SIMAAN_TYPE_VALUES);

/** Every label a person reads is Indonesian. */
export const SIMAAN_TYPE_LABELS: Record<SimaanTypeCode, string> = {
  BIN_NAZHR: "Bin Nazhr (Melihat Mushaf)",
  BIL_GHAIB: "Bil Ghaib (Hafalan)",
  TAHDIR: "Tahdir (Persiapan)",
  TASMI: "Tasmi (Setoran)",
  KHATAM: "Khatam 30 Juz",
};

/** `{ value, label }` pairs for a select, in one place. */
export const SIMAAN_TYPES = SIMAAN_TYPE_VALUES.map((value) => ({
  value,
  label: SIMAAN_TYPE_LABELS[value],
}));

export const SIMAAN_GRADE_VALUES = [
  "MUMTAZ",
  "JAYYID_JIDDAN",
  "JAYYID",
  "MAQBUL",
  "RASIB",
] as const;
export type SimaanGradeCode = (typeof SIMAAN_GRADE_VALUES)[number];

export const SimaanGradeEnum = z.enum(SIMAAN_GRADE_VALUES);

export const SIMAAN_GRADE_LABELS: Record<SimaanGradeCode, string> = {
  MUMTAZ: "Mumtaz (Istimewa)",
  JAYYID_JIDDAN: "Jayyid Jiddan (Sangat Baik)",
  JAYYID: "Jayyid (Baik)",
  MAQBUL: "Maqbul (Cukup)",
  RASIB: "Rasib (Kurang)",
};

/** A calendar day, "yyyy-MM-dd", as the date picker holds it. Not a datetime. */
export const simaanDay = z.iso.date("Tanggal ujian tidak valid (yyyy-MM-dd)");

/**
 * The coverage a person reads, from the juz range: "Juz 30" when it is one juz,
 * "30 Juz" for the whole Qur'an, "Juz 21–25" for a span.
 */
export function simaanCoverageLabel(juzStart: number, juzEnd: number): string {
  if (juzStart === juzEnd) return `Juz ${juzStart}`;
  if (juzStart === 1 && juzEnd === 30) return "30 Juz";
  return `Juz ${juzStart}–${juzEnd}`;
}

const juzNumber = z.number().int().min(1).max(30);
const score = z.number().min(0).max(100);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Maksimal ${max} karakter`).optional();

/**
 * The create contract. Every field is a column of `SimaanExam` (plus the
 * `examinerIds` that become its `SimaanExaminer` rows), and `.strict()` rejects
 * anything else, so a form that follows it cannot send a field Prisma will
 * reject — the three forms used to send `duration`, `examType`, `startSurah`,
 * `location` and a `status` the model does not have. `juzEnd >= juzStart` is
 * enforced on the range the user chose.
 */
export const createSimaanSchema = z
  .object({
    studentId: z.string().uuid("Santri tidak valid"),
    enrollmentId: z.string().uuid().optional(),
    halaqohId: z.string().uuid().optional(),
    simaanType: SimaanTypeEnum,
    examDate: simaanDay,
    sessionNumber: z.number().int().min(1).default(1),
    totalSessions: z.number().int().min(1).default(1),
    juzStart: juzNumber,
    juzEnd: juzNumber,
    overallScore: score.optional(),
    tajwidScore: score.optional(),
    fashohaScore: score.optional(),
    tartilScore: score.optional(),
    grade: SimaanGradeEnum.optional(),
    passed: z.boolean().default(false),
    notes: optionalText(2000),
    recommendations: optionalText(2000),
    examinerIds: z.array(z.string().uuid("Penguji tidak valid")).optional(),
  })
  .strict()
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: "Juz akhir harus lebih besar atau sama dengan juz awal",
    path: ["juzEnd"],
  });
export type CreateSimaanInput = z.input<typeof createSimaanSchema>;

/**
 * What may change after creation. Every field is optional — omitting one
 * leaves the column untouched (there are no defaults to overwrite it) — and
 * `.strict()` refuses a field the model does not have, so the edit form cannot
 * quietly resend `startSurah`/`location`/`status`. The nullable fields (the
 * scores, `grade`, `notes`, `recommendations`) may be sent as `null` to clear
 * a value that is already there; creation never sends `null`.
 */
export const updateSimaanSchema = z
  .object({
    simaanType: SimaanTypeEnum.optional(),
    examDate: simaanDay.optional(),
    sessionNumber: z.number().int().min(1).optional(),
    totalSessions: z.number().int().min(1).optional(),
    juzStart: juzNumber.optional(),
    juzEnd: juzNumber.optional(),
    overallScore: score.nullable().optional(),
    tajwidScore: score.nullable().optional(),
    fashohaScore: score.nullable().optional(),
    tartilScore: score.nullable().optional(),
    grade: SimaanGradeEnum.nullable().optional(),
    passed: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    recommendations: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.juzStart === undefined ||
      data.juzEnd === undefined ||
      data.juzEnd >= data.juzStart,
    {
      message: "Juz akhir harus lebih besar atau sama dengan juz awal",
      path: ["juzEnd"],
    },
  );
export type UpdateSimaanInput = z.infer<typeof updateSimaanSchema>;
