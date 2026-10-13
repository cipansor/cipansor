"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// =====================
// TYPES
// =====================

export interface RaporPesantren {
  id: string;
  studentId: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
    address: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    logoUrl: string | null;
  };
  academicYearId: string;
  semester: number;
  status: "DRAFT" | "FINAL" | "PUBLISHED";
  student: {
    id: string;
    name: string;
    nis: string;
    nisn?: string;
    gender: string;
    birthDate?: string;
    photo?: string;
    class: { id: string; name: string };
    dormRoom?: { id: string; name: string };
  };
  academicYear: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  };
  tahfidz: TahfidzSummary;
  takhosus: TakhosusSummary;
  ibadah: IbadahSummary;
  muhadhoroh: MuhadhorohSummary;
  muhadatsah: MuhadatsahSummary;
  kitabProgress: KitabProgressSummary;
  akhlak: AkhlakSummary;
  attendance: AttendanceSummary;
  overallScore: number;
  overallGrade: string;
  notes?: string;
  headTeacherNotes?: string;
  musyrifNotes?: string;
  principalNotes?: string;
  generatedAt: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TahfidzSummary {
  totalSurah: number;
  totalJuz: number;
  totalAyah: number;
  setoranCount: number;
  murajaahCount: number;
  tasmiCount: number;
  averageGrade: string;
  latestSurah: string;
  latestJuz: number;
  progressPercentage: number;
  grade: string;
  score: number;
  records: Array<{
    date: string;
    surah: string;
    juz: number;
    type: string;
    grade: string;
  }>;
}

export interface TakhosusSummary {
  enrolledHalaqoh: number;
  totalSessions: number;
  averageScore: number;
  grade: string;
  score: number;
  halaqohDetails: Array<{
    halaqohName: string;
    status: string;
    progress: number;
    latestGrade: string;
    sessionsCount: number;
  }>;
}

export interface IbadahSummary {
  totalPoints: number;
  bonusPoints: number;
  currentStreak: number;
  longestStreak: number;
  completionRate: number;
  categoryBreakdown: Array<{
    category: string;
    points: number;
    completionRate: number;
  }>;
  grade: string;
  score: number;
}

export interface MuhadhorohSummary {
  totalSessions: number;
  attendedSessions: number;
  performanceCount: number;
  averageScore: number;
  themes: string[];
  grade: string;
  score: number;
  performances: Array<{
    date: string;
    theme: string;
    score: number;
    feedback?: string;
  }>;
}

export interface MuhadatsahSummary {
  totalSessions: number;
  attendedSessions: number;
  practiceCount: number;
  averageScore: number;
  languages: string[];
  grade: string;
  score: number;
  practices: Array<{
    date: string;
    language: string;
    topic: string;
    score: number;
    feedback?: string;
  }>;
}

export interface KitabProgressSummary {
  totalKitab: number;
  completedKitab: number;
  inProgressKitab: number;
  totalPages: number;
  readPages: number;
  progressPercentage: number;
  grade: string;
  score: number;
  kitabList: Array<{
    name: string;
    category: string;
    totalPages: number;
    completedPages: number;
    status: string;
  }>;
}

export interface AkhlakSummary {
  totalViolations: number;
  totalRewards: number;
  violationPoints: number;
  rewardPoints: number;
  netPoints: number;
  behaviorGrade: string;
  grade: string;
  score: number;
  violations: Array<{
    date: string;
    category: string;
    description: string;
    points: number;
  }>;
  rewards: Array<{
    date: string;
    category: string;
    description: string;
    points: number;
  }>;
}

export interface AttendanceSummary {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  sickDays: number;
  permitDays: number;
  lateDays: number;
  attendanceRate: number;
  grade: string;
}

export interface RaporListItem {
  id: string;
  studentId: string;
  studentName: string;
  studentNis: string;
  className?: string;
  academicYearName: string;
  semester: number;
  status: string;
  overallScore: number | null;
  overallGrade: string | null;
  generatedAt: string;
  publishedAt?: string;
}

