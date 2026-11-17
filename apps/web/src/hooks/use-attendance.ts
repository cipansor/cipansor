import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  Attendance,
  AttendanceStatus,
  AttendanceSummary,
  AttendanceCalendarResponse,
  CreateAttendanceInput,
  BulkAttendanceInput,
  UpdateAttendanceInput,
  SharedPaginatedResponse,
  ApiResponse,
  type AttendanceRecorderScope,
  type AttendanceFollowUpItem,
  type AttendancePatternItem,
  type AttendanceFollowUpChannel,
  type AttendanceFollowUpOutcome,
  type BulkAttendanceResult,
  type RecordFollowUpInput,
} from "@cipansor/shared";

// Re-export shared types for convenience
export { AttendanceStatus };
export type { AttendanceCalendarResponse };

// Re-export constants for UI usage
export const ATTENDANCE_STATUSES: {
  value: AttendanceStatus;
  label: string;
  color: string;
}[] = [
  {
    value: AttendanceStatus.PRESENT,
    label: "Hadir",
    color: "bg-green-100 text-green-800",
  },
  {
    value: AttendanceStatus.ABSENT,
    label: "Tidak Hadir",
    color: "bg-red-100 text-red-800",
  },
  {
    value: AttendanceStatus.LATE,
    label: "Terlambat",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: AttendanceStatus.SICK,
    label: "Sakit",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: AttendanceStatus.EXCUSED,
    label: "Izin",
    color: "bg-purple-100 text-purple-800",
  },
];

export interface AttendanceParams {
  page?: number;
  limit?: number;
  classId?: string;
  studentId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  status?: AttendanceStatus;
}

export function useAttendances(params: AttendanceParams = {}) {
  return useQuery({
    queryKey: ["attendances", params],
    queryFn: async () => {
      // Use SharedPaginatedResponse
      const response = await api.get<SharedPaginatedResponse<Attendance>>(
        "/attendance",
        { params },
      );
      return response.data;
    },
  });
}

