"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import {
  CROSS_UNIT_ROLE_CODES,
  PERMIT_DECIDER_ROLE_CODES,
  PERMIT_STAFF_ROLE_CODES,
  STUDENT_STATUS,
  type PageResponse,
  type Permit,
  type PermitSummary,
} from "@cipansor/shared";
import { getActiveRoleCode, type RbacUser } from "@/lib/rbac";
import { PERMIT_TYPE_LABELS } from "./use-permits";

// ============================================
// TYPES
// ============================================

export interface StaffDashboardStats {
  /**
   * Pending permits: for a role that decides some (wali kelas, musyrif,
   * kepala), the ones that are the caller's own to decide; for other permit
   * staff, all pending in their scope. Null for a role that has no part in
   * permits (bendahara, pustakawan…).
   */
  pendingPermits: number | null;
  /** `pendingPermits` counts the caller's own decisions. */
  permitsAwaitMe: boolean;
  sickStudents: number;
  todayViolations: number;
  todayRewards: number;
  activeStudents: number;
  attendanceToday: {
    present: number;
    absent: number;
    sick: number;
    excused: number;
    total: number;
  };
}

export interface PendingTask {
  id: string;
  type: "permit" | "health" | "violation" | "reward";
  title: string;
  description: string;
  studentName: string;
  status: string;
  date: string;
  priority: "high" | "medium" | "low";
}

export interface RecentActivity {
  id: string;
  type: "permit" | "health" | "violation" | "reward" | "attendance";
  action: string;
  subject: string;
  actor?: string;
  time: string;
  rawTime: number;
}

export interface HealthAlert {
  id: string;
  studentName: string;
  healthType: string;
  severity: string;
  notes: string;
  date: string;
}

// ============================================
// CONSTANTS
// ============================================

export const VIOLATION_CATEGORY_COLORS: Record<string, string> = {
  LIGHT: "bg-yellow-100 text-yellow-800",
  MEDIUM: "bg-orange-100 text-orange-800",
  HEAVY: "bg-red-100 text-red-800",
};

/**
 * The unit the dashboard's counts are narrowed to. The pesantren's staff and
 * the cross-unit services serve every unit's santri — the Pesantren unit holds
 * none of them — so their counts are not pinned to their home unit; the API's
 * `studentScope` then gives them every unit.
 */
export function dashboardUnitId(
  user: (RbacUser & { unitId?: string | null }) | null | undefined,
): string | undefined {
  if (CROSS_UNIT_ROLE_CODES.includes(getActiveRoleCode(user) ?? "")) {
    return undefined;
  }
  return user?.unitId ?? undefined;
}

/**
 * The shared staff dashboard serves nine functions; only some of them work
 * with permits (`PERMIT_STAFF_ROLE_CODES`, the list the API guards with).
 * The rest are not asked, rather than asked and refused.
 */
function readsPermits(user: Parameters<typeof getActiveRoleCode>[0]) {
  return PERMIT_STAFF_ROLE_CODES.includes(getActiveRoleCode(user) ?? "");
}

/** Could be a santri's musyrif, wali kelas or unit head. */
function decidesPermits(user: Parameters<typeof getActiveRoleCode>[0]) {
  return PERMIT_DECIDER_ROLE_CODES.includes(getActiveRoleCode(user) ?? "");
}

// ============================================
// DASHBOARD STATS HOOK
// ============================================

