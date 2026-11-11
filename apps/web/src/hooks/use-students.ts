import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { PaginatedResponse, ApiResponse } from "@/lib/api";
import {
  STUDENT_STATUS,
  type StudentStatus,
  type StudentRewardSummary,
  type StudentViolationSummary,
} from "@cipansor/shared";

// Types
export interface Student {
  id: string;
  nis: string;
  nisn?: string;
  name: string;
  gender: "MALE" | "FEMALE";
  birthDate: string;
  birthPlace: string;
  address: string;
  phone?: string;
  email?: string;
  parentName: string;
  parentPhone: string;
  fatherName?: string;
  motherName?: string;
  photoUrl?: string;
  bloodType?: string;
  specialNeeds?: string;
  /**
   * Kosakatanya dari STUDENT_STATUS di @cipansor/shared, bukan diketik ulang.
   * Sampai 2026-09-13 di sini tertulis "ACTIVE" | "INACTIVE" | "GRADUATED" |
   * "DROPPED_OUT" — empat nilai yang TIDAK ADA di kolomnya (kolomnya berisi
   * 'active' huruf kecil). Tipe inilah yang menyuruh 13 halaman mengirim
   * `status: "ACTIVE"` ke API, yang dulu diam-diam membuang parameternya.
   */
  status: StudentStatus;
  enrollmentDate: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
    type: string;
    code?: string;
  };
  currentClass?: {
    id: string;
    name: string;
    grade: number;
    academicYear?: {
      id: string;
      name: string;
    };
  };
  createdAt: string;
  updatedAt: string;
  // Summary fields for Student 360 View
  summary?: {
    walletBalance: number;
    violationPoints: number;
    boarding: {
      dormitoryName: string;
      roomName: string;
      assignedAt: string;
    } | null;
    unpaidInvoices: {
      count: number;
      total: number;
    };
  };
  // Detailed relation data
  wallet?: {
    id: string;
    balance: number | string;
    lastTopUp?: string;
  };
  roomAssignments?: Array<{
    id: string;
    room: {
      id: string;
      name: string;
      dormitory: {
        id: string;
        name: string;
      };
    };
    assignedAt: string;
    isActive: boolean;
  }>;
  violations?: Array<{
    id: string;
    points: number;
    type: string;
    category: string;
    description: string;
    occurredAt: string;
  }>;
  medicalRecords?: Array<{
    id: string;
    type: string;
    complaint: string;
    diagnosis?: string;
    visitDate: string;
  }>;
  invoices?: Array<{
    id: string;
    invoiceNumber: string;
    amount: number | string;
    paidAmount: number | string;
    dueDate: string;
    status: string;
    paymentType: {
      id: string;
      name: string;
    };
  }>;
  attendances?: Array<{
    id: string;
    date: string;
    status: string;
    notes?: string;
  }>;
  tahfidzRecords?: Array<{
    id: string;
    juz: number;
    surahName: string;
    ayahStart: number;
    ayahEnd: number;
    activityType: string;
    recordedAt: string;
  }>;
  enrollments?: Array<{
    id: string;
    status: string;
    class: {
      id: string;
      name: string;
      academicYear?: {
        id: string;
        name: string;
      };
    };
  }>;
}

export interface StudentListParams {
  page?: number;
  limit?: number;
  search?: string;
  unitId?: string;
  status?: string;
  classId?: string;
  gender?: "MALE" | "FEMALE";
}

export interface CreateStudentData {
  nis: string;
  name: string;
  gender: "MALE" | "FEMALE";
  birthDate: string;
  birthPlace: string;
  address: string;
  phone?: string;
  email?: string;
  parentName: string;
  parentPhone: string;
  unitId: string;
  enrollmentDate?: string;
}

export type UpdateStudentData = Partial<CreateStudentData>;
// `status` sengaja TIDAK ada di sini: `updateStudentSchema` di API membuangnya,
// dan memang harus — menjadikan santri alumni lewat `alumni.service`, yang
// sekaligus membuat baris Alumni dan menutup pendaftaran kelasnya.