export function useAttendance(id: string) {
  return useQuery({
    queryKey: ["attendances", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Attendance>>(
        `/attendance/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useClassAttendance(classId: string, date: string) {
  return useQuery({
    queryKey: ["attendances", "class", classId, date],
    queryFn: async () => {
      const response = await api.get<SharedPaginatedResponse<Attendance>>(
        "/attendance",
        {
          params: { classId, date, limit: 100 }, // specific for class view
        },
      );
      return response.data.data; // data is the array in SharedPaginatedResponse
    },
    enabled: !!classId && !!date,
  });
}

/**
 * The classes whose daily register the signed-in user takes: every class
 * (super admin), every class of their unit (its admin unit), or the ones they
 * are wali kelas of or teach in this academic year.
 */
export function useAttendanceRecorderScope() {
  return useQuery({
    queryKey: ["attendance", "me", "classes"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AttendanceRecorderScope>>(
        "/attendance/me/classes",
      );
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The Alpa marks the signed-in user follows up, within the last 7 days and
 * not yet explained: the santri mukim of the asrama they are musyrif of, and
 * the other pupils of their homeroom classes.
 */
export function useAttendanceFollowUps() {
  return useQuery({
    queryKey: ["attendance", "follow-ups"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AttendanceFollowUpItem[]>>(
        "/attendance/follow-ups",
      );
      return response.data.data;
    },
  });
}

/**
 * The santri the signed-in user is told about whose attendance shows a pattern
 * now (decided 2026-09-28): their homeroom pupils, the santri mukim they are
 * musyrif of, and — for a guru BK — their unit's.
 */
export function useAttendancePatterns() {
  return useQuery({
    queryKey: ["attendance", "patterns"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AttendancePatternItem[]>>(
        "/attendance/patterns",
      );
      return response.data.data;
    },
  });
}

export function useRecordFollowUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      attendanceId,
      data,
    }: {
      attendanceId: string;
      data: RecordFollowUpInput;
    }) => {
      const response = await api.post<ApiResponse<AttendanceFollowUpItem>>(
        `/attendance/${attendanceId}/follow-ups`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "follow-ups"] });
      // A reason changes the mark itself (Alpa → Sakit or Izin).
      queryClient.invalidateQueries({ queryKey: ["attendances"] });
    },
  });
}

export const FOLLOW_UP_CHANNEL_LABELS: Record<
  AttendanceFollowUpChannel,
  string
> = {
  PHONE: "Telepon",
  WHATSAPP: "WhatsApp",
  IN_PERSON: "Bertemu langsung",
  OTHER: "Lainnya",
};

/** What each outcome does to the mark, in the words the page shows. */
export const FOLLOW_UP_OUTCOME_LABELS: Record<
  AttendanceFollowUpOutcome,
  { label: string; effect: string }
> = {
  ILL: { label: "Sakit", effect: "Absensi diubah menjadi Sakit" },
  EXCUSED: { label: "Izin", effect: "Absensi diubah menjadi Izin" },
  NO_REASON: {
    label: "Tanpa keterangan",
    effect: "Tetap Alpa; tindak lanjut selesai",
  },
  UNREACHABLE: {
    label: "Wali tidak terhubungi",
    effect: "Tetap di daftar untuk dicoba lagi",
  },
};

/** "Kehadiran disimpan: 28 baru, 2 diperbarui" — what a save did. */
export function describeAttendanceSave({
  created,
  updated,
}: BulkAttendanceResult): string {
  const parts = [
    created > 0 ? `${created} baru` : null,
    updated > 0 ? `${updated} diperbarui` : null,
  ].filter(Boolean);
  return `Kehadiran disimpan: ${parts.join(", ") || "tidak ada perubahan"}`;
}

export function useCreateAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAttendanceInput) => {
      const response = await api.post<ApiResponse<Attendance>>(
        "/attendance",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendances"] });
    },
  });
}

export function useBulkCreateAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BulkAttendanceInput) => {
      const response = await api.post<ApiResponse<BulkAttendanceResult>>(
        "/attendance/bulk",
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["attendances"] });
      // Invalidate calendar if needed
      queryClient.invalidateQueries({
        queryKey: ["attendance-calendar", variables.classId],
      });
    },
  });
}

export function useUpdateAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateAttendanceInput;
    }) => {
      const response = await api.patch<ApiResponse<Attendance>>(
        `/attendance/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["attendances"] });
      queryClient.invalidateQueries({
        queryKey: ["attendances", variables.id],
      });
    },
  });
}

export function useDeleteAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/attendance/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendances"] });
    },
  });
}

export function useStudentAttendanceSummary(
  studentId: string,
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: ["attendance-summary", studentId, startDate, endDate],
    queryFn: async () => {
      const params = { startDate, endDate, studentId };
      const response = await api.get<ApiResponse<AttendanceSummary>>(
        "/attendance/summary",
        { params },
      );
      return response.data.data;
    },
    enabled: !!studentId && !!startDate && !!endDate,
  });
}

export function useClassAttendanceSummary(
  classId: string,
  startDate: string,
  endDate: string,
) {
  return useQuery({
    queryKey: ["attendance-summary", "class", classId, startDate, endDate],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AttendanceSummary>>(
        "/attendance/summary",
        {
          params: { classId, startDate, endDate },
        },
      );
      return response.data.data;
    },
    enabled: !!classId && !!startDate && !!endDate,
  });
}

export function useAttendanceCalendar(
  classId: string,
  year: number,
  month: number,
) {
  return useQuery({
    queryKey: ["attendance-calendar", classId, year, month],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AttendanceCalendarResponse>>(
        `/attendance/calendar/${classId}`,
        { params: { year, month } },
      );
      return response.data.data;
    },
    enabled: !!classId && !!year && month !== undefined,
  });
}