export function useStaffDashboardStats() {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["staff-dashboard-stats", user?.unitId],
    queryFn: async (): Promise<StaffDashboardStats> => {
      const today = new Date().toISOString().split("T")[0];

      // Fetch multiple stats in parallel
      const [
        pendingPermits,
        healthRes,
        violationsRes,
        rewardsRes,
        attendanceRes,
        studentsRes,
      ] = await Promise.all([
        // Pending permits, counted by the API over the caller's scope.
        readsPermits(user)
          ? api
              .get<ApiResponse<PermitSummary>>("/permits/summary", {
                skipErrorToast: true,
              })
              .then((res) =>
                decidesPermits(user)
                  ? res.data.data.awaitingMe
                  : res.data.data.pending,
              )
              .catch(() => null)
          : Promise.resolve(null),

        // Active health issues (students currently sick)
        api
          .get<PaginatedResponse<unknown>>("/health", {
            params: {
              status: "ACTIVE",
              unitId: dashboardUnitId(user),
              limit: 1,
            },
            skipErrorToast: true,
          })
          .catch(() => ({ data: { meta: { pagination: { total: 0 } } } })),

        // Today's violations
        api
          .get<PaginatedResponse<unknown>>("/violations", {
            params: { date: today, unitId: dashboardUnitId(user), limit: 1 },
            skipErrorToast: true,
          })
          .catch(() => ({ data: { meta: { pagination: { total: 0 } } } })),

        // Today's rewards
        api
          .get<PaginatedResponse<unknown>>("/rewards", {
            params: { date: today, unitId: dashboardUnitId(user), limit: 1 },
            skipErrorToast: true,
          })
          .catch(() => ({ data: { meta: { pagination: { total: 0 } } } })),

        // Today's attendance summary
        api
          .get<
            ApiResponse<{
              present: number;
              absent: number;
              sick: number;
              excused: number;
              total: number;
            }>
          >("/attendance/summary", {
            params: { date: today, unitId: dashboardUnitId(user) },
            skipErrorToast: true,
          })
          .catch(() => ({
            data: {
              data: { present: 0, absent: 0, sick: 0, excused: 0, total: 0 },
            },
          })),

        // Active students count
        api
          .get<PaginatedResponse<unknown>>("/students", {
            params: {
              status: STUDENT_STATUS.ACTIVE,
              unitId: dashboardUnitId(user),
              limit: 1,
            },
            skipErrorToast: true,
          })
          .catch(() => ({ data: { meta: { pagination: { total: 0 } } } })),
      ]);

      return {
        pendingPermits,
        permitsAwaitMe: decidesPermits(user),
        sickStudents: (healthRes.data as any)?.meta?.pagination?.total || 0,
        todayViolations:
          (violationsRes.data as any)?.meta?.pagination?.total || 0,
        todayRewards: (rewardsRes.data as any)?.meta?.pagination?.total || 0,
        activeStudents: (studentsRes.data as any)?.meta?.pagination?.total || 0,
        attendanceToday: (attendanceRes.data as any)?.data || {
          present: 0,
          absent: 0,
          sick: 0,
          excused: 0,
          total: 0,
        },
      };
    },
    enabled: !!user?.unitId,
    staleTime: 2 * 60 * 1000, // 2 minutes - staff dashboard needs more frequent updates
    refetchOnWindowFocus: true,
  });
}

// ============================================
// PENDING TASKS HOOK
// ============================================

export function useStaffPendingTasks(limit: number = 10) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["staff-pending-tasks", user?.unitId, limit],
    queryFn: async (): Promise<PendingTask[]> => {
      const tasks: PendingTask[] = [];

      // Pending permits
      const pendingPermits = readsPermits(user)
        ? await api
            .get<PageResponse<Permit>>("/permits", {
              // A decider's task list is their own decisions, oldest first.
              params: decidesPermits(user)
                ? { awaitingMe: "true", limit: 5 }
                : { status: "PENDING", limit: 5 },
              skipErrorToast: true,
            })
            .then((res) => res.data.data)
            .catch(() => [] as Permit[])
        : [];

      pendingPermits.forEach((permit) => {
        tasks.push({
          id: permit.id,
          type: "permit",
          title: `Izin ${PERMIT_TYPE_LABELS[permit.type].toLowerCase()}`,
          description: permit.reason,
          studentName: permit.student.user.name,
          status: permit.status,
          date: permit.startDate,
          priority: permit.type === "SAKIT" ? "high" : "medium",
        });
      });

      // Fetch active health alerts
      const healthRes = await api
        .get<
          PaginatedResponse<{
            id: string;
            student?: { name: string };
            recordType: string;
            complaint: string;
            status: string;
            createdAt: string;
          }>
        >("/health", {
          params: { status: "ACTIVE", unitId: dashboardUnitId(user), limit: 5 },
          skipErrorToast: true,
        })
        .catch(() => ({ data: { data: [] } }));

      (healthRes.data?.data || []).forEach((health) => {
        tasks.push({
          id: health.id,
          type: "health",
          title: `Kesehatan - ${health.recordType}`,
          description: health.complaint,
          studentName: health.student?.name || "Unknown",
          status: health.status,
          date: health.createdAt,
          priority: health.recordType === "EMERGENCY" ? "high" : "medium",
        });
      });

      // Sort by priority and date
      return tasks
        .sort((a, b) => {
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          }
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })
        .slice(0, limit);
    },
    enabled: !!user?.unitId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// ============================================
// RECENT ACTIVITY HOOK
// ============================================

