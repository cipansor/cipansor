import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { DAY_OF_WEEK_BY_INDEX } from "@cipansor/shared";
import { wibWeekdayOf } from "@/lib/wib";

// Types
export interface HafalanProgress {
  totalJuz: number;
  totalPages: number;
  targetJuz: number;
  percentage: number;
  completedSurahs: number;
  totalSurahs: number;
}

export interface RecentHafalan {
  id: string;
  surahName: string;
  juz: number;
  ayahStart: number;
  ayahEnd: number;
  type: "ZIYADAH" | "MUROJAAH" | "TASMI" | "ASSESSMENT";
  grade: string;
  status: "LANCAR" | "TIDAK_LANCAR" | "PERLU_MUROJAAH";
  createdAt: string;
  teacherName?: string;
}

export interface TodayScheduleItem {
  id: string;
  time: string;
  endTime?: string;
  activity: string;
  subject?: string;
  teacher?: string;
  room?: string;
  status: "completed" | "ongoing" | "upcoming";
  type: "ACADEMIC" | "RELIGIOUS" | "TAHFIDZ" | "EXTRACURRICULAR";
}

export interface StudentStats {
  totalHafalan: {
    juz: number;
    pages: number;
  };
  setoranThisMonth: number;
  setoranLastMonth: number;
  averageGrade: string;
  averageScore: number;
  totalRewards: number;
  attendancePercentage: number;
}

export interface StudentDashboardData {
  progress: HafalanProgress;
  recentHafalan: RecentHafalan[];
  todaySchedule: TodayScheduleItem[];
  stats: StudentStats;
  announcements: Array<{
    id: string;
    title: string;
    priority: number;
    createdAt: string;
  }>;
}

