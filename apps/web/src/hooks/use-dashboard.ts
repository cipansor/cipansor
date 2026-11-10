import { useQuery, useMutation } from "@tanstack/react-query";
import api from "@/lib/api";
import type {
  ApiResponse,
  DashboardStats,
  AttendanceStats,
  FinanceStats,
  TahfidzStats,
  ViolationRewardStats,
  DashboardMetricsResponse,
} from "@cipansor/shared";

type Period = "week" | "month" | "year";

/** `GET /dashboard/metrics`: the contract lives in @cipansor/shared. */
export type DashboardMetricsData = DashboardMetricsResponse;

export function useDashboardStats(params?: { unitId?: string }) {
  return useQuery({
    queryKey: ["dashboard", "stats", params?.unitId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DashboardStats>>(
        "/dashboard/stats",
        { params },
      );
      return response.data.data as DashboardStats;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDashboardMetrics(unitId?: string) {
  return useQuery({
    queryKey: ["dashboard", "metrics", unitId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DashboardMetricsData>>(
        "/dashboard/metrics",
        { params: { unitId } },
      );
      return response.data.data as DashboardMetricsData;
    },
    refetchInterval: 60000,
  });
}

export function useAttendanceStats(params?: {
  startDate?: string;
  endDate?: string;
  unitId?: string;
}) {
  return useQuery({
    queryKey: ["dashboard", "attendance", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AttendanceStats[]>>(
        "/dashboard/attendance",
        { params },
      );
      return response.data.data as AttendanceStats[];
    },
  });
}

export function useFinanceStats(params?: { period?: Period; unitId?: string }) {
  return useQuery({
    queryKey: ["dashboard", "finance", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<FinanceStats>>(
        "/dashboard/finance",
        { params },
      );
      return response.data.data as FinanceStats;
    },
  });
}

export function useTahfidzStats(params?: { period?: Period; unitId?: string }) {
  return useQuery({
    queryKey: ["dashboard", "tahfidz", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TahfidzStats>>(
        "/dashboard/tahfidz",
        { params },
      );
      return response.data.data as TahfidzStats;
    },
  });
}

export function useViolationRewardStats(params?: {
  period?: Period;
  unitId?: string;
}) {
  return useQuery({
    queryKey: ["dashboard", "violation-reward", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ViolationRewardStats>>(
        "/dashboard/violation-reward",
        { params },
      );
      return response.data.data as ViolationRewardStats;
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (data: {
      currentPassword: string;
      newPassword: string;
    }) => {
      // The form shows the API's reason on the field it concerns; a toast
      // repeating it would be the same message twice.
      const response = await api.put("/auth/password", data, {
        skipErrorToast: true,
      });
      return response.data;
    },
  });
}