export interface RaporConfig {
  unitId: string;
  componentWeights: {
    tahfidz: number;
    takhosus: number;
    ibadah: number;
    muhadhoroh: number;
    muhadatsah: number;
    kitabProgress: number;
    akhlak: number;
  };
  gradeThresholds: {
    mumtaz: number;
    jayyidJiddan: number;
    jayyid: number;
    maqbul: number;
  };
  includeAttendance: boolean;
  includeViolations: boolean;
  includeRewards: boolean;
}

export interface LegerItem {
  id: string; // Rapor ID
  studentId: string;
  studentName: string;
  studentNis: string;

  tahfidzScore: number;
  tahfidzGrade: string;

  takhosusScore: number;
  takhosusGrade: string;

  ibadahScore: number;
  ibadahGrade: string;

  muhadhorohScore: number;
  muhadhorohGrade: string;

  muhadatsahScore: number;
  muhadatsahGrade: string;

  kitabScore: number;
  kitabGrade: string;

  akhlakScore: number;
  akhlakGrade: string;

  attendanceScore: number;
  attendanceGrade: string;

  overallScore: number;
  overallGrade: string;
  rank?: number;
}

// =====================
// QUERY KEYS
// =====================

export const raporPesantrenKeys = {
  all: ["rapor-pesantren"] as const,
  lists: () => [...raporPesantrenKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...raporPesantrenKeys.lists(), filters] as const,
  details: () => [...raporPesantrenKeys.all, "detail"] as const,
  detail: (id: string) => [...raporPesantrenKeys.details(), id] as const,
  config: (unitId: string) =>
    [...raporPesantrenKeys.all, "config", unitId] as const,
  leger: (filters: Record<string, unknown>) =>
    [...raporPesantrenKeys.all, "leger", filters] as const,
};

// =====================
// API FUNCTIONS
// =====================

interface ListRaporParams {
  unitId?: string;
  classId?: string;
  academicYearId?: string;
  semester?: number;
  status?: string;
  page?: number;
  limit?: number;
}

const EMPTY_TAHFIDZ: TahfidzSummary = {
  totalSurah: 0,
  totalJuz: 0,
  totalAyah: 0,
  setoranCount: 0,
  murajaahCount: 0,
  tasmiCount: 0,
  averageGrade: "-",
  latestSurah: "-",
  latestJuz: 0,
  progressPercentage: 0,
  grade: "-",
  score: 0,
  records: [],
};

const EMPTY_TAKHOSUS: TakhosusSummary = {
  enrolledHalaqoh: 0,
  totalSessions: 0,
  averageScore: 0,
  grade: "-",
  score: 0,
  halaqohDetails: [],
};

const EMPTY_IBADAH: IbadahSummary = {
  totalPoints: 0,
  bonusPoints: 0,
  currentStreak: 0,
  longestStreak: 0,
  completionRate: 0,
  categoryBreakdown: [],
  grade: "-",
  score: 0,
};

const EMPTY_MUHADHOROH: MuhadhorohSummary = {
  totalSessions: 0,
  attendedSessions: 0,
  performanceCount: 0,
  averageScore: 0,
  themes: [],
  grade: "-",
  score: 0,
  performances: [],
};

const EMPTY_MUHADATSAH: MuhadatsahSummary = {
  totalSessions: 0,
  attendedSessions: 0,
  practiceCount: 0,
  averageScore: 0,
  languages: [],
  grade: "-",
  score: 0,
  practices: [],
};

const EMPTY_KITAB: KitabProgressSummary = {
  totalKitab: 0,
  completedKitab: 0,
  inProgressKitab: 0,
  totalPages: 0,
  readPages: 0,
  progressPercentage: 0,
  grade: "-",
  score: 0,
  kitabList: [],
};

const EMPTY_AKHLAK: AkhlakSummary = {
  totalViolations: 0,
  totalRewards: 0,
  violationPoints: 0,
  rewardPoints: 0,
  netPoints: 0,
  behaviorGrade: "-",
  grade: "-",
  score: 0,
  violations: [],
  rewards: [],
};

