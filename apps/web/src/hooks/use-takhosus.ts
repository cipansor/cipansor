import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// =====================================
// Types
// =====================================

export type TakhosusStatus = "ACTIVE" | "COMPLETED" | "DROPPED" | "SUSPENDED";
export type HalaqohDay =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface Halaqoh {
  id: string;
  unitId: string;
  teacherId: string;
  code: string;
  name: string;
  description?: string;
  level: number;
  maxStudents: number;
  scheduleDay: HalaqohDay[];
  scheduleTime?: string;
  location?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  unit?: { id: string; name: string };
  teacher?: { id: string; name: string; email?: string };
  studentCount?: number;
}

export interface TakhosusEnrollment {
  id: string;
  studentId: string;
  halaqohId: string;
  status: TakhosusStatus;
  targetJuz: number;
  completedJuz: number;
  currentJuz: number;
  enrolledAt: string;
  targetCompletionDate?: string;
  completedAt?: string;
  notes?: string;
  student?: {
    id: string;
    user: { id: string; name: string };
    unit?: { id: string; name: string };
  };
  halaqoh?: { id: string; name: string; code: string };
  sanadCount?: number;
  progressPercentage?: number;
}

export interface SanadRecord {
  id: string;
  enrollmentId: string;
  juz: number;
  surahStart?: number;
  surahEnd?: number;
  teacherId: string;
  grade: string;
  certifiedAt: string;
  notes?: string;
  createdAt: string;
  enrollment?: {
    id: string;
    studentId: string;
    student?: {
      id: string;
      name: string;
      nis: string;
      user?: { id: string; name: string };
    };
  };
  teacher?: { id: string; name: string; email?: string; nip?: string };
}

export interface StudentProgress {
  enrollment: {
    id: string;
    status: TakhosusStatus;
    enrolledAt: string;
    targetJuz: number;
    completedJuz: number;
    currentJuz: number;
    progressPercentage: number;
    targetCompletionDate?: string;
    completedAt?: string;
  };
  student: {
    id: string;
    user: { id: string; name: string };
  };
  halaqoh: {
    id: string;
    name: string;
    code: string;
    teacher?: { id: string; name: string };
  };
  juzProgress: Array<{
    juz: number;
    certified: boolean;
    certifiedAt?: string;
    grade?: string;
    teacherName?: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    surah: string;
    ayahStart: number;
    ayahEnd: number;
    juz?: number;
    score?: number;
    recordedAt: string;
  }>;
}

export interface HalaqohProgress {
  halaqoh: {
    id: string;
    name: string;
    code: string;
    level: number;
    scheduleDay: HalaqohDay[];
    scheduleTime?: string;
    location?: string;
  };
  teacher: { id: string; name: string };
  studentCount: number;
  averageProgress: number;
  students: Array<{
    id: string;
    name: string;
    enrolledAt: string;
    targetJuz: number;
    completedJuz: number;
    currentJuz: number;
    progressPercentage: number;
    sanadCount: number;
  }>;
}

// =====================================
// Constants
// =====================================

export const TAKHOSUS_STATUSES: {
  value: TakhosusStatus;
  label: string;
  color: string;
}[] = [
  { value: "ACTIVE", label: "Aktif", color: "bg-green-100 text-green-800" },
  { value: "COMPLETED", label: "Selesai", color: "bg-blue-100 text-blue-800" },
  { value: "DROPPED", label: "Mundur", color: "bg-red-100 text-red-800" },
  {
    value: "SUSPENDED",
    label: "Ditangguhkan",
    color: "bg-yellow-100 text-yellow-800",
  },
];

export const HALAQOH_DAYS: { value: HalaqohDay; label: string }[] = [
  { value: "MONDAY", label: "Senin" },
  { value: "TUESDAY", label: "Selasa" },
  { value: "WEDNESDAY", label: "Rabu" },
  { value: "THURSDAY", label: "Kamis" },
  { value: "FRIDAY", label: "Jumat" },
  { value: "SATURDAY", label: "Sabtu" },
  { value: "SUNDAY", label: "Ahad" },
];

export const SANAD_GRADES: { value: string; label: string; color: string }[] = [
  {
    value: "MUMTAZ",
    label: "Mumtaz (Sangat Baik)",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "JAYYID_JIDDAN",
    label: "Jayyid Jiddan (Baik Sekali)",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "JAYYID",
    label: "Jayyid (Baik)",
    color: "bg-cyan-100 text-cyan-800",
  },
  {
    value: "MAQBUL",
    label: "Maqbul (Cukup)",
    color: "bg-yellow-100 text-yellow-800",
  },
];

// =====================================
// Halaqoh Hooks
// =====================================

export interface HalaqohParams {
  page?: number;
  limit?: number;
  unitId?: string;
  teacherId?: string;
  isActive?: boolean;
  level?: number;
}

