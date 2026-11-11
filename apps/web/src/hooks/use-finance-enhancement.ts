"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  AccountCode,
  JournalEntry,
  Scholarship,
  ScholarshipRecipient,
  PaymentComponent,
  TrialBalanceReport,
  IncomeExpenseReport,
  GeneralLedgerReport,
  CashFlowReport,
  AccountType,
  ScholarshipSource,
  ScholarshipType,
  PaymentCategory, // Mapped from PaymentComponentCategory
  SharedPaginatedResponse,
  FinanceReportPeriod,
  Budget,
} from "@cipansor/shared";

// Re-export types
export type {
  AccountCode,
  JournalEntry,
  Scholarship,
  ScholarshipRecipient,
  PaymentComponent,
  TrialBalanceReport,
  IncomeExpenseReport,
  GeneralLedgerReport,
  CashFlowReport,
  // Values/Enums must be exported as values too if used as such
};

// Re-export values (Enums)
export {
  AccountType,
  ScholarshipSource,
  ScholarshipType,
  PaymentCategory,
  FinanceReportPeriod,
};

// Aliases to match local names if they differed significantly, or just use shared
export type AccountCodeType = AccountType;
export type PaymentComponentCategory = PaymentCategory;

// ==================== ACCOUNT CODES ====================

interface AccountCodeFilters {
  type?: AccountType;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export function useAccountCodes(filters: AccountCodeFilters = {}) {
  return useQuery({
    queryKey: ["account-codes", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.type) params.append("type", filters.type);
      if (filters.isActive !== undefined)
        params.append("isActive", String(filters.isActive));
      if (filters.search) params.append("search", filters.search);
      if (filters.page) params.append("page", String(filters.page));
      if (filters.limit) params.append("limit", String(filters.limit));

      const response = await api.get<SharedPaginatedResponse<AccountCode>>(
        `/finance-enhancement/account-codes?${params}`,
      );
      const result = response.data;
      return {
        data: result.data,
        pagination: result.meta.pagination,
      };
    },
  });
}

export function useCreateAccountCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      code: string;
      name: string;
      type: AccountType;
      parentId?: string;
      isActive?: boolean;
    }) => {
      const response = await api.post(
        "/finance-enhancement/account-codes",
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-codes"] });
    },
  });
}

export function useUpdateAccountCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      type?: AccountType;
      parentId?: string | null;
      isActive?: boolean;
    }) => {
      const response = await api.put(
        `/finance-enhancement/account-codes/${id}`,
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-codes"] });
    },
  });
}

// ==================== JOURNAL ENTRIES ====================

interface JournalEntryFilters {
  unitId?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function useJournalEntries(filters: JournalEntryFilters = {}) {
  return useQuery({
    queryKey: ["journal-entries", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      if (filters.accountId) params.append("accountId", filters.accountId);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);
      if (filters.search) params.append("search", filters.search);
      if (filters.page) params.append("page", String(filters.page));
      if (filters.limit) params.append("limit", String(filters.limit));

      const response = await api.get<SharedPaginatedResponse<JournalEntry>>(
        `/finance-enhancement/journal-entries?${params}`,
      );
      const result = response.data;
      return {
        data: result.data,
        pagination: result.meta.pagination,
      };
    },
  });
}

export function useJournalEntry(id: string) {
  return useQuery({
    queryKey: ["journal-entry", id],
    queryFn: async () => {
      const response = await api.get<{ data: JournalEntry }>(
        `/finance-enhancement/journal-entries/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      unitId?: string;
      accountId: string;
      date: string;
      description: string;
      debit?: number;
      credit?: number;
      reference?: string;
      referenceType?: string;
    }) => {
      const response = await api.post(
        "/finance-enhancement/journal-entries",
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    },
  });
}

// ==================== SCHOLARSHIPS ====================

interface ScholarshipFilters {
  unitId?: string;
  type?: ScholarshipType;
  source?: ScholarshipSource;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export function useScholarships(filters: ScholarshipFilters = {}) {
  return useQuery({
    queryKey: ["scholarships", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      if (filters.type) params.append("type", filters.type);
      if (filters.source) params.append("source", filters.source);
      if (filters.isActive !== undefined)
        params.append("isActive", String(filters.isActive));
      if (filters.page) params.append("page", String(filters.page));
      if (filters.limit) params.append("limit", String(filters.limit));

      const response = await api.get<SharedPaginatedResponse<Scholarship>>(
        `/finance-enhancement/scholarships?${params}`,
      );
      const result = response.data;
      return {
        data: result.data,
        pagination: result.meta.pagination,
      };
    },
  });
}

export function useScholarship(id: string) {
  return useQuery({
    queryKey: ["scholarship", id],
    queryFn: async () => {
      const response = await api.get<{ data: Scholarship }>(
        `/finance-enhancement/scholarships/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useScholarshipRecipients(
  scholarshipId: string,
  filters: { status?: string; page?: number; limit?: number } = {},
) {
  return useQuery({
    queryKey: ["scholarship-recipients", scholarshipId, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.append("status", filters.status);
      if (filters.page) params.append("page", String(filters.page));
      if (filters.limit) params.append("limit", String(filters.limit));

      const response = await api.get<
        SharedPaginatedResponse<ScholarshipRecipient>
      >(
        `/finance-enhancement/scholarships/${scholarshipId}/recipients?${params}`,
      );
      const result = response.data;
      return {
        data: result.data,
        pagination: result.meta.pagination,
      };
    },
    enabled: !!scholarshipId,
  });
}

export function useCreateScholarship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      source: ScholarshipSource;
      type: ScholarshipType;
      quota?: number;
      requirements?: string;
      startDate: string;
      endDate?: string;
      unitId?: string;
      isActive?: boolean;
    }) => {
      const response = await api.post(
        "/finance-enhancement/scholarships",
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scholarships"] });
    },
  });
}

export function useAssignScholarship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      scholarshipId: string;
      studentId: string;
      academicYearId: string;
      startDate: string;
      endDate?: string;
      notes?: string;
    }) => {
      const response = await api.post(
        "/finance-enhancement/scholarship-recipients",
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scholarship-recipients"] });
    },
  });
}

