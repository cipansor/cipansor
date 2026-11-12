import { useQuery } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { ParentChild, ParentDashboardData } from "@cipansor/shared";

// ==================== TYPES ====================

/**
 * `GET /parent/children` and `GET /parent/dashboard` shapes live in
 * `@cipansor/shared` (decided K13, issue #869) so the API and the wali's
 * screens read the same contract. Re-exported here so the many parent pages
 * that import `ParentChild` from this hook keep working.
 */
export type { ParentChild, ParentDashboardData };

// ==================== HOOKS: CHILDREN ====================

/**
 * Get list of children linked to parent
 */
export function useParentChildren() {
  // The signed-in wali's id is part of the key: the answers are per account,
  // and logout does not drop every query. Without it, a wali who signs in on a
  // shared device after another sees the previous wali's children from cache
  // (CWE-524, #869 review).
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["parent", "children", user?.id],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<ParentChild[]>>("/parent/children");
      return response.data.data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ==================== HOOKS: DASHBOARD ====================

/**
 * Get parent dashboard with all children summaries
 */
export function useParentDashboard() {
  // Per-account key, same reason as `useParentChildren` (CWE-524, #869 review):
  // a shared device must not serve one wali the previous wali's dashboard.
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["parent", "dashboard", user?.id],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<ParentDashboardData>>("/parent/dashboard");
      return response.data.data;
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 minutes
  });
}

// ==================== HOOKS: ATTENDANCE ====================

/**
 * Get child attendance history
 */
export function useChildAttendance(
  studentId: string,
  params?: {
    month?: number;
    year?: number;
    academicYearId?: string;
  },
) {
  return useQuery({
    queryKey: ["parent", "children", studentId, "attendance", params],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          summary: {
            present: number;
            absent: number;
            sick: number;
            permitted: number;
            percentage: number;
          };
          records: Array<{
            date: string;
            status: "PRESENT" | "ABSENT" | "SICK" | "PERMITTED";
            checkInTime?: string;
            notes?: string;
          }>;
        }>
      >(`/parent/children/${studentId}/attendance`, { params });
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

// ==================== HOOKS: ACADEMIC ====================

/**
 * Get child grades/scores
 */
export function useChildGrades(
  studentId: string,
  params?: {
    academicYearId?: string;
    semester?: "GANJIL" | "GENAP";
    subjectId?: string;
  },
) {
  return useQuery({
    queryKey: ["parent", "children", studentId, "grades", params],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          subjects: Array<{
            subjectId: string;
            subjectName: string;
            scores: Array<{
              type: string;
              score: number;
              date: string;
            }>;
            average: number;
          }>;
          overallAverage: number;
          ranking?: number;
        }>
      >(`/parent/children/${studentId}/grades`, { params });
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

/**
 * Get child report cards
 */
export function useChildReportCards(studentId: string) {
  return useQuery({
    queryKey: ["parent", "children", studentId, "report-cards"],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<
          Array<{
            id: string;
            academicYearId: string;
            academicYearName: string;
            semester: "GANJIL" | "GENAP";
            status: "DRAFT" | "FINALIZED" | "PRINTED";
            downloadUrl?: string;
          }>
        >
      >(`/parent/children/${studentId}/report-cards`);
      return response.data.data;
    },
    enabled: !!studentId,
  });
}
