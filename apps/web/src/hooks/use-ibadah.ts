import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, SharedPaginatedResponse } from "@/lib/api";

// ======================
// TYPES & ENUMS
// ======================

export type IbadahCategory =
  "SHOLAT" | "TILAWAH" | "DZIKIR" | "PUASA" | "SEDEKAH" | "SUNNAH" | "OTHER";
export type TargetType = "DAILY" | "WEEKLY" | "MONTHLY";
export type TargetUnit =
  "TIMES" | "MINUTES" | "PAGES" | "JUZ" | "AMOUNT" | "COUNT";
export type LeaderboardPeriod =
  "DAILY" | "WEEKLY" | "MONTHLY" | "SEMESTER" | "YEARLY";
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface IbadahTarget {
  id: string;
  unitId: string;
  name: string;
  nameAr?: string;
  category: IbadahCategory;
  description?: string;
  points: number;
  bonusPoints: number;
  targetType: TargetType;
  targetCount: number;
  targetUnit: TargetUnit;
  isActive: boolean;
  isOptional: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  unit?: {
    id: string;
    name: string;
    code: string;
  };
}

export interface IbadahRecord {
  id: string;
  targetId: string;
  studentId: string;
  date: string;
  isCompleted: boolean;
  actualCount: number;
  actualMinutes?: number;
  pointsEarned: number;
  bonusEarned: number;
  notes?: string;
  verifiedById?: string;
  verifiedAt?: string;
  verificationStatus: VerificationStatus;
  createdAt: string;
  updatedAt: string;
  target?: IbadahTarget;
  student?: {
    id: string;
    name: string;
    nis: string;
    class?: { name: string };
    dormRoom?: { name: string };
  };
  verifiedBy?: {
    id: string;
    name: string;
  };
}

export interface IbadahLeaderboard {
  id: string;
  unitId: string;
  studentId: string;
  periodType: LeaderboardPeriod;
  periodStart: string;
  periodEnd: string;
  totalPoints: number;
  bonusPoints: number;
  streakDays: number;
  completionRate: number;
  rank: number;
  student?: {
    id: string;
    name: string;
    nis: string;
    class?: { name: string };
    dormRoom?: { name: string };
    avatar?: string;
  };
}

