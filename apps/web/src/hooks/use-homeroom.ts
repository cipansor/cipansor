"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";
import type {
  HomeroomViewer,
  MyHomeroomClass,
  StudentStatus,
} from "@cipansor/shared";

// ======================
// TYPES
// ======================

export interface HomeroomClass {
  id: string;
  name: string;
  grade: number;
  academicYear: {
    id: string;
    year: string;
    semester: number;
    name?: string;
    isActive?: boolean;
  };
  unit: {
    id: string;
    name: string;
    type: string;
  };
  homeroomTeacher?: {
    id: string;
    name: string;
    nip?: string;
    email?: string;
    phone?: string;
  };
  students: HomeroomStudent[];
  studentCount: number;
  _count?: { enrollments: number };
}

export interface HomeroomStudent {
  id: string;
  nis: string;
  name: string;
  gender: "MALE" | "FEMALE";
  birthDate?: string;
  address?: string;
  phone?: string;
  email?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  photo?: string;
  status: StudentStatus;
  attendanceSummary?: HomeroomAttendanceSummary;
  academicSummary?: AcademicSummary;
  behaviorNotes?: BehaviorNote[];
  user?: { name: string }; // Added for dashboard compatibility
}

export interface HomeroomAttendanceSummary {
  totalDays: number;
  present: number;
  absent: number;
  sick: number;
  excused: number; // Was permitted
  late: number;
  attendanceRate: number;
}

export interface AcademicSummary {
  averageScore: number;
  rank?: number;
  totalStudents?: number;
  subjectScores: {
    subjectName: string;
    score: number;
    grade: string;
  }[];
}

export type BehaviorNoteType =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "ACHIEVEMENT"
  | "VIOLATION"
  | "COUNSELING_NEEDED"
  | "PARENT_CONTACTED";

export interface BehaviorNote {
  id: string;
  studentId: string;
  type: BehaviorNoteType;
  category: string;
  description: string;
  date: string;
  points?: number;
  followUp?: string;
  resolved: boolean;
  resolvedDate?: string;
  createdBy: {
    id: string;
    name: string;
  };
  createdAt: string;
}

export interface ParentMessage {
  id: string;
  studentId: string;
  student: {
    id: string;
    nis: string;
    name: string;
  };
  subject: string;
  message: string;
  type: "INFO" | "WARNING" | "URGENT" | "ACHIEVEMENT" | "INVITATION";
  status: "DRAFT" | "SENT" | "READ" | "REPLIED";
  sentAt?: string;
  readAt?: string;
  reply?: string;
  repliedAt?: string;
  createdAt: string;
}

// New Dashboard Types
export interface UpcomingBirthday {
  student: {
    id: string;
    name: string;
    nis: string;
  };
  date: string;
  daysUntil: number;
}

export interface RecentAchievement {
  id: string;
  type: "REWARD" | "TAHFIDZ";
  student: {
    id: string;
    user: { name: string };
  };
  category: string;
  description: string;
  date: string;
  points?: number;
}

export interface RecentViolation {
  id: string;
  student: {
    id: string;
    user: { name: string };
  };
  category: string;
  description: string;
  occurredAt: string;
  points: number;
  action?: string;
}

export interface HomeroomDashboardSummary {
  averageAttendance: number;
  averageAcademicScore: number;
  pendingBehaviorNotes: number;
  recentViolations: RecentViolation[];
  recentAchievements: RecentAchievement[];
  upcomingBirthdays: UpcomingBirthday[];
}

/** A pupil as the homeroom API lists them — never the whole Student row. */
export interface HomeroomStudentBrief {
  id: string;
  nis: string;
  gender: "MALE" | "FEMALE";
  photoUrl: string | null;
  user: { name: string };
}

export interface HomeroomDashboardData {
  class: {
    id: string;
    name: string;
    level?: string | null;
    unit: { id: string; name: string };
    academicYear: { id: string; name: string };
    /** A class may have no wali kelas yet; its kepala sekolah still reads it. */
    homeroomTeacher: { id: string; user: { name: string } } | null;
  };
  /** Whether the caller is this class's wali kelas, and may write notes. */
  viewer: HomeroomViewer;
  studentCount: number;
  students: HomeroomStudentBrief[];
  attendanceSummary: {
    status: string;
    count: number;
  }[];
  dashboardSummary: HomeroomDashboardSummary;
}

// ======================
// HOOKS
// ======================

/**
 * The classes the signed-in teacher is wali kelas of, the current academic
 * year's first. `isCurrent` is what makes a teacher a wali kelas *now*: the
 * sidebar shows the Wali Kelas group only for a teacher with a current class,
 * so pass `enabled: false` where that group is not in the menu at all.
 */
