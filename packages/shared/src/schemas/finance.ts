import { z } from "zod";

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
      /^\s*\d+([.,]\d+)?/.test(data.targetValue),
    {
      // `10 juz` and `85%` are fine: the unit follows the number the scorer
      // reads. `sepuluh` is not, and the scorer would silently use its default.
      message: "Target numerik harus diawali angka, misalnya 30 atau 85%",
      path: ["targetValue"],
    },
  );

export type CreateScholarshipCriterionInput = z.infer<
  typeof createScholarshipCriterionSchema
>;
