import { z } from 'zod';
import {
  LAUNDRY_PAYMENT_METHOD_VALUES,
  LAUNDRY_PAYMENT_STATUS_VALUES,
  createLaundryPricingSchema,
  createLaundryTransactionSchema,
  laundryItemInputSchema,
  listLaundryTransactionsQuerySchema,
  processLaundryPaymentSchema,
  updateLaundryPricingSchema,
  updateLaundryStatusSchema,
  type ListLaundryTransactionsQuery,
} from '@cipansor/shared';

// =============================================================================
// STATUS ENUMS
// =============================================================================

// The laundry statuses, the transition table, the query and every request body
// live once, in `@cipansor/shared` (#989, #1010): the API's validation and the
// Portal's form and status menu derive from the same definitions, so a status
// added to `LAUNDRY_STATUS_VALUES` can never be offered by the Portal while the
// API refuses it.

export const PAYMENT_STATUS = LAUNDRY_PAYMENT_STATUS_VALUES;
export const PAYMENT_METHOD = LAUNDRY_PAYMENT_METHOD_VALUES;

// =============================================================================
// PRICING SCHEMAS
// =============================================================================

export const CreatePricingSchema = createLaundryPricingSchema;

export const UpdatePricingSchema = updateLaundryPricingSchema;

// =============================================================================
// LAUNDRY ITEM SCHEMAS (Detail Pakaian)
// =============================================================================

export const LaundryItemInputSchema = laundryItemInputSchema;

// =============================================================================
// TRANSACTION SCHEMAS
// =============================================================================

export const CreateTransactionSchema = createLaundryTransactionSchema;

export const UpdateStatusSchema = updateLaundryStatusSchema;

export const ProcessPaymentSchema = processLaundryPaymentSchema;

/**
 * `GET /transactions`: the list's query is `@cipansor/shared`'s
 * (`listLaundryTransactionsQuerySchema`), so the Portal's search box and
 * status filter validate against the same contract the service reads (R22.4,
 * R22.11, R22.12).
 */
export const ListTransactionsQuerySchema = listLaundryTransactionsQuerySchema;

/**
 * `GET /transactions/stats`: the range is two WIB calendar days (`YYYY-MM-DD`).
 * The service bounds them with `wibDayStart`/`wibDayEnd`, which turn a full ISO
 * instant into `Invalid Date`, so anything else is a 400 here rather than a
 * Prisma error.
 */
export const TransactionStatsQuerySchema = z.object({
  startDate: z.iso.date('Tanggal mulai harus berformat YYYY-MM-DD').optional(),
  endDate: z.iso.date('Tanggal akhir harus berformat YYYY-MM-DD').optional(),
  unitId: z.string().optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];
export type CreatePricingInput = z.infer<typeof CreatePricingSchema>;
export type UpdatePricingInput = z.infer<typeof UpdatePricingSchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type UpdateStatusInput = z.infer<typeof UpdateStatusSchema>;
export type ProcessPaymentInput = z.infer<typeof ProcessPaymentSchema>;
export type ListTransactionsQuery = ListLaundryTransactionsQuery;
export type TransactionStatsQuery = z.infer<typeof TransactionStatsQuerySchema>;