export function useStaffRecentActivity(limit: number = 10) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["staff-recent-activity", user?.unitId, limit],
    queryFn: async (): Promise<RecentActivity[]> => {
      const activities: RecentActivity[] = [];

      // Recent permits, any status
      const recentPermits = readsPermits(user)
        ? await api
            .get<PageResponse<Permit>>("/permits", {
              params: { limit: 5 },
              skipErrorToast: true,
            })
            .then((res) => res.data.data)
            .catch(() => [] as Permit[])
        : [];

      const PERMIT_ACTIONS: Record<Permit["status"], string> = {
        PENDING: "Mengajukan izin",
        APPROVED: "Izin disetujui",
        REJECTED: "Izin ditolak",
        COMPLETED: "Kembali dari izin",
        CANCELLED: "Izin dibatalkan",
      };
      recentPermits.forEach((permit) => {
        activities.push({
          id: `permit-${permit.id}`,
          type: "permit",
          action:
            permit.status === "APPROVED" && permit.departedAt
              ? "Keluar dengan izin"
              : PERMIT_ACTIONS[permit.status],
          subject: permit.student.user.name,
          actor: permit.approvedBy?.name,
          time: permit.updatedAt,
          rawTime: new Date(permit.updatedAt).getTime(),
        });
      });

      // Fetch recent violations
      const violationsRes = await api
        .get<
          PaginatedResponse<{
            id: string;
            student?: { name: string };
            violationType?: { name: string };
            date: string;
            reporter?: { name: string };
          }>
        >("/violations", {
          params: { unitId: dashboardUnitId(user), limit: 5 },
          skipErrorToast: true,
        })
        .catch(() => ({ data: { data: [] } }));

      (violationsRes.data?.data || []).forEach((violation) => {
        activities.push({
          id: `violation-${violation.id}`,
          type: "violation",
          action: "Mencatat pelanggaran",
          subject: violation.student?.name || "Unknown",
          actor: violation.reporter?.name,
          time: violation.date,
          rawTime: new Date(violation.date).getTime(),
        });
      });

      // Fetch recent rewards
      const rewardsRes = await api
        .get<
          PaginatedResponse<{
            id: string;
            student?: { name: string };
            rewardType?: { name: string };
            date: string;
            givenBy?: { name: string };
          }>
        >("/rewards", {
          params: { unitId: dashboardUnitId(user), limit: 5 },
          skipErrorToast: true,
        })
        .catch(() => ({ data: { data: [] } }));

      (rewardsRes.data?.data || []).forEach((reward) => {
        activities.push({
          id: `reward-${reward.id}`,
          type: "reward",
          action: "Memberikan penghargaan",
          subject: reward.student?.name || "Unknown",
          actor: reward.givenBy?.name,
          time: reward.date,
          rawTime: new Date(reward.date).getTime(),
        });
      });

      // Sort by time and limit
      return activities.sort((a, b) => b.rawTime - a.rawTime).slice(0, limit);
    },
    enabled: !!user?.unitId,
    staleTime: 1 * 60 * 1000,
  });
}

// ============================================
// QUICK ACTIONS - HEALTH RECORD
// ============================================

export function useQuickHealthRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      recordType: "CHECKUP" | "ILLNESS" | "INJURY" | "MEDICATION";
      complaint: string;
      diagnosis?: string;
      treatment?: string;
      notes?: string;
    }) => {
      const response = await api.post<ApiResponse<unknown>>("/health", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["staff-pending-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

// ============================================
// COMBINED DASHBOARD HOOK
// ============================================

export function useStaffDashboard() {
  const stats = useStaffDashboardStats();
  const pendingTasks = useStaffPendingTasks(10);
  const recentActivity = useStaffRecentActivity(10);

  return {
    stats: stats.data,
    pendingTasks: pendingTasks.data,
    recentActivity: recentActivity.data,
    isLoading:
      stats.isLoading || pendingTasks.isLoading || recentActivity.isLoading,
    isError: stats.isError || pendingTasks.isError || recentActivity.isError,
    refetch: () => {
      stats.refetch();
      pendingTasks.refetch();
      recentActivity.refetch();
    },
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getViolationCategoryColor(category: string): string {
  return VIOLATION_CATEGORY_COLORS[category] || "bg-gray-100 text-gray-800";
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Baru saja";
  if (diffMins < 60) return `${diffMins} menit lalu`;
  if (diffHours < 24) return `${diffHours} jam lalu`;
  if (diffDays === 1) return "Kemarin";
  if (diffDays < 7) return `${diffDays} hari lalu`;

  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function getPriorityColor(priority: "high" | "medium" | "low"): string {
  switch (priority) {
    case "high":
      return "bg-red-100 text-red-800 border-red-200";
    case "medium":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "low":
      return "bg-green-100 text-green-800 border-green-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

export function getActivityIcon(type: string): string {
  switch (type) {
    case "permit":
      return "📋";
    case "health":
      return "🏥";
    case "violation":
      return "⚠️";
    case "reward":
      return "🏆";
    case "attendance":
      return "✅";
    default:
      return "📌";
  }
}