const EMPTY_ATTENDANCE: AttendanceSummary = {
  totalDays: 0,
  presentDays: 0,
  absentDays: 0,
  sickDays: 0,
  permitDays: 0,
  lateDays: 0,
  attendanceRate: 0,
  grade: "-",
};

/**
 * The aggregator in `apps/api` only emits a component when the student has data
 * for it and stores arbitrary JSON for each, so a rapor can come back with the
 * per-domain summaries missing or partially populated. The detail and print
 * views render the full contract, so fill the gaps here rather than guarding
 * every field access at each call site.
 */
function normalizeRapor(raw: Partial<RaporPesantren>): RaporPesantren {
  // Older rapor rows (and the seed) store a hand-written summary per domain
  // using the field names below rather than the aggregator's Summary shape.
  // Bridge the two so either source renders.
  const legacy = raw as Record<string, Record<string, unknown> | undefined>;
  const mappedTahfidz = raw.tahfidz
    ? {
        score: numberOr(raw.tahfidz.score, legacy.tahfidz?.tahfidzScore),
        grade: stringOr(raw.tahfidz.grade, legacy.tahfidz?.tahfidzGrade),
      }
    : undefined;
  const mappedIbadah = raw.ibadah
    ? {
        score: numberOr(
          raw.ibadah.score,
          legacy.ibadah?.sholatFardhuPercentage,
        ),
        grade: stringOr(raw.ibadah.grade, undefined),
      }
    : undefined;
  const mappedMuhadhoroh = raw.muhadhoroh
    ? {
        score: numberOr(
          raw.muhadhoroh.score,
          legacy.muhadhoroh?.speechSkillScore,
        ),
        grade: stringOr(raw.muhadhoroh.grade, legacy.muhadhoroh?.speechGrade),
      }
    : undefined;

  return {
    ...(raw as RaporPesantren),
    tahfidz: { ...EMPTY_TAHFIDZ, ...(raw.tahfidz ?? {}), ...mappedTahfidz },
    takhosus: { ...EMPTY_TAKHOSUS, ...(raw.takhosus ?? {}) },
    ibadah: { ...EMPTY_IBADAH, ...(raw.ibadah ?? {}), ...mappedIbadah },
    muhadhoroh: {
      ...EMPTY_MUHADHOROH,
      ...(raw.muhadhoroh ?? {}),
      ...mappedMuhadhoroh,
    },
    muhadatsah: { ...EMPTY_MUHADATSAH, ...(raw.muhadatsah ?? {}) },
    kitabProgress: { ...EMPTY_KITAB, ...(raw.kitabProgress ?? {}) },
    akhlak: { ...EMPTY_AKHLAK, ...(raw.akhlak ?? {}) },
    attendance: { ...EMPTY_ATTENDANCE, ...(raw.attendance ?? {}) },
    overallScore: raw.overallScore ?? 0,
    overallGrade: raw.overallGrade ?? "-",
  };
}

function numberOr(
  primary: number | undefined,
  fallback: unknown,
): number | undefined {
  if (typeof primary === "number") return primary;
  return typeof fallback === "number" ? fallback : undefined;
}

function stringOr(
  primary: string | undefined,
  fallback: unknown,
): string | undefined {
  if (primary) return primary;
  return typeof fallback === "string" ? fallback : undefined;
}

async function listRapor(params: ListRaporParams) {
  const { data } = await api.get("/rapor-pesantren", { params });
  return data;
}

async function getRaporById(id: string) {
  const { data } = await api.get(`/rapor-pesantren/${id}`);
  return normalizeRapor(data.data ?? {});
}

interface GenerateRaporParams {
  studentId: string;
  academicYearId: string;
  semester: number;
  unitId?: string;
}

async function generateRapor(params: GenerateRaporParams) {
  const { data } = await api.post("/rapor-pesantren/generate", params);
  return data.data as RaporPesantren;
}

interface GenerateBatchParams {
  unitId: string;
  classId?: string;
  academicYearId: string;
  semester: number;
  studentIds?: string[];
}

