import { z } from "zod";

/** POST /payroll/periods/:id/cancel — one contract for the API and the portal. */
export const cancelPayrollPeriodSchema = z
  .object({
    notes: z.string().optional(),
  })
  .default({});

export type CancelPayrollPeriodInput = z.infer<
  typeof cancelPayrollPeriodSchema
>;