export interface IslamicEvent {
  id: string;
  name: string;
  nameAr?: string;
  hijriDate?: string;
  gregorianDate: string;
  description?: string;
  isHoliday: boolean;
  eventType: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentIbadahStats {
  totalPoints: number;
  totalBonusPoints: number;
  currentStreak: number;
  longestStreak: number;
  completionRate: number;
  totalRecords: number;
  verifiedRecords: number;
  categoryBreakdown: {
    category: IbadahCategory;
    points: number;
    completionRate: number;
    recordCount: number;
  }[];
  weeklyProgress: {
    date: string;
    points: number;
    completionRate: number;
  }[];
  summary?: {
    completionRate: number;
    currentStreak: number;
  };
  byCategory?: {
    category: IbadahCategory;
    completionRate: number;
  }[];
}

// ======================
// CONSTANTS
// ======================

export const IBADAH_CATEGORIES: {
  value: IbadahCategory;
  label: string;
  labelAr: string;
  icon: string;
  color: string;
}[] = [
  {
    value: "SHOLAT",
    label: "Sholat",
    labelAr: "الصلاة",
    icon: "🕌",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "TILAWAH",
    label: "Tilawah Al-Quran",
    labelAr: "تلاوة القرآن",
    icon: "📖",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "DZIKIR",
    label: "Dzikir",
    labelAr: "الذكر",
    icon: "📿",
    color: "bg-purple-100 text-purple-800",
  },
  {
    value: "PUASA",
    label: "Puasa",
    labelAr: "الصيام",
    icon: "🌙",
    color: "bg-amber-100 text-amber-800",
  },
  {
    value: "SEDEKAH",
    label: "Sedekah",
    labelAr: "الصدقة",
    icon: "💝",
    color: "bg-pink-100 text-pink-800",
  },
  {
    value: "SUNNAH",
    label: "Ibadah Sunnah",
    labelAr: "السنة",
    icon: "⭐",
    color: "bg-cyan-100 text-cyan-800",
  },
  {
    value: "OTHER",
    label: "Lainnya",
    labelAr: "أخرى",
    icon: "✨",
    color: "bg-gray-100 text-gray-800",
  },
];

export const TARGET_TYPES: { value: TargetType; label: string }[] = [
  { value: "DAILY", label: "Harian" },
  { value: "WEEKLY", label: "Mingguan" },
  { value: "MONTHLY", label: "Bulanan" },
];

export const TARGET_UNITS: { value: TargetUnit; label: string }[] = [
  { value: "TIMES", label: "Kali" },
  { value: "MINUTES", label: "Menit" },
  { value: "PAGES", label: "Halaman" },
  { value: "JUZ", label: "Juz" },
  { value: "AMOUNT", label: "Jumlah (Rp)" },
  { value: "COUNT", label: "Jumlah" },
];

export const LEADERBOARD_PERIODS: {
  value: LeaderboardPeriod;
  label: string;
}[] = [
  { value: "DAILY", label: "Hari Ini" },
  { value: "WEEKLY", label: "Minggu Ini" },
  { value: "MONTHLY", label: "Bulan Ini" },
  { value: "SEMESTER", label: "Semester Ini" },
  { value: "YEARLY", label: "Tahun Ini" },
];

export const VERIFICATION_STATUSES: {
  value: VerificationStatus;
  label: string;
  color: string;
}[] = [
  {
    value: "PENDING",
    label: "Menunggu Verifikasi",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "VERIFIED",
    label: "Terverifikasi",
    color: "bg-green-100 text-green-800",
  },
  { value: "REJECTED", label: "Ditolak", color: "bg-red-100 text-red-800" },
];

// ======================
// TARGET HOOKS
// ======================

export interface ListTargetsParams {
  page?: number;
  limit?: number;
  unitId?: string;
  category?: IbadahCategory;
  targetType?: TargetType;
  isActive?: boolean;
  search?: string;
}

export interface IbadahAchievements {
  totalPoints: number;
  currentStreak: number;
  level: number;
  badges: { id: string; name: string; icon: string }[];
  nextLevelAt: number;
  progressToNextLevel: number;
}

/** Achievements of the logged-in student (GET /ibadah/achievements/me). */
export function useMyIbadahAchievements() {
  return useQuery({
    queryKey: ["ibadah-achievements", "me"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<IbadahAchievements>>(
        "/ibadah/achievements/me",
      );
      return response.data.data;
    },
    retry: false,
  });
}

export function useIbadahTargets(params: ListTargetsParams = {}) {
  return useQuery({
    queryKey: ["ibadah-targets", params],
    queryFn: async () => {
      const response = await api.get<SharedPaginatedResponse<IbadahTarget>>(
        "/ibadah/targets",
        { params },
      );
      return response.data;
    },
  });
}

export function useIbadahTarget(id: string) {
  return useQuery({
    queryKey: ["ibadah-targets", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<IbadahTarget>>(
        `/ibadah/targets/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateTargetData {
  unitId: string;
  name: string;
  nameAr?: string;
  category: IbadahCategory;
  description?: string;
  points: number;
  bonusPoints?: number;
  targetType: TargetType;
  targetCount: number;
  targetUnit: TargetUnit;
  isActive?: boolean;
  isOptional?: boolean;
  sortOrder?: number;
}

export function useCreateIbadahTarget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTargetData) => {
      const response = await api.post<ApiResponse<IbadahTarget>>(
        "/ibadah/targets",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-targets"] });
    },
  });
}

export function useUpdateIbadahTarget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateTargetData>;
    }) => {
      const response = await api.put<ApiResponse<IbadahTarget>>(
        `/ibadah/targets/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-targets"] });
      queryClient.invalidateQueries({
        queryKey: ["ibadah-targets", variables.id],
      });
    },
  });
}

export function useDeleteIbadahTarget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/ibadah/targets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-targets"] });
    },
  });
}

export function useSeedDefaultTargets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (unitId: string) => {
      const response = await api.post<ApiResponse<IbadahTarget[]>>(
        `/ibadah/targets/seed/${unitId}`,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-targets"] });
    },
  });
}

// ======================
// RECORD HOOKS
// ======================

