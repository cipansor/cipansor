import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  SIMAAN_GRADE_VALUES,
  SIMAAN_GRADE_LABELS,
  SIMAAN_STATUS_LABELS,
  SIMAAN_STATUS_VALUES,
  SIMAAN_TYPE_VALUES,
  SIMAAN_TYPE_LABELS,
  SIMAAN_TYPES,
  simaanStatusOf,
  type CreateSimaanInput,
  type SimaanGradeCode,
  type SimaanStatusCode,
  type SimaanTypeCode,
  type UpdateSimaanInput,
} from "@cipansor/shared";

// The simaan values and Indonesian labels live once in @cipansor/shared
// (`schemas/simaan.ts`), read by the API too (#1024); re-exported here so the
// existing `@/hooks/use-simaan` imports keep working. Only the grade badge
// colours are presentational and stay here.
export {
  SIMAAN_TYPE_VALUES,
  SIMAAN_TYPE_LABELS,
  SIMAAN_TYPES,
  SIMAAN_GRADE_VALUES,
  SIMAAN_GRADE_LABELS,
  SIMAAN_STATUS_VALUES,
  SIMAAN_STATUS_LABELS,
};
export type { SimaanTypeCode, SimaanGradeCode, SimaanStatusCode };

const GRADE_COLORS: Record<SimaanGradeCode, string> = {
  MUMTAZ: "bg-green-100 text-green-800",
  JAYYID_JIDDAN: "bg-blue-100 text-blue-800",
  JAYYID: "bg-yellow-100 text-yellow-800",
  MAQBUL: "bg-orange-100 text-orange-800",
  RASIB: "bg-red-100 text-red-800",
};

export const SIMAAN_GRADES = SIMAAN_GRADE_VALUES.map((value) => ({
  value,
  label: SIMAAN_GRADE_LABELS[value],
  color: GRADE_COLORS[value],
}));

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
  simaanType: SimaanTypeCode;
  examDate: string; // ISO Date
  sessionNumber: number;
  totalSessions: number;
  juzStart: number;
  juzEnd: number;
  overallScore?: number;
  tajwidScore?: number;
  fashohaScore?: number;
  tartilScore?: number;
  grade?: SimaanGradeCode;
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
  simaanType?: SimaanTypeCode;
  dateFrom?: string;
  dateTo?: string;
  passed?: boolean;
  status?: SimaanStatusCode;
}

/**
 * A simaan's state, read from the record rather than a column the model does
 * not have. It is scheduled until it is graded (`passed` or a score), then
 * complete — the same rule the detail page and the edit guard use, and the same
 * rule the API's list filter applies (`simaanStatusOf` in @cipansor/shared), so
 * a filtered list and the badge on its rows cannot disagree (#1125).
 */
export type SimaanStatus = SimaanStatusCode;

export function simaanExamStatus(
  exam: Pick<SimaanExam, "passed" | "overallScore">,
): SimaanStatus {
  return simaanStatusOf(exam);
}

/** The create payload — the shared contract the API validates against (#1024). */
export type CreateSimaanData = CreateSimaanInput;

/** The update payload — the shared contract the API validates against (#1024). */
export type UpdateSimaanData = UpdateSimaanInput;

export interface SubmitScoresData {
  overallScore: number;
  tajwidScore?: number;
  fashohaScore?: number;
  tartilScore?: number;
  grade: SimaanGradeCode;
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

export function useUpcomingSimaan(days: number = 7) {
  return useQuery({
    queryKey: [...simaanKeys.upcoming(), days],
    queryFn: async () => {
      const response = await api.get(`/simaan/upcoming?days=${days}`);
      return response.data.data as SimaanExam[];
    },
  });
}
