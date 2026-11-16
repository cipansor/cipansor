import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreatePrivacyPolicyVersionInput,
  PrivacyPolicyCurrentDTO,
  PrivacyPolicyVersionSummaryDTO,
} from "@cipansor/shared";

/**
 * Kebijakan Privasi publik yang berversi (UU PDP 27/2022 Pasal 30, 35).
 *
 * Halaman publik dan formulir SPMB membacanya tanpa sesi; hanya Super Admin
 * yang menerbitkan versi baru. Versi lama tidak pernah disunting — persetujuan
 * pendaftar menunjuk nomornya (decisions/persetujuan-pengguna.md).
 */

const CURRENT_KEY = ["privacy-policy", "current"] as const;
const VERSIONS_KEY = ["privacy-policy", "versions"] as const;

/**
 * Versi yang berlaku. `null` = yayasan belum menerbitkan teksnya; halaman
 * publik menampilkannya sebagai "belum tersedia", dan formulir SPMB memang
 * belum boleh mengumpulkan data (lihat gerbang persetujuan di spmb-form.tsx).
 */
export function usePrivacyPolicyCurrent(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: CURRENT_KEY,
    queryFn: async () => {
      const response = await api.get<{ data: PrivacyPolicyCurrentDTO | null }>(
        "/privacy-policy/current",
      );
      return response.data.data ?? null;
    },
    staleTime: 30 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/** Daftar versi (layar admin), terbaru dulu. */
export function usePrivacyPolicyVersions(page = 1, limit = 20) {
  return useQuery({
    queryKey: [...VERSIONS_KEY, page, limit],
    queryFn: async () => {
      // The API answers with `{ data, pagination }` (ApiResponse.success with
      // its pagination argument) — not the `meta.pagination` wrapper the
      // legacy list endpoints use.
      const response = await api.get<{
        data: PrivacyPolicyVersionSummaryDTO[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>("/privacy-policy/versions", { params: { page, limit } });
      return {
        data: response.data.data ?? [],
        pagination: response.data.pagination,
      };
    },
  });
}

/** Terbitkan versi baru (Super Admin). */
export function useCreatePrivacyPolicyVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePrivacyPolicyVersionInput) => {
      const response = await api.post<{ data: PrivacyPolicyCurrentDTO }>(
        "/privacy-policy/versions",
        input,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CURRENT_KEY });
      queryClient.invalidateQueries({ queryKey: VERSIONS_KEY });
    },
  });
}
