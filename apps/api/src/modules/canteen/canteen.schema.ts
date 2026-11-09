import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';

// =============================================================================
// CATEGORY SCHEMAS
// =============================================================================

export const CreateCategorySchema = z.object({
  name: z.string().min(1, 'Nama kategori wajib diisi'),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  businessUnitId: z.string().uuid().optional().nullable(),
});

export const UpdateCategorySchema = partialUpdateSchema(CreateCategorySchema);

// =============================================================================
// ITEM SCHEMAS
// =============================================================================

export const CreateItemSchema = z.object({
  categoryId: z.string().uuid('Category ID tidak valid'),
  businessUnitId: z.string().uuid().optional().nullable(),
  code: z.string().optional(),
  name: z.string().min(1, 'Nama item wajib diisi'),
  description: z.string().optional(),
  price: z.number().positive('Harga harus lebih dari 0'),
  costPrice: z.number().positive().optional(),
  stock: z.number().int().min(0).default(0),
  minStock: z.number().int().min(0).default(5),
  unit: z.string().default('pcs'),
  imageUrl: z.string().url().optional().nullable(),
  isAvailable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const UpdateItemSchema = partialUpdateSchema(CreateItemSchema);

export const ListItemsQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  search: z.string().optional(),
  isAvailable: z.enum(['true', 'false']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
});

// =============================================================================
// TRANSACTION SCHEMAS
// =============================================================================

export const TransactionItemSchema = z.object({
  itemId: z.string().uuid('Item ID tidak valid'),
  quantity: z.number().int().positive('Jumlah harus lebih dari 0'),
  notes: z.string().optional(),
});

export const CreateTransactionSchema = z.object({
  studentId: z.string().uuid().optional().nullable(), // Optional untuk non-santri
  customerName: z.string().optional().nullable(),
  businessUnitId: z.string().uuid().optional().nullable(), // Optional Business Unit association
  items: z.array(TransactionItemSchema).min(1, 'Minimal 1 item'),
  discount: z.number().min(0).default(0),
  paymentMethod: z.enum(['WALLET', 'CASH']),
  notes: z.string().optional(),
});

// Only CANCELLED and REFUNDED are valid target statuses for updateStatus —
// PENDING and COMPLETED cannot be transitioned to (see VALID_TRANSITIONS in
// transactionService.updateStatus). Restricting the schema surfaces invalid
// values as a clean Zod validation error instead of a runtime transition error.
export const UpdateTransactionStatusSchema = z.object({
  status: z.enum(['CANCELLED', 'REFUNDED']),
  notes: z.string().optional(),
  // Required when cancelling a COMPLETED transaction, since it triggers
  // financial side-effects (wallet refund, stock restore, journal reversal).
  // Prevents accidental cancellation of settled transactions.
  confirmReversal: z.boolean().optional(),
});

export const ListTransactionsQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED']).optional(),
  paymentMethod: z.enum(['WALLET', 'CASH']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
});

/**
 * `GET /transactions/stats`: the range is two WIB calendar days
 * (`YYYY-MM-DD`). The service bounds them with `wibDayStart`/`wibDayEnd`, which
 * turn a full ISO instant into `Invalid Date`, so anything else is a 400 here
 * rather than a Prisma error.
 */
export const TransactionStatsQuerySchema = z.object({
  startDate: z.iso.date('Tanggal mulai harus berformat YYYY-MM-DD').optional(),
  endDate: z.iso.date('Tanggal akhir harus berformat YYYY-MM-DD').optional(),
  unitId: z.string().optional(),
});

// =============================================================================
// STOCK MOVEMENT SCHEMAS
// =============================================================================

export const CreateStockMovementSchema = z.object({
  itemId: z.string().uuid('Item ID tidak valid'),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'EXPIRED']),
  quantity: z.number().int().min(1, 'Jumlah minimal 1'),
  notes: z.string().optional(),
});

export const ListStockMovementsQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'EXPIRED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('20'),
});

export const ListCategoriesQuerySchema = z.object({
  businessUnitId: z.string().uuid().optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type UpdateTransactionStatusInput = z.infer<typeof UpdateTransactionStatusSchema>;
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
export type TransactionStatsQuery = z.infer<typeof TransactionStatsQuerySchema>;
export type CreateStockMovementInput = z.infer<typeof CreateStockMovementSchema>;
export type ListStockMovementsQuery = z.infer<typeof ListStockMovementsQuerySchema>;
