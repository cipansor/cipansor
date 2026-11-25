import { z } from "zod";

/** The number a criterion target carries, and whether it is a percentage. */
export interface ScholarshipTarget {
  value: number;
  percent: boolean;
}

/**
 * The leading number of a target such as `10 juz`, `85%`, `7.5` or `85,5%`.
 * Both separators are accepted because the form is free text; the unit after
 * the number is a note for the reader, not part of the value. Returns null when
 * the text does not start with a positive, finite number, so the route can
 * refuse it instead of the scorer silently using a default.
 */
export function parseScholarshipTarget(
  text: string | null | undefined,
): ScholarshipTarget | null {
  if (!text) return null;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(%?)/.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, percent: match[2] === "%" };
}

/**
 * Writing a scholarship criterion (#1003). The API validates the body with this
 * schema and the web sends the same type, so the form and the route cannot
 * drift apart.
 */
export const createScholarshipCriterionSchema = z
  .object({
    name: z.string().min(2).max(100),
    description: z.string().optional(),
    weight: z.number().positive(),
    type: z.enum(["NUMERIC", "BOOLEAN", "ENUM"]),
    targetValue: z.string().optional(),
  })
  .refine(
    (data) =>
      data.type !== "NUMERIC" ||
      !data.targetValue ||
      parseScholarshipTarget(data.targetValue) !== null,
    {
      // `10 juz`, `85%` and `85,5%` are fine: the unit follows the number the
      // scorer reads. `sepuluh` and `0` are not, and the scorer would silently
      // use its default or divide by zero.
      message:
        "Target numerik harus berupa angka positif, misalnya 30, 85,5% atau 10 juz",
      path: ["targetValue"],
    },
  );

export type CreateScholarshipCriterionInput = z.infer<
  typeof createScholarshipCriterionSchema
>;
