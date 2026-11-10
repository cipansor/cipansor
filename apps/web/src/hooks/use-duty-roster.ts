"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// Types
export type DutyType =
  | "CLEANING_CLASSROOM"
  | "CLEANING_BATHROOM"
  | "CLEANING_YARD"
  | "CLEANING_MOSQUE"
  | "SECURITY"
  | "CANTEEN"
  | "LIBRARY"
  | "GARDEN"
  | "KITCHEN";

export type DutyStatus = "PENDING" | "COMPLETED" | "ABSENT" | "SUBSTITUTED";

export type DutyShift = "MORNING" | "AFTERNOON" | "EVENING";

export interface DutyAssignment {
  id: string;
  date: string;
  dutyType: DutyType;
  shift: DutyShift;
  location: string;
  startTime: string;
  endTime: string;
  status: DutyStatus;
  notes?: string;
  student: {
    id: string;
    nis: string;
    name: string;
    class: {
      id: string;
      name: string;
    };
    photo?: string;
  };
  supervisor?: {
    id: string;
    name: string;
  };
  substitute?: {
    id: string;
    nis: string;
    name: string;
  };
  completedAt?: string;
  completionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DutyRoster {
  id: string;
  date: string;
  dutyType: DutyType;
  shift: DutyShift;
  location: string;
  startTime: string;
  endTime: string;
  notes?: string;
  supervisor?: {
    id: string;
    name: string;
  };
  assignments: DutyAssignment[];
  createdAt: string;
}

export interface CreateDutyRosterInput {
  date: string;
  dutyType: DutyType;
  shift: DutyShift;
  location: string;
  startTime: string;
  endTime: string;
  notes?: string;
  supervisorId?: string;
  studentIds: string[];
}

export interface DutyStatistics {
  totalAssignments: number;
  completed: number;
  pending: number;
  absent: number;
  completionRate: number;
  byType: {
    type: DutyType;
    count: number;
    completed: number;
  }[];
  byDay: {
    date: string;
    count: number;
    completed: number;
  }[];
}

// Labels
export const DUTY_TYPE_LABELS: Record<DutyType, string> = {
  CLEANING_CLASSROOM: "Piket Kelas",
  CLEANING_BATHROOM: "Piket Kamar Mandi",
  CLEANING_YARD: "Piket Halaman",
  CLEANING_MOSQUE: "Piket Masjid",
  SECURITY: "Piket Keamanan",
  CANTEEN: "Piket Kantin",
  LIBRARY: "Piket Perpustakaan",
  GARDEN: "Piket Taman",
  KITCHEN: "Piket Dapur",
};

export const DUTY_SHIFT_LABELS: Record<DutyShift, string> = {
  MORNING: "Pagi",
  AFTERNOON: "Siang",
  EVENING: "Sore/Malam",
};

export const DUTY_STATUS_LABELS: Record<DutyStatus, string> = {
  PENDING: "Menunggu",
  COMPLETED: "Selesai",
  ABSENT: "Tidak Hadir",
  SUBSTITUTED: "Digantikan",
};

// Get duty roster list
export function useDutyRosters(params?: {
  date?: string;
  startDate?: string;
  endDate?: string;
  dutyType?: DutyType;
  shift?: DutyShift;
  classId?: string;
  page?: number;
  limit?: number;
}) {
  const queryParams = new URLSearchParams();
  if (params?.date) queryParams.append("date", params.date);
  if (params?.startDate) queryParams.append("startDate", params.startDate);
  if (params?.endDate) queryParams.append("endDate", params.endDate);
  if (params?.dutyType) queryParams.append("dutyType", params.dutyType);
  if (params?.shift) queryParams.append("shift", params.shift);
  if (params?.classId) queryParams.append("classId", params.classId);
  if (params?.page) queryParams.append("page", params.page.toString());
  if (params?.limit) queryParams.append("limit", params.limit.toString());

  return useQuery<PaginatedResponse<DutyRoster>>({
    queryKey: ["duty-rosters", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<DutyRoster>>(
        `/duty-roster?${queryParams.toString()}`,
      );
      return response.data;
    },
  });
}

// Get duty roster detail
export function useDutyRoster(id?: string) {
  return useQuery<DutyRoster>({
    queryKey: ["duty-rosters", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DutyRoster>>(
        `/duty-roster/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

// Get duty statistics
export function useDutyStatistics(params?: {
  startDate?: string;
  endDate?: string;
  classId?: string;
  studentId?: string;
}) {
  const queryParams = new URLSearchParams();
  if (params?.startDate) queryParams.append("startDate", params.startDate);
  if (params?.endDate) queryParams.append("endDate", params.endDate);
  if (params?.classId) queryParams.append("classId", params.classId);
  if (params?.studentId) queryParams.append("studentId", params.studentId);

  return useQuery<DutyStatistics>({
    queryKey: ["duty-statistics", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DutyStatistics>>(
        `/duty-roster/statistics?${queryParams.toString()}`,
      );
      return response.data.data;
    },
  });
}

// Create duty roster
export function useCreateDutyRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDutyRosterInput) => {
      const response = await api.post<ApiResponse<DutyRoster>>(
        "/duty-roster",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty-rosters"] });
      queryClient.invalidateQueries({ queryKey: ["duty-statistics"] });
    },
  });
}

// Update duty roster
export function useUpdateDutyRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateDutyRosterInput>;
    }) => {
      const response = await api.put<ApiResponse<DutyRoster>>(
        `/duty-roster/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["duty-rosters"] });
      queryClient.invalidateQueries({
        queryKey: ["duty-rosters", variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ["duty-statistics"] });
    },
  });
}

// Delete duty roster
export function useDeleteDutyRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete<ApiResponse<void>>(
        `/duty-roster/${id}`,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty-rosters"] });
      queryClient.invalidateQueries({ queryKey: ["duty-statistics"] });
    },
  });
}

// Update duty assignment status
export function useUpdateDutyStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      assignmentId,
      status,
      notes,
    }: {
      assignmentId: string;
      status: DutyStatus;
      notes?: string;
    }) => {
      const response = await api.patch<ApiResponse<DutyAssignment>>(
        `/duty-assignments/${assignmentId}/status`,
        {
          status,
          notes,
        },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty-rosters"] });
      queryClient.invalidateQueries({ queryKey: ["duty-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["duty-statistics"] });
    },
  });
}