async function generateBatchRapor(params: GenerateBatchParams) {
  const { data } = await api.post("/rapor-pesantren/generate-batch", params);
  return data.data as { total: number; success: number; failed: number };
}

interface UpdateRaporParams {
  id: string;
  data: {
    status?: string;
    notes?: string;
    headTeacherNotes?: string;
    musyrifNotes?: string;
    principalNotes?: string;
  };
}

async function updateRapor({ id, data }: UpdateRaporParams) {
  const response = await api.put(`/rapor-pesantren/${id}`, data);
  return response.data;
}

async function deleteRapor(id: string) {
  const { data } = await api.delete(`/rapor-pesantren/${id}`);
  return data;
}

async function getRaporConfig(unitId: string) {
  const { data } = await api.get(`/rapor-pesantren/config/${unitId}`);
  return data.data as RaporConfig;
}

async function saveRaporConfig(config: RaporConfig) {
  const { data } = await api.put(
    `/rapor-pesantren/config/${config.unitId}`,
    config,
  );
  return data.data as RaporConfig;
}

interface GetLegerParams {
  unitId: string;
  classId: string;
  academicYearId: string;
  semester: number;
}

async function getLeger(params: GetLegerParams) {
  const { data } = await api.get("/rapor-pesantren/leger", { params });
  return data.data as LegerItem[];
}

// =====================
// HOOKS
// =====================

export function useRaporList(params: ListRaporParams = {}) {
  return useQuery({
    queryKey: raporPesantrenKeys.list(params as Record<string, unknown>),
    queryFn: () => listRapor(params),
  });
}

export function useRaporDetail(id: string) {
  return useQuery({
    queryKey: raporPesantrenKeys.detail(id),
    queryFn: () => getRaporById(id),
    enabled: !!id,
  });
}

export function useRaporConfig(unitId: string) {
  return useQuery({
    queryKey: raporPesantrenKeys.config(unitId),
    queryFn: () => getRaporConfig(unitId),
    enabled: !!unitId,
  });
}

export function useGenerateRapor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateRapor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: raporPesantrenKeys.lists() });
    },
  });
}

export function useLeger(params: Partial<GetLegerParams>) {
  return useQuery({
    queryKey: raporPesantrenKeys.leger(params as Record<string, unknown>),
    queryFn: () => getLeger(params as GetLegerParams),
    enabled: !!(
      params.unitId &&
      params.classId &&
      params.academicYearId &&
      params.semester
    ),
  });
}

export function useGenerateBatchRapor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateBatchRapor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: raporPesantrenKeys.lists() });
    },
  });
}

export function useUpdateRapor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateRapor,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: raporPesantrenKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: raporPesantrenKeys.lists() });
    },
  });
}

export function useDeleteRapor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteRapor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: raporPesantrenKeys.lists() });
    },
  });
}

export function useSaveRaporConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveRaporConfig,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: raporPesantrenKeys.config(variables.unitId),
      });
    },
  });
}

// =====================
// CONSTANTS
// =====================

export const RAPOR_STATUS = {
  DRAFT: { label: "Draft", color: "gray" },
  FINAL: { label: "Final", color: "blue" },
  PUBLISHED: { label: "Terpublikasi", color: "green" },
} as const;

export const GRADE_COLORS = {
  MUMTAZ: "green",
  JAYYID_JIDDAN: "blue",
  JAYYID: "cyan",
  MAQBUL: "yellow",
  RASIB: "red",
} as const;

export const COMPONENT_LABELS = {
  tahfidz: "Tahfidz Al-Quran",
  ibadah: "Ibadah Harian",
  muhadhoroh: "Muhadhoroh (Pidato)",
  muhadatsah: "Muhadatsah (Percakapan)",
  kitabProgress: "Kitab Kuning",
  akhlak: "Akhlak & Perilaku",
} as const;

export const DEFAULT_WEIGHTS = {
  tahfidz: 20,
  takhosus: 10,
  ibadah: 15,
  muhadhoroh: 15,
  muhadatsah: 15,
  kitabProgress: 15,
  akhlak: 10,
} as const;