export function useHomeroomClasses(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["homeroom", "my-classes"],
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<MyHomeroomClass[]>>(
        "/homeroom/my-classes",
      );
      return data.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

// Get Dashboard Data
export function useHomeroomDashboard(classId: string | undefined) {
  return useQuery({
    queryKey: ["homeroom", "dashboard", classId],
    queryFn: async () => {
      if (!classId) throw new Error("Class ID is required");
      const { data } = await api.get<ApiResponse<HomeroomDashboardData>>(
        `/homeroom/${classId}/dashboard`,
      );
      return data.data;
    },
    enabled: !!classId,
  });
}

/**
 * The single homeroom class of the signed-in wali kelas.
 *
 * This used to GET /homeroom/my-class, which the API has never served — the
 * only endpoint is the plural /homeroom/my-classes. It 404'd on every render
 * of the behaviour and messages pages. Take the first class from the list
 * rather than adding a singular endpoint that would duplicate it: the API puts
 * the current academic year's class first, and a wali kelas holds one a year.
 */
export function useMyHomeroomClass() {
  return useQuery<HomeroomClass | null>({
    queryKey: ["homeroom", "my-classes", "first"],
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<HomeroomClass[]>>(
        "/homeroom/my-classes",
      );
      // React Query 5 rejects an `undefined` return: it is reserved for
      // "no data yet", so a wali kelas with no class must resolve to `null`.
      return data.data?.[0] ?? null;
    },
  });
}

// Get student detail for homeroom
export function useHomeroomStudent(studentId?: string) {
  return useQuery<HomeroomStudent>({
    queryKey: ["homeroom", "student", studentId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeroomStudent>>(
        `/homeroom/student/${studentId}`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

// Student Detail Types for comprehensive view
export interface StudentDetailData {
  id: string;
  nis: string;
  name: string;
  gender: "MALE" | "FEMALE";
  birthDate?: string;
  birthPlace?: string;
  address?: string;
  phone?: string;
  email?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  motherName?: string;
  motherPhone?: string;
  enrollmentDate?: string;
  photo?: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  unit?: {
    id: string;
    name: string;
  };
  enrollments?: Array<{
    id: string;
    status: string;
    class?: {
      id: string;
      name: string;
      grade?: number;
    };
  }>;
  tahfidzRecords?: Array<{
    id: string;
    activityType: string;
    juz: number;
    surahId: number;
    surahName: string;
    ayatStart: number;
    ayatEnd: number;
    score?: number;
    grade?: string;
    notes?: string;
    recordedAt: string;
  }>;
  attendances?: Array<{
    id: string;
    date: string;
    status: string;
    notes?: string;
  }>;
}

export interface StudentNotesData {
  violations: Array<{
    id: string;
    type: string;
    category: string;
    description: string;
    points: number;
    occurredAt: string;
    action?: string;
  }>;
  rewards: Array<{
    id: string;
    category: string;
    description: string;
    points: number;
    givenAt: string;
  }>;
}

// Get student full detail from homeroom
export function useHomeroomStudentDetail(studentId?: string) {
  return useQuery<StudentDetailData>({
    queryKey: ["homeroom", "student-detail", studentId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StudentDetailData>>(
        `/homeroom/student/${studentId}`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

// Get student notes (violations & rewards)
export function useHomeroomStudentNotes(studentId?: string) {
  return useQuery<StudentNotesData>({
    queryKey: ["homeroom", "student-notes", studentId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StudentNotesData>>(
        `/homeroom/student/${studentId}/notes`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

// Create student note via homeroom
export function useCreateHomeroomNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      type: "POSITIVE" | "NEGATIVE";
      title: string;
      description?: string;
      category?: string;
    }) => {
      const response = await api.post<
        ApiResponse<{ type: string; data: unknown }>
      >("/homeroom/notes", data);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["homeroom", "student-notes", variables.studentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["homeroom", "student-detail", variables.studentId],
      });
    },
  });
}

// Get parent messages
export function useParentMessages(classId?: string) {
  return useQuery<ParentMessage[]>({
    queryKey: ["homeroom", "messages", classId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ParentMessage[]>>(
        `/homeroom/classes/${classId}/messages`,
      );
      return response.data.data;
    },
    enabled: !!classId,
  });
}

// Send parent message
export function useSendParentMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentIds: string[];
      subject: string;
      message: string;
      type: ParentMessage["type"];
    }) => {
      const response = await api.post<ApiResponse<ParentMessage>>(
        "/homeroom/messages",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homeroom", "messages"] });
    },
  });
}

/**
 * The pupils of a class, as the homeroom API lists them to its wali kelas and
 * the unit's kepala sekolah and operator (404 to anyone else).
 */
export function useHomeroomClassStudents(classId?: string) {
  return useQuery({
    queryKey: ["homeroom", "class", classId, "students"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeroomStudentBrief[]>>(
        `/homeroom/class/${classId}/students`,
      );
      return response.data.data;
    },
    enabled: !!classId,
  });
}
