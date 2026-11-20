import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { studentInUnitAt } from '@/utils/student-unit-history';
import { dayOf, todayWib } from '@/utils/wib';
import type {
  DashboardOverviewQuery,
  MetricsQuery,
  UnitComparisonQuery,
  TrendQuery,
  CreateMetricSnapshotInput,
  GenerateReportInput,
} from './dashboard.schema';

// ============================================
// Dashboard Service
// ============================================

export const dashboardService = {
  // ============================================
  // OVERVIEW
  // ============================================

  async getOverview(query: DashboardOverviewQuery) {
    const { unitId } = query;

    // Build where clauses - use unitId not currentUnitId
    const studentWhere: Prisma.StudentWhereInput = {};
    if (unitId) studentWhere.unitId = unitId;

    const teacherWhere: Prisma.TeacherWhereInput = {};
    if (unitId) teacherWhere.unitId = unitId;

    // Get counts in parallel
    const [totalStudents, activeStudents, totalTeachers, totalClasses, totalUnits] =
      await Promise.all([
        prisma.student.count({ where: studentWhere }),
        prisma.student.count({ where: { ...studentWhere, status: 'active' } }),
        prisma.teacher.count({ where: teacherWhere }),
        prisma.class.count({
          where: { ...(unitId ? { unitId } : {}), academicYear: { isActive: true } },
        }),
        prisma.unit.count(),
      ]);

    // Get recent attendance stats (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const attendanceStats = await prisma.attendance.groupBy({
      by: ['status'],
      where: {
        date: { gte: sevenDaysAgo },
        ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
      },
      _count: { _all: true },
    });

    const totalAttendance = attendanceStats.reduce((sum, s) => sum + (s._count?._all || 0), 0);
    const presentCount = attendanceStats.find((s) => s.status === 'PRESENT')?._count?._all || 0;
    const attendanceRate =
      totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0;

    // Get tahfidz stats - use available fields (totalAyah, score)
    const tahfidzStats = await prisma.tahfidzRecord.aggregate({
      _avg: { score: true, totalAyah: true },
      _sum: { totalAyah: true },
      _count: { _all: true },
      where: unitId ? { student: studentInUnitAt(unitId, new Date()) } : {},
    });

    // Get murojaah stats
    const murojaahStats = await prisma.murojaahRecord.aggregate({
      _avg: { qualityScore: true },
      _sum: { pagesReviewed: true },
      _count: { _all: true },
      where: unitId ? { student: studentInUnitAt(unitId, new Date()) } : {},
    });

    // Get simaan stats
    const simaanTotal = await prisma.simaanExam.count({
      where: unitId ? { student: studentInUnitAt(unitId, new Date()) } : {},
    });

    const simaanPassed = await prisma.simaanExam.count({
      where: {
        passed: true,
        ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
      },
    });

    return {
      students: {
        total: totalStudents,
        active: activeStudents,
        inactive: totalStudents - activeStudents,
      },
      teachers: {
        total: totalTeachers,
      },
      classes: {
        total: totalClasses,
      },
      units: {
        total: totalUnits,
      },
      attendance: {
        rate: attendanceRate,
        total: totalAttendance,
        present: presentCount,
      },
      tahfidz: {
        totalRecords: tahfidzStats._count._all,
        avgScore: Math.round(tahfidzStats._avg.score || 0),
        totalAyah: tahfidzStats._sum.totalAyah || 0,
      },
      murojaah: {
        totalRecords: murojaahStats._count._all,
        avgQuality: Math.round(murojaahStats._avg.qualityScore || 0),
        totalPages: murojaahStats._sum.pagesReviewed || 0,
      },
      simaan: {
        totalExams: simaanTotal,
        passedExams: simaanPassed,
        passRate: simaanTotal > 0 ? Math.round((simaanPassed / simaanTotal) * 100) : 0,
      },
    };
  },

  // ============================================
  // METRICS
  // ============================================

  async getMetrics(query: MetricsQuery) {
    const {
      page = 1,
      limit = 20,
      unitId,
      academicYearId,
      metricType,
      periodType,
      dateFrom,
      dateTo,
    } = query;

    const where: Prisma.DashboardMetricSnapshotWhereInput = {};

    if (unitId) where.unitId = unitId;
    if (academicYearId) where.academicYearId = academicYearId;
    if (metricType) where.metricType = metricType;
    if (periodType) where.periodType = periodType;

    if (dateFrom || dateTo) {
      where.periodDate = {};
      if (dateFrom) where.periodDate.gte = new Date(dateFrom);
      if (dateTo) where.periodDate.lte = new Date(dateTo);
    }

    const [metrics, total] = await Promise.all([
      prisma.dashboardMetricSnapshot.findMany({
        where,
        include: {
          unit: { select: { id: true, name: true } },
          academicYear: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { periodDate: 'desc' },
      }),
      prisma.dashboardMetricSnapshot.count({ where }),
    ]);

    return {
      metrics,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async createMetricSnapshot(data: CreateMetricSnapshotInput, userId: string) {
    const snapshot = await prisma.dashboardMetricSnapshot.create({
      data: {
        unitId: data.unitId,
        academicYearId: data.academicYearId,
        metricType: data.metricType,
        metricValue: data.metricValue,
        metricData: data.metricData as Prisma.JsonObject,
        periodType: data.periodType,
        periodDate: new Date(data.periodDate),
        createdById: userId,
      },
      include: {
        unit: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
      },
    });

    return snapshot;
  },

  // ============================================
  // TRENDS
  // ============================================

  async getTrend(query: TrendQuery) {
    const { metricType, unitId, periodType, startDate, endDate, limit = 30 } = query;

    const where: Prisma.DashboardMetricSnapshotWhereInput = {
      metricType,
      periodType,
    };

    if (unitId) where.unitId = unitId;

    if (startDate || endDate) {
      where.periodDate = {};
      if (startDate) where.periodDate.gte = new Date(startDate);
      if (endDate) where.periodDate.lte = new Date(endDate);
    }

    const snapshots = await prisma.dashboardMetricSnapshot.findMany({
      where,
      select: {
        periodDate: true,
        metricValue: true,
        metricData: true,
      },
      orderBy: { periodDate: 'asc' },
      take: limit,
    });

    // Calculate trend
    const values = snapshots.map((s) => s.metricValue);
    const trend =
      values.length >= 2 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : 0;

    return {
      metricType,
      periodType,
      dataPoints: snapshots.map((s) => ({
        date: s.periodDate,
        value: s.metricValue,
        data: s.metricData,
      })),
      summary: {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length || 0,
        trend: Math.round(trend * 100) / 100,
      },
    };
  },

  // ============================================
  // UNIT COMPARISON
  // ============================================

  async getUnitComparison(query: UnitComparisonQuery) {
    const { metricType, academicYearId, periodStart, periodEnd } = query;

    // 1. Get all units
    const units = await prisma.unit.findMany({
      select: { id: true, name: true, type: true },
    });

    const unitIds = units.map((u) => u.id);

    // 2. Build the common where clause for metrics
    const metricWhere: Prisma.DashboardMetricSnapshotWhereInput = {
      unitId: { in: unitIds },
      metricType,
    };
    if (academicYearId) metricWhere.academicYearId = academicYearId;
    if (periodStart || periodEnd) {
      metricWhere.periodDate = {};
      if (periodStart) metricWhere.periodDate.gte = new Date(periodStart);
      if (periodEnd) metricWhere.periodDate.lte = new Date(periodEnd);
    }

    // 3. Get all data in parallel with a few bulk queries
    const [metricsByUnit, studentsByUnit, teachersByUnit] = await Promise.all([
      // Get metrics aggregated by unit
      prisma.dashboardMetricSnapshot.groupBy({
        by: ['unitId'],
        where: metricWhere,
        _avg: { metricValue: true },
        _sum: { metricValue: true },
        _count: { _all: true },
      }),
      // Get active student counts by unit
      prisma.student.groupBy({
        by: ['unitId'],
        where: { unitId: { in: unitIds }, status: 'active' },
        _count: { _all: true },
      }),
      // Get teacher counts by unit
      prisma.teacher.groupBy({
        by: ['unitId'],
        where: { unitId: { in: unitIds } },
        _count: { _all: true },
      }),
    ]);

    // 4. Create maps for efficient lookups
    const metricsMap = new Map(
      metricsByUnit.map((m) => [
        m.unitId,
        {
          avg: m._avg.metricValue || 0,
          sum: m._sum.metricValue || 0,
          count: m._count._all,
        },
      ])
    );

    const studentsMap = new Map(studentsByUnit.map((s) => [s.unitId, s._count._all]));

    const teachersMap = new Map(teachersByUnit.map((t) => [t.unitId, t._count._all]));

    // 5. Combine the data
    const comparisons = units.map((unit) => ({
      unit: {
        id: unit.id,
        name: unit.name,
        type: unit.type,
      },
      metrics: metricsMap.get(unit.id) || { avg: 0, sum: 0, count: 0 },
      stats: {
        students: studentsMap.get(unit.id) || 0,
        teachers: teachersMap.get(unit.id) || 0,
      },
    }));

    return {
      metricType,
      period: {
        start: periodStart,
        end: periodEnd,
      },
      comparisons,
    };
  },

  // ============================================
  // REPORTS
  // ============================================

  async generateReport(data: GenerateReportInput, userId: string) {
    const { unitId, reportType, periodType, periodStart, periodEnd } = data;

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    let reportData: Record<string, unknown>;

    switch (reportType) {
      case 'ACADEMIC':
        reportData = await this.generateAcademicReport(unitId, start, end);
        break;
      case 'ATTENDANCE':
        reportData = await this.generateAttendanceReport(unitId, start, end);
        break;
      case 'TAHFIDZ':
        reportData = await this.generateTahfidzReport(unitId, start, end);
        break;
      case 'ENROLLMENT':
        reportData = await this.generateEnrollmentReport(unitId, start, end);
        break;
      default:
        reportData = {};
    }

    // Save report
    const report = await prisma.unitComparisonReport.create({
      data: {
        unitId,
        reportType,
        periodType,
        periodStart: start,
        periodEnd: end,
        reportData: reportData as Prisma.JsonObject,
        generatedById: userId,
      },
      include: {
        unit: { select: { id: true, name: true } },
      },
    });

    return report;
  },

  async generateAcademicReport(unitId: string | undefined, start: Date, end: Date) {
    const studentWhere: Prisma.StudentWhereInput = unitId ? { unitId } : {};

    const totalStudents = await prisma.student.count({ where: studentWhere });
    const activeStudents = await prisma.student.count({
      where: { ...studentWhere, status: 'active' },
    });

    return {
      summary: {
        totalStudents,
        activeStudents,
        period: { start, end },
      },
    };
  },

  async generateAttendanceReport(unitId: string | undefined, start: Date, end: Date) {
    const where: Prisma.AttendanceWhereInput = {
      date: { gte: start, lte: end },
    };

    if (unitId) {
      where.student = { unitId };
    }

    const stats = await prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const total = stats.reduce((sum, s) => sum + (s._count?._all || 0), 0);
    const present = stats.find((s) => s.status === 'PRESENT')?._count?._all || 0;
    const sick = stats.find((s) => s.status === 'SICK')?._count?._all || 0;
    const absent = stats.find((s) => s.status === 'ABSENT')?._count?._all || 0;

    return {
      summary: {
        total,
        present,
        sick,
        absent,
        attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
      },
      breakdown: stats.map((s) => ({
        status: s.status,
        count: s._count._all,
      })),
    };
  },

  async generateTahfidzReport(unitId: string | undefined, start: Date, end: Date) {
    const where: Prisma.TahfidzRecordWhereInput = {
      recordedAt: { gte: start, lte: end },
    };

    if (unitId) {
      where.student = { unitId };
    }

    const stats = await prisma.tahfidzRecord.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAyah: true },
      _avg: { score: true },
    });

    const byType = await prisma.tahfidzRecord.groupBy({
      by: ['activityType'],
      where,
      _count: { _all: true },
    });

    return {
      summary: {
        totalRecords: stats._count._all,
        totalAyah: stats._sum.totalAyah || 0,
        avgScore: Math.round(stats._avg.score || 0),
      },
      byActivityType: byType.map((b) => ({
        type: b.activityType,
        count: b._count._all,
      })),
    };
  },

  async generateEnrollmentReport(unitId: string | undefined, start: Date, end: Date) {
    const where: Prisma.StudentWhereInput = unitId ? { unitId } : {};

    const totalStudents = await prisma.student.count({ where });
    const byStatus = await prisma.student.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    return {
      summary: {
        total: totalStudents,
        period: { start, end },
      },
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
      })),
    };
  },

  // ============================================
  // QUICK STATS
  // ============================================

  async getQuickStats(unitId?: string) {
    const studentWhere: Prisma.StudentWhereInput = unitId ? { unitId } : {};

    const [students, teachers, classes] = await Promise.all([
      prisma.student.count({ where: { ...studentWhere, status: 'active' } }),
      prisma.teacher.count({ where: unitId ? { unitId } : {} }),
      prisma.class.count({
        where: { ...(unitId ? { unitId } : {}), academicYear: { isActive: true } },
      }),
    ]);

    // Today's attendance. `Attendance.date` and `MurojaahRecord.murojaahDate`
    // are `@db.Date` columns filled with the WIB day (`dayOf(todayWib())`), so
    // the bound is that same stored day — equality, not a lower bound. A local
    // `setHours(0,0,0,0)` on the UTC container yields the UTC day (07:00 WIB),
    // which both counted yesterday and lost today's 00:00–07:00 rows (#1152).
    const today = dayOf(todayWib());

    const todayAttendance = await prisma.attendance.count({
      where: {
        date: today,
        status: 'PRESENT',
        ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
      },
    });

    // Recent murojaah
    const recentMurojaah = await prisma.murojaahRecord.count({
      where: {
        murojaahDate: today,
        ...(unitId ? { student: studentInUnitAt(unitId, new Date()) } : {}),
      },
    });

    return {
      activeStudents: students,
      activeTeachers: teachers,
      totalClasses: classes,
      todayAttendance,
      todayMurojaah: recentMurojaah,
    };
  },
};
