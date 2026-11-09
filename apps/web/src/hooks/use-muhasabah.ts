import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// =====================================
// Types
// =====================================

export type MuhasabahMood =
  "EXCELLENT" | "GOOD" | "NEUTRAL" | "LOW" | "STRUGGLING";

export interface DailyMuhasabah {
  id: string;
  studentId: string;
  date: string;
  // Sholat
  sholatSubuh: boolean;
  sholatDzuhur: boolean;
  sholatAshar: boolean;
  sholatMaghrib: boolean;
  sholatIsya: boolean;
  sholatTahajud: boolean;
  sholatDhuha: boolean;
  // Tilawah & Dzikir
  tilawahPages: number;
  dzikirPagi: boolean;
  dzikirSore: boolean;
  istighfar: number;
  shalawat: number;
  murojaahJuz?: number;
  // Refleksi
  mood: MuhasabahMood;
  gratitude?: string;
  improvement?: string;
  notes?: string;
  // Meta
  createdAt: string;
  updatedAt: string;
  student?: {
    id: string;
    user: { id: string; name: string };
    unit?: { id: string; name: string };
  };
}

export interface MuhasabahStats {
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  averageSholatCompletion: number;
  averageTilawahPages: number;
  moodDistribution: Record<MuhasabahMood, number>;
}

export interface MuhasabahSummary {
  totalRecords: number;
  thisWeek: number;
  thisMonth: number;
  currentStreak: number;
  averageSholatCompletion: number;
  averageTilawahPages: number;
}

// =====================================
// Constants
// =====================================

export const MUHASABAH_MOODS: {
  value: MuhasabahMood;
  label: string;
  emoji: string;
  color: string;
}[] = [
  {
    value: "EXCELLENT",
    label: "Sangat Baik",
    emoji: "😊",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "GOOD",
    label: "Baik",
    emoji: "🙂",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "NEUTRAL",
    label: "Biasa",
    emoji: "😐",
    color: "bg-gray-100 text-gray-800",
  },
  {
    value: "LOW",
    label: "Kurang",
    emoji: "😔",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "STRUGGLING",
    label: "Berat",
    emoji: "😢",
    color: "bg-red-100 text-red-800",
  },
];

export const SHOLAT_WAJIB = [
  { key: "sholatSubuh", label: "Subuh", time: "04:30" },
  { key: "sholatDzuhur", label: "Dzuhur", time: "12:00" },
  { key: "sholatAshar", label: "Ashar", time: "15:30" },
  { key: "sholatMaghrib", label: "Maghrib", time: "18:00" },
  { key: "sholatIsya", label: "Isya", time: "19:30" },
] as const;

export const SHOLAT_SUNNAH = [
  { key: "sholatTahajud", label: "Tahajud", time: "03:00" },
  { key: "sholatDhuha", label: "Dhuha", time: "08:00" },
] as const;

// =====================================
// Hooks
// =====================================

export interface MuhasabahParams {
  page?: number;
  limit?: number;
  studentId?: string;
  startDate?: string;
  endDate?: string;
}

export function useMuhasabahRecords(params: MuhasabahParams = {}) {
  return useQuery({
    queryKey: ["muhasabah", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<DailyMuhasabah>>(
        "/muhasabah",
        { params },
      );
      return response.data;
    },
  });
}

export function useMuhasabahRecord(id: string) {
  return useQuery({
    queryKey: ["muhasabah", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DailyMuhasabah>>(
        `/muhasabah/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useMyMuhasabahToday() {
  return useQuery({
    queryKey: ["muhasabah", "today"],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<DailyMuhasabah>>("/muhasabah/today");
      return response.data.data;
    },
  });
}

export function useMyMuhasabahStats() {
  return useQuery({
    queryKey: ["muhasabah", "stats"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<MuhasabahStats>>(
        "/muhasabah/me/stats",
      );
      return response.data.data;
    },
  });
}

export function useMuhasabahSummary(studentId?: string) {
  return useQuery({
    queryKey: ["muhasabah", "summary", studentId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<MuhasabahSummary>>(
        "/muhasabah/summary",
        {
          params: { studentId },
        },
      );
      return response.data.data;
    },
  });
}

export interface CreateMuhasabahData {
  date: string;
  // Sholat
  sholatSubuh: boolean;
  sholatDzuhur: boolean;
  sholatAshar: boolean;
  sholatMaghrib: boolean;
  sholatIsya: boolean;
  sholatTahajud?: boolean;
  sholatDhuha?: boolean;
  // Tilawah & Dzikir
  tilawahPages?: number;
  dzikirPagi?: boolean;
  dzikirSore?: boolean;
  istighfar?: number;
  shalawat?: number;
  murojaahJuz?: number;
  // Refleksi
  mood: MuhasabahMood;
  gratitude?: string;
  improvement?: string;
  notes?: string;
}

export function useCreateMuhasabah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMuhasabahData) => {
      const response = await api.post<ApiResponse<DailyMuhasabah>>(
        "/muhasabah",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["muhasabah"] });
    },
  });
}

export function useUpdateMuhasabah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateMuhasabahData>;
    }) => {
      const response = await api.put<ApiResponse<DailyMuhasabah>>(
        `/muhasabah/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["muhasabah"] });
      queryClient.invalidateQueries({ queryKey: ["muhasabah", variables.id] });
    },
  });
}

export function useDeleteMuhasabah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/muhasabah/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["muhasabah"] });
    },
  });
}

// Utility function to calculate sholat completion percentage
export function calculateSholatCompletion(record: DailyMuhasabah): number {
  const sholatWajib = [
    record.sholatSubuh,
    record.sholatDzuhur,
    record.sholatAshar,
    record.sholatMaghrib,
    record.sholatIsya,
  ];
  const completed = sholatWajib.filter(Boolean).length;
  return Math.round((completed / 5) * 100);
}
