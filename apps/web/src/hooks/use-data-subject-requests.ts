import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";
import type {
  CreateGuardianDataSubjectRequestInput,
  CreatePublicDataSubjectRequestInput,
  DataSubjectRequestDTO,
  DataSubjectRequestSummaryDTO,
  ListDataSubjectRequestsQuery,
  PublicDataSubjectRequestCreatedDTO,
  PublicDataSubjectRequestVerifiedDTO,
  UpdateDataSubjectRequestStatusInput,
  VerifyPublicDataSubjectRequestInput,
} from "@cipansor/shared";

/**
 * Alur hak subjek data (UU 27/2022 Pasal 30, 32, 33, 40, 43–44).
 *
 * Tiga permukaan memakai berkas ini, dan pemisahannya mengikuti pemisahan
 * rutenya:
 *
 * 1. **Wali** — `useMyDataSubjectRequests` dan `useCreateDataSubjectRequest`
 *    untuk dirinya atau santri tanggungannya. Yang menentukan boleh atau tidak
 *    adalah peladen (tautan `StudentParent`), bukan layar ini.
 * 2. **Pendaftar SPMB tanpa akun** — dua langkah, dan langkah pertamanya tidak
 *    mengembalikan data subjek apa pun. Nomor permintaan yang keluar dari
 *    langkah itu satu-satunya yang dapat ditanyakan kabarnya.
 * 3. **Petugas pelindungan data pribadi** — daftar kerja, riwayat tindakan,
 *    dan perpindahan status. Salinan data untuk permintaan akses ikut pada
 *    jawaban penutupan, sekali, dan tidak disimpan di mana pun.
 */

// ==================== WALI (portal) ====================

const MINE_KEY = ["data-subject-requests", "mine"] as const;

/**
 * Permintaan yang diajukan pemohon yang sedang masuk.
 *
 * Kunci cache-nya memuat id pengguna, sama seperti hook portal orang tua yang
 * lain: jawabannya per akun, dan sesi tidak menghapus seluruh cache — di
 * perangkat berbagi, wali berikutnya akan membaca permintaan wali sebelumnya
 * (CWE-524).
 */
export function useMyDataSubjectRequests(userId?: string | null) {
  return useQuery({
    queryKey: [...MINE_KEY, userId],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<DataSubjectRequestSummaryDTO[]>
      >("/data-subject-requests/mine");
      return response.data.data ?? [];
    },
    enabled: !!userId,
  });
}

/** Ajukan permintaan atas data sendiri atau data santri tanggungan. */
export function useCreateDataSubjectRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGuardianDataSubjectRequestInput) => {
      const response = await api.post<ApiResponse<DataSubjectRequestDTO>>(
        "/data-subject-requests",
        input,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MINE_KEY });
    },
  });
}

// ==================== PUBLIK (pendaftar SPMB) ====================

/**
 * Langkah pertama formulir publik.
 *
 * Token Turnstile ikut sebagai `turnstileToken`; dikosongkan ketika gerbangnya
 * dimatikan di build ini (site key kosong), dan peladen pun mematikan gerbang
 * yang sama dari secret key yang kosong.
 */
export function useSubmitPublicDataSubjectRequest() {
  return useMutation({
    mutationFn: async (input: {
      payload: CreatePublicDataSubjectRequestInput;
      turnstileToken: string | null;
    }) => {
      const response = await api.post<
        ApiResponse<PublicDataSubjectRequestCreatedDTO>
      >("/data-subject-requests/public", {
        ...input.payload,
        ...(input.turnstileToken
          ? { turnstileToken: input.turnstileToken }
          : {}),
      });
      return response.data.data;
    },
  });
}

/** Langkah kedua: kode yang tiba di kontak terdaftar. */
export function useVerifyPublicDataSubjectRequest() {
  return useMutation({
    mutationFn: async (input: VerifyPublicDataSubjectRequestInput) => {
      const response = await api.post<
        ApiResponse<PublicDataSubjectRequestVerifiedDTO>
      >("/data-subject-requests/public/verify", input);
      return response.data.data;
    },
  });
}

// ==================== PETUGAS PELINDUNGAN DATA PRIBADI ====================

const LIST_KEY = ["data-subject-requests", "list"] as const;

/** Daftar kerja petugas: belum selesai lebih dulu, tenggat terdekat di atas. */
export function useDataSubjectRequests(
  query: Partial<ListDataSubjectRequestsQuery> = {},
) {
  return useQuery({
    queryKey: [...LIST_KEY, query],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<DataSubjectRequestSummaryDTO[]>
      >("/data-subject-requests", {
        params: {
          ...query,
          // Boolean dikirim sebagai string: skema query membacanya sebagai
          // enum "true"/"false", dan `true` telanjang akan diserialkan begitu
          // juga — tetapi eksplisit di sini menjaga kontraknya terbaca.
          openOnly:
            query.openOnly === undefined ? undefined : String(query.openOnly),
          overdueOnly:
            query.overdueOnly === undefined
              ? undefined
              : String(query.overdueOnly),
        },
      });
      return {
        data: response.data.data ?? [],
        // Pagination sits at the TOP level of the envelope: the controller
        // passes it as `ApiResponse.success(data, message, pagination)`, which
        // spreads it onto `pagination`. Reading `meta.pagination` (as this hook
        // once did) always returned `undefined`, so the list could never show a
        // page control.
        pagination: response.data.pagination,
      };
    },
  });
}

/** Satu permintaan lengkap dengan riwayat tindakannya. */
export function useDataSubjectRequest(id?: string | null) {
  return useQuery({
    queryKey: ["data-subject-requests", "detail", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DataSubjectRequestDTO>>(
        `/data-subject-requests/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

/**
 * Pindahkan status permintaan.
 *
 * Jawaban penutupan permintaan akses membawa salinan datanya sekali; salinan
 * itu dikembalikan kepada pemanggil dan tidak pernah disimpan di cache React
 * Query — sebuah salinan data pribadi yang tinggal di cache akan hidup lebih
 * lama daripada alasan ia dibuat.
 */
export function useUpdateDataSubjectRequestStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      payload: UpdateDataSubjectRequestStatusInput;
    }) => {
      const response = await api.patch<
        ApiResponse<DataSubjectRequestDTO & { exportPayload?: unknown }>
      >(`/data-subject-requests/${input.id}/status`, input.payload);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      // Halaman rinciannya juga: tanpa ini lencana statusnya tetap yang lama
      // sampai dimuat ulang, dan petugas yang baru memindahkan status melihat
      // layar yang membantah tindakannya sendiri.
      queryClient.invalidateQueries({
        queryKey: ["data-subject-requests", "detail", variables.id],
      });
    },
  });
}
