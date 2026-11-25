import { z } from "zod";

/**
 * The laundry status flow, read by both the API and the web (#989, R27.10,
 * R22.6).
 *
 * `LAUNDRY_STATUS_FLOW` is the one table of legal transitions: the API accepts a
 * status change exactly when the pair is in it, and the Portal offers only the
 * statuses it names. Before this the table lived inside the service's
 * `updateStatus`, so the Portal and the API could disagree about which move is
 * allowed.
 */
export const LAUNDRY_STATUS_VALUES = [
  "RECEIVED", // Diterima
  "WASHING", // Sedang dicuci
  "DRYING", // Sedang dikeringkan
  "IRONING", // Sedang disetrika
  "READY", // Siap diambil
  "DELIVERED", // Sudah diambil
  "CANCELLED", // Dibatalkan
] as const;
export type LaundryStatusCode = (typeof LAUNDRY_STATUS_VALUES)[number];

export const LaundryStatusEnum = z.enum(LAUNDRY_STATUS_VALUES);

/** Every legal transition, keyed by the transaction's current status. */
export const LAUNDRY_STATUS_FLOW: Record<
  LaundryStatusCode,
  readonly LaundryStatusCode[]
> = {
  RECEIVED: ["WASHING", "CANCELLED"],
  WASHING: ["DRYING", "CANCELLED"],
  DRYING: ["IRONING", "READY", "CANCELLED"],
  IRONING: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** Every status in Indonesian, the only text the Portal prints for one. */
export const LAUNDRY_STATUS_LABELS: Record<LaundryStatusCode, string> = {
  RECEIVED: "Diterima",
  WASHING: "Sedang Dicuci",
  DRYING: "Sedang Dikeringkan",
  IRONING: "Sedang Disetrika",
  READY: "Siap Diambil",
  DELIVERED: "Sudah Diambil",
  CANCELLED: "Dibatalkan",
};

/** `LaundryTransaction.paymentStatus` in Prisma; the contract test pins the two. */
export const LAUNDRY_PAYMENT_STATUS_VALUES = [
  "UNPAID",
  "PAID",
  "REFUNDED",
] as const;
export type LaundryPaymentStatusCode =
  (typeof LAUNDRY_PAYMENT_STATUS_VALUES)[number];
export const LaundryPaymentStatusEnum = z.enum(LAUNDRY_PAYMENT_STATUS_VALUES);

export const LAUNDRY_PAYMENT_STATUS_LABELS: Record<
  LaundryPaymentStatusCode,
  string
> = {
  UNPAID: "Belum Dibayar",
  PAID: "Lunas",
  REFUNDED: "Dikembalikan",
};

/** `LaundryTransaction.paymentMethod` in Prisma: who pays, and when. */
export const LAUNDRY_PAYMENT_METHOD_VALUES = [
  "WALLET",
  "CASH",
  "PENDING",
] as const;
export type LaundryPaymentMethodCode =
  (typeof LAUNDRY_PAYMENT_METHOD_VALUES)[number];
export const LaundryPaymentMethodEnum = z.enum(LAUNDRY_PAYMENT_METHOD_VALUES);

export const LAUNDRY_PAYMENT_METHOD_LABELS: Record<
  LaundryPaymentMethodCode,
  string
> = {
  WALLET: "Dompet Santri",
  CASH: "Tunai",
  PENDING: "Bayar Nanti",
};

/** The statuses a transaction in `from` may move to — the flow's own list. */
export function laundryNextStatuses(
  from: LaundryStatusCode,
): readonly LaundryStatusCode[] {
  return LAUNDRY_STATUS_FLOW[from] ?? [];
}

/**
 * What the Portal offers as the target status for a transaction in `from`, with
 * the Indonesian label it prints (R22.5, R22.6). Derived from the flow, never
 * retyped: the menu and the API's 409 agree by construction.
 */
export function laundryStatusOptions(
  from: LaundryStatusCode,
): Array<{ value: LaundryStatusCode; label: string }> {
  return laundryNextStatuses(from).map((value) => ({
    value,
    label: LAUNDRY_STATUS_LABELS[value],
  }));
}

/**
 * How many pieces a transaction carries: the sum of its `items[].quantity`,
 * and 0 when it lists none (R22.2). The API sends no total of its own, so the
 * one derivation lives here and both sides read it.
 */
export function laundryItemCount(
  items: readonly { quantity: number }[] | null | undefined,
): number {
  return (items ?? []).reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * `GET /laundry/transactions` — the list's query, validated at the edge and
 * read by the Portal's search box and status filter (R22.4, R22.11, R22.12).
 */
export const listLaundryTransactionsQuerySchema = z.object({
  studentId: z.uuid("Santri tidak valid").optional(),
  status: LaundryStatusEnum.optional(),
  paymentStatus: LaundryPaymentStatusEnum.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  /** Santri name, NIS or `transactionNo`, case-insensitively. */
  search: z
    .string()
    .trim()
    .min(1, "Pencarian minimal 1 karakter")
    .max(100)
    .optional(),
  page: z.coerce.number().int().min(1, "Halaman minimal 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100, "Maksimal 100 baris")
    .default(20),
});
export type ListLaundryTransactionsQuery = z.infer<
  typeof listLaundryTransactionsQuerySchema
>;

/** A laundry item as the API sends it (`LaundryItem`). */
export interface LaundryTransactionItemDTO {
  id: string;
  itemType: string;
  quantity: number;
  notes: string | null;
}

/**
 * A transaction as `GET /laundry/transactions` sends it. `Decimal` columns
 * arrive as strings — Prisma's `toJSON` — so the money fields are both.
 */
export interface LaundryTransactionDTO {
  id: string;
  transactionNo: string;
  unitId: string;
  businessUnitId: string | null;
  studentId: string;
  weight: string | number;
  pricePerKg: string | number;
  subtotal: string | number;
  discount: string | number;
  total: string | number;
  paymentMethod: LaundryPaymentMethodCode;
  paymentStatus: LaundryPaymentStatusCode;
  paidAt: string | null;
  status: LaundryStatusCode;
  receivedAt: string;
  estimatedAt: string;
  readyAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  student: { id: string; nis: string; user: { name: string } };
  pricing?: { id: string; name: string; isExpress?: boolean } | null;
  items?: LaundryTransactionItemDTO[];
  receivedBy?: { id: string; name: string } | null;
  deliveredBy?: { id: string; name: string } | null;
}

/** A price tier as the API sends it — per kilogram, the only rate it has. */
export interface LaundryPricingDTO {
  id: string;
  unitId: string;
  businessUnitId: string | null;
  name: string;
  description: string | null;
  pricePerKg: string | number;
  minWeight: string | number;
  processDays: number;
  isExpress: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `GET /laundry/transactions/stats` — the four summary cards read this. */
export interface LaundryTransactionStatsDTO {
  period: { startDate: string; endDate: string };
  summary: {
    totalRevenue: number;
    totalWeight: number;
    totalTransactions: number;
    pendingPayments: number;
    pendingPickup: number;
  };
  statusBreakdown: Array<{ status: LaundryStatusCode; count: number }>;
}

/** Whether a `from` → `to` move is one the flow allows. */
export function laundryTransitionAllowed(
  from: LaundryStatusCode,
  to: LaundryStatusCode,
): boolean {
  return laundryNextStatuses(from).includes(to);
}

/**
 * The price tier's fields. A tier is priced per kilogram — the only rate the
 * schema has — so a form collects `pricePerKg` and a minimum weight, never a
 * per-item price (R22.8).
 */
export const createLaundryPricingSchema = z.object({
  name: z.string().min(1, "Nama layanan wajib diisi"),
  description: z.string().optional(),
  pricePerKg: z.number().positive("Harga per kg harus lebih dari 0"),
  minWeight: z.number().positive("Berat minimal harus lebih dari 0").default(1),
  processDays: z
    .number()
    .int()
    .positive("Lama proses minimal 1 hari")
    .default(2),
  isExpress: z.boolean().default(false),
  isActive: z.boolean().default(true),
  businessUnitId: z.uuid("Unit usaha tidak valid").nullable().optional(),
});
export type CreateLaundryPricingInput = z.input<
  typeof createLaundryPricingSchema
>;

/**
 * A partial update. Written field by field rather than with `.partial()`: in
 * Zod 4 a partial of a schema with defaults still applies those defaults, so an
 * edit that changed only the name would silently reset `minWeight`,
 * `processDays`, `isExpress` and `isActive` (`apps/api/src/lib/partial.ts`).
 */
export const updateLaundryPricingSchema = z.object({
  name: z.string().min(1, "Nama layanan wajib diisi").optional(),
  description: z.string().optional(),
  pricePerKg: z.number().positive("Harga per kg harus lebih dari 0").optional(),
  minWeight: z.number().positive("Berat minimal harus lebih dari 0").optional(),
  processDays: z
    .number()
    .int()
    .positive("Lama proses minimal 1 hari")
    .optional(),
  isExpress: z.boolean().optional(),
  isActive: z.boolean().optional(),
  businessUnitId: z.uuid("Unit usaha tidak valid").nullable().optional(),
});
export type UpdateLaundryPricingInput = z.infer<
  typeof updateLaundryPricingSchema
>;

/** The pieces inside a transaction (`LaundryItem`): a kind and how many. */
export const laundryItemInputSchema = z.object({
  itemType: z.string().min(1, "Jenis pakaian wajib diisi"),
  quantity: z.number().int().positive("Jumlah minimal 1"),
  notes: z.string().optional(),
});
export type LaundryItemInput = z.infer<typeof laundryItemInputSchema>;

/**
 * A new transaction (R22.9): the santri, one price tier, the weight in
 * kilograms, and who pays. The API prices it from the tier — a client never
 * sends an amount.
 */
export const createLaundryTransactionSchema = z.object({
  studentId: z.uuid("Santri tidak valid"),
  pricingId: z.uuid("Tarif tidak valid"),
  weight: z.number().positive("Berat harus lebih dari 0"),
  paymentMethod: LaundryPaymentMethodEnum,
  discount: z.number().min(0).default(0),
  notes: z.string().optional(),
  items: z.array(laundryItemInputSchema).optional(),
});
export type CreateLaundryTransactionInput = z.input<
  typeof createLaundryTransactionSchema
>;

/** A status change: the target must be one the flow names (R22.6). */
export const updateLaundryStatusSchema = z.object({
  status: LaundryStatusEnum,
  notes: z.string().optional(),
});
export type UpdateLaundryStatusInput = z.infer<
  typeof updateLaundryStatusSchema
>;

/** Taking a later payment — the two methods the counter can settle. */
export const processLaundryPaymentSchema = z.object({
  paymentMethod: z.enum(["WALLET", "CASH"]),
});
export type ProcessLaundryPaymentInput = z.infer<
  typeof processLaundryPaymentSchema
>;
