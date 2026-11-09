import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';

// =============================================================================
// STATUS ENUMS
// =============================================================================

export const LAUNDRY_STATUS = [
  'RECEIVED', // Diterima
  'WASHING', // Sedang dicuci
  'DRYING', // Sedang dikeringkan
  'IRONING', // Sedang disetrika
  'READY', // Siap diambil
  'DELIVERED', // Sudah diambil
  'CANCELLED', // Dibatalkan
] as const;

export const PAYMENT_STATUS = ['UNPAID', 'PAID', 'REFUNDED'] as const;
export const PAYMENT_METHOD = ['WALLET', 'CASH', 'PENDING'] as const;

// =============================================================================
// PRICING SCHEMAS
// =============================================================================

export const CreatePricingSchema = z.object({
  name: z.string().min(1, 'Nama layanan wajib diisi'),
  description: z.string().optional(),
  pricePerKg: z.number().positive('Harga per kg harus lebih dari 0'),
  minWeight: z.number().positive().default(1),
  processDays: z.number().int().positive().default(2),
  isExpress: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const UpdatePricingSchema = partialUpdateSchema(CreatePricingSchema);

// =============================================================================
// LAUNDRY ITEM SCHEMAS (Detail Pakaian)
// =============================================================================

export const LaundryItemInputSchema = z.object({
  itemType: z.string().min(1, 'Jenis pakaian wajib diisi'),
  quantity: z.number().int().positive('Jumlah minimal 1'),
  notes: z.string().optional(),
});

// =============================================================================
// TRANSACTION SCHEMAS
// =============================================================================

export const CreateTransactionSchema = z.object({
  studentId: z.string().uuid('Student ID tidak valid'),
  pricingId: z.string().uuid('Pricing ID tidak valid'),
  weight: z.number().positive('Berat harus lebih dari 0'),
  paymentMethod: z.enum(['WALLET', 'CASH', 'PENDING']),
  discount: z.number().min(0).default(0),
  notes: z.string().optional(),
  businessUnitId: z.string().uuid().optional(),
  items: z.array(LaundryItemInputSchema).optional(),
});

export const UpdateStatusSchema = z.object({
  status: z.enum(LAUNDRY_STATUS),
  notes: z.string().optional(),
});

export const ProcessPaymentSchema = z.object({
  paymentMethod: z.enum(['WALLET', 'CASH']),
});

export const ListTransactionsQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  status: z.enum(LAUNDRY_STATUS).optional(),
  paymentStatus: z.enum(PAYMENT_STATUS).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
});

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

export type LaundryStatus = (typeof LAUNDRY_STATUS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];
export type CreatePricingInput = z.infer<typeof CreatePricingSchema>;
export type UpdatePricingInput = z.infer<typeof UpdatePricingSchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type UpdateStatusInput = z.infer<typeof UpdateStatusSchema>;
export type ProcessPaymentInput = z.infer<typeof ProcessPaymentSchema>;
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
export type TransactionStatsQuery = z.infer<typeof TransactionStatsQuerySchema>;
