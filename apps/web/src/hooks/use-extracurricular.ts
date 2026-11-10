import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";
import {
  AttendanceStatus,
  DayOfWeek,
  splitScheduleTime,
  type ExtracurricularCategory,
  type ExtracurricularDTO,
  type ExtracurricularStatus,
  type CreateExtracurricularInput,
  type PublicExtracurricular,
  type UpdateExtracurricularInput as UpdateExtracurricularBody,
} from "@cipansor/shared";

// Types
export type {
  ExtracurricularCategory,
  ExtracurricularStatus,
  CreateExtracurricularInput,
} from "@cipansor/shared";

/** An extracurricular as the API returns it (`@cipansor/shared`). */
export type Extracurricular = ExtracurricularDTO;

export type EnrollmentStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface ExtracurricularEnrollment {
  id: string;
  studentId: string;
  student?: {
    id: string;
    nis: string;
    name: string;
    currentClass?: {
      id: string;
      name: string;
    };
  };
  extracurricularId: string;
  extracurricular?: Extracurricular;
  status: EnrollmentStatus;
  enrolledAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedReason?: string;
  withdrawnAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtracurricularAchievement {
  id: string;
  extracurricularId: string;
  extracurricular?: Extracurricular;
  title: string;
  description?: string;
  level:
    | "SCHOOL"
    | "DISTRICT"
    | "REGIONAL"
    | "PROVINCIAL"
    | "NATIONAL"
    | "INTERNATIONAL";
  rank?: string; // e.g., "1st", "2nd", "Finalist"
  date: string;
  participants: Array<{
    studentId: string;
    student?: {
      id: string;
      name: string;
      nis: string;
    };
  }>;
  certificate?: string; // URL to certificate image
  photo?: string; // URL to achievement photo
  createdAt: string;
  updatedAt: string;
}

export interface ExtracurricularListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: ExtracurricularCategory;
  status?: ExtracurricularStatus;
  unitId?: string;
  academicYearId?: string;
}

export type UpdateExtracurricularInput = UpdateExtracurricularBody & {
  id: string;
};

export interface CreateAchievementInput {
  extracurricularId: string;
  title: string;
  description?: string;
  level: ExtracurricularAchievement["level"];
  rank?: string;
  date: string;
  participantIds: string[];
  certificate?: string;
  photo?: string;
}

// Category config — every value the API holds, labelled for the portal.
export const EXTRACURRICULAR_CATEGORIES: Array<{
  value: ExtracurricularCategory;
  label: string;
  icon: string;
  color: string;
}> = [
  {
    value: "SPORTS",
    label: "Olahraga",
    icon: "⚽",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "ARTS",
    label: "Seni & Budaya",
    icon: "🎨",
    color: "bg-purple-100 text-purple-800",
  },
  {
    value: "ACADEMIC",
    label: "Akademik",
    icon: "🔬",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "RELIGIOUS",
    label: "Keagamaan",
    icon: "📿",
    color: "bg-emerald-100 text-emerald-800",
  },
  {
    value: "SCOUTING",
    label: "Kepramukaan",
    icon: "⛺",
    color: "bg-orange-100 text-orange-800",
  },
  {
    value: "LEADERSHIP",
    label: "Kepemimpinan",
    icon: "🏆",
    color: "bg-red-100 text-red-800",
  },
  {
    value: "LANGUAGE",
    label: "Bahasa",
    icon: "📚",
    color: "bg-amber-100 text-amber-800",
  },
  {
    value: "TECHNOLOGY",
    label: "Teknologi",
    icon: "💻",
    color: "bg-cyan-100 text-cyan-800",
  },
  {
    value: "OTHER",
    label: "Lainnya",
    icon: "📋",
    color: "bg-gray-100 text-gray-800",
  },
];

export const EXTRACURRICULAR_STATUS_LABELS: Record<
  ExtracurricularStatus,
  string
> = {
  ACTIVE: "Aktif",
  INACTIVE: "Tidak Aktif",
  SUSPENDED: "Ditangguhkan",
};

export const ACHIEVEMENT_LEVELS: Array<{
  value: ExtracurricularAchievement["level"];
  label: string;
  color: string;
}> = [
  {
    value: "SCHOOL",
    label: "Tingkat Sekolah",
    color: "bg-gray-100 text-gray-800",
  },
  {
    value: "DISTRICT",
    label: "Tingkat Kecamatan",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "REGIONAL",
    label: "Tingkat Kabupaten/Kota",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "PROVINCIAL",
    label: "Tingkat Provinsi",
    color: "bg-amber-100 text-amber-800",
  },
  {
    value: "NATIONAL",
    label: "Tingkat Nasional",
    color: "bg-red-100 text-red-800",
  },
  {
    value: "INTERNATIONAL",
    label: "Tingkat Internasional",
    color: "bg-purple-100 text-purple-800",
  },
];

