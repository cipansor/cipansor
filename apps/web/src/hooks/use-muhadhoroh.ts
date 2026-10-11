"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ===================
// TYPES
// ===================

export type MuhadhorohStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

export interface MuhadhorohRecord {
  id: string;
  unitId: string;
  studentId: string;
  scheduledAt: string;
  topic: string;
  language: string;
  duration: number | null;
  contentScore: number | null;
  deliveryScore: number | null;
  languageScore: number | null;
  totalScore: number | null;
  grade: string | null;
  feedback: string | null;
  evaluatorId: string | null;
  evaluatedAt: string | null;
  status: MuhadhorohStatus;
  videoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  unit?: {
    id: string;
    name: string;
  };
  student?: {
    id: string;
    nis: string;
    name: string;
    class?: {
      id: string;
      name: string;
      level?: string;
    } | null;
  };
  evaluator?: {
    id: string;
    name: string;
  } | null;
}

export interface MuhadhorohStats {
  total: number;
  byStatus: { status: string; count: number }[];
  byLanguage: { language: string; count: number }[];
  averages: {
    content: number;
    delivery: number;
    language: number;
    total: number;
  };
}

export interface TopPerformer {
  studentId: string;
  name: string;
  nis: string;
  class: string | null;
  averageScore: number;
  totalSessions: number;
}

export interface ListMuhadhorohParams {
  unitId?: string;
  studentId?: string;
  evaluatorId?: string;
  status?: MuhadhorohStatus;
  language?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface CreateMuhadhorohInput {
  unitId: string;
  studentId: string;
  scheduledAt: string;
  topic: string;
  language?: string;
}

export interface UpdateMuhadhorohInput {
  topic?: string;
  language?: string;
  scheduledAt?: string;
  status?: MuhadhorohStatus;
}

export interface EvaluateMuhadhorohInput {
  contentScore: number;
  deliveryScore: number;
  languageScore: number;
  feedback?: string;
  videoUrl?: string;
  duration?: number;
}

// ===================
// QUERY KEYS
// ===================

export const muhadhorohKeys = {
  all: ["muhadhoroh"] as const,
  lists: () => [...muhadhorohKeys.all, "list"] as const,
  list: (params: ListMuhadhorohParams) =>
    [...muhadhorohKeys.lists(), params] as const,
  details: () => [...muhadhorohKeys.all, "detail"] as const,
  detail: (id: string) => [...muhadhorohKeys.details(), id] as const,
  upcoming: (unitId: string) =>
    [...muhadhorohKeys.all, "upcoming", unitId] as const,
  statistics: (unitId: string, startDate?: string, endDate?: string) =>
    [...muhadhorohKeys.all, "statistics", unitId, startDate, endDate] as const,
  topPerformers: (unitId: string) =>
    [...muhadhorohKeys.all, "top-performers", unitId] as const,
  studentHistory: (studentId: string) =>
    [...muhadhorohKeys.all, "student-history", studentId] as const,
};

// ===================
// API FUNCTIONS
// ===================

async function fetchMuhadhorohList(params: ListMuhadhorohParams) {
  const searchParams = new URLSearchParams();

  if (params.unitId) searchParams.set("unitId", params.unitId);
  if (params.studentId) searchParams.set("studentId", params.studentId);
  if (params.evaluatorId) searchParams.set("evaluatorId", params.evaluatorId);
  if (params.status) searchParams.set("status", params.status);
  if (params.language) searchParams.set("language", params.language);
  if (params.startDate) searchParams.set("startDate", params.startDate);
  if (params.endDate) searchParams.set("endDate", params.endDate);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const response = await api.get(`/muhadhoroh?${searchParams.toString()}`);
  return response.data as {
    data: MuhadhorohRecord[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  };
}

async function fetchMuhadhorohById(id: string) {
  const response = await api.get(`/muhadhoroh/${id}`);
  return response.data.data as MuhadhorohRecord;
}

async function fetchUpcomingMuhadhoroh(unitId: string, limit = 10) {
  const response = await api.get(
    `/muhadhoroh/upcoming?unitId=${unitId}&limit=${limit}`,
  );
  return response.data.data as MuhadhorohRecord[];
}

async function fetchMuhadhorohStatistics(
  unitId: string,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams({ unitId });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const response = await api.get(`/muhadhoroh/statistics?${params.toString()}`);
  return response.data.data as MuhadhorohStats;
}

async function fetchTopPerformers(unitId: string, limit = 10) {
  const response = await api.get(
    `/muhadhoroh/top-performers?unitId=${unitId}&limit=${limit}`,
  );
  return response.data.data as TopPerformer[];
}

async function fetchStudentHistory(studentId: string, limit = 20) {
  const response = await api.get(
    `/muhadhoroh/student/${studentId}/history?limit=${limit}`,
  );
  return response.data.data as MuhadhorohRecord[];
}

async function createMuhadhoroh(input: CreateMuhadhorohInput) {
  const response = await api.post("/muhadhoroh", input);
  return response.data.data as MuhadhorohRecord;
}

async function updateMuhadhoroh(id: string, input: UpdateMuhadhorohInput) {
  const response = await api.patch(`/muhadhoroh/${id}`, input);
  return response.data.data as MuhadhorohRecord;
}

async function deleteMuhadhoroh(id: string) {
  await api.delete(`/muhadhoroh/${id}`);
}

async function evaluateMuhadhoroh(id: string, input: EvaluateMuhadhorohInput) {
  const response = await api.post(`/muhadhoroh/${id}/evaluate`, input);
  return response.data.data as MuhadhorohRecord;
}

async function cancelMuhadhoroh(id: string) {
  const response = await api.post(`/muhadhoroh/${id}/cancel`);
  return response.data.data as MuhadhorohRecord;
}

// ===================
// QUERY HOOKS
// ===================

export function useMuhadhorohList(params: ListMuhadhorohParams = {}) {
  return useQuery({
    queryKey: muhadhorohKeys.list(params),
    queryFn: () => fetchMuhadhorohList(params),
  });
}

export function useMuhadhorohDetail(id: string | undefined) {
  return useQuery({
    queryKey: muhadhorohKeys.detail(id!),
    queryFn: () => fetchMuhadhorohById(id!),
    enabled: !!id,
  });
}

export function useUpcomingMuhadhoroh(unitId: string | undefined, limit = 10) {
  return useQuery({
    queryKey: muhadhorohKeys.upcoming(unitId!),
    queryFn: () => fetchUpcomingMuhadhoroh(unitId!, limit),
    enabled: !!unitId,
  });
}

export function useMuhadhorohStatistics(
  unitId: string | undefined,
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: muhadhorohKeys.statistics(unitId!, startDate, endDate),
    queryFn: () => fetchMuhadhorohStatistics(unitId!, startDate, endDate),
    enabled: !!unitId,
  });
}

