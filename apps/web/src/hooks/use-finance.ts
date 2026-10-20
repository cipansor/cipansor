import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// Bill types (tagihan)

/** Prisma Decimal columns (amount, paidAmount) arrive as strings. */
export type Money = number | string;

/**
 * A santri bill exactly as GET /finance/invoices and /finance/invoices/:id
 * return it (Prisma `Invoice`).
 *
 * This type used to describe a bill the API never sent (`billType`,
 * `student.name`, `academicYear`, `description`), so the list's "Jenis"
 * column was blank and the santri column showed only the NIS. The kind of
 * bill is its `paymentType`, a per-unit row, not a fixed enum.
 */
export interface Bill {
  id: string;
  invoiceNumber: string;
  studentId: string;
  student?: {
    id: string;
    nis: string;
    unitId: string;
    user?: { id: string; name: string };
    unit?: { id: string; name: string };
  };
  paymentTypeId: string;
  paymentType?: { id: string; name: string; code: string };
  amount: Money;
  paidAmount: Money;
  dueDate: string;
  status: BillStatus;
  /** e.g. "September 2026", or "Tahun Ajaran 2026/2027" for a yearly fee. */
  period?: string | null;
  notes?: string | null;
  /** Only on GET /finance/invoices/:id. */
  payments?: Payment[];
  createdAt: string;
  updatedAt: string;
}

export type BillStatus =
  "PENDING" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";

export const BILL_STATUSES: {
  value: BillStatus;
  label: string;
  color: string;
}[] = [
  {
    value: "PENDING",
    label: "Menunggu",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "PARTIAL",
    label: "Dibayar Sebagian",
    color: "bg-blue-100 text-blue-800",
  },
  { value: "PAID", label: "Lunas", color: "bg-green-100 text-green-800" },
  { value: "OVERDUE", label: "Jatuh Tempo", color: "bg-red-100 text-red-800" },
  {
    value: "CANCELLED",
    label: "Dibatalkan",
    color: "bg-gray-100 text-gray-800",
  },
];

// Payment types (pembayaran)

/**
 * A payment as GET /finance/payments and /finance/payments/:id return it
 * (Prisma `Payment`). Like `Bill`, this used to describe fields the API never
 * sent (`billId`, `bill`, `paymentMethod`, `paymentDate`, `receiptNumber`).
 */
export interface Payment {
  id: string;
  invoiceId: string;
  invoice?: Bill & {
    student?: Bill["student"] & {
      /** Only on GET /finance/payments/:id: the active class, for the receipt. */
      enrollments?: { class: { id: string; name: string } }[];
    };
  };
  amount: Money;
  method: PaymentMethod;
  referenceNo?: string | null;
  proofUrl?: string | null;
  paidAt: string;
  notes?: string | null;
  verificationStatus: PaymentVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

/** Only FINAL_APPROVED payments count toward a bill; the others are proofs in review. */
export type PaymentVerificationStatus =
  "PENDING_VERIFICATION" | "TU_APPROVED" | "FINAL_APPROVED" | "REJECTED";

export const VERIFICATION_LABELS: Record<PaymentVerificationStatus, string> = {
  PENDING_VERIFICATION: "Menunggu verifikasi TU",
  TU_APPROVED: "Menunggu persetujuan akhir",
  FINAL_APPROVED: "Sah",
  REJECTED: "Ditolak",
};

/** Prisma `PaymentMethod`. */
export type PaymentMethod =
  "CASH" | "BANK_TRANSFER" | "VIRTUAL_ACCOUNT" | "EWALLET" | "OTHER";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Tunai" },
  { value: "BANK_TRANSFER", label: "Transfer Bank" },
  { value: "VIRTUAL_ACCOUNT", label: "Virtual Account" },
  { value: "EWALLET", label: "Dompet Digital / QRIS" },
  { value: "OTHER", label: "Lainnya" },
];

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/**
 * The kinds of bill, for a filter: active payment types, one per code.
 * Payment types are rows per unit, so "SPP" exists once in each unit; the
 * list filters by code so one choice covers them all.
 */