/** Days in the order a week is read here, Monday first. */
export const WEEKDAYS: Array<{ value: DayOfWeek; label: string }> = [
  { value: DayOfWeek.MONDAY, label: "Senin" },
  { value: DayOfWeek.TUESDAY, label: "Selasa" },
  { value: DayOfWeek.WEDNESDAY, label: "Rabu" },
  { value: DayOfWeek.THURSDAY, label: "Kamis" },
  { value: DayOfWeek.FRIDAY, label: "Jumat" },
  { value: DayOfWeek.SATURDAY, label: "Sabtu" },
  { value: DayOfWeek.SUNDAY, label: "Minggu" },
];

// Hooks
export function useExtracurriculars(params: ExtracurricularListParams = {}) {
  return useQuery({
    queryKey: ["extracurriculars", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Extracurricular>>(
        "/extracurricular",
        {
          params,
        },
      );
      return response.data;
    },
  });
}

/**
 * The public site's list on *Kegiatan* — no session. Each active
 * extracurricular once, with the units that run it.
 */
export function usePublicExtracurriculars() {
  return useQuery({
    queryKey: ["extracurriculars", "public"] as const,
    queryFn: async () => {
      const response = await api.get<ApiResponse<PublicExtracurricular[]>>(
        "/extracurricular/public",
      );
      return response.data.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useExtracurricular(id: string) {
  return useQuery({
    queryKey: ["extracurriculars", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Extracurricular>>(
        `/extracurricular/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateExtracurricular() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateExtracurricularInput) => {
      const response = await api.post<ApiResponse<Extracurricular>>(
        "/extracurricular",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extracurriculars"] });
    },
  });
}

export function useUpdateExtracurricular() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateExtracurricularInput) => {
      const response = await api.put<ApiResponse<Extracurricular>>(
        `/extracurricular/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["extracurriculars"] });
      queryClient.invalidateQueries({
        queryKey: ["extracurriculars", variables.id],
      });
    },
  });
}

export function useDeleteExtracurricular() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/extracurricular/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extracurriculars"] });
    },
  });
}

// Enrollment hooks
export function useExtracurricularEnrollments(
  extracurricularId: string,
  params: { status?: EnrollmentStatus } = {},
) {
  return useQuery({
    queryKey: ["extracurricular-enrollments", extracurricularId, params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ExtracurricularEnrollment[]>>(
        `/extracurricular/${extracurricularId}/enrollments`,
        { params },
      );
      return response.data.data;
    },
    enabled: !!extracurricularId,
  });
}

export function useApproveEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      enrollmentId,
      extracurricularId,
    }: {
      enrollmentId: string;
      extracurricularId: string;
    }) => {
      const response = await api.post<ApiResponse<ExtracurricularEnrollment>>(
        `/extracurricular/enrollments/${enrollmentId}/approve`,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["extracurricular-enrollments", variables.extracurricularId],
      });
    },
  });
}

export function useRejectEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      enrollmentId,
      extracurricularId,
      reason,
    }: {
      enrollmentId: string;
      extracurricularId: string;
      reason: string;
    }) => {
      const response = await api.post<ApiResponse<ExtracurricularEnrollment>>(
        `/extracurricular/enrollments/${enrollmentId}/reject`,
        { reason },
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["extracurricular-enrollments", variables.extracurricularId],
      });
    },
  });
}

// Achievement hooks
export function useExtracurricularAchievements(
  params: { extracurricularId?: string; level?: string } = {},
) {
  return useQuery({
    queryKey: ["extracurricular-achievements", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ExtracurricularAchievement[]>>(
        "/extracurricular/achievements",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useCreateAchievement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAchievementInput) => {
      const response = await api.post<ApiResponse<ExtracurricularAchievement>>(
        "/extracurricular/achievements",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["extracurricular-achievements"],
      });
    },
  });
}

// Helper functions
export function getCategoryConfig(category: ExtracurricularCategory) {
  return EXTRACURRICULAR_CATEGORIES.find((c) => c.value === category);
}

export function getLevelConfig(level: ExtracurricularAchievement["level"]) {
  return ACHIEVEMENT_LEVELS.find((l) => l.value === level);
}

/** "Selasa, Kamis · 15:30–17:00" — or null when no meeting time is set. */
export function formatSchedule(
  ekskul: Pick<Extracurricular, "scheduleDay" | "scheduleTime">,
): string | null {
  const days = WEEKDAYS.filter((d) => ekskul.scheduleDay?.includes(d.value))
    .map((d) => d.label)
    .join(", ");
  const time = splitScheduleTime(ekskul.scheduleTime);
  const hours = time ? `${time.start}–${time.end}` : ekskul.scheduleTime;
  return [days, hours].filter(Boolean).join(" · ") || null;
}