export function useTopPerformers(unitId: string | undefined, limit = 10) {
  return useQuery({
    queryKey: muhadhorohKeys.topPerformers(unitId!),
    queryFn: () => fetchTopPerformers(unitId!, limit),
    enabled: !!unitId,
  });
}

export function useStudentMuhadhorohHistory(
  studentId: string | undefined,
  limit = 20,
) {
  return useQuery({
    queryKey: muhadhorohKeys.studentHistory(studentId!),
    queryFn: () => fetchStudentHistory(studentId!, limit),
    enabled: !!studentId,
  });
}

// ===================
// MUTATION HOOKS
// ===================

export function useCreateMuhadhoroh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMuhadhoroh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.lists() });
    },
  });
}

export function useUpdateMuhadhoroh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMuhadhorohInput }) =>
      updateMuhadhoroh(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: muhadhorohKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteMuhadhoroh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMuhadhoroh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.lists() });
    },
  });
}

export function useEvaluateMuhadhoroh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: EvaluateMuhadhorohInput;
    }) => evaluateMuhadhoroh(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: muhadhorohKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.all });
    },
  });
}

export function useCancelMuhadhoroh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelMuhadhoroh,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.lists() });
      queryClient.invalidateQueries({ queryKey: muhadhorohKeys.detail(id) });
    },
  });
}

// ===================
// HELPER FUNCTIONS
// ===================

export function getStatusColor(status: MuhadhorohStatus) {
  switch (status) {
    case "SCHEDULED":
      return "bg-blue-100 text-blue-700";
    case "COMPLETED":
      return "bg-green-100 text-green-700";
    case "CANCELLED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export function getStatusLabel(status: MuhadhorohStatus) {
  switch (status) {
    case "SCHEDULED":
      return "Terjadwal";
    case "COMPLETED":
      return "Selesai";
    case "CANCELLED":
      return "Dibatalkan";
    default:
      return status;
  }
}

export function getGradeColor(grade: string | null) {
  switch (grade) {
    case "A":
      return "bg-green-100 text-green-700";
    case "B":
      return "bg-blue-100 text-blue-700";
    case "C":
      return "bg-yellow-100 text-yellow-700";
    case "D":
      return "bg-orange-100 text-orange-700";
    case "E":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export function getLanguageLabel(language: string | null | undefined) {
  if (!language) return "-";
  switch (language.toLowerCase()) {
    case "indonesian":
      return "Bahasa Indonesia";
    case "arabic":
      return "Bahasa Arab";
    case "english":
      return "Bahasa Inggris";
    default:
      return language;
  }
}

export function formatDuration(minutes: number | null) {
  if (!minutes) return "-";
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} jam ${mins} menit` : `${hours} jam`;
}
