import { prisma } from '@/lib/prisma';
import { Prisma, DailyMood, MealConsumption, UnitType, TahfidzActivityType } from '@prisma/client';
import { whatsAppService } from '../notifications';
import { logger } from '@/lib/logger';
import { Errors } from '@/middleware/error';
import {
  assertStudentInScope,
  onlyScopedStudents,
  STUDENT_SAFE_SELECT,
  studentScope,
  type ScopeActor,
} from '@/utils/student-scope';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { dayOf, todayWib, wibTimeOnDay } from '@/utils/wib';
import { STUDENT_STATUS, type BulkCreateDailyReportsResult } from '@cipansor/shared';
import type {
  ListDailyReportsQuery,
  CreateDailyReportInput,
  UpdateDailyReportInput,
  ConfirmDailyReportInput,
  BulkCreateDailyReportsInput,
  StudentDailySummaryQuery,
  ClassDailySummaryQuery,
} from './daily-report.schema';

// ============================================
// Daily Report Service
// Using DailyStudentReport model
//
// Which reports an account reaches is `studentScope`: a wali, their own
// children's; staff, their unit's; the cross-unit roles, every unit's. Outside
// it a report answers 404, so its id is not confirmed. What an account may do
// is the route guard's (DAILY_REPORT_*_ROLE_CODES in @cipansor/shared).
// ============================================

const scopeOf = (actor: ScopeActor): Prisma.DailyStudentReportWhereInput =>
  onlyScopedStudents(studentScope(actor));

async function findInScope(id: string, actor: ScopeActor) {
  const report = await prisma.dailyStudentReport.findFirst({
    where: { AND: [{ id }, scopeOf(actor)] },
    select: { id: true, studentId: true, homeActivity: true },
  });
  if (!report) throw Errors.notFound('Daily report');
  return report;
}

/**
 * The academic year whose dates hold `day`. Not `isActive`: that is a flag
 * someone has to remember to move, and a report belongs to the year it was
 * made in.
 */
async function academicYearFor(day: Date): Promise<string | null> {
  const year = await prisma.academicYear.findFirst({
    where: { deletedAt: null, startDate: { lte: day }, endDate: { gte: day } },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  });
  return year?.id ?? null;
}

const REPORT_STUDENT_SELECT = {
  id: true,
  unitId: true,
  parentName: true,
  parentPhone: true,
  unit: { select: { type: true } },
  user: { select: { name: true } },
} satisfies Prisma.StudentSelect;

const photoRows = (photos: NonNullable<CreateDailyReportInput['photos']>) =>
  photos.map((photo) => ({ photoUrl: photo.url, caption: photo.caption || null }));

