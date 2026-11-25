/**
 * Payroll Hook
 * React Query hooks for payroll management (salary components, employee salaries, periods, slips)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CancelPayrollPeriodInput } from "@cipansor/shared";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// ============================================
// Types
// ============================================

export type SalaryComponentType = "ALLOWANCE" | "DEDUCTION";

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  type: SalaryComponentType;
  description?: string;
  defaultAmount?: number;
  isPercentage: boolean;
  percentageBase?: string;
  isTaxable: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeSalary {
  id: string;
  staffId: string;
  staff?: {
    id: string;
    name: string;
    nip?: string;
    position?: string;
    unit?: {
      id: string;
      name: string;
    };
  };
  basicSalary: number;
  taxStatus: string;
  hasNpwp: boolean;
  npwpNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  components: EmployeeSalaryComponent[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeSalaryComponent {
  id: string;
  componentId: string;
  component?: SalaryComponent;
  amount: number;
  isActive: boolean;
}

export type PayrollStatus =
  "DRAFT" | "CALCULATED" | "APPROVED" | "PAID" | "CANCELLED";

export const PAYROLL_STATUS_MAP: Record<
  PayrollStatus,
  { label: string; color: string }
> = {
  DRAFT: { label: "Draft", color: "bg-gray-100 text-gray-800" },
  CALCULATED: { label: "Dihitung", color: "bg-blue-100 text-blue-800" },
  APPROVED: { label: "Disetujui", color: "bg-green-100 text-green-800" },
  PAID: { label: "Dibayar", color: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Dibatalkan", color: "bg-red-100 text-red-800" },
};

export interface PayrollPeriod {
  id: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  name: string;
  month: number;
  year: number;
  startDate: string;
  endDate: string;
  status: PayrollStatus;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalTax: number;
  totalEmployees: number;
  createdById?: string;
  approvedById?: string | null;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollSlip {
  id: string;
  periodId: string;
  period?: PayrollPeriod;
  staffId: string;
  staff?: {
    id: string;
    name: string;
    nip?: string;
    position?: string;
  };
  basicSalary: number;
  grossSalary: number;
  totalDeductions: number;
  taxAmount: number;
  netSalary: number;
  taxStatus: string;
  hasNpwp: boolean;
  items: PayrollItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PayrollItem {
  id: string;
  payrollId: string;
  componentId: string;
  component?: SalaryComponent;
  componentName: string;
  componentType: SalaryComponentType;
  amount: number;
  isAdjusted: boolean;
  adjustedBy?: string;
  adjustedAt?: string;
  adjustmentNotes?: string;
}

export interface PayrollSummary {
  totalEmployees: number;
  totalGross: number;
  totalDeductions: number;
  totalTax: number;
  totalNet: number;
  byUnit: {
    unitId: string;
    unitName: string;
    employeeCount: number;
    totalNet: number;
  }[];
}

// ============================================
// Salary Components Hooks
// ============================================

export interface ListComponentsParams {
  type?: SalaryComponentType;
  isActive?: string;
  search?: string;
}

export function useSalaryComponents(params?: ListComponentsParams) {
  return useQuery({
    queryKey: ["payroll", "components", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SalaryComponent[]>>(
        "/payroll/components",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useSalaryComponent(id: string) {
  return useQuery({
    queryKey: ["payroll", "components", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SalaryComponent>>(
        `/payroll/components/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateComponentInput {
  code: string;
  name: string;
  type: SalaryComponentType;
  description?: string;
  defaultAmount?: number;
  isPercentage?: boolean;
  percentageBase?: string;
  isTaxable?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export function useCreateSalaryComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateComponentInput) => {
      const response = await api.post<ApiResponse<SalaryComponent>>(
        "/payroll/components",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "components"] });
    },
  });
}

export function useUpdateSalaryComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateComponentInput>;
    }) => {
      const response = await api.put<ApiResponse<SalaryComponent>>(
        `/payroll/components/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "components"] });
    },
  });
}

export function useDeleteSalaryComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/payroll/components/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "components"] });
    },
  });
}

export function useSeedSalaryComponents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<{ created: number }>>(
        "/payroll/components/seed",
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "components"] });
    },
  });
}

// ============================================
// Employee Salaries Hooks
// ============================================

export interface ListSalariesParams {
  unitId?: string;
  search?: string;
  page?: string;
  limit?: string;
}

export function useEmployeeSalaries(params?: ListSalariesParams) {
  return useQuery({
    queryKey: ["payroll", "salaries", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<EmployeeSalary>>(
        "/payroll/salaries",
        { params },
      );
      return response.data;
    },
  });
}

export function useEmployeeSalary(staffId: string) {
  return useQuery({
    queryKey: ["payroll", "salaries", staffId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<EmployeeSalary>>(
        `/payroll/salaries/${staffId}`,
      );
      return response.data.data;
    },
    enabled: !!staffId,
  });
}

export interface CreateEmployeeSalaryInput {
  staffId: string;
  basicSalary: number;
  taxStatus?: string;
  hasNpwp?: boolean;
  npwpNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  components?: {
    componentId: string;
    amount: number;
  }[];
}

export function useCreateEmployeeSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateEmployeeSalaryInput) => {
      const response = await api.post<ApiResponse<EmployeeSalary>>(
        "/payroll/salaries",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "salaries"] });
    },
  });
}

export function useUpdateEmployeeSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      staffId,
      data,
    }: {
      staffId: string;
      data: Partial<CreateEmployeeSalaryInput>;
    }) => {
      const response = await api.put<ApiResponse<EmployeeSalary>>(
        `/payroll/salaries/${staffId}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "salaries"] });
    },
  });
}

export function useDeleteEmployeeSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (staffId: string) => {
      await api.delete(`/payroll/salaries/${staffId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "salaries"] });
    },
  });
}

// ============================================
// Payroll Periods Hooks
// ============================================

export interface ListPeriodsParams {
  unitId?: string;
  year?: string;
  status?: PayrollStatus;
  page?: string;
  limit?: string;
}

export function usePayrollPeriods(params?: ListPeriodsParams) {
  return useQuery({
    queryKey: ["payroll", "periods", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<PayrollPeriod>>(
        "/payroll/periods",
        { params },
      );
      return response.data;
    },
  });
}

export function usePayrollPeriod(id: string) {
  return useQuery({
    queryKey: ["payroll", "periods", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PayrollPeriod>>(
        `/payroll/periods/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreatePeriodInput {
  unitId: string;
  name: string;
  month: number;
  year: number;
  startDate: string;
  endDate: string;
  notes?: string;
}

export function useCreatePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePeriodInput) => {
      const response = await api.post<ApiResponse<PayrollPeriod>>(
        "/payroll/periods",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

export function useUpdatePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreatePeriodInput>;
    }) => {
      const response = await api.put<ApiResponse<PayrollPeriod>>(
        `/payroll/periods/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

export function useApprovePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const response = await api.post<ApiResponse<PayrollPeriod>>(
        `/payroll/periods/${id}/approve`,
        { notes },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

export function usePayPayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payDate,
      notes,
    }: {
      id: string;
      payDate: string;
      notes?: string;
    }) => {
      const response = await api.post<ApiResponse<PayrollPeriod>>(
        `/payroll/periods/${id}/pay`,
        { payDate, notes },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

export function useCancelPayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & CancelPayrollPeriodInput) => {
      const response = await api.post<ApiResponse<PayrollPeriod>>(
        `/payroll/periods/${id}/cancel`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

export function useDeletePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/payroll/periods/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

// ============================================
// Payroll Slips Hooks
// ============================================

export interface ListSlipsParams {
  periodId?: string;
  staffId?: string;
  search?: string;
  page?: string;
  limit?: string;
}

export function usePayrollSlips(params?: ListSlipsParams) {
  return useQuery({
    queryKey: ["payroll", "slips", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<PayrollSlip>>(
        "/payroll/slips",
        { params },
      );
      return response.data;
    },
    enabled: !!params?.periodId,
  });
}

export function usePayrollSlip(id: string) {
  return useQuery({
    queryKey: ["payroll", "slips", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PayrollSlip>>(
        `/payroll/slips/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface GeneratePayrollInput {
  periodId: string;
  staffIds?: string[];
}

export function useGeneratePayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: GeneratePayrollInput) => {
      const response = await api.post<
        ApiResponse<{ created: number; updated: number }>
      >("/payroll/generate", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "slips"] });
      queryClient.invalidateQueries({ queryKey: ["payroll", "periods"] });
    },
  });
}

export interface AdjustPayrollItemInput {
  itemId: string;
  amount: number;
  notes?: string;
}

export function useAdjustPayrollItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slipId,
      data,
    }: {
      slipId: string;
      data: AdjustPayrollItemInput;
    }) => {
      const response = await api.put<ApiResponse<PayrollSlip>>(
        `/payroll/slips/${slipId}/adjust`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "slips"] });
    },
  });
}

export function usePayrollPeriodSummary(periodId: string) {
  return useQuery({
    queryKey: ["payroll", "periods", periodId, "summary"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PayrollSummary>>(
        `/payroll/periods/${periodId}/summary`,
      );
      return response.data.data;
    },
    enabled: !!periodId,
  });
}

// ============================================
// Utility Functions
// ============================================

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getMonthName(month: number): string {
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return months[month - 1] || "";
}

export const TAX_STATUS_OPTIONS = [
  { value: "TK/0", label: "TK/0 - Tidak Kawin, 0 tanggungan" },
  { value: "TK/1", label: "TK/1 - Tidak Kawin, 1 tanggungan" },
  { value: "TK/2", label: "TK/2 - Tidak Kawin, 2 tanggungan" },
  { value: "TK/3", label: "TK/3 - Tidak Kawin, 3 tanggungan" },
  { value: "K/0", label: "K/0 - Kawin, 0 tanggungan" },
  { value: "K/1", label: "K/1 - Kawin, 1 tanggungan" },
  { value: "K/2", label: "K/2 - Kawin, 2 tanggungan" },
  { value: "K/3", label: "K/3 - Kawin, 3 tanggungan" },
  { value: "K/I/0", label: "K/I/0 - Kawin, istri bekerja, 0 tanggungan" },
  { value: "K/I/1", label: "K/I/1 - Kawin, istri bekerja, 1 tanggungan" },
  { value: "K/I/2", label: "K/I/2 - Kawin, istri bekerja, 2 tanggungan" },
  { value: "K/I/3", label: "K/I/3 - Kawin, istri bekerja, 3 tanggungan" },
];
