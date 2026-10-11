"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ===================
// TYPES
// ===================

export type MuhadatsahStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

export interface MuhadatsahRecord {
  id: string;
  unitId: string;
  studentId: string;
  partnerId: string | null;
  scheduledAt: string;
  language: string;
  topic: string | null;
  duration: number | null;
  fluencyScore: number | null;
  grammarScore: number | null;
  vocabularyScore: number | null;
  pronunciationScore: number | null;
  totalScore: number | null;
  grade: string | null;
  feedback: string | null;
  evaluatorId: string | null;
  evaluatedAt: string | null;
  status: MuhadatsahStatus;
  recordingUrl: string | null;
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
  partner?: {
    id: string;
    nis: string;
    name: string;
  } | null;
  evaluator?: {
    id: string;
    name: string;
  } | null;
}

export interface MuhadatsahStats {
  total: number;
  byStatus: { status: string; count: number }[];
  byLanguage: { language: string; count: number }[];
  averages: {
    fluency: number;
    grammar: number;
    vocabulary: number;
    pronunciation: number;
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

export interface AvailablePartner {
  id: string;
  nis: string;
  name: string;
  class: {
    name: string;
    level?: string;
  } | null;
}

export interface ListMuhadatsahParams {
  unitId?: string;
  studentId?: string;
  partnerId?: string;
  evaluatorId?: string;
  status?: MuhadatsahStatus;
  language?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface CreateMuhadatsahInput {
  unitId: string;
  studentId: string;
  partnerId?: string;
  scheduledAt: string;
  topic?: string;
  language: string;
}

export interface UpdateMuhadatsahInput {
  topic?: string;
  language?: string;
  partnerId?: string;
  scheduledAt?: string;
  status?: MuhadatsahStatus;
}

export interface EvaluateMuhadatsahInput {
  fluencyScore: number;
  grammarScore: number;
  vocabularyScore: number;
  pronunciationScore: number;
  feedback?: string;
  recordingUrl?: string;
  duration?: number;
}

// ===================
// QUERY KEYS
// ===================

export const muhadatsahKeys = {
  all: ["muhadatsah"] as const,
  lists: () => [...muhadatsahKeys.all, "list"] as const,
  list: (params: ListMuhadatsahParams) =>
    [...muhadatsahKeys.lists(), params] as const,
  details: () => [...muhadatsahKeys.all, "detail"] as const,
  detail: (id: string) => [...muhadatsahKeys.details(), id] as const,
  upcoming: (unitId: string) =>
    [...muhadatsahKeys.all, "upcoming", unitId] as const,
  statistics: (unitId: string, startDate?: string, endDate?: string) =>
    [...muhadatsahKeys.all, "statistics", unitId, startDate, endDate] as const,
  topPerformers: (unitId: string, language?: string) =>
    [...muhadatsahKeys.all, "top-performers", unitId, language] as const,
  studentHistory: (studentId: string) =>
    [...muhadatsahKeys.all, "student-history", studentId] as const,
  matchPartners: (unitId: string, language: string) =>
    [...muhadatsahKeys.all, "match-partners", unitId, language] as const,
};

// ===================
// API FUNCTIONS
// ===================

async function fetchMuhadatsahList(params: ListMuhadatsahParams) {
  const searchParams = new URLSearchParams();

  if (params.unitId) searchParams.set("unitId", params.unitId);
  if (params.studentId) searchParams.set("studentId", params.studentId);
  if (params.partnerId) searchParams.set("partnerId", params.partnerId);
  if (params.evaluatorId) searchParams.set("evaluatorId", params.evaluatorId);
  if (params.status) searchParams.set("status", params.status);
  if (params.language) searchParams.set("language", params.language);
  if (params.startDate) searchParams.set("startDate", params.startDate);
  if (params.endDate) searchParams.set("endDate", params.endDate);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const response = await api.get(`/muhadatsah?${searchParams.toString()}`);
  return response.data as {
    data: MuhadatsahRecord[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  };
}

async function fetchMuhadatsahById(id: string) {
  const response = await api.get(`/muhadatsah/${id}`);
  return response.data.data as MuhadatsahRecord;
}

async function fetchUpcomingMuhadatsah(unitId: string, limit = 10) {
  const response = await api.get(
    `/muhadatsah/upcoming?unitId=${unitId}&limit=${limit}`,
  );
  return response.data.data as MuhadatsahRecord[];
}

async function fetchMuhadatsahStatistics(
  unitId: string,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams({ unitId });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const response = await api.get(`/muhadatsah/statistics?${params.toString()}`);
  return response.data.data as MuhadatsahStats;
}

async function fetchTopPerformers(
  unitId: string,
  language?: string,
  limit = 10,
) {
  const params = new URLSearchParams({ unitId, limit: String(limit) });
  if (language) params.set("language", language);

  const response = await api.get(
    `/muhadatsah/top-performers?${params.toString()}`,
  );
  return response.data.data as TopPerformer[];
}

async function fetchStudentHistory(studentId: string, limit = 20) {
  const response = await api.get(
    `/muhadatsah/student/${studentId}/history?limit=${limit}`,
  );
  return response.data.data as MuhadatsahRecord[];
}

async function fetchMatchPartners(unitId: string, language: string) {
  const response = await api.get(
    `/muhadatsah/match-partners?unitId=${unitId}&language=${language}`,
  );
  return response.data.data as AvailablePartner[];
}

async function createMuhadatsah(input: CreateMuhadatsahInput) {
  const response = await api.post("/muhadatsah", input);
  return response.data.data as MuhadatsahRecord;
}

async function updateMuhadatsah(id: string, input: UpdateMuhadatsahInput) {
  const response = await api.patch(`/muhadatsah/${id}`, input);
  return response.data.data as MuhadatsahRecord;
}

async function deleteMuhadatsah(id: string) {
  await api.delete(`/muhadatsah/${id}`);
}

async function evaluateMuhadatsah(id: string, input: EvaluateMuhadatsahInput) {
  const response = await api.post(`/muhadatsah/${id}/evaluate`, input);
  return response.data.data as MuhadatsahRecord;
}

async function cancelMuhadatsah(id: string) {
  const response = await api.post(`/muhadatsah/${id}/cancel`);
  return response.data.data as MuhadatsahRecord;
}

// ===================
// QUERY HOOKS
// ===================

export function useMuhadatsahList(params: ListMuhadatsahParams = {}) {
  return useQuery({
    queryKey: muhadatsahKeys.list(params),
    queryFn: () => fetchMuhadatsahList(params),
  });
}

export function useMuhadatsahDetail(id: string | undefined) {
  return useQuery({
    queryKey: muhadatsahKeys.detail(id!),
    queryFn: () => fetchMuhadatsahById(id!),
    enabled: !!id,
  });
}

export function useUpcomingMuhadatsah(unitId: string | undefined, limit = 10) {
  return useQuery({
    queryKey: muhadatsahKeys.upcoming(unitId!),
    queryFn: () => fetchUpcomingMuhadatsah(unitId!, limit),
    enabled: !!unitId,
  });
}

export function useMuhadatsahStatistics(
  unitId: string | undefined,
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: muhadatsahKeys.statistics(unitId!, startDate, endDate),
    queryFn: () => fetchMuhadatsahStatistics(unitId!, startDate, endDate),
    enabled: !!unitId,
  });
}

export function useTopPerformers(
  unitId: string | undefined,
  language?: string,
  limit = 10,
) {
  return useQuery({
    queryKey: muhadatsahKeys.topPerformers(unitId!, language),
    queryFn: () => fetchTopPerformers(unitId!, language, limit),
    enabled: !!unitId,
  });
}

export function useStudentMuhadatsahHistory(
  studentId: string | undefined,
  limit = 20,
) {
  return useQuery({
    queryKey: muhadatsahKeys.studentHistory(studentId!),
    queryFn: () => fetchStudentHistory(studentId!, limit),
    enabled: !!studentId,
  });
}

export function useMatchPartners(
  unitId: string | undefined,
  language: string | undefined,
) {
  return useQuery({
    queryKey: muhadatsahKeys.matchPartners(unitId!, language!),
    queryFn: () => fetchMatchPartners(unitId!, language!),
    enabled: !!unitId && !!language,
  });
}

// ===================
// MUTATION HOOKS
// ===================

export function useCreateMuhadatsah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMuhadatsah,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.lists() });
    },
  });
}

