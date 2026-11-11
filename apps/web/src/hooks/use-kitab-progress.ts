import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

// Types
export type KitabCategory =
  | "NAHWU" // Tata bahasa Arab
  | "SHOROF" // Morfologi Arab
  | "FIQIH" // Hukum Islam
  | "AQIDAH" // Tauhid/Akidah
  | "TAFSIR" // Tafsir Al-Qur'an
  | "HADITS" // Hadits
  | "AKHLAK" // Akhlak/Tasawuf
  | "SEJARAH" // Sirah/Tarikh
  | "TAJWID" // Ilmu Tajwid
  | "LUGHOH"; // Bahasa Arab

export type KitabLevel =
  | "MUBTADI" // Pemula
  | "MUTAWASSITH" // Menengah
  | "MUTAQADDIM"; // Lanjut

export type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export const KITAB_CATEGORIES: KitabCategory[] = [
  "NAHWU",
  "SHOROF",
  "FIQIH",
  "AQIDAH",
  "TAFSIR",
  "HADITS",
  "AKHLAK",
  "SEJARAH",
  "TAJWID",
  "LUGHOH",
];

export const KITAB_LEVELS: KitabLevel[] = [
  "MUBTADI",
  "MUTAWASSITH",
  "MUTAQADDIM",
];

export const KITAB_CATEGORY_LABELS: Record<KitabCategory, string> = {
  NAHWU: "Nahwu",
  SHOROF: "Shorof",
  FIQIH: "Fiqih",
  AQIDAH: "Aqidah/Tauhid",
  TAFSIR: "Tafsir",
  HADITS: "Hadits",
  AKHLAK: "Akhlak/Tasawuf",
  SEJARAH: "Sirah/Tarikh",
  TAJWID: "Tajwid",
  LUGHOH: "Bahasa Arab",
};

export const KITAB_CATEGORY_DESCRIPTIONS: Record<KitabCategory, string> = {
  NAHWU: "Tata bahasa Arab (sintaksis)",
  SHOROF: "Morfologi Arab (perubahan kata)",
  FIQIH: "Hukum Islam dan ibadah",
  AQIDAH: "Akidah dan tauhid",
  TAFSIR: "Tafsir dan penjelasan Al-Qur'an",
  HADITS: "Hadits Nabi SAW",
  AKHLAK: "Akhlak dan tasawuf",
  SEJARAH: "Sejarah Islam dan sirah nabawiyah",
  TAJWID: "Ilmu tajwid dan qira'at",
  LUGHOH: "Bahasa Arab dan balaghah",
};

export const KITAB_LEVEL_LABELS: Record<KitabLevel, string> = {
  MUBTADI: "Mubtadi' (Pemula)",
  MUTAWASSITH: "Mutawassith (Menengah)",
  MUTAQADDIM: "Mutaqaddim (Lanjut)",
};

export const KITAB_LEVEL_COLORS: Record<KitabLevel, string> = {
  MUBTADI: "bg-green-100 text-green-800",
  MUTAWASSITH: "bg-yellow-100 text-yellow-800",
  MUTAQADDIM: "bg-purple-100 text-purple-800",
};

export const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  NOT_STARTED: "Belum Dimulai",
  IN_PROGRESS: "Sedang Dipelajari",
  COMPLETED: "Selesai",
};

export const PROGRESS_STATUS_COLORS: Record<ProgressStatus, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
};

// Interfaces
export interface KitabKuning {
  id: string;
  title: string;
  author?: string;
  category: KitabCategory;
  level: KitabLevel;
  totalPages?: number;
  totalChapters?: number;
  description?: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    progresses: number;
  };
}

export interface KitabProgress {
  id: string;
  studentId: string;
  student?: {
    id: string;
    nis: string;
    name: string;
    classEnrollment?: {
      class: {
        id: string;
        name: string;
        level: number;
      };
    }[];
  };
  kitabId: string;
  kitab?: KitabKuning;
  currentPage?: number;
  currentChapter?: number;
  status: ProgressStatus;
  startedAt?: string;
  completedAt?: string;
  score?: number;
  notes?: string;
  teacherId?: string;
  teacher?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface KitabStatistics {
  totalKitab: number;
  byCategory: Record<KitabCategory, number>;
  byLevel: Record<KitabLevel, number>;
  totalStudentsLearning: number;
  completionRate: number;
  topKitab: Array<{
    kitab: KitabKuning;
    studentCount: number;
    completedCount: number;
  }>;
}

export interface StudentKitabReport {
  student: {
    id: string;
    nis: string;
    name: string;
  };
  progresses: KitabProgress[];
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    averageScore: number;
  };
}

// ===== Kitab CRUD Queries =====

