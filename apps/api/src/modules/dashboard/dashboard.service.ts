/**
 * Dashboard Service
 * Business logic for dashboard metrics and statistics
 *
 * This service layer separates business logic from the controller,
 * following the layered architecture pattern for better testability
 * and maintainability.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getCurrentDashboardMetrics } from '@/lib/dashboard-metrics';
import type {
  DashboardStats,
  AttendanceStats,
  FinanceStats,
  TahfidzStats,
  ViolationRewardStats,
  DashboardMetrics,
  DashboardAlert,
  AdmissionsStats,
  CBTStats,
} from '@cipansor/shared';
import { DAY_OF_WEEK_BY_INDEX } from '@cipansor/shared';
import { studentInUnitAt } from '@/utils/student-unit-history';
import { dayOf, shiftWibDay, todayWib } from '@/utils/wib';
import { wibDayStart } from '@/utils/wib-day';
import { memorizedJuz } from '@/modules/tahfidz/quran-surahs';
import { STUDENT_STATUS } from '@cipansor/shared';

export interface DashboardServiceContext {
  userId?: string;
  unitId?: string;
  role?: string;
}

export interface DateRangeParams {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Everything the teacher dashboard shows, scoped to one teacher.
 *
 * `targetAchievement` is deliberately nullable. It can only be computed for
 * students who actually have a TahfidzTarget for the active academic year;
 * when none do, the honest answer is "not measurable", and a 0 would render
 * as "0% of target reached" — a claim about the teacher's work that nothing
 * in the database supports. The UI must handle null, not coalesce it.
 */
export interface TeacherDashboardStats {
  totalStudents: number;
  totalClasses: number;
  setoranToday: number;
  setoranYesterday: number;
  weeklySetoranCount: number;
  monthlySetoranCount: number;
  targetAchievement: number | null;
  studentsWithTarget: number;
}

/**
 * One timetabled lesson for the teacher, today.
 *
 * Resolved server-side because the JWT does not carry a teacherId: the web
 * client used to send `user.id` as `teacherId`, which is a User id and matches
 * no Schedule row, so the teacher's timetable silently came back empty.
 */
export interface TeacherScheduleItem {
  id: string;
  startTime: string;
  endTime: string;
  subjectName: string | null;
  className: string | null;
  room: string | null;
  studentCount: number;
}

export interface TeacherSetoranItem {
  id: string;
  studentName: string;
  className: string | null;
  surahName: string;
  juz: number;
  ayahStart: number;
  ayahEnd: number;
  activityType: string;
  score: number | null;
  recordedAt: Date;
}

export interface TeacherClassSummary {
  id: string;
  name: string;
  level: string;
  studentCount: number;
  isHomeroom: boolean;
}

export interface TeacherDashboard extends TeacherDashboardStats {
  todaySchedule: TeacherScheduleItem[];
  recentSetoran: TeacherSetoranItem[];
  classes: TeacherClassSummary[];
}

export interface PeriodParams {
  period?: 'week' | 'month' | 'year';
}

/**
 * Dashboard Service Class
 * Handles all dashboard-related business logic
 */