export function useHalaqohs(params: HalaqohParams = {}) {
  return useQuery({
    queryKey: ["takhosus", "halaqoh", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Halaqoh>>(
        "/takhosus/halaqoh",
        { params },
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useTakhosusDashboard(unitId?: string) {
  return useQuery({
    queryKey: ["takhosus", "dashboard", unitId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<any>>(
        "/takhosus/dashboard-stats",
        { params: { unitId } },
      );
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useHalaqoh(id: string) {
  return useQuery({
    queryKey: ["takhosus", "halaqoh", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Halaqoh>>(
        `/takhosus/halaqoh/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });
}

export function useHalaqohProgress(halaqohId: string) {
  return useQuery({
    queryKey: ["takhosus", "halaqoh", halaqohId, "progress"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HalaqohProgress>>(
        `/takhosus/halaqoh/${halaqohId}/progress`,
      );
      return response.data.data;
    },
    enabled: !!halaqohId,
    staleTime: 5 * 60 * 1000,
  });
}

export interface CreateHalaqohData {
  unitId: string;
  teacherId: string;
  code: string;
  name: string;
  description?: string;
  level?: number;
  maxStudents?: number;
  scheduleDay: HalaqohDay[];
  scheduleTime?: string;
  location?: string;
  isActive?: boolean;
}

export function useCreateHalaqoh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateHalaqohData) => {
      const response = await api.post<ApiResponse<Halaqoh>>(
        "/takhosus/halaqoh",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "halaqoh"] });
    },
  });
}

export function useUpdateHalaqoh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateHalaqohData>;
    }) => {
      const response = await api.put<ApiResponse<Halaqoh>>(
        `/takhosus/halaqoh/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "halaqoh"] });
      queryClient.invalidateQueries({
        queryKey: ["takhosus", "halaqoh", variables.id],
      });
    },
  });
}

export function useDeleteHalaqoh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/takhosus/halaqoh/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "halaqoh"] });
    },
  });
}

// =====================================
// Enrollment Hooks
// =====================================

export interface EnrollmentParams {
  page?: number;
  limit?: number;
  halaqohId?: string;
  status?: TakhosusStatus;
  studentId?: string;
}

export function useEnrollments(params: EnrollmentParams = {}) {
  return useQuery({
    queryKey: ["takhosus", "enrollment", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<TakhosusEnrollment>>(
        "/takhosus/enrollment",
        { params },
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnrollment(id: string) {
  return useQuery({
    queryKey: ["takhosus", "enrollment", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TakhosusEnrollment>>(
        `/takhosus/enrollment/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnrollmentByStudent(studentId: string) {
  return useQuery({
    queryKey: ["takhosus", "enrollment", "student", studentId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TakhosusEnrollment>>(
        `/takhosus/enrollment/student/${studentId}`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnrollmentStats(unitId?: string) {
  return useQuery({
    queryKey: ["takhosus", "enrollment", "stats", unitId],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          total: number;
          active: number;
          completed: number;
          dropped: number;
          averageProgress: number;
        }>
      >("/takhosus/enrollment/stats", { params: { unitId } });
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface CreateEnrollmentData {
  studentId: string;
  halaqohId: string;
  targetJuz?: number;
  currentJuz?: number;
  targetCompletionDate?: string;
  notes?: string;
}

export function useCreateEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateEnrollmentData) => {
      const response = await api.post<ApiResponse<TakhosusEnrollment>>(
        "/takhosus/enrollment",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "enrollment"] });
    },
  });
}

export function useUpdateEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateEnrollmentData & { status: TakhosusStatus }>;
    }) => {
      const response = await api.put<ApiResponse<TakhosusEnrollment>>(
        `/takhosus/enrollment/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "enrollment"] });
      queryClient.invalidateQueries({
        queryKey: ["takhosus", "enrollment", variables.id],
      });
    },
  });
}

export function useDeleteEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/takhosus/enrollment/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "enrollment"] });
    },
  });
}

// =====================================
// Sanad Hooks
// =====================================

export interface SanadParams {
  page?: number;
  limit?: number;
  enrollmentId?: string;
  teacherId?: string;
  studentId?: string;
  juz?: number;
}

export function useSanadRecords(params: SanadParams = {}) {
  return useQuery({
    queryKey: ["takhosus", "sanad", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<SanadRecord>>(
        "/takhosus/sanad",
        { params },
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface CreateSanadData {
  enrollmentId: string;
  juz: number;
  surahStart?: number;
  surahEnd?: number;
  teacherId: string;
  grade: string;
  certifiedAt?: string;
  notes?: string;
}

export function useCreateSanad() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSanadData) => {
      const response = await api.post<ApiResponse<SanadRecord>>(
        "/takhosus/sanad",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takhosus", "sanad"] });
      queryClient.invalidateQueries({ queryKey: ["takhosus", "enrollment"] });
      queryClient.invalidateQueries({ queryKey: ["takhosus", "progress"] });
    },
  });
}

// =====================================
// Progress Hooks
// =====================================

export function useStudentProgress(studentId: string) {
  return useQuery({
    queryKey: ["takhosus", "progress", "student", studentId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StudentProgress>>(
        `/takhosus/progress/student/${studentId}`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyProgress() {
  return useQuery({
    queryKey: ["takhosus", "progress", "me"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StudentProgress>>(
        "/takhosus/progress/me",
      );
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
