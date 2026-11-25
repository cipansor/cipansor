import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// =====================================
// TYPES
// =====================================

export interface AccountCode {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: "DEBIT" | "CREDIT";
  parentId?: string;
  parent?: {
    id: string;
    code: string;
    name: string;
  };
  cashFlowCategory?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  unitId: string;
  accountId: string;
  account: {
    code: string;
    name: string;
  };
  date: string;
  description: string;
  debit: number;
  credit: number;
  reference?: string;
  referenceType?: string;
  createdById: string;
  createdBy: {
    name: string;
  };
  createdAt: string;
}

export interface ReportRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  debit?: number; // Trial Balance
  credit?: number; // Trial Balance
  balance?: number; // Trial Balance & Balance Sheet
}

export interface BalanceSheetData {
  assets: ReportRow[];
  totalAssets: number;
  liabilities: ReportRow[];
  totalLiabilities: number;
  equity: ReportRow[];
  netIncome: number;
  totalEquity: number;
}

export interface IncomeStatementData {
  revenues: ReportRow[];
  totalRevenue: number;
  expenses: ReportRow[];
  totalExpense: number;
  netIncome: number;
}

// =====================================
// ACCOUNT HOOKS
// =====================================

export interface AccountParams {
  search?: string;
  type?: string;
  isActive?: boolean;
}

export function useAccounts(params: AccountParams = {}) {
  return useQuery({
    queryKey: ["accounts", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AccountCode[]>>(
        "/finance/accounting/accounts",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useAccount(id: string) {
  return useQuery({
    queryKey: ["accounts", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AccountCode>>(
        `/finance/accounting/accounts/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<AccountCode>) => {
      const response = await api.post<ApiResponse<AccountCode>>(
        "/finance/accounting/accounts",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<AccountCode>;
    }) => {
      const response = await api.put<ApiResponse<AccountCode>>(
        `/finance/accounting/accounts/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/finance/accounting/accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useSeedAccounts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<AccountCode[]>>(
        "/finance/accounting/accounts/seed",
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// =====================================
// JOURNAL HOOKS
// =====================================

export interface JournalParams {
  page?: number;
  limit?: number;
  unitId?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
}

export function useJournals(params: JournalParams = {}) {
  return useQuery({
    queryKey: ["journals", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<JournalEntry>>(
        "/finance/accounting/journals",
        { params },
      );
      return response.data;
    },
  });
}

export interface CreateJournalEntryData {
  unitId: string;
  date: string;
  description: string;
  entries: {
    accountId: string;
    debit: number;
    credit: number;
  }[];
}

export function useCreateJournal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateJournalEntryData) => {
      const response = await api.post<ApiResponse<JournalEntry[]>>(
        "/finance/accounting/journals",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journals"] });
      // Invalidate reports too as they will change
      queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      queryClient.invalidateQueries({ queryKey: ["balance-sheet"] });
      queryClient.invalidateQueries({ queryKey: ["income-statement"] });
    },
  });
}

// =====================================
// REPORT HOOKS
// =====================================

export interface AccountingReportParams {
  unitId?: string;
  startDate?: string;
  endDate?: string;
}

export function useTrialBalance(params: AccountingReportParams = {}) {
  return useQuery({
    queryKey: ["trial-balance", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ReportRow[]>>(
        "/finance/accounting/reports/trial-balance",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useBalanceSheet(params: AccountingReportParams = {}) {
  return useQuery({
    queryKey: ["balance-sheet", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<BalanceSheetData>>(
        "/finance/accounting/reports/balance-sheet",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useIncomeStatement(params: AccountingReportParams = {}) {
  return useQuery({
    queryKey: ["income-statement", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<IncomeStatementData>>(
        "/finance/accounting/reports/income-statement",
        { params },
      );
      return response.data.data;
    },
  });
}