export function useUpdateMuhadatsah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMuhadatsahInput }) =>
      updateMuhadatsah(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: muhadatsahKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteMuhadatsah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMuhadatsah,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.lists() });
    },
  });
}

export function useEvaluateMuhadatsah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: EvaluateMuhadatsahInput;
    }) => evaluateMuhadatsah(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: muhadatsahKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.all });
    },
  });
}

export function useCancelMuhadatsah() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelMuhadatsah,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.lists() });
      queryClient.invalidateQueries({ queryKey: muhadatsahKeys.detail(id) });
    },
  });
}

// ===================
// HELPER FUNCTIONS
// ===================

export function getStatusColor(status: MuhadatsahStatus) {
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

export function getStatusLabel(status: MuhadatsahStatus) {
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
    case "arabic":
      return "Bahasa Arab";
    case "english":
      return "Bahasa Inggris";
    default:
      return language;
  }
}

export function getLanguageIcon(language: string | null | undefined) {
  switch ((language ?? "").toLowerCase()) {
    case "arabic":
      return "🕌";
    case "english":
      return "🇬🇧";
    default:
      return "💬";
  }
}

export function formatDuration(minutes: number | null) {
  if (!minutes) return "-";
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} jam ${mins} menit` : `${hours} jam`;
}

export function getScoreLabel(score: number | null) {
  if (score === null) return "-";
  if (score >= 90) return "Sangat Baik";
  if (score >= 80) return "Baik";
  if (score >= 70) return "Cukup";
  if (score >= 60) return "Kurang";
  return "Sangat Kurang";
}

export function getScoreColor(score: number | null) {
  if (score === null) return "text-gray-500";
  if (score >= 90) return "text-green-600";
  if (score >= 80) return "text-blue-600";
  if (score >= 70) return "text-yellow-600";
  if (score >= 60) return "text-orange-600";
  return "text-red-600";
}