export interface ListRecordsParams {
  page?: number;
  limit?: number;
  studentId?: string;
  targetId?: string;
  unitId?: string;
  classId?: string;
  dormRoomId?: string;
  category?: IbadahCategory;
  date?: string;
  startDate?: string;
  endDate?: string;
  verificationStatus?: VerificationStatus;
  isCompleted?: boolean;
}

export function useIbadahRecords(params: ListRecordsParams = {}) {
  return useQuery({
    queryKey: ["ibadah-records", params],
    queryFn: async () => {
      const response = await api.get<SharedPaginatedResponse<IbadahRecord>>(
        "/ibadah/records",
        { params },
      );
      return response.data;
    },
  });
}

export function useIbadahRecord(id: string) {
  return useQuery({
    queryKey: ["ibadah-records", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<IbadahRecord>>(
        `/ibadah/records/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateRecordData {
  targetId: string;
  studentId: string;
  date: string;
  isCompleted: boolean;
  actualCount: number;
  actualMinutes?: number;
  notes?: string;
}

export function useCreateIbadahRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateRecordData) => {
      const response = await api.post<ApiResponse<IbadahRecord>>(
        "/ibadah/records",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-records"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-stats"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-leaderboard"] });
    },
  });
}

export function useUpdateIbadahRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateRecordData>;
    }) => {
      const response = await api.put<ApiResponse<IbadahRecord>>(
        `/ibadah/records/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-records"] });
      queryClient.invalidateQueries({
        queryKey: ["ibadah-records", variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ["ibadah-stats"] });
    },
  });
}

export function useDeleteIbadahRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/ibadah/records/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-records"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-stats"] });
    },
  });
}

export interface BulkCreateRecordsData {
  studentId: string;
  date: string;
  records: {
    targetId: string;
    isCompleted: boolean;
    actualCount: number;
    actualMinutes?: number;
    notes?: string;
  }[];
}

export function useBulkCreateIbadahRecords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BulkCreateRecordsData) => {
      const response = await api.post<ApiResponse<IbadahRecord[]>>(
        "/ibadah/records/bulk",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-records"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-stats"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-leaderboard"] });
    },
  });
}

export interface VerifyRecordsData {
  recordIds: string[];
  status: "VERIFIED" | "REJECTED";
  notes?: string;
}

export function useVerifyIbadahRecords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: VerifyRecordsData) => {
      const response = await api.post<ApiResponse<{ verified: number }>>(
        "/ibadah/records/verify",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-records"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-stats"] });
    },
  });
}

// ======================
// DAILY CHECK-IN
// ======================

export interface DailyCheckInData {
  studentId: string;
  unitId: string;
  date: string;
  checkIns: {
    targetId: string;
    isCompleted: boolean;
    actualCount: number;
    actualMinutes?: number;
    notes?: string;
  }[];
}

export function useDailyCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: DailyCheckInData) => {
      const response = await api.post<
        ApiResponse<{
          records: IbadahRecord[];
          totalPointsToday: number;
          streak: number;
        }>
      >("/ibadah/check-in", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ibadah-records"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-stats"] });
      queryClient.invalidateQueries({ queryKey: ["ibadah-leaderboard"] });
    },
  });
}

// ======================
// LEADERBOARD HOOKS
// ======================

export interface LeaderboardParams {
  unitId: string;
  periodType: LeaderboardPeriod;
  classId?: string;
  dormRoomId?: string;
  limit?: number;
}

export function useIbadahLeaderboard(params: LeaderboardParams) {
  return useQuery({
    queryKey: ["ibadah-leaderboard", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<any>>("/ibadah/leaderboard", {
        params,
      });
      // The endpoint returns { data: { periodType, startDate, endDate, data: [] } }
      // — the entries are nested under data.data. Return the array so the page's
      // `leaderboard.map` doesn't crash.
      const lb = response.data.data;
      return (Array.isArray(lb) ? lb : (lb?.data ?? [])) as IbadahLeaderboard[];
    },
    enabled: !!params.unitId,
  });
}

// ======================
// STATISTICS HOOKS
// ======================

export interface StudentStatsParams {
  studentId: string;
  startDate?: string;
  endDate?: string;
}

