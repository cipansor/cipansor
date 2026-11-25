import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ApiResponse,
  type CreateLaundryPricingInput,
  type CreateLaundryTransactionInput,
  type LaundryPricingDTO,
  type LaundryStatusCode,
  type LaundryTransactionDTO,
  type LaundryTransactionStatsDTO,
  type ListLaundryTransactionsQuery,
  type Pagination,
  type ProcessLaundryPaymentInput,
  type UpdateLaundryPricingInput,
} from "@cipansor/shared";
import api from "@/lib/api";

/**
 * `/laundry` reads and writes through these hooks only (#1010, R22.1). The page
 * used to call `fetch` directly, which sent no CSRF header — every write was
 * refused by the API's double-submit check — and named columns the API does not
 * have (`transactionNumber`, `student.fullName`, `totalItems`, `totalAmount`).
 */

const KEY = "laundry";

export interface LaundryTransactionPage {
  data: LaundryTransactionDTO[];
  pagination: Pagination;
}

/**
 * The transaction list (R22.4, R22.12): `search` and `status` go to the API, so
 * the server filters and paginates inside `laundryReadScope` rather than the
 * browser filtering one page.
 */
export function useLaundryTransactions(
  params: Partial<ListLaundryTransactionsQuery> = {},
) {
  return useQuery({
    queryKey: [KEY, "transactions", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<LaundryTransactionDTO[]>>(
        "/laundry/transactions",
        { params, skipErrorToast: true },
      );
      return {
        data: response.data.data,
        pagination: response.data.pagination ?? {
          page: 1,
          limit: params.limit ?? 20,
          total: response.data.data.length,
          totalPages: 1,
        },
      } as LaundryTransactionPage;
    },
  });
}

/** One transaction, for the detail dialog — the same columns as the list. */
export function useLaundryTransaction(id: string | null) {
  return useQuery({
    queryKey: [KEY, "transaction", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<LaundryTransactionDTO>>(
        `/laundry/transactions/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

/** The summary cards (R22.10) — four figures over the whole period, not a page. */
export function useLaundryStats(
  params: {
    startDate?: string;
    endDate?: string;
  } = {},
) {
  return useQuery({
    queryKey: [KEY, "stats", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<LaundryTransactionStatsDTO>>(
        "/laundry/transactions/stats",
        { params, skipErrorToast: true },
      );
      return response.data.data;
    },
  });
}

/** The price tiers of the caller's unit, per kilogram (R22.8). */
export function useLaundryPricing() {
  return useQuery({
    queryKey: [KEY, "pricing"],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<LaundryPricingDTO[]>>("/laundry/pricing");
      return response.data.data;
    },
  });
}

export function useCreateLaundryPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLaundryPricingInput) =>
      (
        await api.post<ApiResponse<LaundryPricingDTO>>(
          "/laundry/pricing",
          data,
          {
            skipErrorToast: true,
          },
        )
      ).data.data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [KEY, "pricing"] }),
  });
}

export function useUpdateLaundryPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateLaundryPricingInput;
    }) =>
      (
        await api.put<ApiResponse<LaundryPricingDTO>>(
          `/laundry/pricing/${id}`,
          data,
          { skipErrorToast: true },
        )
      ).data.data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [KEY, "pricing"] }),
  });
}

export function useDeleteLaundryPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      api.delete(`/laundry/pricing/${id}`, { skipErrorToast: true }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [KEY, "pricing"] }),
  });
}

/** R22.9: one price tier, a weight in kg, and the method the API accepts. */
export function useCreateLaundryTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLaundryTransactionInput) =>
      (
        await api.post<ApiResponse<LaundryTransactionDTO>>(
          "/laundry/transactions",
          data,
          { skipErrorToast: true },
        )
      ).data.data,
    onSuccess: () => invalidateLaundry(queryClient),
  });
}

/**
 * Settle a `PENDING` transaction — `POST …/pay`, the only route that turns
 * `UNPAID` into `PAID` and books the revenue. Without it a Bayar Nanti order
 * stayed unpaid forever, even after the laundry was handed over.
 */
export function useProcessLaundryPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & ProcessLaundryPaymentInput) =>
      (
        await api.post<ApiResponse<LaundryTransactionDTO>>(
          `/laundry/transactions/${id}/pay`,
          data,
          { skipErrorToast: true },
        )
      ).data.data,
    onSuccess: () => invalidateLaundry(queryClient),
  });
}

/**
 * R22.3, R22.7: `PATCH …/status`, never `PUT` — the API serves no `PUT` there,
 * which is why the status change never saved. Nothing is written to the cache
 * before the API answers, so a refusal (409 outside the flow, 404 out of reach)
 * leaves the transaction showing the status it had.
 */
export function useUpdateLaundryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
    }: {
      id: string;
      status: LaundryStatusCode;
      notes?: string;
    }) =>
      (
        await api.patch<ApiResponse<LaundryTransactionDTO>>(
          `/laundry/transactions/${id}/status`,
          { status, notes },
          { skipErrorToast: true },
        )
      ).data.data,
    onSuccess: () => invalidateLaundry(queryClient),
  });
}

function invalidateLaundry(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [KEY] });
}
