import { prisma } from '@/lib/prisma';
import { studentScope, type ScopeActor } from '@/utils/student-scope';
import { dayDate, wibDayOf } from '@/utils/wib-day';
import { Prisma, MurojaahType, TahfidzMistakeType } from '@prisma/client';
import type {
  ListMurojaahQuery,
  CreateMurojaahInput,
  UpdateMurojaahInput,
  CreateMistakeInput,
  StudentMurojaahSummaryQuery,
  HalaqohMurojaahQuery,
} from './murojaah.schema';

// ============================================
// Murojaah Service
// ============================================

/**
 * The WIB calendar day a murojaah date names, as the `@db.Date` column holds
 * it. A date input writes "2026-10-28" (that day directly); the form's picker
 * sends a full datetime whose instant is WIB midnight, so its UTC day is the
 * day before. Both must land on the same calendar day.
 */
function murojaahDayDate(value: string): Date {
  return dayDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : wibDayOf(new Date(value)));
}

export const murojaahService = {
  // ============================================
  // LIST & READ
  // ============================================

  async findAll(query: ListMurojaahQuery, context: ScopeActor) {
    const {
      page = 1,
      limit = 20,
      studentId,
      enrollmentId,
      halaqohId,
      unitId,
      murojaahType,
      dateFrom,
      dateTo,
      juz,
      search,
    } = query;

    // Scoped like tahfidz.findAll: staff their unit (the yayasan board and the
    // boarding staff, whose santri span units, all of them), a santri their
    // own records, a wali their children's. The `unitId` filter below narrows
    // within that scope; it used to replace it, so `?unitId=` reopened any unit.
    const scope = studentScope(context);
    const where: Prisma.MurojaahRecordWhereInput = {
      student: unitId ? { AND: [scope, { unitId }] } : scope,
    };

    // Filter by student
    if (studentId) where.studentId = studentId;

    // Filter by enrollment
    if (enrollmentId) where.enrollmentId = enrollmentId;

    // Filter by halaqoh
    if (halaqohId) where.halaqohId = halaqohId;

    // Filter by murojaah type
    if (murojaahType) where.murojaahType = murojaahType as MurojaahType;

    // Date filters
    if (dateFrom || dateTo) {
      where.murojaahDate = {};
      if (dateFrom) where.murojaahDate.gte = murojaahDayDate(dateFrom);
      if (dateTo) where.murojaahDate.lte = murojaahDayDate(dateTo);
    }

    // Filter by juz
    if (juz) {
      where.AND = [{ juzStart: { lte: juz } }, { juzEnd: { gte: juz } }];
    }

    // Search in notes
    if (search) {
      where.OR = [
        { notes: { contains: search, mode: 'insensitive' } },
        { improvementAreas: { contains: search, mode: 'insensitive' } },
        { student: { user: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [records, total] = await Promise.all([
      prisma.murojaahRecord.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              nis: true,
              user: { select: { id: true, name: true } },
            },
          },
          enrollment: {
            select: { id: true, status: true },
          },
          halaqoh: {
            select: { id: true, name: true },
          },
          recordedBy: {
            select: { id: true, name: true },
          },
          mistakes: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ murojaahDate: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.murojaahRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async findById(id: string, context: ScopeActor) {
    const record = await prisma.murojaahRecord.findFirstOrThrow({
      where: { id, student: studentScope(context) },
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            nisn: true,
            user: { select: { id: true, name: true } },
          },
        },
        enrollment: {
          select: { id: true, status: true },
        },
        halaqoh: {
          select: { id: true, name: true, level: true },
        },
        recordedBy: {
          select: { id: true, name: true },
        },
        mistakes: {
          orderBy: { juz: 'asc' },
        },
      },
    });

    return record;
  },

  // ============================================
  // CREATE
  // ============================================

  async create(data: CreateMurojaahInput, userId: string) {
    const murojaahDate = murojaahDayDate(data.murojaahDate);

    const record = await prisma.murojaahRecord.create({
      data: {
        studentId: data.studentId,
        enrollmentId: data.enrollmentId,
        halaqohId: data.halaqohId,
        recordedById: userId,
        murojaahType: data.murojaahType as MurojaahType,
        murojaahDate,
        juzStart: data.juzStart,
        juzEnd: data.juzEnd,
        pagesReviewed: data.pagesReviewed,
        durationMinutes: data.durationMinutes,
        qualityScore: data.qualityScore,
        mistakeCount: data.mistakes?.length || 0,
        fluencyLevel: data.fluencyLevel || 3,
        tajwidScore: data.tajwidScore,
        notes: data.notes,
        improvementAreas: data.improvementAreas,
        mistakes:
          data.mistakes && data.mistakes.length > 0
            ? {
                create: data.mistakes.map((m) => ({
                  mistakeType: m.mistakeType as TahfidzMistakeType,
                  juz: m.juz,
                  surahNumber: m.surahNumber,
                  ayahNumber: m.ayahNumber,
                  description: m.description,
                })),
              }
            : undefined,
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        halaqoh: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        mistakes: true,
      },
    });

    return record;
  },

  // ============================================
  // UPDATE
  // ============================================

  async update(id: string, data: UpdateMurojaahInput) {
    const record = await prisma.murojaahRecord.update({
      where: { id },
      data: {
        ...(data.murojaahType && { murojaahType: data.murojaahType as MurojaahType }),
        ...(data.juzStart !== undefined && { juzStart: data.juzStart }),
        ...(data.juzEnd !== undefined && { juzEnd: data.juzEnd }),
        ...(data.pagesReviewed !== undefined && { pagesReviewed: data.pagesReviewed }),
        ...(data.durationMinutes !== undefined && { durationMinutes: data.durationMinutes }),
        ...(data.qualityScore !== undefined && { qualityScore: data.qualityScore }),
        ...(data.fluencyLevel !== undefined && { fluencyLevel: data.fluencyLevel }),
        ...(data.tajwidScore !== undefined && { tajwidScore: data.tajwidScore }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.improvementAreas !== undefined && { improvementAreas: data.improvementAreas }),
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        mistakes: true,
      },
    });

    return record;
  },

  // ============================================
  // DELETE
  // ============================================

  async delete(id: string) {
    await prisma.murojaahRecord.findUniqueOrThrow({ where: { id } });
    await prisma.murojaahRecord.delete({ where: { id } });
    return { message: 'Murojaah record deleted successfully' };
  },

  // ============================================
  // MISTAKE MANAGEMENT
  // ============================================

  async addMistake(data: CreateMistakeInput) {
    // Verify murojaah exists
    await prisma.murojaahRecord.findUniqueOrThrow({ where: { id: data.murojaahId } });

    const mistake = await prisma.murojaahMistake.create({
      data: {
        murojaahId: data.murojaahId,
        mistakeType: data.mistakeType as TahfidzMistakeType,
        juz: data.juz,
        surahNumber: data.surahNumber,
        ayahNumber: data.ayahNumber,
        description: data.description,
      },
    });

    // Update mistake count
    await prisma.murojaahRecord.update({
      where: { id: data.murojaahId },
      data: { mistakeCount: { increment: 1 } },
    });

    return mistake;
  },

  async deleteMistake(id: string) {
    const mistake = await prisma.murojaahMistake.findUniqueOrThrow({ where: { id } });
    await prisma.murojaahMistake.delete({ where: { id } });

    // Update mistake count
    await prisma.murojaahRecord.update({
      where: { id: mistake.murojaahId },
      data: { mistakeCount: { decrement: 1 } },
    });

    return { message: 'Mistake deleted successfully' };
  },

  // ============================================
  // STUDENT HISTORY & SUMMARY
  // ============================================

  async getStudentHistory(studentId: string, query: ListMurojaahQuery, context: ScopeActor) {
    // This used to run as SUPER_ADMIN on the claim that the caller had been
    // authorised for the student; nothing had. The caller's own scope applies.
    return this.findAll({ ...query, studentId }, context);
  },

  async getStudentSummary(query: StudentMurojaahSummaryQuery) {
    const { studentId, startDate, endDate, murojaahType } = query;

    const where: Prisma.MurojaahRecordWhereInput = { studentId };

    if (startDate || endDate) {
      where.murojaahDate = {};
      if (startDate) where.murojaahDate.gte = murojaahDayDate(startDate);
      if (endDate) where.murojaahDate.lte = murojaahDayDate(endDate);
    }

    if (murojaahType) {
      where.murojaahType = murojaahType as MurojaahType;
    }

    const [stats, mistakesGrouped, coverageRecords, recentRecordsRaw, student] = await Promise.all([
      prisma.murojaahRecord.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          pagesReviewed: true,
          durationMinutes: true,
          mistakeCount: true,
          qualityScore: true,
          fluencyLevel: true,
        },
      }),
      prisma.murojaahMistake.groupBy({
        by: ['mistakeType'],
        where: { murojaah: where },
        _count: { _all: true },
      }),
      prisma.murojaahRecord.findMany({
        where,
        select: { juzStart: true, juzEnd: true },
      }),
      prisma.murojaahRecord.findMany({
        where,
        orderBy: { murojaahDate: 'desc' },
        take: 10,
        select: {
          id: true,
          murojaahDate: true,
          murojaahType: true,
          juzStart: true,
          juzEnd: true,
          pagesReviewed: true,
          qualityScore: true,
          mistakeCount: true,
        },
      }),
      prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, nis: true, user: { select: { name: true } } },
      }),
    ]);

    // Calculate statistics
    const totalSessions = stats._count._all;
    const totalPages = stats._sum.pagesReviewed || 0;
    const totalMinutes = stats._sum.durationMinutes || 0;
    const totalMistakes = stats._sum.mistakeCount || 0;
    const avgQuality =
      totalSessions > 0 ? Math.round((stats._sum.qualityScore || 0) / totalSessions) : 0;
    const avgFluency =
      totalSessions > 0
        ? Math.round(((stats._sum.fluencyLevel || 0) / totalSessions) * 10) / 10
        : 0;

    // Juz coverage analysis
    const juzCoverage: Record<number, number> = {};
    coverageRecords.forEach((r) => {
      for (let j = r.juzStart; j <= r.juzEnd; j++) {
        juzCoverage[j] = (juzCoverage[j] || 0) + 1;
      }
    });

    // Mistake type breakdown
    const mistakeBreakdown: Record<string, number> = {};
    mistakesGrouped.forEach((g) => {
      mistakeBreakdown[g.mistakeType] = g._count._all;
    });

    // Recent murojaah records (last 10)
    const recentRecords = recentRecordsRaw.map((r) => ({
      id: r.id,
      date: r.murojaahDate,
      type: r.murojaahType,
      juzRange: `${r.juzStart}-${r.juzEnd}`,
      pages: r.pagesReviewed,
      quality: r.qualityScore,
      mistakes: r.mistakeCount,
    }));

    return {
      student,
      summary: {
        totalSessions,
        totalPages,
        totalMinutes,
        avgMinutesPerSession: totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0,
        totalMistakes,
        avgMistakesPerSession:
          totalSessions > 0 ? Math.round((totalMistakes / totalSessions) * 10) / 10 : 0,
        avgQualityScore: avgQuality,
        avgFluencyLevel: avgFluency,
      },
      juzCoverage,
      mistakeBreakdown,
      recentRecords,
    };
  },

  // ============================================
  // HALAQOH RECORDS
  // ============================================

  async getHalaqohRecords(query: HalaqohMurojaahQuery) {
    const { halaqohId, page = 1, limit = 20, dateFrom, dateTo } = query;

    const where: Prisma.MurojaahRecordWhereInput = { halaqohId };

    if (dateFrom || dateTo) {
      where.murojaahDate = {};
      if (dateFrom) where.murojaahDate.gte = murojaahDayDate(dateFrom);
      if (dateTo) where.murojaahDate.lte = murojaahDayDate(dateTo);
    }

    const [records, total, halaqoh] = await Promise.all([
      prisma.murojaahRecord.findMany({
        where,
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          mistakes: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ murojaahDate: 'desc' }],
      }),
      prisma.murojaahRecord.count({ where }),
      prisma.halaqoh.findUnique({
        where: { id: halaqohId },
        select: { id: true, name: true, level: true },
      }),
    ]);

    return {
      halaqoh,
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // ============================================
  // SCHEDULE RECOMMENDATION
  // ============================================

  async getMurojaahSchedule(studentId: string) {
    // Get student's tahfidz progress
    const tahfidzRecords = await prisma.tahfidzRecord.findMany({
      where: { studentId },
      orderBy: { recordedAt: 'desc' },
      take: 1,
    });

    // Get recent murojaah records
    const recentMurojaah = await prisma.murojaahRecord.findMany({
      where: { studentId },
      orderBy: { murojaahDate: 'desc' },
      take: 30,
    });

    // Calculate juz that need review (not reviewed in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentlyReviewedJuz = new Set<number>();
    recentMurojaah
      .filter((r) => r.murojaahDate >= sevenDaysAgo)
      .forEach((r) => {
        for (let j = r.juzStart; j <= r.juzEnd; j++) {
          recentlyReviewedJuz.add(j);
        }
      });

    // Get memorized juz (from tahfidz records)
    const memorizedJuz = new Set<number>();
    const currentHafalan = tahfidzRecords[0];
    if (currentHafalan) {
      // TahfidzRecord has 'juz' field, not juzStart/juzEnd
      memorizedJuz.add(currentHafalan.juz);
    }
    // Add all juz from tahfidz records
    tahfidzRecords.forEach((r) => memorizedJuz.add(r.juz));

    // Find juz needing review
    const needsReview: number[] = [];
    memorizedJuz.forEach((juz) => {
      if (!recentlyReviewedJuz.has(juz)) {
        needsReview.push(juz);
      }
    });

    // Create schedule recommendation
    const today = new Date();
    const schedule = [];
    const juzPerDay = 3; // Review 3 juz per day

    for (let i = 0; i < Math.min(7, Math.ceil(needsReview.length / juzPerDay)); i++) {
      const scheduleDate = new Date(today);
      scheduleDate.setDate(scheduleDate.getDate() + i);

      const startIdx = i * juzPerDay;
      const endIdx = Math.min(startIdx + juzPerDay, needsReview.length);
      const juzForDay = needsReview.slice(startIdx, endIdx);

      if (juzForDay.length > 0) {
        schedule.push({
          date: scheduleDate.toISOString().split('T')[0],
          juz: juzForDay,
          estimatedMinutes: juzForDay.length * 15, // ~15 min per juz
          type: i === 0 ? 'DAILY' : 'WEEKLY',
        });
      }
    }

    return {
      student: await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, user: { select: { name: true } } },
      }),
      currentMemorization: {
        totalJuz: memorizedJuz.size,
        juzList: Array.from(memorizedJuz).sort((a, b) => a - b),
      },
      reviewStatus: {
        recentlyReviewed: Array.from(recentlyReviewedJuz).sort((a, b) => a - b),
        needsReview: needsReview.sort((a, b) => a - b),
      },
      recommendedSchedule: schedule,
    };
  },

  // ============================================
  // ANALYTICS
  // ============================================

  /**
   * Get quality distribution analytics
   */
  async getQualityDistribution(query: {
    dateFrom?: string;
    dateTo?: string;
    halaqohId?: string;
    murojaahType?: string;
  }) {
    const where: Prisma.MurojaahRecordWhereInput = {};

    if (query.dateFrom || query.dateTo) {
      where.murojaahDate = {};
      if (query.dateFrom) where.murojaahDate.gte = murojaahDayDate(query.dateFrom);
      if (query.dateTo) where.murojaahDate.lte = murojaahDayDate(query.dateTo);
    }

    if (query.halaqohId) where.halaqohId = query.halaqohId;
    if (query.murojaahType) where.murojaahType = query.murojaahType as MurojaahType;

    // Get all records with quality scores
    const records = await prisma.murojaahRecord.findMany({
      where,
      select: { qualityScore: true },
    });

    // Categorize by quality ranges
    const distribution = {
      excellent: records.filter((r) => r.qualityScore >= 90).length,
      good: records.filter((r) => r.qualityScore >= 75 && r.qualityScore < 90).length,
      fair: records.filter((r) => r.qualityScore >= 60 && r.qualityScore < 75).length,
      poor: records.filter((r) => r.qualityScore < 60).length,
    };

    const total = records.length;

    return {
      distribution: {
        excellent: {
          count: distribution.excellent,
          percentage: total > 0 ? (distribution.excellent / total) * 100 : 0,
        },
        good: {
          count: distribution.good,
          percentage: total > 0 ? (distribution.good / total) * 100 : 0,
        },
        fair: {
          count: distribution.fair,
          percentage: total > 0 ? (distribution.fair / total) * 100 : 0,
        },
        poor: {
          count: distribution.poor,
          percentage: total > 0 ? (distribution.poor / total) * 100 : 0,
        },
      },
      total,
      averageQuality: total > 0 ? records.reduce((sum, r) => sum + r.qualityScore, 0) / total : 0,
    };
  },

  /**
   * Get mistake patterns analytics
   */
  async getMistakePatterns(query: { dateFrom?: string; dateTo?: string; halaqohId?: string }) {
    const where: Prisma.MurojaahRecordWhereInput = {};

    if (query.dateFrom || query.dateTo) {
      where.murojaahDate = {};
      if (query.dateFrom) where.murojaahDate.gte = murojaahDayDate(query.dateFrom);
      if (query.dateTo) where.murojaahDate.lte = murojaahDayDate(query.dateTo);
    }

    if (query.halaqohId) where.halaqohId = query.halaqohId;

    // Get mistakes grouped by type
    const mistakes = await prisma.murojaahMistake.findMany({
      where: {
        murojaah: where,
      },
      select: {
        mistakeType: true,
        murojaah: {
          select: {
            murojaahDate: true,
          },
        },
      },
    });

    // Group by mistake type
    const mistakesByType: Record<string, { count: number; trend: number }> = {};
    const mistakeTypes = ['LAHIN_JALI', 'LAHIN_KHAFI', 'TAJWID', 'MAKHROJ', 'OTHERS'];

    for (const type of mistakeTypes) {
      const typedMistakes = mistakes.filter((m) => m.mistakeType === type);
      mistakesByType[type] = {
        count: typedMistakes.length,
        trend: 0, // Calculate trend if needed
      };
    }

    return {
      patterns: mistakesByType,
      totalMistakes: mistakes.length,
    };
  },

  /**
   * Get consistency score analytics
   */
  async getConsistencyScore(query: { dateFrom?: string; dateTo?: string; halaqohId?: string }) {
    const dateFrom = query.dateFrom
      ? murojaahDayDate(query.dateFrom)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = query.dateTo ? murojaahDayDate(query.dateTo) : new Date();

    const where: Prisma.MurojaahRecordWhereInput = {
      murojaahDate: { gte: dateFrom, lte: dateTo },
    };

    if (query.halaqohId) where.halaqohId = query.halaqohId;

    // Get daily counts
    const records = await prisma.murojaahRecord.findMany({
      where,
      select: {
        murojaahDate: true,
        qualityScore: true,
      },
      orderBy: { murojaahDate: 'asc' },
    });

    // Group by date
    const dailyData: Record<string, { count: number; avgQuality: number }> = {};

    for (const record of records) {
      const dateKey = record.murojaahDate.toISOString().split('T')[0];
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { count: 0, avgQuality: 0 };
      }
      dailyData[dateKey].count++;
      dailyData[dateKey].avgQuality += record.qualityScore;
    }

    // Calculate averages
    const dailyRecords = Object.entries(dailyData).map(([date, data]) => ({
      date,
      count: data.count,
      avgQuality: data.avgQuality / data.count,
    }));

    // Calculate overall consistency percentage
    const totalDays = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
    const activeDays = dailyRecords.length;
    const consistencyPercentage = totalDays > 0 ? (activeDays / totalDays) * 100 : 0;

    return {
      consistencyPercentage,
      activeDays,
      totalDays,
      dailyRecords,
    };
  },

  /**
   * Get top performers
   */
  async getTopPerformers(query: {
    dateFrom?: string;
    dateTo?: string;
    halaqohId?: string;
    limit?: number;
  }) {
    const where: Prisma.MurojaahRecordWhereInput = {};

    if (query.dateFrom || query.dateTo) {
      where.murojaahDate = {};
      if (query.dateFrom) where.murojaahDate.gte = murojaahDayDate(query.dateFrom);
      if (query.dateTo) where.murojaahDate.lte = murojaahDayDate(query.dateTo);
    }

    if (query.halaqohId) where.halaqohId = query.halaqohId;

    // Get all records grouped by student
    const records = await prisma.murojaahRecord.findMany({
      where,
      select: {
        studentId: true,
        qualityScore: true,
        pagesReviewed: true,
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    // Group by student and calculate stats
    const studentStats: Record<
      string,
      {
        studentId: string;
        studentName: string;
        recordCount: number;
        totalPages: number;
        avgQuality: number;
        scores: number[];
      }
    > = {};

    for (const record of records) {
      if (!studentStats[record.studentId]) {
        studentStats[record.studentId] = {
          studentId: record.studentId,
          studentName: record.student.user?.name || 'Unknown',
          recordCount: 0,
          totalPages: 0,
          avgQuality: 0,
          scores: [],
        };
      }
      studentStats[record.studentId].recordCount++;
      studentStats[record.studentId].totalPages += record.pagesReviewed;
      studentStats[record.studentId].scores.push(record.qualityScore);
    }

    // Calculate averages and sort
    const performers = Object.values(studentStats)
      .map((student) => ({
        ...student,
        avgQuality: student.scores.reduce((sum, score) => sum + score, 0) / student.scores.length,
      }))
      .sort((a, b) => b.avgQuality - a.avgQuality)
      .slice(0, query.limit || 10)
      .map((student, index) => ({
        rank: index + 1,
        studentId: student.studentId,
        studentName: student.studentName,
        recordCount: student.recordCount,
        totalPages: student.totalPages,
        avgQuality: Math.round(student.avgQuality * 10) / 10,
      }));

    return { performers };
  },
};