// Hooks
export function useStudents(params: StudentListParams = {}) {
  return useQuery({
    queryKey: ["students", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Student>>("/students", {
        params,
      });
      // Students carry their display name on the related user record. Normalize
      // it onto `name` so every consumer (list, id-card, certificates, transcript,
      // duty-roster…) has a string — several call `.split`/`.charAt` on it and
      // crashed when it was undefined. Keep the typed return so consumers retain
      // `Student` (a loosely-typed return would make `name` `any` downstream).
      const body = response.data;
      return {
        ...body,
        // GET /students nests its counts as `meta.pagination` (the envelope
        // the staff dashboards read), not the flat `meta` this type declares.
        // The roster read `meta.total` and `meta.totalPages`, got nothing, and
        // showed "0 of 0 results" with a single page — the first 10 santri
        // were all anyone could reach.
        meta: studentListMeta(body.meta),
        data: (body.data ?? []).map((s) => ({
          ...s,
          name: s.name ?? (s as { user?: { name?: string } }).user?.name ?? "",
        })),
      } as PaginatedResponse<Student>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

type ListMeta = PaginatedResponse<Student>["meta"];

/** Flat pagination meta from either envelope the API uses. */
export function studentListMeta(
  meta: ListMeta | { pagination?: ListMeta } | undefined,
): ListMeta {
  const m =
    (meta as { pagination?: ListMeta } | undefined)?.pagination ??
    (meta as ListMeta | undefined);
  return {
    page: m?.page ?? 1,
    limit: m?.limit ?? 0,
    total: m?.total ?? 0,
    totalPages: m?.totalPages ?? 1,
  };
}

export function useStudent(id: string) {
  return useQuery({
    queryKey: ["students", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Student>>(`/students/${id}`);
      // Sama dengan useStudents: nama ada di `user.name`. Tanpa ini judul halaman
      // detail santri dan baris "Full Name" kosong, dan dialog Luluskan menulis
      // "undefined tercatat lulus".
      const s = response.data.data;
      return {
        ...s,
        name: s.name ?? (s as { user?: { name?: string } }).user?.name ?? "",
      };
    },
    enabled: !!id,
  });
}

export function useCreateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateStudentData) => {
      const response = await api.post<ApiResponse<Student>>("/students", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useUpdateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateStudentData;
    }) => {
      const response = await api.put<ApiResponse<Student>>(
        `/students/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["students", variables.id] });
    },
  });
}

export function useDeleteStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/students/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

// ==================== UTILITY HOOKS ====================

/**
 * Search students with autocomplete
 */
export function useStudentSearch(query: string, unitId?: string) {
  return useQuery({
    queryKey: ["students", "search", query, unitId],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Student>>("/students", {
        params: {
          search: query,
          unitId,
          limit: 10,
          status: STUDENT_STATUS.ACTIVE,
        },
      });
      return response.data.data;
    },
    enabled: query.length >= 2,
  });
}

/**
 * Get students by class
 */
export function useStudentsByClass(classId: string) {
  return useQuery({
    queryKey: ["students", "by-class", classId],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Student>>("/students", {
        params: { classId, limit: 100 },
      });
      // Students carry their display name on the related user record; normalize
      // it onto `name` so dropdowns don't render blank labels (see useStudents).
      return (response.data.data ?? []).map((s) => ({
        ...s,
        name: s.name ?? (s as { user?: { name?: string } }).user?.name ?? "",
      }));
    },
    enabled: !!classId,
  });
}

/**
 * Luluskan santri dari unitnya sekarang.
 *
 * Satu-satunya jalur yang juga menulis baris Alumni, menyelesaikan rombel unit
 * itu, dan menutup riwayat unitnya dengan LULUS (`POST /alumni/from-student`).
 * Hook ini dulu memanggil `POST /students/:id/graduate`, rute yang tidak pernah
 * ada, dan tidak dipakai halaman mana pun.
 */
export function useGraduateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      studentId,
      ...body
    }: {
      studentId: string;
      graduationDate: string;
      lastClass?: string;
      tahfidzLevel?: string;
      notes?: string;
    }) => {
      const response = await api.post<
        ApiResponse<{ id: string; graduationYear: number }>
      >(`/alumni/from-student/${studentId}`, body);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["students", variables.studentId],
      });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["alumni"] });
    },
  });
}

export interface StudentCompleteProfile extends Student {
  enrollments: Array<{
    id: string;
    status: string;
    class: {
      id: string;
      name: string;
      academicYear?: {
        id: string;
        name: string;
      };
    };
  }>;
  parents: Array<{
    id: string;
    name: string;
    relation: string;
    phone?: string;
    email?: string;
    occupation?: string;
  }>;
  academicSummary: {
    averageGrade?: number;
    totalSubjects?: number;
    ranking?: number;
    trend?: "UP" | "DOWN" | "STABLE";
  };
  attendanceSummary: {
    totalDays: number;
    presentDays: number;
    percentage: number;
  };
  behaviorSummary: {
    totalViolations: number;
    totalRewards: number;
    points: number;
  };
}

/**
 * Get complete student profile with all related data
 */
export function useStudentCompleteProfile(studentId: string) {
  return useQuery({
    queryKey: ["students", studentId, "complete-profile"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StudentCompleteProfile>>(
        `/students/${studentId}/complete-profile`,
      );
      return response.data.data;
    },
    enabled: !!studentId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/** A santri's behaviour record, from the two per-santri summaries. */
export interface StudentBehaviorStats {
  violationPoints: number;
  rewardPoints: number;
  totalViolations: number;
  totalRewards: number;
  recentViolations: StudentViolationSummary["recentViolations"];
  recentRewards: StudentRewardSummary["recentRewards"];
}

/**
 * A santri's violations and rewards, from `GET /violations/student/:id/summary`
 * and `GET /rewards/student/:id/summary` (both check the caller's scope). The
 * totals are counted from the summaries' groups; the lists are the ten latest.
 * Either request failing fails the query, so the tab never shows a clean
 * record it could not read.
 */
export function useStudentBehaviorStats(studentId: string) {
  return useQuery({
    queryKey: ["students", studentId, "behavior-stats"],
    queryFn: async (): Promise<StudentBehaviorStats> => {
      const [violations, rewards] = await Promise.all([
        api.get<ApiResponse<StudentViolationSummary>>(
          `/violations/student/${studentId}/summary`,
        ),
        api.get<ApiResponse<StudentRewardSummary>>(
          `/rewards/student/${studentId}/summary`,
        ),
      ]);
      const v = violations.data.data;
      const r = rewards.data.data;
      return {
        violationPoints: v?.totalPoints ?? 0,
        rewardPoints: r?.totalPoints ?? 0,
        totalViolations: (v?.byType ?? []).reduce((n, g) => n + g._count, 0),
        totalRewards: (r?.byCategory ?? []).reduce((n, g) => n + g._count, 0),
        recentViolations: v?.recentViolations ?? [],
        recentRewards: r?.recentRewards ?? [],
      };
    },
    enabled: !!studentId,
  });
}
