import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Enums
// The API's `MurojaahType` values (Prisma enum). The English values this list
// used to carry were rejected by the database, so no murojaah could be saved.
export const MUROJAAH_TYPES = [
  { value: "YAUMIYAH", label: "Harian (Yaumiyah)" },
  { value: "USBUIYAH", label: "Mingguan (Usbuiyah)" },
  { value: "SYAHRIYAH", label: "Bulanan (Syahriyah)" },
  { value: "TASMI", label: "Tasmi' (Uji Acak)" },
] as const;

export const MISTAKE_TYPES = [
  { value: "LAHN_JALI", label: "Lahin Jali (Berat)" },
  { value: "LAHN_KHAFI", label: "Lahin Khafi (Ringan)" },
  { value: "GHUNNAH", label: "Ghunnah" },
  { value: "MAD", label: "Mad" },
  { value: "WAQF", label: "Waqf" },
  { value: "IBTIDA", label: "Ibtida" },
] as const;

// Types matching Backend Schema
export interface MurojaahMistake {
  id: string;
  murojaahId: string;
  mistakeType:
    | "LAHN_JALI"
    | "LAHN_KHAFI"
    | "GHUNNAH"
    | "MAD"
    | "WAQF"
    | "IBTIDA"
    | "TAJWID"
    | "MAKHROJ"
    | "HARAKAT"
    | "LAFAZ"
    | "OTHER";
  juz: number;
  surahNumber: number;
  ayatNumber?: number; // Frontend uses ayatNumber
  ayahNumber?: number; // Backend uses ayahNumber
  description?: string;
  createdAt: string;
}

export interface MurojaahRecord {
  id: string;
  studentId: string;
  enrollmentId?: string;
  halaqohId?: string;
  recordedById: string;
  murojaahType: (typeof MUROJAAH_TYPES)[number]["value"];
  murojaahDate: string; // ISO Date
  date?: string; // Frontend might expect 'date'
  juzStart: number;
  juzEnd: number;
  startAyat?: number;
  endAyat?: number;
  surahName?: string;
  repetitions?: number;
  pagesReviewed: number;
  durationMinutes: number;
  qualityScore: number;
  mistakeCount: number;
  fluencyLevel: number;
  tajwidScore?: number;
  grade?: number;
  status: string; // PENDING, PASSED, etc.
  notes?: string;
  improvementAreas?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  student?: {
    id: string;
    nis: string;
    photoUrl?: string;
    user?: {
      name: string;
    };
  };
  teacher?: {
    user?: {
      name: string;
    };
  };
  halaqoh?: {
    id: string;
    name: string;
  };
  recordedBy?: {
    id: string;
    name: string;
  };
  mistakes?: MurojaahMistake[];
}

export interface MurojaahFilters {
  page?: number;
  limit?: number;
  search?: string;
  studentId?: string;
  enrollmentId?: string;
  halaqohId?: string;
  unitId?: string;
  classId?: string;
  murojaahType?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  juz?: number;
}

export interface CreateMurojaahData {
  studentId: string;
  enrollmentId?: string;
  halaqohId?: string;
  murojaahType: string;
  murojaahDate: string;
  juzStart: number;
  juzEnd: number;
  pagesReviewed: number;
  durationMinutes: number;
  qualityScore: number;
  fluencyLevel?: number;
  tajwidScore?: number;
  notes?: string;
  improvementAreas?: string;
  mistakes?: Array<{
    mistakeType: string;
    juz: number;
    surahNumber: number;
    ayahNumber?: number;
    description?: string;
  }>;
}

export type UpdateMurojaahData = Partial<
  Omit<CreateMurojaahData, "studentId" | "mistakes">
> & {
  status?: string;
  grade?: number;
};

export interface StudentMurojaahSummary {
  student: {
    id: string;
    nis: string;
    user: { name: string };
  };
  summary: {
    totalSessions: number;
    totalPages: number;
    totalMinutes: number;
    avgMinutesPerSession: number;
    totalMistakes: number;
    avgMistakesPerSession: number;
    avgQualityScore: number;
    avgFluencyLevel: number;
  };
  juzCoverage: Record<number, number>;
  mistakeBreakdown: Record<string, number>;
  recentRecords: Array<{
    id: string;
    date: string;
    type: string;
    juzRange: string;
    pages: number;
    quality: number;
    mistakes: number;
  }>;
}