export const dailyReportService = {
  // ============================================
  // LIST & READ
  // ============================================

  async findAll(query: Partial<ListDailyReportsQuery>, actor: ScopeActor) {
    const {
      page = 1,
      limit = 20,
      studentId,
      unitId,
      classId,
      academicYearId,
      dateFrom,
      dateTo,
      date,
      mood,
      isConfirmedByParent,
      search,
    } = query;

    const filters: Prisma.DailyStudentReportWhereInput[] = [scopeOf(actor)];

    if (studentId) filters.push({ studentId });
    if (unitId) filters.push({ unitId });
    if (academicYearId) filters.push({ academicYearId });
    if (classId) {
      filters.push({
        student: { enrollments: { some: { classId, status: 'active' } } },
      });
    }

    if (date) {
      filters.push({ reportDate: dayOf(date) });
    } else if (dateFrom || dateTo) {
      filters.push({
        reportDate: {
          ...(dateFrom ? { gte: dayOf(dateFrom) } : {}),
          ...(dateTo ? { lte: dayOf(dateTo) } : {}),
        },
      });
    }

    if (mood) filters.push({ mood: mood as DailyMood });

    // Read by the wali, which is what confirming records.
    if (isConfirmedByParent !== undefined) {
      filters.push({
        parentReadAt: isConfirmedByParent === 'true' ? { not: null } : null,
      });
    }

    if (search) {
      filters.push({
        OR: [
          { activitiesSummary: { contains: search, mode: 'insensitive' } },
          { healthStatus: { contains: search, mode: 'insensitive' } },
          { teacherNotes: { contains: search, mode: 'insensitive' } },
          { student: { user: { name: { contains: search, mode: 'insensitive' } } } },
        ],
      });
    }

    const where: Prisma.DailyStudentReportWhereInput = { AND: filters };

    const [reports, total] = await Promise.all([
      prisma.dailyStudentReport.findMany({
        where,
        include: {
          student: { select: STUDENT_SAFE_SELECT },
          unit: { select: { id: true, name: true } },
          academicYear: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          photos: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.dailyStudentReport.count({ where }),
    ]);

    return {
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async findById(id: string, actor: ScopeActor) {
    const report = await prisma.dailyStudentReport.findFirst({
      where: { AND: [{ id }, scopeOf(actor)] },
      include: {
        student: {
          select: {
            ...STUDENT_SAFE_SELECT,
            birthDate: true,
            enrollments: {
              where: { status: 'active' },
              select: { classId: true },
              take: 1,
            },
          },
        },
        unit: { select: { id: true, name: true, type: true } },
        academicYear: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        photos: true,
        homework: true,
      },
    });
    if (!report) throw Errors.notFound('Daily report');

    return {
      ...report,
      student: {
        ...report.student,
        classId: report.student.enrollments[0]?.classId,
      },
    };
  },

  async findByStudentAndDate(studentId: string, day: Date) {
    return prisma.dailyStudentReport.findUnique({
      where: { studentId_reportDate: { studentId, reportDate: day } },
    });
  },

  // ============================================
  // CREATE
  // ============================================

  /**
   * The unit and the academic year are the pupil's and the day's, never the
   * caller's: a report sits in the unit its pupil belongs to.
   */
  async create(data: CreateDailyReportInput, actor: ScopeActor) {
    const student = await prisma.student.findFirst({
      where: { AND: [{ id: data.studentId }, studentScope(actor)] },
      select: REPORT_STUDENT_SELECT,
    });
    if (!student) throw Errors.notFound('Student');

    const reportDate = dayOf(data.reportDate);
    if (await this.findByStudentAndDate(student.id, reportDate)) {
      throw Errors.conflict('Laporan harian siswa ini untuk tanggal itu sudah ada');
    }

    const report = await prisma.dailyStudentReport.create({
      data: {
        studentId: student.id,
        unitId: student.unitId,
        academicYearId: await academicYearFor(reportDate),
        reportDate,
        unitType: student.unit.type as UnitType,
        arrivalTime: data.arrivalTime ? wibTimeOnDay(data.reportDate, data.arrivalTime) : undefined,
        mood: data.morningMood ?? undefined,
        healthStatus: data.healthNotes,
        temperature: data.temperature,
        hadBreakfast: data.breakfastConsumption
          ? data.breakfastConsumption === 'HABIS' || data.breakfastConsumption === 'SETENGAH'
          : undefined,
        mealStatus: data.lunchConsumption ?? undefined,
        snackStatus: data.snackConsumption ?? undefined,
        napDuration: data.napDurationMinutes,
        toiletNotes: data.toiletingNotes,
        sholatDhuha: data.sholatDhuha,
        sholatDzuhur: data.sholatDzuhur,
        sholatAshar: data.sholatAshar,
        sholatJamaah: data.sholatJamaah,
        activitiesSummary: data.activitiesSummary,
        achievements: data.learningAchievements,
        tahfidzActivity: data.surahPractice,
        behaviorNotes: data.behaviorNotes,
        teacherNotes: data.parentNotes,
        homeActivity: data.homeworkSuggestion,
        createdById: actor.sub,
        photos: data.photos?.length ? { create: photoRows(data.photos) } : undefined,
        homework: data.homework?.length
          ? {
              create: data.homework.map((hw) => ({
                subjectName: hw.subjectName,
                description: hw.description,
                dueDate: hw.dueDate ? dayOf(hw.dueDate) : null,
              })),
            }
          : undefined,
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        unit: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        photos: true,
      },
    });

    if (student.parentPhone) {
      whatsAppService
        .sendDailyReportNotification({
          parentPhone: student.parentPhone,
          parentName: student.parentName || 'Orang Tua',
          studentName: student.user.name,
          date: reportDate,
          mood: data.morningMood ?? undefined,
          healthStatus: data.healthNotes ?? undefined,
        })
        .catch((err) => logger.error(`Failed to send WA notification: ${err}`));
    }

    return report;
  },

  async bulkCreate(data: BulkCreateDailyReportsInput, actor: ScopeActor) {
    const reportDate = dayOf(data.reportDate);
    const academicYearId = await academicYearFor(reportDate);

    // Get teacher record for KitabProgress (actor.sub is User.id, need Teacher.id)
    const teacher = await prisma.teacher.findUnique({
      where: { userId: actor.sub },
      select: { id: true },
    });

    const studentIds = data.reports.map((r) => r.studentId);

    // Pupils this account may write for; anyone else reads as not found.
    const students = await prisma.student.findMany({
      where: { AND: [{ id: { in: studentIds } }, studentScope(actor)] },
      select: REPORT_STUDENT_SELECT,
    });
    const studentById = new Map(students.map((s) => [s.id, s]));

    const existingReports = await prisma.dailyStudentReport.findMany({
      where: { studentId: { in: studentIds }, reportDate },
      select: { studentId: true },
    });
    const existingStudentIds = new Set(existingReports.map((r) => r.studentId));

    const results: BulkCreateDailyReportsResult['details'] = { success: [], failed: [] };

    const validReports: typeof data.reports = [];
    for (const report of data.reports) {
      if (!studentById.has(report.studentId)) {
        results.failed.push({ studentId: report.studentId, error: 'Student not found' });
      } else if (existingStudentIds.has(report.studentId)) {
        results.failed.push({
          studentId: report.studentId,
          error: 'Report already exists for this date',
        });
      } else {
        validReports.push(report);
      }
    }

    if (validReports.some((r) => r.readingProgress) && !teacher) {
      throw Errors.badRequest(
        'Cannot record reading progress: User is not a registered Teacher. Please contact administrator.'
      );
    }

    if (validReports.length > 0) {
      try {
        await prisma.dailyStudentReport.createMany({
          data: validReports.map((report) => {
            const student = studentById.get(report.studentId)!;
            return {
              studentId: report.studentId,
              unitId: student.unitId,
              academicYearId,
              reportDate,
              unitType: student.unit.type as UnitType,
              arrivalTime: report.arrivalTime
                ? wibTimeOnDay(data.reportDate, report.arrivalTime)
                : undefined,
              mood: report.morningMood ?? undefined,
              healthStatus: report.healthNotes,
              hadBreakfast: report.breakfastConsumption
                ? report.breakfastConsumption === 'HABIS' ||
                  report.breakfastConsumption === 'SETENGAH'
                : undefined,
              mealStatus: report.lunchConsumption ?? undefined,
              napDuration: report.napDurationMinutes,
              activitiesSummary: report.activitiesSummary,
              achievements: report.learningAchievements,
              tahfidzActivity: report.surahPractice,
              behaviorNotes: report.behaviorNotes,
              teacherNotes: report.parentNotes,
              homeActivity: report.homeworkSuggestion,
              sholatDhuha: report.sholatDhuha,
              sholatDzuhur: report.sholatDzuhur,
              sholatAshar: report.sholatAshar,
              sholatJamaah: report.sholatJamaah,
              createdById: actor.sub,
            };
          }),
        });

        // Process related data (Kitab & Tahfidz)
        await Promise.all(
          validReports.map(async (report) => {
            const student = studentById.get(report.studentId)!;

            // Reading progress is kept per academic year; a day outside every
            // year has nowhere to put it.
            if (report.readingProgress && teacher && academicYearId) {
              try {
                await prisma.kitabProgress.upsert({
                  where: {
                    kitabId_studentId_academicYearId: {
                      kitabId: report.readingProgress.bookId,
                      studentId: report.studentId,
                      academicYearId,
                    },
                  },
                  update: {
                    currentPage: report.readingProgress.page,
                    teacherId: teacher.id,
                  },
                  create: {
                    kitabId: report.readingProgress.bookId,
                    studentId: report.studentId,
                    academicYearId,
                    teacherId: teacher.id,
                    currentPage: report.readingProgress.page,
                  },
                });
              } catch (err) {
                logger.error(`Failed to update Reading Progress for ${report.studentId}: ${err}`);
              }
            } else if (report.readingProgress && !academicYearId) {
              logger.warn(
                `Skipped Reading Progress for ${report.studentId}: no academic year holds ${data.reportDate}`
              );
            }

            if (report.tahfidzProgress) {
              try {
                await prisma.tahfidzRecord.create({
                  data: {
                    studentId: report.studentId,
                    activityType: TahfidzActivityType.ZIYADAH,
                    surahNumber: report.tahfidzProgress.surahNumber,
                    surahName: report.tahfidzProgress.surahName,
                    ayahStart: report.tahfidzProgress.ayahStart,
                    ayahEnd: report.tahfidzProgress.ayahEnd,
                    juz: 30, // Default to 30 for TK, or calculate
                    totalAyah:
                      report.tahfidzProgress.ayahEnd - report.tahfidzProgress.ayahStart + 1,
                    recordedById: actor.sub,
                    recordedAt: reportDate,
                  },
                });
              } catch (err) {
                logger.error(`Failed to create Tahfidz Record for ${report.studentId}: ${err}`);
              }
            }

            results.success.push(report.studentId);

            if (student.parentPhone) {
              try {
                await whatsAppService.sendDailyReportNotification({
                  parentPhone: student.parentPhone,
                  parentName: student.parentName || 'Orang Tua',
                  studentName: student.user.name,
                  date: reportDate,
                  mood: report.morningMood ?? undefined,
                  healthStatus: report.healthNotes ?? undefined,
                });
              } catch (err) {
                logger.error(
                  `Failed to send WA notification in bulk for ${report.studentId}: ${err}`
                );
              }
            }
          })
        );
      } catch (error) {
        // If createMany fails, all validReports failed
        for (const report of validReports) {
          results.failed.push({
            studentId: report.studentId,
            error: error instanceof Error ? error.message : 'Batch creation failed',
          });
        }
      }
    }

    return {
      created: results.success.length,
      failed: results.failed.length,
      details: results,
    };
  },

  // ============================================
  // UPDATE
  // ============================================

  async update(id: string, data: UpdateDailyReportInput, actor: ScopeActor) {
    await findInScope(id, actor);

    const report = await prisma.dailyStudentReport.update({
      where: { id },
      data: {
        mood: data.morningMood ?? undefined,
        healthStatus: data.healthNotes,
        temperature: data.temperature,
        hadBreakfast: data.breakfastConsumption
          ? data.breakfastConsumption === 'HABIS' || data.breakfastConsumption === 'SETENGAH'
          : undefined,
        mealStatus: data.lunchConsumption ?? undefined,
        snackStatus: data.snackConsumption ?? undefined,
        napDuration: data.napDurationMinutes,
        toiletNotes: data.toiletingNotes,
        sholatDhuha: data.sholatDhuha,
        sholatDzuhur: data.sholatDzuhur,
        sholatAshar: data.sholatAshar,
        sholatJamaah: data.sholatJamaah,
        activitiesSummary: data.activitiesSummary,
        achievements: data.learningAchievements,
        tahfidzActivity: data.surahPractice,
        behaviorNotes: data.behaviorNotes,
        teacherNotes: data.parentNotes,
        homeActivity: data.homeworkSuggestion,
      },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        photos: true,
        homework: true,
      },
    });

    // `photos` and `homework` replace the lists they are sent for.
    if (data.photos !== undefined) {
      await prisma.dailyReportPhoto.deleteMany({ where: { reportId: id } });
      if (data.photos.length > 0) {
        await prisma.dailyReportPhoto.createMany({
          data: photoRows(data.photos).map((row) => ({ ...row, reportId: id })),
        });
      }
    }

    if (data.homework !== undefined) {
      await prisma.dailyHomework.deleteMany({ where: { reportId: id } });
      if (data.homework.length > 0) {
        await prisma.dailyHomework.createMany({
          data: data.homework.map((hw) => ({
            reportId: id,
            subjectName: hw.subjectName,
            description: hw.description,
            dueDate: hw.dueDate ? dayOf(hw.dueDate) : null,
          })),
        });
      }
    }

    return report;
  },

  // ============================================
  // DELETE
  // ============================================

  async delete(id: string, actor: ScopeActor) {
    await findInScope(id, actor);
    // Photos and homework go with it (onDelete: Cascade).
    await prisma.dailyStudentReport.delete({ where: { id } });
    return { message: 'Daily report deleted successfully' };
  },

  // ============================================
  // PARENT CONFIRMATION (Read notification)
  // ============================================

  /** Only a wali of the report's pupil acknowledges it; anyone else gets 404. */
  async confirmByParent(id: string, data: ConfirmDailyReportInput, actor: ScopeActor) {
    const existing = await prisma.dailyStudentReport.findFirst({
      where: { id, student: { parents: { some: { parentId: actor.sub } } } },
      select: { homeActivity: true },
    });
    if (!existing) throw Errors.notFound('Daily report');

    const feedback = data.parentFeedback;
    let homeActivity = existing.homeActivity;
    if (feedback) {
      homeActivity = homeActivity
        ? `${homeActivity}\n\n[Tanggapan Orang Tua]: ${feedback}`
        : `[Tanggapan Orang Tua]: ${feedback}`;
    }

    return prisma.dailyStudentReport.update({
      where: { id },
      data: { parentReadAt: new Date(), homeActivity },
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
      },
    });
  },

  // ============================================
  // SUMMARIES & STATISTICS
  // ============================================

  async getStudentMonthlySummary(query: StudentDailySummaryQuery, actor: ScopeActor) {
    const { studentId, month, year } = query;
    await assertStudentInScope(studentId, actor);

    const now = new Date();
    const targetYear = year || now.getFullYear();
    const targetMonth = month || now.getMonth() + 1;

    const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
    const endDate = new Date(Date.UTC(targetYear, targetMonth, 0));

    const reports = await prisma.dailyStudentReport.findMany({
      where: { studentId, reportDate: { gte: startDate, lte: endDate } },
      include: {
        photos: true,
        homework: true,
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { reportDate: 'asc' },
    });

    const moodDistribution: Record<string, number> = {
      HAPPY: 0,
      NEUTRAL: 0,
      SAD: 0,
      SICK: 0,
      TIRED: 0,
      EXCITED: 0,
    };

    const mealStats: Record<string, Record<string, number>> = {
      meal: { HABIS: 0, SETENGAH: 0, SEDIKIT: 0, TIDAK_MAU: 0 },
      snack: { HABIS: 0, SETENGAH: 0, SEDIKIT: 0, TIDAK_MAU: 0 },
    };

    let totalNapMinutes = 0;
    let napCount = 0;
    let confirmedCount = 0;

    reports.forEach((report) => {
      if (report.mood) moodDistribution[report.mood]++;
      if (report.mealStatus) mealStats.meal[report.mealStatus as MealConsumption]++;
      if (report.snackStatus) mealStats.snack[report.snackStatus as MealConsumption]++;
      if (report.napDuration) {
        totalNapMinutes += report.napDuration;
        napCount++;
      }
      if (report.parentReadAt) confirmedCount++;
    });

    return {
      student: await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, nisn: true, user: { select: { name: true } } },
      }),
      period: {
        month: targetMonth,
        year: targetYear,
        startDate,
        endDate,
      },
      statistics: {
        totalReports: reports.length,
        confirmedByParent: confirmedCount,
        moodDistribution,
        mealStats,
        averageNapDuration: napCount > 0 ? Math.round(totalNapMinutes / napCount) : null,
      },
      reports,
    };
  },

  /**
   * A class, or a unit, on one day. An account bound to a unit reads only its
   * own: the unit it asks for is ignored in favour of its pupils' scope.
   */
  async getClassDailySummary(query: ClassDailySummaryQuery, actor: ScopeActor) {
    const { classId, date } = query;
    const unitId = seesAllUnits(actor) ? query.unitId : (actor.unitId ?? undefined);
    const day = date ?? todayWib();
    const reportDate = dayOf(day);

    const students = await prisma.student.findMany({
      where: {
        AND: [
          studentScope(actor),
          { status: STUDENT_STATUS.ACTIVE },
          unitId ? { unitId } : {},
          classId ? { enrollments: { some: { classId, status: 'active' } } } : {},
        ],
      },
      select: { id: true, nisn: true, user: { select: { name: true } } },
    });

    const reports = await prisma.dailyStudentReport.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, reportDate },
      include: {
        student: { select: { id: true, nisn: true, user: { select: { name: true } } } },
      },
    });

    const reportMap = new Map(reports.map((r) => [r.studentId, r]));

    return {
      date: day,
      totalStudents: students.length,
      reportsSubmitted: reports.length,
      pendingReports: students.length - reports.length,
      confirmedByParents: reports.filter((r) => r.parentReadAt).length,
      moodOverview: {
        happy: reports.filter((r) => r.mood === 'HAPPY').length,
        sick: reports.filter((r) => r.mood === 'SICK').length,
      },
      studentsWithReports: reports.map((r) => ({
        studentId: r.studentId,
        studentName: r.student.user.name,
        mood: r.mood,
        isConfirmed: !!r.parentReadAt,
      })),
      studentsWithoutReports: students
        .filter((s) => !reportMap.has(s.id))
        .map((s) => ({ studentId: s.id, studentName: s.user.name })),
    };
  },
};
