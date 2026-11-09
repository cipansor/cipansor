import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Enums
export const SIMAAN_TYPES = [
  { value: "BIN_NAZHR", label: "Bin Nazhr (Melihat Mushaf)" },
  { value: "BIL_GHAIB", label: "Bil Ghaib (Hafalan)" },
  { value: "TAHDIR", label: "Tahdir (Persiapan)" },
  { value: "TASMI", label: "Tasmi (Setoran)" },
  { value: "KHATAM", label: "Khatam 30 Juz" },
] as const;

export const SIMAAN_GRADES = [
  {
    value: "MUMTAZ",
    label: "Mumtaz (Istimewa)",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "JAYYID_JIDDAN",
    label: "Jayyid Jiddan (Sangat Baik)",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "JAYYID",
    label: "Jayyid (Baik)",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "MAQBUL",
    label: "Maqbul (Cukup)",
    color: "bg-orange-100 text-orange-800",
  },
  { value: "RASIB", label: "Rasib (Kurang)", color: "bg-red-100 text-red-800" },
] as const;

// Types matching Backend Schema
export interface SimaanExaminer {
  id: string;
  simaanId: string;
  examinerId: string;
  score?: number;
  notes?: string;
  createdAt: string;
  examiner?: {
    id: string;
    name?: string;
    user?: {
      name: string;
    };
  };
}

export interface SimaanExam {
  id: string;
  studentId: string;
  enrollmentId?: string;
  halaqohId?: string;
  simaanType: "JUZ_AMMA" | "ONE_JUZ" | "FIVE_JUZ" | "TEN_JUZ" | "FULL_QURAN";
  examDate: string; // ISO Date
  sessionNumber: number;
  totalSessions: number;
  juzStart: number;
  juzEnd: number;
  overallScore?: number;
  tajwidScore?: number;
  fashohaScore?: number;
  tartilScore?: number;
  grade?: "MUMTAZ" | "JAYYID_JIDDAN" | "JAYYID" | "MAQBUL" | "RASIB";
  status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  passed: boolean;
  notes?: string;
  recommendations?: string;
  createdAt: string;
  updatedAt: string;
  student?: {
    id: string;
    nis: string;
    photoUrl?: string | null;
    user?: {
      name: string;
    };
  };
  halaqoh?: {
    id: string;
    name: string;
  };
  examiners?: SimaanExaminer[];
}

export interface SimaanFilters {
  page?: number;
  limit?: number;
  search?: string;
  studentId?: string;
  enrollmentId?: string;
  halaqohId?: string;
  unitId?: string;
  simaanType?: string;
  dateFrom?: string;
  dateTo?: string;
  passed?: boolean;
  status?: string;
}

export interface CreateSimaanData {
  studentId: string;
  enrollmentId?: string;
  halaqohId?: string;
  simaanType: string;
  examDate: string;
  sessionNumber?: number;
  totalSessions?: number;
  juzStart: number;
  juzEnd: number;
  overallScore?: number;
  tajwidScore?: number;
  fashohaScore?: number;
  tartilScore?: number;
  grade?: string;
  passed?: boolean;
  notes?: string;
  recommendations?: string;
  examinerIds: string[];
}

export type UpdateSimaanData = Partial<
  Omit<CreateSimaanData, "studentId" | "examinerIds">
>;

export interface SubmitScoresData {
  overallScore: number;
  tajwidScore?: number;
  fashohaScore?: number;
  tartilScore?: number;
  grade: string;
  passed: boolean;
  notes?: string;
  recommendations?: string;
}

export interface SimaanResponse {
  data: SimaanExam[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary?: {
    scheduled: number;
    inProgress: number;
    completed: number;
    averageGrade: number;
  };
}

// Query Keys
export const simaanKeys = {
  all: ["simaan"] as const,
  lists: () => [...simaanKeys.all, "list"] as const,
  list: (filters: SimaanFilters) => [...simaanKeys.lists(), filters] as const,
  details: () => [...simaanKeys.all, "detail"] as const,
  detail: (id: string) => [...simaanKeys.details(), id] as const,
  upcoming: () => [...simaanKeys.all, "upcoming"] as const,
};

// Hooks

export function useSimaanExams(filters: SimaanFilters = {}) {
  return useQuery({
    queryKey: simaanKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      });
      const response = await api.get(`/simaan?${params.toString()}`);
      return response.data as SimaanResponse;
    },
  });
}

export function useSimaanExam(id: string) {
  return useQuery({
    queryKey: simaanKeys.detail(id),
    queryFn: async () => {
      const response = await api.get(`/simaan/${id}`);
      return response.data.data as SimaanExam;
    },
    enabled: !!id,
  });
}

export function useCreateSimaan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSimaanData) => {
      const response = await api.post("/simaan", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: simaanKeys.all });
    },
  });
}

export function useUpdateSimaan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateSimaanData;
    }) => {
      const response = await api.patch(`/simaan/${id}`, data);
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: simaanKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: simaanKeys.lists() });
    },
  });
}

export function useDeleteSimaan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/simaan/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: simaanKeys.all });
    },
  });
}

export function useSubmitSimaanScores() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: SubmitScoresData;
    }) => {
      // Scores go to `POST /simaan/scores`, which names the simaan in the body.
      const response = await api.post("/simaan/scores", {
        simaanId: id,
        ...data,
      });
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: simaanKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: simaanKeys.lists() });
    },
  });
}

export function useCompleteSimaan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { passed: boolean; notes?: string };
    }) => {
      // Completing a simaan is recording its result: `passed` and the notes
      // are fields of the record (`PATCH /simaan/:id`).
      const response = await api.patch(`/simaan/${id}`, data);
      return response.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: simaanKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: simaanKeys.lists() });
    },
  });
}

export function useUpcomingSimaan(days: number = 7) {
  return useQuery({
    queryKey: [...simaanKeys.upcoming(), days],
    queryFn: async () => {
      const response = await api.get(`/simaan/upcoming?days=${days}`);
      return response.data.data as SimaanExam[];
    },
  });
}
