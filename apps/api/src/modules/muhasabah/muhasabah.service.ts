import { prisma } from '@/lib/prisma';
import { Prisma, MuhasabahMood } from '@prisma/client';
import { dayOf } from '@/utils/wib';
import { CreateMuhasabahInput, UpdateMuhasabahInput } from './muhasabah.schema';

export const muhasabahService = {
  /**
   * Get all muhasabah records with pagination
   */
  async findAll(params: {
    page: number;
    limit: number;
    studentId?: string;
    mood?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, limit, studentId, mood, startDate, endDate } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.DailyMuhasabahWhereInput = {
      ...(studentId && { studentId }),
      ...(mood && { mood: mood as MuhasabahMood }),
    };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      prisma.dailyMuhasabah.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          student: {
            include: {
              user: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.dailyMuhasabah.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get muhasabah by ID
   */
  async findById(id: string) {
    return prisma.dailyMuhasabah.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            unit: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  /**
   * Get muhasabah by student and date
   */
  async findByStudentAndDate(studentId: string, date: Date) {
    return prisma.dailyMuhasabah.findUnique({
      where: {
        studentId_date: {
          studentId,
          date,
        },
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  /**
   * Create muhasabah
   */
  async create(input: CreateMuhasabahInput) {
    // `date` is a "yyyy-MM-dd" calendar day; the `@db.Date` column holds it as
    // midnight UTC. `setHours(0,0,0,0)` would floor to *UTC* midnight on the
    // server's clock, which on a UTC container is the previous WIB day.
    const dateObj = dayOf(input.date);

    // Check if already exists for this day
    const existing = await this.findByStudentAndDate(input.studentId, dateObj);
    if (existing) {
      throw new Error('Muhasabah for this date already exists');
    }

    return prisma.dailyMuhasabah.create({
      data: {
        studentId: input.studentId,
        date: dateObj,
        // Ibadah Wajib
        sholatSubuh: input.sholatSubuh ?? false,
        sholatDzuhur: input.sholatDzuhur ?? false,
        sholatAshar: input.sholatAshar ?? false,
        sholatMaghrib: input.sholatMaghrib ?? false,
        sholatIsya: input.sholatIsya ?? false,
        // Ibadah Sunnah
        sholatTahajud: input.sholatTahajud ?? false,
        sholatDhuha: input.sholatDhuha ?? false,
        sholatRawatib: input.sholatRawatib ?? 0,
        puasaSunnah: input.puasaSunnah ?? false,
        // Tilawah & Dzikir
        tilawahPages: input.tilawahPages ?? 0,
        tilawahJuz: input.tilawahJuz,
        dzikirPagi: input.dzikirPagi ?? false,
        dzikirSore: input.dzikirSore ?? false,
        istighfar: input.istighfar ?? 0,
        shalawat: input.shalawat ?? 0,
        // Hafalan
        murojaahJuz: input.murojaahJuz,
        murojaahPages: input.murojaahPages ?? 0,
        ziyadahAyat: input.ziyadahAyat ?? 0,
        // Kebaikan
        sedekah: input.sedekah ?? false,
        membantOrangTua: input.membantOrangTua ?? false,
        berbaikKeTeman: input.berbaikKeTeman ?? false,
        // Refleksi
        mood: input.mood ?? 'NEUTRAL',
        gratitude: input.gratitude,
        improvement: input.improvement,
        notes: input.notes,
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  /**
   * Update muhasabah
   */
  async update(id: string, input: UpdateMuhasabahInput) {
    return prisma.dailyMuhasabah.update({
      where: { id },
      data: {
        // Ibadah Wajib
        ...(input.sholatSubuh !== undefined && { sholatSubuh: input.sholatSubuh }),
        ...(input.sholatDzuhur !== undefined && { sholatDzuhur: input.sholatDzuhur }),
        ...(input.sholatAshar !== undefined && { sholatAshar: input.sholatAshar }),
        ...(input.sholatMaghrib !== undefined && { sholatMaghrib: input.sholatMaghrib }),
        ...(input.sholatIsya !== undefined && { sholatIsya: input.sholatIsya }),
        // Ibadah Sunnah
        ...(input.sholatTahajud !== undefined && { sholatTahajud: input.sholatTahajud }),
        ...(input.sholatDhuha !== undefined && { sholatDhuha: input.sholatDhuha }),
        ...(input.sholatRawatib !== undefined && { sholatRawatib: input.sholatRawatib }),
        ...(input.puasaSunnah !== undefined && { puasaSunnah: input.puasaSunnah }),
        // Tilawah & Dzikir
        ...(input.tilawahPages !== undefined && { tilawahPages: input.tilawahPages }),
        ...(input.tilawahJuz !== undefined && { tilawahJuz: input.tilawahJuz }),
        ...(input.dzikirPagi !== undefined && { dzikirPagi: input.dzikirPagi }),
        ...(input.dzikirSore !== undefined && { dzikirSore: input.dzikirSore }),
        ...(input.istighfar !== undefined && { istighfar: input.istighfar }),
        ...(input.shalawat !== undefined && { shalawat: input.shalawat }),
        // Hafalan
        ...(input.murojaahJuz !== undefined && { murojaahJuz: input.murojaahJuz }),
        ...(input.murojaahPages !== undefined && { murojaahPages: input.murojaahPages }),
        ...(input.ziyadahAyat !== undefined && { ziyadahAyat: input.ziyadahAyat }),
        // Kebaikan
        ...(input.sedekah !== undefined && { sedekah: input.sedekah }),
        ...(input.membantOrangTua !== undefined && { membantOrangTua: input.membantOrangTua }),
        ...(input.berbaikKeTeman !== undefined && { berbaikKeTeman: input.berbaikKeTeman }),
        // Refleksi
        ...(input.mood !== undefined && { mood: input.mood }),
        ...(input.gratitude !== undefined && { gratitude: input.gratitude }),
        ...(input.improvement !== undefined && { improvement: input.improvement }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  /**
   * Delete muhasabah
   */
  async delete(id: string) {
    return prisma.dailyMuhasabah.delete({
      where: { id },
    });
  },

  /**
   * Get student's muhasabah history
   */
  async getStudentHistory(studentId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return prisma.dailyMuhasabah.findMany({
      where: {
        studentId,
        date: { gte: startDate },
      },
      orderBy: { date: 'desc' },
    });
  },

  /**
   * Get student muhasabah statistics
   */
  async getStudentStats(studentId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const records = await prisma.dailyMuhasabah.findMany({
      where: {
        studentId,
        date: { gte: startDate },
      },
    });

    if (records.length === 0) {
      return {
        totalDays: days,
        recordedDays: 0,
        completionRate: 0,
        sholatWajibRate: 0,
        tahajudRate: 0,
        averageTilawahPages: 0,
        averageIstighfar: 0,
        averageShalawat: 0,
        moodBreakdown: {},
      };
    }

    const totalRecords = records.length;

    // Count complete sholat wajib (all 5 prayers)
    const completeSholatWajib = records.filter(
      (r) => r.sholatSubuh && r.sholatDzuhur && r.sholatAshar && r.sholatMaghrib && r.sholatIsya
    ).length;

    const tahajudDone = records.filter((r) => r.sholatTahajud).length;
    const totalTilawahPages = records.reduce((sum, r) => sum + r.tilawahPages, 0);
    const totalIstighfar = records.reduce((sum, r) => sum + r.istighfar, 0);
    const totalShalawat = records.reduce((sum, r) => sum + r.shalawat, 0);

    // Mood breakdown
    const moodBreakdown: Record<string, number> = {};
    records.forEach((r) => {
      moodBreakdown[r.mood] = (moodBreakdown[r.mood] || 0) + 1;
    });

    return {
      totalDays: days,
      recordedDays: totalRecords,
      completionRate: Math.round((totalRecords / days) * 100),
      sholatWajibRate: Math.round((completeSholatWajib / totalRecords) * 100),
      tahajudRate: Math.round((tahajudDone / totalRecords) * 100),
      averageTilawahPages: Math.round((totalTilawahPages / totalRecords) * 10) / 10,
      averageIstighfar: Math.round(totalIstighfar / totalRecords),
      averageShalawat: Math.round(totalShalawat / totalRecords),
      moodBreakdown,
    };
  },

  /**
   * Get class/halaqoh muhasabah summary
   */
  async getGroupStats(params: {
    unitId?: string;
    classId?: string;
    halaqohId?: string;
    days?: number;
  }) {
    const { unitId, classId, halaqohId, days = 7 } = params;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const studentWhere: any = {};
    if (unitId) studentWhere.unitId = unitId;
    if (classId) studentWhere.classId = classId;

    const students = await prisma.student.findMany({
      where: studentWhere,
      select: { id: true },
    });

    const studentIds = students.map((s) => s.id);

    // If halaqohId, filter by takhosus enrollment
    let filteredStudentIds = studentIds;
    if (halaqohId) {
      const enrollments = await prisma.takhosusEnrollment.findMany({
        where: {
          halaqohId,
          status: 'ACTIVE',
        },
        select: { studentId: true },
      });
      filteredStudentIds = enrollments.map((e) => e.studentId);
    }

    const records = await prisma.dailyMuhasabah.findMany({
      where: {
        studentId: { in: filteredStudentIds },
        date: { gte: startDate },
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Group by student
    const studentStats: Record<
      string,
      { recordCount: number; completeSholat: number; tahajud: number; tilawahPages: number }
    > = {};
    filteredStudentIds.forEach((id) => {
      studentStats[id] = {
        recordCount: 0,
        completeSholat: 0,
        tahajud: 0,
        tilawahPages: 0,
      };
    });

    records.forEach((r) => {
      if (studentStats[r.studentId]) {
        studentStats[r.studentId].recordCount++;
        if (r.sholatSubuh && r.sholatDzuhur && r.sholatAshar && r.sholatMaghrib && r.sholatIsya) {
          studentStats[r.studentId].completeSholat++;
        }
        if (r.sholatTahajud) studentStats[r.studentId].tahajud++;
        studentStats[r.studentId].tilawahPages += r.tilawahPages;
      }
    });

    // Calculate completion rates
    const studentCompletionRates = Object.entries(studentStats).map(([studentId, stats]) => ({
      studentId,
      completionRate: Math.round((stats.recordCount / days) * 100),
      sholatRate:
        stats.recordCount > 0 ? Math.round((stats.completeSholat / stats.recordCount) * 100) : 0,
      tahajudRate:
        stats.recordCount > 0 ? Math.round((stats.tahajud / stats.recordCount) * 100) : 0,
      avgTilawahPages:
        stats.recordCount > 0 ? Math.round((stats.tilawahPages / stats.recordCount) * 10) / 10 : 0,
    }));

    // Overall stats
    const totalStudents = filteredStudentIds.length;
    const avgCompletion =
      studentCompletionRates.reduce((sum, s) => sum + s.completionRate, 0) / (totalStudents || 1);
    const avgSholat =
      studentCompletionRates.reduce((sum, s) => sum + s.sholatRate, 0) / (totalStudents || 1);
    const avgTahajud =
      studentCompletionRates.reduce((sum, s) => sum + s.tahajudRate, 0) / (totalStudents || 1);

    return {
      period: { days, startDate, endDate: new Date() },
      totalStudents,
      totalRecords: records.length,
      averageCompletionRate: Math.round(avgCompletion),
      averageSholatRate: Math.round(avgSholat),
      averageTahajudRate: Math.round(avgTahajud),
      studentStats: studentCompletionRates.sort((a, b) => b.completionRate - a.completionRate),
    };
  },

  /**
   * Get daily report for musyrif
   */
  async getDailyReport(day: string, halaqohId?: string) {
    const startOfDay = dayOf(day);

    let studentIds: string[] | undefined;

    if (halaqohId) {
      const enrollments = await prisma.takhosusEnrollment.findMany({
        where: {
          halaqohId,
          status: 'ACTIVE',
        },
        select: { studentId: true },
      });
      studentIds = enrollments.map((e) => e.studentId);
    }

    const records = await prisma.dailyMuhasabah.findMany({
      where: {
        date: startOfDay,
        ...(studentIds && { studentId: { in: studentIds } }),
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      date: startOfDay,
      totalRecords: records.length,
      records: records.map((r) => ({
        id: r.id,
        student: r.student,
        mood: r.mood,
        sholatWajibComplete:
          r.sholatSubuh && r.sholatDzuhur && r.sholatAshar && r.sholatMaghrib && r.sholatIsya,
        sholatTahajud: r.sholatTahajud,
        tilawahPages: r.tilawahPages,
        gratitude: r.gratitude,
        improvement: r.improvement,
      })),
    };
  },
};

export default muhasabahService;