export function useKitabList(params?: {
  unitId?: string;
  category?: KitabCategory;
  level?: KitabLevel;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["kitab-list", params],
    queryFn: async () => {
      const response = await api.get("/kitab-progress/kitab", { params });
      return response.data.data as {
        data: KitabKuning[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useKitabDetail(id: string) {
  return useQuery({
    queryKey: ["kitab-detail", id],
    queryFn: async () => {
      const response = await api.get(`/kitab-progress/kitab/${id}`);
      return response.data.data as KitabKuning;
    },
    enabled: !!id,
  });
}

export function useCreateKitab() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      title: string;
      author?: string;
      category: KitabCategory;
      level: KitabLevel;
      totalPages?: number;
      totalChapters?: number;
      description?: string;
      unitId?: string;
    }) => {
      const response = await api.post("/kitab-progress/kitab", data);
      return response.data.data as KitabKuning;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kitab-list"] });
      queryClient.invalidateQueries({ queryKey: ["kitab-statistics"] });
    },
  });
}

export function useUpdateKitab() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{
        title: string;
        author: string;
        category: KitabCategory;
        level: KitabLevel;
        totalPages: number;
        totalChapters: number;
        description: string;
        isActive: boolean;
      }>;
    }) => {
      const response = await api.put(`/kitab-progress/kitab/${id}`, data);
      return response.data.data as KitabKuning;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["kitab-list"] });
      queryClient.invalidateQueries({
        queryKey: ["kitab-detail", variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ["kitab-statistics"] });
    },
  });
}

export function useDeleteKitab() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kitab-progress/kitab/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kitab-list"] });
      queryClient.invalidateQueries({ queryKey: ["kitab-statistics"] });
    },
  });
}

// ===== Progress Queries =====

export function useKitabProgresses(params?: {
  kitabId?: string;
  studentId?: string;
  classId?: string;
  unitId?: string;
  status?: ProgressStatus;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["kitab-progresses", params],
    queryFn: async () => {
      const response = await api.get("/kitab-progress/progress", { params });
      return response.data.data as {
        data: KitabProgress[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useUpdateProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      kitabId: string;
      currentPage?: number;
      currentChapter?: number;
      status?: ProgressStatus;
      score?: number;
      notes?: string;
    }) => {
      const response = await api.post("/kitab-progress/progress/update", data);
      return response.data.data as KitabProgress;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["kitab-progresses"] });
      queryClient.invalidateQueries({
        queryKey: ["student-kitab-progress", variables.studentId],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "kitab-progress-detail",
          variables.kitabId,
          variables.studentId,
        ],
      });
      queryClient.invalidateQueries({ queryKey: ["kitab-statistics"] });
      queryClient.invalidateQueries({
        queryKey: ["student-kitab-report", variables.studentId],
      });
    },
  });
}

export function useMarkCompleted() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      kitabId: string;
      score?: number;
      notes?: string;
    }) => {
      const response = await api.post(
        "/kitab-progress/progress/complete",
        data,
      );
      return response.data.data as KitabProgress;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["kitab-progresses"] });
      queryClient.invalidateQueries({
        queryKey: ["student-kitab-progress", variables.studentId],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "kitab-progress-detail",
          variables.kitabId,
          variables.studentId,
        ],
      });
      queryClient.invalidateQueries({ queryKey: ["kitab-statistics"] });
      queryClient.invalidateQueries({
        queryKey: ["student-kitab-report", variables.studentId],
      });
    },
  });
}

// ===== Statistics & Reports =====

export function useKitabStatistics(params?: { unitId?: string }) {
  return useQuery({
    queryKey: ["kitab-statistics", params],
    queryFn: async () => {
      const response = await api.get("/kitab-progress/statistics", { params });
      return response.data.data as KitabStatistics;
    },
  });
}

export function useStudentKitabReport(studentId: string) {
  return useQuery({
    queryKey: ["student-kitab-report", studentId],
    queryFn: async () => {
      const response = await api.get(
        `/kitab-progress/report/student/${studentId}`,
      );
      return response.data.data as StudentKitabReport;
    },
    enabled: !!studentId,
  });
}

// ===== Helper Functions =====

export function getProgressPercentage(
  progress: KitabProgress,
  kitab: KitabKuning,
): number {
  if (progress.status === "COMPLETED") return 100;
  if (progress.status === "NOT_STARTED") return 0;

  if (kitab.totalPages && progress.currentPage) {
    return Math.round((progress.currentPage / kitab.totalPages) * 100);
  }

  if (kitab.totalChapters && progress.currentChapter) {
    return Math.round((progress.currentChapter / kitab.totalChapters) * 100);
  }

  return 0;
}

export function formatScore(score: number | undefined | null): string {
  if (score === undefined || score === null) return "-";
  return score.toFixed(0);
}

export function getCategoryIcon(category: KitabCategory): string {
  const icons: Record<KitabCategory, string> = {
    NAHWU: "📖",
    SHOROF: "📝",
    FIQIH: "⚖️",
    AQIDAH: "🕌",
    TAFSIR: "📚",
    HADITS: "📜",
    AKHLAK: "💫",
    SEJARAH: "🏛️",
    TAJWID: "🎵",
    LUGHOH: "🗣️",
  };
  return icons[category] || "📖";
}

export function getLevelBadgeColor(level: KitabLevel): string {
  return KITAB_LEVEL_COLORS[level] || "bg-gray-100 text-gray-800";
}

export function getStatusBadgeColor(status: ProgressStatus): string {
  return PROGRESS_STATUS_COLORS[status] || "bg-gray-100 text-gray-800";
}