export class DashboardService {
  /**
   * Get main dashboard statistics
   */
  async getStats(context: DashboardServiceContext): Promise<DashboardStats> {
    const unitFilter = context.unitId ? { unitId: context.unitId } : {};

    // Calculate date for last month comparison
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    const [
      totalStudents,
      activeStudents,
      lastMonthStudents,
      totalTeachers,
      totalClasses,
      totalUnits,
      todayAttendance,
      activeAcademicYear,
    ] = await Promise.all([
      prisma.student.count({ where: unitFilter }),
      prisma.student.count({ where: { ...unitFilter, status: STUDENT_STATUS.ACTIVE } }),
      prisma.student.count({
        where: {
          ...unitFilter,
          status: STUDENT_STATUS.ACTIVE,
          createdAt: { lte: lastMonth },
        },
      }),
      prisma.teacher.count({ where: unitFilter }),
      // Rombel tahun ajaran aktif saja: rombel tahun lalu tetap tersimpan untuk rapor lama.
      prisma.class.count({ where: { ...unitFilter, academicYear: { isActive: true } } }),
      prisma.unit.count({ where: context.unitId ? { id: context.unitId } : {} }),
      this.getTodayAttendanceCount(context.unitId),
      prisma.academicYear.findFirst({ where: { isActive: true } }),
    ]);

    // Calculate student growth percentage
    let studentsGrowth = 0;
    if (lastMonthStudents > 0) {
      studentsGrowth = Math.round(((activeStudents - lastMonthStudents) / lastMonthStudents) * 100);
    }

    // Calculate attendance rate
    const attendanceRate =
      activeStudents > 0 ? Math.round((todayAttendance / activeStudents) * 100) : 0;

    return {
      totalStudents,
      totalTeachers,
      totalClasses,
      totalUnits,
      studentsGrowth,
      attendanceRate,
      activeAcademicYear: activeAcademicYear
        ? {
            id: activeAcademicYear.id,
            name: activeAcademicYear.name,
            startDate: activeAcademicYear.startDate.toISOString(),
            endDate: activeAcademicYear.endDate.toISOString(),
          }
        : undefined,
    };
  }

  /**
   * Get quick stats for dashboard cards
   */
  async getQuickStats(context: DashboardServiceContext): Promise<{
    totalStudents: number;
    activeStudents: number;
    totalTeachers: number;
    todayAttendance: number;
    attendanceRate: number;
  }> {
    const unitFilter = context.unitId ? { unitId: context.unitId } : {};

    const [totalStudents, activeStudents, totalTeachers, todayAttendance] = await Promise.all([
      prisma.student.count({ where: unitFilter }),
      prisma.student.count({ where: { ...unitFilter, status: STUDENT_STATUS.ACTIVE } }),
      prisma.teacher.count({ where: unitFilter }),
      this.getTodayAttendanceCount(context.unitId),
    ]);

    const attendanceRate =
      activeStudents > 0 ? Math.round((todayAttendance / activeStudents) * 100) : 0;

    return {
      totalStudents,
      activeStudents,
      totalTeachers,
      todayAttendance,
      attendanceRate,
    };
  }

  /**
   * Get dashboard metrics with history and alerts
   */
  async getMetrics(context: DashboardServiceContext): Promise<{
    current: DashboardMetrics;
    recent: DashboardMetrics[];
    alerts: DashboardAlert[];
  }> {
    const [current, recent, alerts] = await Promise.all([
      getCurrentDashboardMetrics(context.unitId),
      this.getRecentMetricsHistory(context.unitId),
      this.getActiveAlerts(context.unitId),
    ]);

    logger.info('Dashboard metrics retrieved', {
      userId: context.userId,
      unitId: context.unitId || 'all',
      alertCount: alerts.length,
    });

    return { current, recent, alerts };
  }

