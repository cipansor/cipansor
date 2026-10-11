import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { PaginatedResponse } from "@/lib/api";

// Types
export type ViolationCategory = "LIGHT" | "MEDIUM" | "HEAVY";

export interface ViolationType {
  id: string;
  name: string;
  description?: string;
  category: ViolationCategory;
  points: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Violation {
  id: string;
  studentId: string;
  violationTypeId: string;
  date: string;
  description?: string;
  witness?: string;
  actionTaken?: string;
  reportedById: string;
  createdAt: string;
  updatedAt: string;
  student?: {
    id: string;
    name: string;
    nis: string;
    class?: { name: string };
    unit?: { name: string };
  };
  violationType?: ViolationType;
  reportedBy?: { name: string };
}

// The Violation row keeps severity in `type` (MINOR/MODERATE/MAJOR), the
// category as a free string, the date in `occurredAt` and the follow-up in
// `action` — there is no ViolationType table. Normalize into the UI shape the
// list/detail/edit pages read, deriving the display severity from `type`.
const SEVERITY_BY_TYPE: Record<string, ViolationCategory> = {
  MINOR: "LIGHT",
  MODERATE: "MEDIUM",
  MAJOR: "HEAVY",
};

export function normalizeViolation(raw: any): Violation {
  const category = (raw.category ?? "lainnya") as string;
  const severity = SEVERITY_BY_TYPE[raw.type] ?? "LIGHT";
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  const points = raw.points ?? 0;
  return {
    ...raw,
    violationTypeId: raw.violationTypeId ?? category,
    date: raw.occurredAt ?? raw.createdAt ?? new Date().toISOString(),
    actionTaken: raw.actionTaken ?? raw.action ?? undefined,
    violationType: raw.violationType ?? {
      id: category,
      name: label,
      description: raw.description ?? undefined,
      category: severity,
      points,
      isActive: true,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
  };
}

// Constants
export const VIOLATION_CATEGORIES: {
  value: ViolationCategory;
  label: string;
  color: string;
}[] = [
  { value: "LIGHT", label: "Ringan", color: "bg-yellow-100 text-yellow-800" },
  { value: "MEDIUM", label: "Sedang", color: "bg-orange-100 text-orange-800" },
  { value: "HEAVY", label: "Berat", color: "bg-red-100 text-red-800" },
];

// Violation Types Hooks
//
// `/violations/categories` now returns one `{id, name, category, points, type}`
// per category, with the points and severity its existing rows carry. The web
// shape names severity `category` (LIGHT/MEDIUM/HEAVY) and carries the DB
// `type` alongside it so the create form can submit the real severity.
export interface ViolationTypeWithSeverity extends ViolationType {
  /** The DB `type` the category's rows use (MINOR/MODERATE/MAJOR). */
  type: "MINOR" | "MODERATE" | "MAJOR";
}

const SEVERITY_BY_DB_TYPE: Record<string, ViolationCategory> = {
  MINOR: "LIGHT",
  MODERATE: "MEDIUM",
  MAJOR: "HEAVY",
};

function categoryToViolationType(raw: any): ViolationTypeWithSeverity {
  const name = String(raw?.id ?? raw);
  const label = raw?.name ?? name.charAt(0).toUpperCase() + name.slice(1);
  const dbType = (raw?.type ?? "MINOR") as "MINOR" | "MODERATE" | "MAJOR";
  return {
    id: name,
    name: label,
    // The API's `category` is the free-text category name (e.g. "IBADAH"), not
    // a severity — severity lives in `type` (MINOR/MODERATE/MAJOR). Derive the
    // display bucket from `type` so the badge gets a label and a colour; taking
    // `raw.category` handed the badge a string it has no mapping for, and it
    // rendered blank.
    category: SEVERITY_BY_DB_TYPE[dbType] ?? "LIGHT",
    points: typeof raw?.points === "number" ? raw.points : 0,
    type: dbType,
    isActive: raw?.isActive ?? true,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
  };
}

export function useViolationTypes(params?: {
  category?: ViolationCategory;
  isActive?: boolean;
}) {
  return useQuery({
    queryKey: ["violation-types", params],
    queryFn: async () => {
      const response = await api.get<{ data: unknown[] }>(
        "/violations/categories",
        { params },
      );
      return (response.data.data ?? []).map(categoryToViolationType);
    },
  });
}

export function useViolationType(id: string) {
  return useQuery({
    queryKey: ["violation-types", id],
    queryFn: async () => {
      // The API wraps the row in `{success, data}`; return the payload, not the
      // envelope, so the edit form's fields are populated.
      const response = await api.get<{ data: ViolationType }>(
        `/violations/categories/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateViolationType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      category: ViolationCategory;
      points: number;
      isActive?: boolean;
    }) => {
      const response = await api.post<ViolationType>(
        "/violations/categories",
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violation-types"] });
    },
  });
}

export function useUpdateViolationType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        description?: string;
        category?: ViolationCategory;
        points?: number;
        isActive?: boolean;
      };
    }) => {
      const response = await api.put<ViolationType>(
        `/violations/categories/${id}`,
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violation-types"] });
    },
  });
}

export function useDeleteViolationType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/violations/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violation-types"] });
    },
  });
}

// Violations Hooks
export function useViolations(params?: {
  page?: number;
  limit?: number;
  studentId?: string;
  violationTypeId?: string;
  category?: ViolationCategory;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ["violations", params],
    queryFn: async () => {
      // The API filters the free-text `category` exactly via `categoryId`; the
      // UI names it `violationTypeId`. Translate so the filter reaches the API
      // instead of being dropped as an unknown param.
      const { violationTypeId, ...rest } = params ?? {};
      const response = await api.get<PaginatedResponse<Violation>>(
        "/violations",
        {
          params: {
            ...rest,
            ...(violationTypeId && { categoryId: violationTypeId }),
          },
        },
      );
      return {
        ...response.data,
        data: (response.data.data ?? []).map(normalizeViolation),
      };
    },
  });
}

export function useViolation(id: string) {
  return useQuery({
    queryKey: ["violations", id],
    queryFn: async () => {
      const response = await api.get<any>(`/violations/${id}`);
      return normalizeViolation(response.data.data ?? response.data);
    },
    enabled: !!id,
  });
}

export function useStudentViolations(studentId: string) {
  return useQuery({
    queryKey: ["violations", "student", studentId],
    queryFn: async () => {
      const response = await api.get<any>(`/violations/student/${studentId}`);
      return (response.data.data ?? []).map(normalizeViolation);
    },
    enabled: !!studentId,
  });
}

export function useStudentViolationSummary(studentId: string) {
  return useQuery({
    queryKey: ["violations", "student-summary", studentId],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data: {
          totalPoints: number;
          recentViolations: Violation[];
          byType: { type: string; _count: { _all: number } }[];
          byCategory: { category: string; _count: { _all: number } }[];
        };
      }>(`/violations/student/${studentId}/summary`);
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

export function useCreateViolation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      type: string;
      category: string;
      description: string;
      occurredAt: string;
      points?: number;
      action?: string;
    }) => {
      const response = await api.post<Violation>("/violations", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violations"] });
    },
  });
}

export function useUpdateViolation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        type?: string;
        category?: string;
        description?: string;
        occurredAt?: string;
        points?: number;
        action?: string;
      };
    }) => {
      const response = await api.put<Violation>(`/violations/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violations"] });
    },
  });
}

export function useDeleteViolation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/violations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violations"] });
    },
  });
}

// Violation Summary Hooks
export function useViolationSummary(params?: {
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ["violations", "summary", params],
    queryFn: async () => {
      const response = await api.get<{
        totalViolations: number;
        byCategory: { category: ViolationCategory; count: number }[];
        topViolationTypes: {
          violationTypeId: string;
          name: string;
          count: number;
        }[];
        topStudents: {
          studentId: string;
          name: string;
          count: number;
          points: number;
        }[];
      }>("/violations/summary", { params });
      return response.data;
    },
  });
}

export function useStudentViolationPoints(studentId: string) {
  return useQuery({
    queryKey: ["violations", "points", studentId],
    queryFn: async () => {
      const response = await api.get<{
        totalPoints: number;
        violations: Violation[];
      }>(`/violations/student/${studentId}/points`);
      return response.data;
    },
    enabled: !!studentId,
  });
}
