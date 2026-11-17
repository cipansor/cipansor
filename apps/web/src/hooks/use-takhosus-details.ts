import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
export interface PaginatedResponse<T> {
  data: T[];
  meta: any;
}
import {
  MurojaahRecord,
  SimaanExam,
  TakhosusDashboardStats,
} from "@cipansor/shared";

// Define input types locally if not available in @cipansor/shared,
// or import from a shared location if you move schemas to shared package.
// For now, I will define them to match the API schemas.

export interface CreateMurojaahInput {
  studentId: string;
  murojaahType: "YAUMIYAH" | "USBUIYAH" | "SYAHRIYAH" | "TASMI";
  murojaahDate: string;
  juzStart: number;
  juzEnd: number;
  pagesReviewed?: number;
  durationMinutes?: number;
  qualityScore: number;
  mistakeCount?: number;
  fluencyLevel?: number;
  tajwidScore?: number;
  notes?: string;
  mistakes?: {
    mistakeType: "LAHIN_JALI" | "LAHIN_KHAFI" | "TAJWID" | "LUPA" | "URUTAN";
    juz: number;
    surahNumber: number;
    ayahNumber?: number;
    description?: string;
  }[];
}

// Re-export shared types for component usage
export type { MurojaahRecord, SimaanExam, TakhosusDashboardStats };

// ================= HOOKS =================

export function useTakhosusDashboard(unitId?: string) {
  return useQuery({
    queryKey: ["takhosus", "dashboard", unitId],
    queryFn: async () => {
      const { data } = await api.get<{ data: TakhosusDashboardStats }>(
        "/takhosus/dashboard-stats",
        {
          params: { unitId },
        },
      );
      return data.data;
    },
  });
}

export function useMurojaahRecords(params: {
  page?: number;
  limit?: number;
  studentId?: string;
  halaqohId?: string;
}) {
  return useQuery({
    queryKey: ["takhosus", "murojaah", params],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<MurojaahRecord>>(
        "/takhosus/murojaah",
        {
          params,
        },
      );
      return data;
    },
  });
}

export function useCreateMurojaah() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateMurojaahInput) => {
      const { data: response } = await api.post("/takhosus/murojaah", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "murojaah"] });
      queryClient.invalidateQueries({ queryKey: ["takhosus", "dashboard"] });
    },
  });
}