// Fetch student tahfidz progress
export function useStudentHafalanProgress() {
  const { user } = useAuthStore();
  const studentId = (user as any)?.studentId || user?.id;

  return useQuery({
    queryKey: ["student", "hafalan-progress", studentId],
    queryFn: async (): Promise<HafalanProgress> => {
      try {
        const response = await api.get(`/tahfidz/summary/${studentId}`);
        const data = response.data.data;

        return {
          totalJuz: data.totalJuz || 0,
          totalPages: data.totalPages || 0,
          targetJuz: data.targetJuz || 5,
          percentage:
            data.percentage ||
            Math.round((data.totalJuz / (data.targetJuz || 5)) * 100),
          completedSurahs: data.completedSurahs || 0,
          totalSurahs: 114,
        };
      } catch (error) {
        // Return default values if API fails
        return {
          totalJuz: 0,
          totalPages: 0,
          targetJuz: 5,
          percentage: 0,
          completedSurahs: 0,
          totalSurahs: 114,
        };
      }
    },
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Fetch recent hafalan records
export function useStudentRecentHafalan(limit: number = 5) {
  const { user } = useAuthStore();
  const studentId = (user as any)?.studentId || user?.id;

  return useQuery({
    queryKey: ["student", "recent-hafalan", studentId, limit],
    queryFn: async (): Promise<RecentHafalan[]> => {
      try {
        const response = await api.get("/tahfidz", {
          params: {
            studentId,
            limit,
            sortBy: "createdAt",
            sortOrder: "desc",
          },
        });

        const records = response.data.data || [];
        return records.map((record: any) => ({
          id: record.id,
          surahName: record.surahName,
          juz: record.juz,
          ayahStart: record.ayahStart,
          ayahEnd: record.ayahEnd,
          type: record.type,
          grade: record.grade || "MAQBUL",
          status:
            record.status ||
            (record.grade === "MUMTAZ" || record.grade === "JAYYID_JIDDAN"
              ? "LANCAR"
              : "PERLU_MUROJAAH"),
          createdAt: record.createdAt,
          teacherName: record.teacher?.name,
        }));
      } catch (error) {
        return [];
      }
    },
    enabled: !!studentId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Fetch today's schedule
export function useStudentTodaySchedule() {
  const { user } = useAuthStore();
  const studentId = (user as any)?.studentId || user?.id;

  return useQuery({
    queryKey: ["student", "today-schedule", studentId],
    queryFn: async (): Promise<TodayScheduleItem[]> => {
      try {
        const today = new Date();
        // The API filters on the WIB school day, not the device's day: a device
        // west of WIB would otherwise ask for the previous day between 17:00 and
        // midnight UTC.
        const dayOfWeek = DAY_OF_WEEK_BY_INDEX[wibWeekdayOf(today)];

        const response = await api.get("/curriculum/schedules", {
          params: {
            studentId,
            dayOfWeek,
          },
        });

        const schedules = response.data.data || [];
        const currentTime = today.getHours() * 60 + today.getMinutes();

        return schedules
          .map((schedule: any) => {
            const [startHour, startMin] = (schedule.startTime || "00:00")
              .split(":")
              .map(Number);
            const [endHour, endMin] = (schedule.endTime || "00:00")
              .split(":")
              .map(Number);
            const scheduleStart = startHour * 60 + startMin;
            const scheduleEnd = endHour * 60 + endMin;

            let status: "completed" | "ongoing" | "upcoming" = "upcoming";
            if (currentTime > scheduleEnd) {
              status = "completed";
            } else if (
              currentTime >= scheduleStart &&
              currentTime <= scheduleEnd
            ) {
              status = "ongoing";
            }

            return {
              id: schedule.id,
              time: schedule.startTime || "00:00",
              endTime: schedule.endTime,
              activity:
                schedule.subject?.name || schedule.activityName || "Kegiatan",
              subject: schedule.subject?.name,
              teacher: schedule.teacher?.name,
              room: schedule.room,
              status,
              type: schedule.subject?.type || schedule.type || "ACADEMIC",
            };
          })
          .sort((a: TodayScheduleItem, b: TodayScheduleItem) =>
            a.time.localeCompare(b.time),
          );
      } catch (error) {
        // Return default schedule if API fails
        return getDefaultSchedule();
      }
    },
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

// Fetch student statistics
export function useStudentStats() {
  const { user } = useAuthStore();
  const studentId = (user as any)?.studentId || user?.id;

  return useQuery({
    queryKey: ["student", "stats", studentId],
    queryFn: async (): Promise<StudentStats> => {
      try {
        // Fetch multiple endpoints in parallel
        const [tahfidzRes, rewardsRes, attendanceRes] =
          await Promise.allSettled([
            api.get(`/tahfidz/summary/${studentId}`),
            api.get("/rewards", { params: { studentId, limit: 100 } }),
            api.get("/attendance/summary", { params: { studentId } }),
          ]);

        const tahfidzData =
          tahfidzRes.status === "fulfilled" ? tahfidzRes.value.data.data : null;
        const rewardsData =
          rewardsRes.status === "fulfilled" ? rewardsRes.value.data : null;
        const attendanceData =
          attendanceRes.status === "fulfilled"
            ? attendanceRes.value.data.data
            : null;

        return {
          totalHafalan: {
            juz: tahfidzData?.totalJuz || 0,
            pages: tahfidzData?.totalPages || 0,
          },
          setoranThisMonth: tahfidzData?.setoranThisMonth || 0,
          setoranLastMonth: tahfidzData?.setoranLastMonth || 0,
          averageGrade: tahfidzData?.averageGrade || "N/A",
          averageScore: tahfidzData?.averageScore || 0,
          totalRewards: rewardsData?.data?.length || rewardsData?.total || 0,
          attendancePercentage: attendanceData?.percentage || 0,
        };
      } catch (error) {
        return {
          totalHafalan: { juz: 0, pages: 0 },
          setoranThisMonth: 0,
          setoranLastMonth: 0,
          averageGrade: "N/A",
          averageScore: 0,
          totalRewards: 0,
          attendancePercentage: 0,
        };
      }
    },
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000,
  });
}

// Fetch recent announcements for student
export function useStudentAnnouncements(limit: number = 3) {
  return useQuery({
    queryKey: ["student", "announcements", limit],
    queryFn: async () => {
      try {
        const response = await api.get("/announcements/recent", {
          params: { limit },
        });
        return response.data.data || [];
      } catch (error) {
        return [];
      }
    },
    staleTime: 2 * 60 * 1000,
  });
}

// Combined dashboard hook
export function useStudentDashboard() {
  const progress = useStudentHafalanProgress();
  const recentHafalan = useStudentRecentHafalan(5);
  const todaySchedule = useStudentTodaySchedule();
  const stats = useStudentStats();
  const announcements = useStudentAnnouncements(3);

  return {
    progress: progress.data,
    recentHafalan: recentHafalan.data,
    todaySchedule: todaySchedule.data,
    stats: stats.data,
    announcements: announcements.data,
    isLoading:
      progress.isLoading ||
      recentHafalan.isLoading ||
      todaySchedule.isLoading ||
      stats.isLoading,
    isError:
      progress.isError &&
      recentHafalan.isError &&
      todaySchedule.isError &&
      stats.isError,
    refetch: () => {
      progress.refetch();
      recentHafalan.refetch();
      todaySchedule.refetch();
      stats.refetch();
      announcements.refetch();
    },
  };
}

// Helper function for default schedule
function getDefaultSchedule(): TodayScheduleItem[] {
  const now = new Date();
  const currentHour = now.getHours();

  const defaultSchedule = [
    {
      time: "05:00",
      activity: "Sholat Subuh & Tahajud",
      type: "RELIGIOUS" as const,
    },
    { time: "05:30", activity: "Tahfidz Pagi", type: "TAHFIDZ" as const },
    { time: "07:00", activity: "Sarapan", type: "EXTRACURRICULAR" as const },
    { time: "08:00", activity: "Pelajaran Formal", type: "ACADEMIC" as const },
    { time: "12:00", activity: "Sholat Dzuhur", type: "RELIGIOUS" as const },
    { time: "13:00", activity: "Tahfidz Siang", type: "TAHFIDZ" as const },
    { time: "15:00", activity: "Sholat Ashar", type: "RELIGIOUS" as const },
    {
      time: "16:00",
      activity: "Ekstrakurikuler",
      type: "EXTRACURRICULAR" as const,
    },
    { time: "18:00", activity: "Sholat Maghrib", type: "RELIGIOUS" as const },
    { time: "19:00", activity: "Sholat Isya", type: "RELIGIOUS" as const },
    { time: "20:00", activity: "Belajar Malam", type: "ACADEMIC" as const },
  ];

  return defaultSchedule.map((item, index) => {
    const [hour] = item.time.split(":").map(Number);
    let status: "completed" | "ongoing" | "upcoming" = "upcoming";

    if (currentHour > hour + 1) {
      status = "completed";
    } else if (currentHour >= hour && currentHour <= hour + 1) {
      status = "ongoing";
    }

    return {
      id: `default-${index}`,
      ...item,
      status,
    };
  });
}

// Grade display helper
export function getGradeDisplay(grade: string): {
  label: string;
  color: string;
} {
  const grades: Record<string, { label: string; color: string }> = {
    MUMTAZ: { label: "Mumtaz (A)", color: "bg-green-100 text-green-800" },
    JAYYID_JIDDAN: {
      label: "Jayyid Jiddan (A-)",
      color: "bg-blue-100 text-blue-800",
    },
    JAYYID: { label: "Jayyid (B+)", color: "bg-cyan-100 text-cyan-800" },
    MAQBUL: { label: "Maqbul (B)", color: "bg-yellow-100 text-yellow-800" },
    RASIB: { label: "Rasib (C)", color: "bg-red-100 text-red-800" },
  };

  return grades[grade] || { label: grade, color: "bg-gray-100 text-gray-800" };
}

// Status display helper
export function getStatusDisplay(status: string): {
  label: string;
  color: string;
} {
  const statuses: Record<string, { label: string; color: string }> = {
    LANCAR: { label: "Lancar", color: "bg-green-100 text-green-700" },
    TIDAK_LANCAR: { label: "Tidak Lancar", color: "bg-red-100 text-red-700" },
    PERLU_MUROJAAH: {
      label: "Perlu Muraja'ah",
      color: "bg-yellow-100 text-yellow-700",
    },
  };

  return (
    statuses[status] || { label: status, color: "bg-gray-100 text-gray-700" }
  );
}