// Query Keys
export const murojaahKeys = {
  all: ["murojaah"] as const,
  lists: () => [...murojaahKeys.all, "list"] as const,
  list: (filters: MurojaahFilters) =>
    [...murojaahKeys.lists(), filters] as const,
  details: () => [...murojaahKeys.all, "detail"] as const,
  detail: (id: string) => [...murojaahKeys.details(), id] as const,
  summary: (studentId: string) =>
    [...murojaahKeys.all, "summary", studentId] as const,
  schedule: (studentId: string) =>
    [...murojaahKeys.all, "schedule", studentId] as const,
  mistakes: (id: string) => [...murojaahKeys.detail(id), "mistakes"] as const,
};

// Hooks

export function useMurojaahRecords(filters: MurojaahFilters = {}) {
  return useQuery({
    queryKey: murojaahKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      });
      const response = await api.get(`/murojaah?${params.toString()}`);
      return response.data;
    },
  });
}

export function useMurojaah(id: string) {
  return useQuery({
    queryKey: murojaahKeys.detail(id),
    queryFn: async () => {
      const response = await api.get(`/murojaah/${id}`);
      // Adapt backend response to frontend expectations if needed
      const data = response.data.data as MurojaahRecord;
      if (!data.date && data.murojaahDate) data.date = data.murojaahDate;
      return data;
    },
    enabled: !!id,
  });
}

export function useMurojaahMistakes(murojaahId: string) {
  return useQuery({
    queryKey: murojaahKeys.mistakes(murojaahId),
    queryFn: async () => {
      // Backend includes mistakes in getMurojaahById usually
      const response = await api.get(`/murojaah/${murojaahId}`);
      const data = response.data.data as MurojaahRecord;
      return { data: data.mistakes || [] };
    },
    enabled: !!murojaahId,
  });
}

export function useCreateMurojaah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMurojaahData) => {
      const response = await api.post("/murojaah", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: murojaahKeys.all });
    },
  });
}

export function useUpdateMurojaah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMurojaahData;
    }) => {
      const response = await api.patch(`/murojaah/${id}`, data);
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: murojaahKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: murojaahKeys.lists() });
    },
  });
}

export function useReviewMurojaah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      grade,
    }: {
      id: string;
      status: string;
      grade?: number;
    }) => {
      const response = await api.patch(`/murojaah/${id}`, {
        status,
        grade,
      });
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: murojaahKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: murojaahKeys.lists() });
    },
  });
}

export function useDeleteMurojaah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/murojaah/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: murojaahKeys.all });
    },
  });
}

export function useDeleteMurojaahMistake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      murojaahId,
      mistakeId,
    }: {
      murojaahId: string;
      mistakeId: string;
    }) => {
      const response = await api.delete(`/murojaah/mistakes/${mistakeId}`);
      return response.data;
    },
    onSuccess: (_, { murojaahId }) => {
      queryClient.invalidateQueries({
        queryKey: murojaahKeys.detail(murojaahId),
      });
      queryClient.invalidateQueries({
        queryKey: murojaahKeys.mistakes(murojaahId),
      });
    },
  });
}

export function useStudentMurojaahSummary(
  studentId: string,
  filters?: { startDate?: string; endDate?: string; murojaahType?: string },
) {
  return useQuery({
    queryKey: [...murojaahKeys.summary(studentId), filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value) params.append(key, String(value));
        });
      }
      const response = await api.get(
        `/murojaah/students/${studentId}/summary?${params.toString()}`,
      );
      return response.data.data as StudentMurojaahSummary;
    },
    enabled: !!studentId,
  });
}

export function useMurojaahSchedule(studentId: string) {
  return useQuery({
    queryKey: murojaahKeys.schedule(studentId),
    queryFn: async () => {
      const response = await api.get(
        `/murojaah/students/${studentId}/schedule`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
  });
}
