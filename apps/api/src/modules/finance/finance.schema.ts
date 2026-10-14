import { z } from 'zod';
import { PaymentStatus, PaymentMethod } from '@prisma/client';
import { partialUpdateSchema } from '@/lib/partial';

// =====================================
// PAYMENT TYPE SCHEMAS
// =====================================

export const createPaymentTypeSchema = z.object({
  unitId: z.string().uuid('Invalid unit ID'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  code: z.string().min(2, 'Code must be at least 2 characters'),
  description: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  isRecurring: z.boolean().default(false),
  isActive: z.boolean().default(true),
  accountId: z.string().uuid('Invalid account ID').optional(),
});

export const updatePaymentTypeSchema = partialUpdateSchema(createPaymentTypeSchema).omit({
  unitId: true,
});

export const queryPaymentTypeSchema = z.object({
  unitId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  isRecurring: z.coerce.boolean().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// =====================================
// INVOICE SCHEMAS
// =====================================

/**
 * A bill's deadline is a calendar day, not an instant: "due 10 August" means
 * the whole of that day in Tasikmalaya. `dueDate` is stored as that day's
 * date-only value (midnight UTC) and the monthly guard, the reminder window
 * and the academic-year bounds all compare it as a date — so the input is the
 * same day, not a timestamp the writer would silently truncate.
 */
const dueDateField = z.string().date('Invalid due date');

export const createInvoiceSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
  paymentTypeId: z.string().uuid('Invalid payment type ID'),
  amount: z.number().positive('Amount must be positive'),
  dueDate: dueDateField,
  period: z.string().optional(),
  notes: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
  amount: z.number().positive().optional(),
  dueDate: dueDateField.optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  notes: z.string().optional(),
});

export const queryInvoiceSchema = z.object({
  studentId: z.string().uuid().optional(),
  paymentTypeId: z.string().uuid().optional(),
  /** Payment types are per unit; a foundation user filters "SPP" across all of them by code. */
  paymentTypeCode: z.string().max(50).optional(),
  /** Bills due within the months of this academic year. */
  academicYearId: z.string().uuid().optional(),
  /** Invoice number, NIS or student name. */
  search: z.string().max(100).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const financialSummaryQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});

// =====================================
// PAYMENT SCHEMAS
// =====================================

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  amount: z.number().positive('Amount must be positive'),
  method: z.nativeEnum(PaymentMethod),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export const queryPaymentSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Type exports
export type CreatePaymentTypeDto = z.infer<typeof createPaymentTypeSchema>;
export type UpdatePaymentTypeDto = z.infer<typeof updatePaymentTypeSchema>;
export type QueryPaymentTypeDto = z.infer<typeof queryPaymentTypeSchema>;

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;
export type QueryInvoiceDto = z.infer<typeof queryInvoiceSchema>;

export const submitPaymentProofSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  method: z.nativeEnum(PaymentMethod),
  referenceNo: z.string().max(100).optional(),
  proofUrl: z.string().url('Invalid proof URL'),
  notes: z.string().max(500).optional(),
});
export type SubmitPaymentProofDto = z.infer<typeof submitPaymentProofSchema>;

export const verifyPaymentSchema = z.object({
  action: z.enum(['TU_APPROVE', 'FINAL_APPROVE', 'REJECT']),
  rejectionReason: z.string().max(500).optional(),
});
export type VerifyPaymentDto = z.infer<typeof verifyPaymentSchema>;

export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;
export type QueryPaymentDto = z.infer<typeof queryPaymentSchema>;

// =====================================
// ACCOUNTING SCHEMAS
// =====================================

export const createAccountSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  type: z.string().min(1, 'Type is required'),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  parentId: z.string().uuid().optional(),
  cashFlowCategory: z.string().optional(),
  netAssetCategory: z
    .enum(['UNRESTRICTED', 'TEMPORARILY_RESTRICTED', 'PERMANENTLY_RESTRICTED'])
    .optional(),
  ziswafFundType: z.enum(['ZAKAT', 'INFAK_SEDEKAH', 'WAKAF', 'AMIL', 'NON_HALAL']).optional(),
  isActive: z.boolean().default(true),
});

export const updateAccountSchema = partialUpdateSchema(createAccountSchema);

export const saveReportNoteSchema = z.object({
  unitId: z.string().uuid(),
  periodId: z.string().uuid().optional(),
  reportType: z.string().min(1),
  sectionKey: z.string().min(1),
  content: z.string(),
});

export const queryAccountSchema = z.object({
  search: z.string().optional(),
  type: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const createJournalSchema = z.object({
  unitId: z.string().uuid(),
  date: z.string().datetime(),
  description: z.string().min(1),
  entries: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debit: z.number().min(0),
        credit: z.number().min(0),
      })
    )
    .min(2),
});

export const queryJournalSchema = z.object({
  unitId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const queryReportSchema = z.object({
  unitId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type CreateAccountDto = z.infer<typeof createAccountSchema>;
export type UpdateAccountDto = z.infer<typeof updateAccountSchema>;
export type CreateJournalDto = z.infer<typeof createJournalSchema>;