// ==================== PAYMENT COMPONENTS ====================

interface PaymentComponentFilters {
  unitId?: string;
  category?: PaymentCategory;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export function usePaymentComponents(filters: PaymentComponentFilters = {}) {
  return useQuery({
    queryKey: ["payment-components", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      if (filters.category) params.append("category", filters.category);
      if (filters.isActive !== undefined)
        params.append("isActive", String(filters.isActive));
      if (filters.page) params.append("page", String(filters.page));
      if (filters.limit) params.append("limit", String(filters.limit));

      const response = await api.get<SharedPaginatedResponse<PaymentComponent>>(
        `/finance-enhancement/payment-components?${params}`,
      );
      const result = response.data;
      return {
        data: result.data,
        pagination: result.meta.pagination,
      };
    },
  });
}

export function useCreatePaymentComponent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      code: string;
      name: string;
      description?: string;
      category: PaymentCategory;
      amount: number;
      unitId?: string;
      isActive?: boolean;
    }) => {
      const response = await api.post(
        "/finance-enhancement/payment-components",
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-components"] });
    },
  });
}

// ==================== REPORTS ====================

export function useTrialBalanceReport(filters: {
  unitId?: string;
  startDate: string;
  endDate: string;
}) {
  return useQuery({
    queryKey: ["trial-balance-report", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      params.append("startDate", filters.startDate);
      params.append("endDate", filters.endDate);

      const response = await api.get<{ data: TrialBalanceReport }>(
        `/finance-enhancement/reports/trial-balance?${params}`,
      );
      return response.data.data;
    },
    enabled: !!filters.startDate && !!filters.endDate,
  });
}

export function useCashFlowForecast(unitId?: string, months: number = 6) {
  return useQuery({
    queryKey: ["cash-flow-forecast", unitId, months],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (unitId) params.append("unitId", unitId);
      params.append("months", String(months));

      const response = await api.get<{ data: any }>(
        `/finance-enhancement/reports/cash-flow-forecast?${params}`,
      );
      return response.data.data;
    },
    enabled: !!unitId,
  });
}

// ==================== BUDGETS ====================

export function useBudgets(
  filters: {
    unitId?: string;
    academicYearId?: string;
    page?: number;
    limit?: number;
    enabled?: boolean;
  } = {},
) {
  const { enabled = true, ...query } = filters;
  return useQuery({
    queryKey: ["budgets", query],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.unitId) params.append("unitId", query.unitId);
      if (query.academicYearId)
        params.append("academicYearId", query.academicYearId);
      if (query.page) params.append("page", String(query.page));
      if (query.limit) params.append("limit", String(query.limit));

      const response = await api.get<SharedPaginatedResponse<Budget>>(
        `/finance-enhancement/budgets?${params}`,
      );
      return response.data;
    },
  });
}

export function useGeneralLedgerReport(filters: {
  unitId?: string;
  accountId: string;
  startDate: string;
  endDate: string;
}) {
  return useQuery({
    queryKey: ["general-ledger-report", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      params.append("accountId", filters.accountId);
      params.append("startDate", filters.startDate);
      params.append("endDate", filters.endDate);

      const response = await api.get<{ data: GeneralLedgerReport }>(
        `/finance-enhancement/reports/general-ledger?${params}`,
      );
      return response.data.data;
    },
    enabled: !!filters.accountId && !!filters.startDate && !!filters.endDate,
  });
}

export function useCashFlowReport(filters: {
  unitId?: string;
  startDate: string;
  endDate: string;
}) {
  return useQuery({
    queryKey: ["cash-flow-report", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      params.append("startDate", filters.startDate);
      params.append("endDate", filters.endDate);

      const response = await api.get<{ data: CashFlowReport }>(
        `/finance-enhancement/reports/cash-flow?${params}`,
      );
      return response.data.data;
    },
    enabled: !!filters.startDate && !!filters.endDate,
  });
}

export function useIncomeExpenseReport(filters: {
  unitId?: string;
  startDate: string;
  endDate: string;
  groupBy?: FinanceReportPeriod | "month" | "day";
}) {
  return useQuery({
    queryKey: ["income-expense-report", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.unitId) params.append("unitId", filters.unitId);
      params.append("startDate", filters.startDate);
      params.append("endDate", filters.endDate);
      if (filters.groupBy) params.append("groupBy", filters.groupBy);

      const response = await api.get<{ data: IncomeExpenseReport }>(
        `/finance-enhancement/reports/income-expense?${params}`,
      );
      return response.data.data;
    },
    enabled: !!filters.startDate && !!filters.endDate,
  });
}