export function useStudentIbadahStats(params: StudentStatsParams) {
  return useQuery({
    queryKey: ["ibadah-stats", "student", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<StudentIbadahStats>>(
        "/ibadah/stats/student",
        { params },
      );
      return response.data.data;
    },
    enabled: !!params.studentId,
  });
}

export interface UnitStatsParams {
  unitId: string;
  startDate?: string;
  endDate?: string;
}

export function useUnitIbadahStats(params: UnitStatsParams) {
  return useQuery({
    queryKey: ["ibadah-stats", "unit", params],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          totalStudents: number;
          activeStudents: number;
          totalPoints: number;
          averageCompletionRate: number;
          categoryBreakdown: {
            category: IbadahCategory;
            totalPoints: number;
            averageCompletion: number;
          }[];
          topPerformers: {
            studentId: string;
            studentName: string;
            points: number;
            streak: number;
          }[];
        }>
      >("/ibadah/stats/unit", { params });
      return response.data.data;
    },
    enabled: !!params.unitId,
  });
}

export interface ClassStatsParams {
  classId: string;
  startDate?: string;
  endDate?: string;
}

export function useClassIbadahStats(params: ClassStatsParams) {
  return useQuery({
    queryKey: ["ibadah-stats", "class", params],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          totalStudents: number;
          averageCompletionRate: number;
          studentStats: {
            studentId: string;
            studentName: string;
            totalPoints: number;
            completionRate: number;
            streak: number;
          }[];
        }>
      >("/ibadah/stats/class", { params });
      return response.data.data;
    },
    enabled: !!params.classId,
  });
}

// ======================
// ISLAMIC EVENTS HOOKS
// ======================

export interface ListEventsParams {
  page?: number;
  limit?: number;
  year?: number;
  month?: number;
  isHoliday?: boolean;
  eventType?: string;
  startDate?: string;
  endDate?: string;
}

export function useIslamicEvents(params: ListEventsParams = {}) {
  return useQuery({
    queryKey: ["islamic-events", params],
    queryFn: async () => {
      const response = await api.get<SharedPaginatedResponse<IslamicEvent>>(
        "/ibadah/events",
        { params },
      );
      return response.data;
    },
  });
}

export function useIslamicEvent(id: string) {
  return useQuery({
    queryKey: ["islamic-events", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<IslamicEvent>>(
        `/ibadah/events/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateIslamicEventData {
  name: string;
  nameAr?: string;
  hijriDate?: string;
  gregorianDate: string;
  description?: string;
  isHoliday?: boolean;
  eventType: string;
}

export function useCreateIslamicEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateIslamicEventData) => {
      const response = await api.post<ApiResponse<IslamicEvent>>(
        "/ibadah/events",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["islamic-events"] });
    },
  });
}

export function useUpdateIslamicEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateIslamicEventData>;
    }) => {
      const response = await api.put<ApiResponse<IslamicEvent>>(
        `/ibadah/events/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["islamic-events"] });
      queryClient.invalidateQueries({
        queryKey: ["islamic-events", variables.id],
      });
    },
  });
}

export function useDeleteIslamicEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/ibadah/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["islamic-events"] });
    },
  });
}

// ======================
// HELPER FUNCTIONS
// ======================

export function getCategoryInfo(category: IbadahCategory) {
  return (
    IBADAH_CATEGORIES.find((c) => c.value === category) || IBADAH_CATEGORIES[6]
  );
}

export function getTargetTypeLabel(type: TargetType) {
  return TARGET_TYPES.find((t) => t.value === type)?.label || type;
}

export function getTargetUnitLabel(unit: TargetUnit) {
  return TARGET_UNITS.find((u) => u.value === unit)?.label || unit;
}

export function getVerificationStatusInfo(status: VerificationStatus) {
  return (
    VERIFICATION_STATUSES.find((s) => s.value === status) ||
    VERIFICATION_STATUSES[0]
  );
}

export function formatPoints(points: number) {
  if (points >= 1000) {
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toString();
}

export function getStreakEmoji(streak: number) {
  if (streak >= 30) return "🔥🔥🔥";
  if (streak >= 14) return "🔥🔥";
  if (streak >= 7) return "🔥";
  if (streak >= 3) return "✨";
  return "";
}
