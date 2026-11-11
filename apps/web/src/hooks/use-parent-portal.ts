import { useQuery } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";

// ==================== TYPES ====================

/**
 * A child as `GET /parent/children` actually returns it.
 *
 * This used to declare a nested `student` object with a `class` and a
 * `birthDate`. The API returns none of that: it flattens the StudentParent
 * join and — importantly — sets `id` to the *student's* id, because every
 * downstream route is `/parent/children/{studentId}/…`. Nesting it would break
 * all of them.
 *
 * The mismatch was invisible for as long as the demo parents had no children:
 * an empty array meant `children.find(c => c.student.id === …)` never ran. The
 * moment a parent had one, the portal died with "Cannot read properties of
 * undefined (reading 'id')" and rendered the error boundary instead of a
 * sidebar. Keep this type honest against `parent.service.ts#getChildren`.
 */
export interface ParentChild {
  /** The student's id — not the parent-child link id. */
  id: string;
  nis: string;
  nisn?: string | null;
  name: string;
  gender: "MALE" | "FEMALE";
  birthPlace?: string | null;
  birthDate?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  status: string;
  relation: string;
  isPrimary: boolean;
  unitId: string;
  unit?: {
    id: string;
    name: string;
    type: string;
  } | null;
  currentClass?: {
    id: string;
    name: string;
    level: string;
    academicYear?: { id: string; name: string; isActive: boolean };
    /** `user.id` is the messaging recipient — the Teacher id is not a User id. */
    homeroomTeacher?: { id: string; user: { id: string; name: string } } | null;
  } | null;
}

export interface ChildSummary {
  studentId: string;
  studentName: string;
  className?: string;
  photoUrl?: string;

  // Attendance
  attendance: {
    present: number;
    absent: number;
    sick: number;
    permitted: number;
    percentage: number;
  };

  // Academic
  academic: {
    averageScore?: number;
    pendingAssignments?: number;
    recentGrades?: Array<{
      subject: string;
      score: number;
      date: string;
    }>;
  };

  // Violations & Rewards
  behavior: {
    violationCount: number;
    rewardCount: number;
    recentViolations?: Array<{
      type: string;
      date: string;
      status: string;
    }>;
  };

  // Finance
  finance: {
    pendingPayments: number;
    upcomingDue?: Array<{
      name: string;
      amount: number;
      dueDate: string;
    }>;
    walletBalance?: number;
  };

  // Health (PAUD/SD)
  health?: {
    lastCheckup?: string;
    height?: number;
    weight?: number;
  };

  // Tahfidz (if applicable)
  tahfidz?: {
    currentJuz?: number;
    memorizedPages?: number;
    lastMurojaah?: string;
  };
}

export interface ParentDashboardData {
  children: ChildSummary[];
  recentAnnouncements: Array<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  }>;
  unreadNotifications: number;
  unreadMessages: number;
  upcomingEvents: Array<{
    id: string;
    title: string;
    date: string;
    type: string;
  }>;
}

// ==================== HOOKS: CHILDREN ====================

/**
 * Get list of children linked to parent
 */
export function useParentChildren() {
  return useQuery({
    queryKey: ["parent", "children"],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<ParentChild[]>>("/parent/children");
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ==================== HOOKS: DASHBOARD ====================

/**
 * Get parent dashboard with all children summaries
 */
export function useParentDashboard() {
  return useQuery({
    queryKey: ["parent", "dashboard"],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<ParentDashboardData>>("/parent/dashboard");
      return response.data.data;
    },
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