  /**
   * Get attendance statistics with date range
   */
  async getAttendanceStats(
    context: DashboardServiceContext,
    dateRange: DateRangeParams
  ): Promise<AttendanceStats[]> {
    // Default to last 7 days if not specified
    const end = dateRange.endDate || new Date();
    const start = dateRange.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        date: {
          gte: start,
          lte: end,
        },
        // Keanggotaan unit dibaca pada AKHIR rentang yang dilaporkan, bukan
        // hari ini. Rentang ini bisa historis; memakai hari ini berarti
        // menanyakan lagi "unit santri ini SEKARANG apa" — kekeliruan yang
        // penukaran ini justru menghapus.
        ...(context.unitId ? { student: studentInUnitAt(context.unitId, end) } : {}),
      },
      select: {
        date: true,
        status: true,
      },
    });

    // Aggregate by date
    const statsMap = new Map<string, AttendanceStats>();

    attendanceRecords.forEach((record) => {
      const dateStr = record.date.toISOString().split('T')[0];
      if (!statsMap.has(dateStr)) {
        statsMap.set(dateStr, {
          date: dateStr,
          present: 0,
          absent: 0,
          sick: 0,
          excused: 0,
        });
      }

      const stats = statsMap.get(dateStr)!;
      switch (record.status) {
        case 'PRESENT':
          stats.present++;
          break;
        case 'ABSENT':
          stats.absent++;
          break;
        case 'SICK':
          stats.sick++;
          break;
        case 'EXCUSED':
          stats.excused++;
          break;
      }
    });

    return Array.from(statsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get finance statistics
   */
  async getFinanceStats(context: DashboardServiceContext): Promise<FinanceStats> {
    const unitFilter = context.unitId
      ? { student: studentInUnitAt(context.unitId, new Date()) }
      : {};

    const [totalBilled, totalPaid, totalUnpaid, recentPaymentsRaw] = await Promise.all([
      prisma.invoice.aggregate({
        where: { ...unitFilter },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        where: { ...unitFilter, status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        where: { ...unitFilter, status: { not: 'PAID' } },
        _sum: { amount: true },
      }),
      prisma.payment.findMany({
        where: {
          invoice: { ...unitFilter },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          invoice: {
            include: {
              student: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const recentPayments = recentPaymentsRaw.map((p) => ({
      id: p.id,
      studentName: p.invoice.student.user.name,
      amount: Number(p.amount),
      date: p.createdAt.toISOString(),
    }));

    return {
      totalBilled: Number(totalBilled._sum.amount || 0),
      totalPaid: Number(totalPaid._sum.amount || 0),
      totalUnpaid: Number(totalUnpaid._sum.amount || 0),
      recentPayments,
    };
  }

  /**
   * Get comprehensive tahfidz statistics with real data
   */
  async getTahfidzStats(context: DashboardServiceContext, params: PeriodParams = {}) {
    const period = params.period || 'month';
    const now = new Date();
    let periodStart: Date;

    switch (period) {
      case 'week':
        periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        periodStart = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const unitFilter = context.unitId
      ? { student: studentInUnitAt(context.unitId, new Date()) }
      : {};

    // Get total memorized ayah across all students
    const totalMemorizedResult = await prisma.tahfidzRecord.aggregate({
      where: {
        ...unitFilter,
        activityType: 'ZIYADAH',
      },
      _sum: { totalAyah: true },
    });

    // Hafalan per santri dalam juz, menurut ukuran tiap juz (lihat memorizedJuz).
    const ayahByStudentJuz = await prisma.tahfidzRecord.groupBy({
      by: ['studentId', 'juz'],
      where: {
        ...unitFilter,
        activityType: 'ZIYADAH',
      },
      _sum: { totalAyah: true },
    });
    const juzByStudent = new Map<string, Array<[number, number]>>();
    for (const row of ayahByStudentJuz) {
      const list = juzByStudent.get(row.studentId) ?? [];
      list.push([row.juz, row._sum.totalAyah || 0]);
      juzByStudent.set(row.studentId, list);
    }
    const juzOfStudent = (studentId: string) =>
      Math.round(memorizedJuz(juzByStudent.get(studentId) ?? []) * 10) / 10;
    const totalStudentsWithRecords = juzByStudent.size;
    const averageJuz =
      totalStudentsWithRecords > 0
        ? Math.round(
            ([...juzByStudent.values()].reduce((sum, list) => sum + memorizedJuz(list), 0) /
              totalStudentsWithRecords) *
              10
          ) / 10
        : 0;

    // Get top 5 students by memorization
    const topStudentsRaw = await prisma.tahfidzRecord.groupBy({
      by: ['studentId'],
      where: {
        ...unitFilter,
        activityType: 'ZIYADAH',
      },
      _sum: { totalAyah: true },
      orderBy: {
        _sum: { totalAyah: 'desc' },
      },
      take: 5,
    });

    // Fetch student details for top students
    const topStudentIds = topStudentsRaw.map((s) => s.studentId);
    const studentsData = await prisma.student.findMany({
      where: { id: { in: topStudentIds } },
      include: {
        user: { select: { name: true } },
        unit: { select: { name: true } },
      },
    });

    const studentMap = new Map(studentsData.map((s) => [s.id, s]));
    const topStudents = topStudentsRaw.map((s) => {
      const student = studentMap.get(s.studentId);
      const totalAyah = s._sum.totalAyah || 0;
      const juzCount = juzOfStudent(s.studentId);
      return {
        id: s.studentId,
        studentId: s.studentId,
        name: student?.user.name || 'Unknown',
        studentName: student?.user.name || 'Unknown',
        unitName: student?.unit?.name || 'Unknown',
        totalAyat: totalAyah,
        totalAyah,
        totalJuz: juzCount,
        juzCount,
        surahCount: 0, // Would need additional query
      };
    });

    // Get monthly progress
    const monthlyProgress = await this.getMonthlyTahfidzProgress(context, periodStart);

    return {
      totalMemorized: totalMemorizedResult._sum.totalAyah || 0,
      averageJuz,
      topStudents,
      monthlyProgress,
    };
  }

  /**
   * Get violation and reward statistics
   */
  async getViolationRewardStats(context: DashboardServiceContext, params: PeriodParams = {}) {
    const period = params.period || 'month';
    const now = new Date();
    let periodStart: Date;

    switch (period) {
      case 'week':
        periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        periodStart = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const unitFilter = context.unitId
      ? { student: studentInUnitAt(context.unitId, new Date()) }
      : {};

    const [totalViolations, totalRewards, recentViolationsRaw, recentRewardsRaw] =
      await Promise.all([
        prisma.violation.count({
          where: {
            ...unitFilter,
            createdAt: { gte: periodStart },
          },
        }),
        prisma.reward.count({
          where: {
            ...unitFilter,
            createdAt: { gte: periodStart },
          },
        }),
        prisma.violation.findMany({
          where: { ...unitFilter },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            student: {
              include: {
                user: { select: { name: true } },
              },
            },
          },
        }),
        prisma.reward.findMany({
          where: { ...unitFilter },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            student: {
              include: {
                user: { select: { name: true } },
              },
            },
          },
        }),
      ]);

    const recentViolations = recentViolationsRaw.map((v) => ({
      id: v.id,
      studentName: v.student.user.name,
      type: v.type.toString(),
      points: v.points,
      date: v.createdAt.toISOString(),
    }));

    const recentRewards = recentRewardsRaw.map((r) => ({
      id: r.id,
      studentName: r.student.user.name,
      type: r.category, // Reward uses 'category' field
      points: r.points,
      date: r.createdAt.toISOString(),
    }));

    return {
      totalViolations,
      totalRewards,
      recentViolations,
      recentRewards,
    };
  }

  /**
   * Get monthly tahfidz progress data for charts
   */
  private async getMonthlyTahfidzProgress(
    context: DashboardServiceContext,
    since: Date
  ): Promise<Array<{ month: string; ayahCount: number; studentCount: number }>> {
    const unitFilter = context.unitId
      ? { student: studentInUnitAt(context.unitId, new Date()) }
      : {};

    const records = await prisma.tahfidzRecord.findMany({
      where: {
        ...unitFilter,
        activityType: 'ZIYADAH',
        recordedAt: { gte: since },
      },
      select: {
        recordedAt: true,
        totalAyah: true,
        studentId: true,
      },
    });

    // Group by month
    const monthlyMap = new Map<string, { ayahCount: number; students: Set<string> }>();

    records.forEach((record) => {
      const monthKey = record.recordedAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { ayahCount: 0, students: new Set() });
      }
      const data = monthlyMap.get(monthKey)!;
      data.ayahCount += record.totalAyah;
      data.students.add(record.studentId);
    });

    return Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        totalAyat: data.ayahCount, // backward compatibility
        ayahCount: data.ayahCount,
        studentCount: data.students.size,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Get recent metrics history for trend visualization
   */
  private async getRecentMetricsHistory(unitId?: string): Promise<DashboardMetrics[]> {
    try {
      const history = await prisma.dashboardHistory.findMany({
        where: {
          unitId: unitId || null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 12, // Last 12 data points
      });

      if (history.length === 0) {
        const current = await getCurrentDashboardMetrics(unitId);
        return [current];
      }

      return history.map((h) => h.metrics as unknown as DashboardMetrics).reverse();
    } catch (error) {
      logger.error('Error fetching metrics history:', error);
      const current = await getCurrentDashboardMetrics(unitId);
      return [current];
    }
  }

  /**
   * Get active dashboard alerts
   */
  private async getActiveAlerts(unitId?: string): Promise<DashboardAlert[]> {
    const alerts: DashboardAlert[] = [];
    // The day the alert speaks about is the WIB day; `Attendance.date` holds it
    // as a `@db.Date` value, so it is compared for equality, not `>=`.
    const today = dayOf(todayWib());

    try {
      const unitFilter = unitId ? { unitId } : {};

      // 1. Check attendance rate
      const [activeStudents, todayPresent] = await Promise.all([
        prisma.student.count({
          where: { ...unitFilter, status: STUDENT_STATUS.ACTIVE },
        }),
        prisma.attendance.count({
          where: {
            date: today,
            status: 'PRESENT',
            ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
          },
        }),
      ]);

      const attendanceRate = activeStudents > 0 ? (todayPresent / activeStudents) * 100 : 0;

      if (attendanceRate < 80 && attendanceRate > 0) {
        alerts.push({
          id: `attendance-low-${Date.now()}`,
          title: 'Tingkat Kehadiran Rendah',
          message: `Tingkat kehadiran hari ini: ${attendanceRate.toFixed(1)}%. Perlu perhatian khusus.`,
          severity: attendanceRate < 70 ? 'CRITICAL' : 'WARNING',
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Check overdue invoices
      const overdueInvoices = await prisma.invoice.count({
        where: {
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
          dueDate: { lt: new Date() },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
        },
      });

      if (overdueInvoices > 0) {
        alerts.push({
          id: `invoices-overdue-${Date.now()}`,
          title: 'Tagihan Terlambat',
          message: `${overdueInvoices} tagihan melewati batas waktu pembayaran.`,
          severity: overdueInvoices > 10 ? 'WARNING' : 'INFO',
          timestamp: new Date().toISOString(),
        });
      }

      // 3. Check murojaah quality
      const recentQuality = await prisma.murojaahRecord.aggregate({
        _avg: { qualityScore: true },
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
        },
      });

      const avgQuality = Number(recentQuality._avg.qualityScore || 0);
      if (avgQuality > 0 && avgQuality < 75) {
        alerts.push({
          id: `murojaah-quality-low-${Date.now()}`,
          title: 'Kualitas Murojaah Menurun',
          message: `Rata-rata kualitas murojaah 7 hari terakhir: ${avgQuality.toFixed(1)}. Perlu bimbingan tambahan.`,
          severity: avgQuality < 65 ? 'WARNING' : 'INFO',
          timestamp: new Date().toISOString(),
        });
      }

      // 4. Check for students without recent tahfidz activity
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const studentsWithRecentTahfidz = await prisma.tahfidzRecord.findMany({
        where: {
          recordedAt: { gte: sevenDaysAgo },
          ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
        },
        select: { studentId: true },
        distinct: ['studentId'],
      });

      const totalActiveStudents = await prisma.student.count({
        where: { ...unitFilter, status: STUDENT_STATUS.ACTIVE },
      });

      const inactiveStudents = totalActiveStudents - studentsWithRecentTahfidz.length;
      const inactivityRate =
        totalActiveStudents > 0 ? (inactiveStudents / totalActiveStudents) * 100 : 0;

      if (inactivityRate > 30) {
        alerts.push({
          id: `tahfidz-inactive-${Date.now()}`,
          title: 'Banyak Santri Tidak Aktif Tahfidz',
          message: `${inactiveStudents} santri (${inactivityRate.toFixed(0)}%) belum ada aktivitas tahfidz dalam 7 hari terakhir.`,
          severity: inactivityRate > 50 ? 'WARNING' : 'INFO',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error calculating alerts:', error);
    }

    return alerts;
  }

  /**
   * Admissions (PPDB) summary for the dashboard. Registrants have no direct
   * unitId; unit scoping goes through their admission period.
   */
  async getAdmissionsStats(context: DashboardServiceContext): Promise<AdmissionsStats> {
    const registrantFilter = context.unitId ? { admissionPeriod: { unitId: context.unitId } } : {};

    const [totalRegistrants, statusCounts, activePeriods, recentRegistrants] = await Promise.all([
      prisma.registrant.count({ where: registrantFilter }),
      prisma.registrant.groupBy({
        by: ['status'],
        where: registrantFilter,
        _count: true,
      }),
      // Sama dengan gerbang pendaftaran (admissions.service): isActive adalah
      // saklar, tanggal adalah jadwalnya. Gelombang yang sudah tutup atau baru
      // buka bulan depan bukan "periode aktif".
      prisma.admissionPeriod.count({
        where: {
          ...(context.unitId ? { unitId: context.unitId } : {}),
          isActive: true,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
      }),
      prisma.registrant.findMany({
        where: registrantFilter,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, fullName: true, status: true, createdAt: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = Number(row._count);
    }

    return {
      totalRegistrants,
      byStatus,
      activePeriods,
      recentRegistrants: recentRegistrants.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * CBT (online exam) summary for the dashboard.
   */
  async getCBTSummary(context: DashboardServiceContext): Promise<CBTStats> {
    // A CBT exam is one delivered from a question bank (the CBT module refuses to
    // create one without `questionBankId`). Written exams share the table, and
    // counting them made the card report every ulangan as an online exam.
    const unitFilter = {
      ...(context.unitId ? { unitId: context.unitId } : {}),
      questionBankId: { not: null },
    };
    const now = new Date();

    const [totalExams, ongoingExams, upcomingExams, totalAttempts, avgScoreResult] =
      await Promise.all([
        prisma.exam.count({ where: unitFilter }),
        prisma.exam.count({ where: { ...unitFilter, status: 'ONGOING' } }),
        prisma.exam.count({
          where: { ...unitFilter, status: 'SCHEDULED', scheduledAt: { gte: now } },
        }),
        prisma.examAttempt.count({ where: { exam: unitFilter } }),
        prisma.examAttempt.aggregate({
          where: { exam: unitFilter, score: { not: null } },
          _avg: { score: true },
        }),
      ]);

    return {
      totalExams,
      ongoingExams,
      upcomingExams,
      totalAttempts,
      avgScore: Number(avgScoreResult._avg.score ?? 0),
    };
  }

  /**
   * Class IDs a teacher is responsible for.
   *
   * Three independent links exist and a teacher can hold any combination, so
   * this is a union rather than a single lookup: homeroom (Class), timetabled
   * lessons (Schedule) and subject assignments (TeacherSubject). A
   * TeacherSubject with a null classId means "every class" for that subject
   * and carries no class of its own, so it contributes nothing here.
   */
  private async getTeacherClassIds(teacherId: string): Promise<string[]> {
    const [homeroom, scheduled, assigned] = await Promise.all([
      prisma.class.findMany({
        where: { homeroomTeacherId: teacherId, deletedAt: null },
        select: { id: true },
      }),
      prisma.schedule.findMany({
        where: { teacherId, isActive: true },
        select: { classId: true },
        distinct: ['classId'],
      }),
      prisma.teacherSubject.findMany({
        where: { teacherId, isActive: true, classId: { not: null } },
        select: { classId: true },
        distinct: ['classId'],
      }),
    ]);

    return [
      ...new Set([
        ...homeroom.map((c) => c.id),
        ...scheduled.map((s) => s.classId),
        ...assigned.map((t) => t.classId as string),
      ]),
    ];
  }

  /**
   * Teacher dashboard figures, all scoped to the teacher.
   *
   * Student and class counts come from the teacher's own classes; the setoran
   * counts are what this teacher recorded, which is what "Setoran Hari Ini"
   * on their own dashboard means. A teacher with no classes gets zeros and a
   * null achievement — an empty state, not an error.
   */
  async getTeacherStats(teacherId: string, userId: string): Promise<TeacherDashboard> {
    const classIds = await this.getTeacherClassIds(teacherId);

    // Setoran bounds follow the WIB calendar day: `TahfidzRecord.recordedAt` is a
    // real `DateTime`, so a WIB midnight keeps a 00:00–06:59 WIB setoran in
    // "hari ini" instead of dropping it (`dayOf(todayWib())` would be in the
    // future then, and the count would read zero).
    const today = todayWib();
    const startOfToday = wibDayStart(today);
    const startOfYesterday = wibDayStart(shiftWibDay(today, -1));
    const startOfWeek = wibDayStart(shiftWibDay(today, -6));
    const startOfMonth = wibDayStart(`${today.slice(0, 7)}-01`);

    const recordedByMe = { recordedById: userId };

    const [enrollments, setoranToday, setoranYesterday, weeklySetoranCount, monthlySetoranCount] =
      await Promise.all([
        classIds.length
          ? prisma.classEnrollment.findMany({
              where: { classId: { in: classIds }, status: 'active' },
              select: { studentId: true },
              distinct: ['studentId'],
            })
          : Promise.resolve([]),
        prisma.tahfidzRecord.count({
          where: { ...recordedByMe, recordedAt: { gte: startOfToday } },
        }),
        prisma.tahfidzRecord.count({
          where: { ...recordedByMe, recordedAt: { gte: startOfYesterday, lt: startOfToday } },
        }),
        prisma.tahfidzRecord.count({
          where: { ...recordedByMe, recordedAt: { gte: startOfWeek } },
        }),
        prisma.tahfidzRecord.count({
          where: { ...recordedByMe, recordedAt: { gte: startOfMonth } },
        }),
      ]);

    const studentIds = enrollments.map((e) => e.studentId);
    const [{ targetAchievement, studentsWithTarget }, todaySchedule, recentSetoran, classes] =
      await Promise.all([
        this.getTargetAchievement(studentIds),
        this.getTeacherTodaySchedule(teacherId),
        this.getTeacherRecentSetoran(userId),
        this.getTeacherClasses(teacherId, classIds),
      ]);

    return {
      totalStudents: studentIds.length,
      totalClasses: classIds.length,
      setoranToday,
      setoranYesterday,
      weeklySetoranCount,
      monthlySetoranCount,
      targetAchievement,
      studentsWithTarget,
      todaySchedule,
      recentSetoran,
      classes,
    };
  }

  /**
   * The setoran this teacher recorded most recently.
   *
   * Keyed on recordedById, which is a User id — TahfidzRecord links to the
   * recording User, not to Teacher. The web client used to call the general
   * /tahfidz list with a `teacherId` param that endpoint does not accept, so
   * it showed whatever records the caller could see.
   */
  private async getTeacherRecentSetoran(userId: string, limit = 5): Promise<TeacherSetoranItem[]> {
    const records = await prisma.tahfidzRecord.findMany({
      where: { recordedById: userId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        surahName: true,
        juz: true,
        ayahStart: true,
        ayahEnd: true,
        activityType: true,
        score: true,
        recordedAt: true,
        student: {
          select: {
            user: { select: { name: true } },
            enrollments: {
              where: { status: 'active' },
              orderBy: { enrolledAt: 'desc' },
              take: 1,
              select: { class: { select: { name: true } } },
            },
          },
        },
      },
    });

    return records.map((r) => ({
      id: r.id,
      studentName: r.student?.user?.name ?? '-',
      className: r.student?.enrollments[0]?.class?.name ?? null,
      surahName: r.surahName,
      juz: r.juz,
      ayahStart: r.ayahStart,
      ayahEnd: r.ayahEnd,
      activityType: r.activityType,
      score: r.score,
      recordedAt: r.recordedAt,
    }));
  }

  /**
   * The teacher's own classes, with a real head count per class.
   */
  private async getTeacherClasses(
    teacherId: string,
    classIds: string[]
  ): Promise<TeacherClassSummary[]> {
    if (classIds.length === 0) return [];

    const classes = await prisma.class.findMany({
      where: { id: { in: classIds }, deletedAt: null },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        level: true,
        homeroomTeacherId: true,
        _count: { select: { enrollments: true } },
      },
    });

    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      studentCount: c._count.enrollments,
      isHomeroom: c.homeroomTeacherId === teacherId,
    }));
  }

  /**
   * The teacher's timetabled lessons for today, ordered by start time.
   */
  private async getTeacherTodaySchedule(teacherId: string): Promise<TeacherScheduleItem[]> {
    const dayOfWeek = DAY_OF_WEEK_BY_INDEX[new Date().getDay()];

    const schedules = await prisma.schedule.findMany({
      where: { teacherId, isActive: true, dayOfWeek },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        room: true,
        subject: { select: { name: true } },
        class: {
          select: {
            name: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
    });

    return schedules.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      subjectName: s.subject?.name ?? null,
      className: s.class?.name ?? null,
      room: s.room,
      studentCount: s.class?._count.enrollments ?? 0,
    }));
  }

  /**
   * Mean progress against each student's own tahfidz target, as a percentage.
   *
   * "Juz achieved" is the count of distinct juz the student has records in —
   * the same definition getStats already uses for topStudents.completedJuz, so
   * the two screens cannot disagree. Per-student progress is capped at 100%
   * so one student far past their target cannot mask a class that is behind.
   *
   * Returns null when no student has a target for the active year: there is
   * nothing to measure against, and reporting 0 would be a claim, not a gap.
   */
  private async getTargetAchievement(
    studentIds: string[]
  ): Promise<{ targetAchievement: number | null; studentsWithTarget: number }> {
    if (studentIds.length === 0) {
      return { targetAchievement: null, studentsWithTarget: 0 };
    }

    const activeYear = await prisma.academicYear.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (!activeYear) {
      return { targetAchievement: null, studentsWithTarget: 0 };
    }

    const targets = await prisma.tahfidzTarget.findMany({
      where: { studentId: { in: studentIds }, academicYearId: activeYear.id, targetJuz: { gt: 0 } },
      select: { studentId: true, targetJuz: true },
    });
    if (targets.length === 0) {
      return { targetAchievement: null, studentsWithTarget: 0 };
    }

    const juzRecords = await prisma.tahfidzRecord.findMany({
      where: { studentId: { in: targets.map((t) => t.studentId) } },
      select: { studentId: true, juz: true },
      distinct: ['studentId', 'juz'],
    });

    const completedByStudent = new Map<string, number>();
    for (const r of juzRecords) {
      completedByStudent.set(r.studentId, (completedByStudent.get(r.studentId) ?? 0) + 1);
    }

    const ratioSum = targets.reduce((sum, t) => {
      const completed = completedByStudent.get(t.studentId) ?? 0;
      return sum + Math.min(completed / t.targetJuz, 1);
    }, 0);

    return {
      targetAchievement: Math.round((ratioSum / targets.length) * 100),
      studentsWithTarget: targets.length,
    };
  }

  /**
   * Get today's attendance count
   */
  private async getTodayAttendanceCount(unitId?: string): Promise<number> {
    // `Attendance.date` is a `@db.Date` filled with the WIB day
    // (`dayOf(todayWib(...))`), so the bound has to be that same day. A local
    // `setHours(0,0,0,0)` on a UTC container yields the UTC day, one earlier
    // between 00:00 and 06:59 WIB.
    const today = dayOf(todayWib());

    return prisma.attendance.count({
      where: {
        date: today,
        status: 'PRESENT',
        ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
      },
    });
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();