export function usePaymentTypeOptions() {
  return useQuery({
    queryKey: ["payment-types", "options"],
    queryFn: async () => {
      const response = await api.get<
        PaginatedResponse<{ id: string; code: string; name: string }>
      >("/finance/payment-types", { params: { isActive: true, limit: 100 } });
      const byCode = new Map<string, string>();
      for (const t of response.data.data) {
        if (!byCode.has(t.code)) byCode.set(t.code, t.name);
      }
      return Array.from(byCode, ([code, name]) => ({ code, name })).sort(
        (a, b) => a.name.localeCompare(b.name, "id"),
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}

// Bill hooks
export interface BillParams {
  page?: number;
  limit?: number;
  studentId?: string;
  /** Bills due within this academic year's months. */
  academicYearId?: string;
  /** Payment types are per unit; filter by code to match "SPP" in every unit. */
  paymentTypeCode?: string;
  /** Invoice number, NIS or santri name. */
  search?: string;
  status?: BillStatus;
}

export function useBills(params: BillParams = {}) {
  return useQuery({
    queryKey: ["bills", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Bill>>(
        "/finance/invoices",
        {
          params,
        },
      );
      return response.data;
    },
  });
}

export function useBill(id: string) {
  return useQuery({
    queryKey: ["bills", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Bill>>(
        `/finance/invoices/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useStudentBills(studentId: string) {
  return useQuery({
    queryKey: ["students", studentId, "bills"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Bill[]>>(
        `/students/${studentId}/bills`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

export interface CreateBillData {
  studentId: string;
  /** The concrete PaymentType row — a bill's kind is a per-unit row, not an enum. */
  paymentTypeId: string;
  amount: number;
  /** A calendar day, "YYYY-MM-DD"; the API stores it as that day's midnight UTC. */
  dueDate: string;
  /** e.g. "September 2026". */
  period?: string;
  notes?: string;
}

/**
 * The payment types a bill can be made for, with their ids. `usePaymentTypeOptions`
 * above dedupes by code for the list's filter; a create form needs the real row,
 * because `createInvoice` connects the bill to a `paymentTypeId`.
 */
export function useBillPaymentTypes() {
  return useQuery({
    queryKey: ["payment-types", "choices"],
    queryFn: async () => {
      const response = await api.get<
        PaginatedResponse<{
          id: string;
          code: string;
          name: string;
          unitId: string;
        }>
      >("/finance/payment-types", { params: { isActive: true, limit: 100 } });
      return [...response.data.data].sort((a, b) =>
        a.name.localeCompare(b.name, "id"),
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateBillData) => {
      const response = await api.post<ApiResponse<Bill>>(
        "/finance/invoices",
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      queryClient.invalidateQueries({
        queryKey: ["students", variables.studentId, "bills"],
      });
    },
  });
}

export interface CreateBulkBillsData {
  studentIds: string[];
  paymentTypeId: string;
  amount: number;
  dueDate: string;
  period?: string;
  notes?: string;
}

/**
 * The same bill for many santri. The API answers `{ created, invoices }`; the
 * SPP matrix is a different route (`POST /finance/spp-matrix/generate`), which
 * bills a whole unit or class for one month and skips what already exists.
 */
export function useCreateBulkBills() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateBulkBillsData) => {
      const response = await api.post<
        ApiResponse<{ created: number; invoices: Bill[] }>
      >("/finance/invoices/bulk", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}

export function useUpdateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateBillData>;
    }) => {
      const response = await api.patch<ApiResponse<Bill>>(
        `/finance/invoices/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      queryClient.invalidateQueries({ queryKey: ["bills", variables.id] });
    },
  });
}

export function useDeleteBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/finance/invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}

// Payment hooks
export interface PaymentParams {
  page?: number;
  limit?: number;
  invoiceId?: string;
  method?: PaymentMethod;
  startDate?: string;
  endDate?: string;
}

export function usePayments(params: PaymentParams = {}) {
  return useQuery({
    queryKey: ["payments", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Payment>>(
        "/finance/payments",
        {
          params,
        },
      );
      return response.data;
    },
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: ["payments", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Payment>>(
        `/finance/payments/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreatePaymentData {
  billId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: string;
  notes?: string;
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePaymentData) => {
      const response = await api.post<ApiResponse<Payment>>(
        "/finance/payments",
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({
        queryKey: ["bills", variables.billId, "payments"],
      });
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}

export function useDeletePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/finance/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}

// Financial summary/reports
export interface FinancialSummary {
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  totalOverdue: number;
  billsByType: {
    /** The payment type's name. */
    type: string;
    total: number;
    paid: number;
    outstanding: number;
  }[];
  recentPayments: Payment[];
}

export function useFinancialSummary(academicYearId?: string) {
  return useQuery({
    queryKey: ["financial-summary", academicYearId],
    queryFn: async () => {
      const params = academicYearId ? { academicYearId } : {};
      const response = await api.get<ApiResponse<FinancialSummary>>(
        "/finance/summary",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useStudentFinancialSummary(studentId: string) {
  return useQuery({
    queryKey: ["students", studentId, "financial-summary"],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          totalBilled: number;
          totalPaid: number;
          totalOutstanding: number;
          bills: Bill[];
        }>
      >(`/students/${studentId}/financial-summary`);
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

// =====================================
// SPP MATRIX HOOKS
// =====================================

export interface SppMatrixMonth {
  invoiceId?: string;
  status: "PAID" | "PARTIAL" | "PENDING" | "OVERDUE" | "NOT_BILLED";
  amount: number;
  paidAmount: number;
  dueDate?: string;
}

export interface StudentSppRow {
  studentId: string;
  studentName: string;
  nis: string;
  className: string;
  months: {
    [month: string]: SppMatrixMonth;
  };
  totalAmount: number;
  totalPaid: number;
}

export interface SppMatrixSummary {
  totalStudents: number;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  paidCount: number;
  partialCount: number;
  pendingCount: number;
  overdueCount: number;
}

export interface SppMatrixData {
  students: StudentSppRow[];
  sppRate: number;
  paymentTypeId: string;
  year: number;
  months: string[];
  summary: SppMatrixSummary;
}

export interface SppMatrixParams {
  unitId?: string;
  classId?: string;
  year?: number;
  paymentTypeId?: string;
}

export function useSppMatrix(params: SppMatrixParams = {}) {
  return useQuery({
    queryKey: ["spp-matrix", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SppMatrixData>>(
        "/finance/spp-matrix",
        { params },
      );
      return response.data.data;
    },
  });
}

export interface GenerateSppInvoicesData {
  unitId?: string;
  classId?: string;
  paymentTypeId: string;
  year: number;
  month: number;
  dueDay?: number;
}

export function useGenerateSppInvoices() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: GenerateSppInvoicesData) => {
      const response = await api.post<
        ApiResponse<{
          created: number;
          skipped: number;
          total: number;
        }>
      >("/finance/spp-matrix/generate", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spp-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}
