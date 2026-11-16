import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import { UserRole, Prisma, AttendanceStatus as PrismaAttendanceStatus } from '@prisma/client';
import { eventBus } from '@/lib/event-bus';
import {
  AttendanceStatus,
  CreateAttendanceInput,
  BulkAttendanceInput,
  UpdateAttendanceInput,
  Attendance,
  AttendanceCalendarResponse,
  AttendanceSummary,
  BulkAttendanceResult,
} from '@cipansor/shared';
import type { ListAttendanceQuery, AttendanceSummaryQuery } from './attendance.schema';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { STUDENT_SAFE_SELECT, studentScope, type ScopeActor } from '@/utils/student-scope';
import { assertMayRecord, recorderScope, type AttendanceActor } from './attendance.access';
import { dayOf, dayString, todayWib } from '@/utils/wib';
import { tellAbsences } from './attendance.notice';

export class AttendanceService {
  /**
   * Helper to safely map Prisma Attendance to Shared Attendance
   */
  private mapToShared(record: any): Attendance {
    return {
      ...record,
      status: record.status as unknown as AttendanceStatus,
    };
  }

  /**
   * Get attendance records with pagination
   */
  async findAll(query: ListAttendanceQuery, currentUser: ScopeActor) {
    const { page, limit, classId, studentId, date, startDate, endDate, status } = query;
    const skip = (page - 1) * limit;

    // Staff see their unit, a santri their own days, a wali their children's.
    // (Filtering by unit alone gave a santri the whole school's register.)
    const where: Prisma.AttendanceWhereInput = { student: studentScope(currentUser) };

    if (classId) {
      where.classId = classId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (status) {
      // Cast shared status to Prisma status (safe because we aligned them)
      where.status = status as unknown as PrismaAttendanceStatus;
    }

    // Date filtering with timezone safety
    if (date) {
      // query.date is a string (YYYY-MM-DD) from schema
      const d = new Date(date);
      // Use string comparison for date part to avoid timezone shifts if storing as Date
      // OR explicitly set UTC boundaries if the DB stores timestamps
      // Assuming DB stores DateTime (timestamp), we need range coverage
      // Using UTC methods to ignore server local timezone
      const startOfDay = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
      );
      const endOfDay = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
      );

      where.date = {
        gte: startOfDay,
        lte: endOfDay,
      };
    } else if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: {
          student: { select: STUDENT_SAFE_SELECT },
          class: {
            select: { id: true, name: true, level: true },
          },
          recordedBy: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.attendance.count({ where }),
    ]);

    // Map to shared type Attendance
    const mappedRecords: Attendance[] = records.map(this.mapToShared);

    return {
      records: mappedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single attendance record
   */
  async findById(id: string, currentUser: ScopeActor): Promise<Attendance> {
    const attendance = await prisma.attendance.findFirst({
      where: { id, student: studentScope(currentUser) },
      include: {
        student: {
          select: { ...STUDENT_SAFE_SELECT, unit: { select: { id: true, name: true } } },
        },
        class: { select: { id: true, name: true, level: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    });

    if (!attendance) {
      throw Errors.notFound('Attendance record');
    }

    return this.mapToShared(attendance);
  }

  /**
   * One pupil's day, by someone who records the class's register
   * (attendance.access.ts). A second record for the same day is a conflict;
   * the class form (bulk) is how a day is corrected.
   */
  async create(input: CreateAttendanceInput, actor: AttendanceActor): Promise<Attendance> {
    await assertMayRecord(input.classId, input.date, actor);

    const enrollment = await prisma.classEnrollment.findFirst({
      where: { studentId: input.studentId, classId: input.classId, status: 'active' },
      select: { id: true },
    });
    if (!enrollment) {
      throw Errors.badRequest('Siswa tidak terdaftar di kelas ini');
    }

    const date = dayOf(input.date);
    const existing = await prisma.attendance.findUnique({
      where: {
        studentId_classId_date: { studentId: input.studentId, classId: input.classId, date },
      },
      select: { id: true },
    });
    if (existing) {
      throw Errors.conflict('Absensi siswa ini pada tanggal itu sudah dicatat');
    }

    const attendance = await prisma.attendance.create({
      data: {
        studentId: input.studentId,
        classId: input.classId,
        date,
        status: input.status as unknown as PrismaAttendanceStatus,
        notes: input.notes,
        recordedById: actor.sub,
      },
      include: {
        student: { select: { ...STUDENT_SAFE_SELECT, unit: { select: { id: true, name: true } } } },
        class: { select: { id: true, name: true } },
      },
    });

    // Emit event for cross-module integration
    eventBus.emit('attendance:created', {
      id: attendance.id,
      studentId: attendance.studentId,
      studentName: attendance.student.user?.name || 'Unknown',
      classId: attendance.classId,
      className: attendance.class?.name || '',
      unitId: attendance.student.unitId,
      unitName: attendance.student.unit?.name || '',
      status: attendance.status as any,
      date: attendance.date,
      recordedById: actor.sub,
    });

    void tellAbsences(input.classId, input.date, [
      { studentId: input.studentId, status: attendance.status },
    ]);

    return this.mapToShared(attendance);
  }

  /**
   * A pupil's day recorded by another module on the server — the UKS marking
   * a pupil it sent home sick. The calling module checks its own caller, so
   * there is no class relation to check here; a day the class's teachers
   * already recorded is left as they recorded it.
   */
  async recordFromIntegration(
    input: {
      studentId: string;
      classId: string;
      on: Date;
      status: AttendanceStatus;
      notes?: string;
    },
    recordedById: string
  ): Promise<'created' | 'already-recorded'> {
    const date = dayOf(todayWib(input.on));
    const existing = await prisma.attendance.findUnique({
      where: {
        studentId_classId_date: { studentId: input.studentId, classId: input.classId, date },
      },
      select: { id: true },
    });
    if (existing) return 'already-recorded';
    await prisma.attendance.create({
      data: {
        studentId: input.studentId,
        classId: input.classId,
        date,
        status: input.status as unknown as PrismaAttendanceStatus,
        notes: input.notes,
        recordedById,
      },
    });
    return 'created';
  }

  /**
   * A class's day. Pupils already recorded that day are updated, not skipped:
   * saving the register again is how it is corrected.
   */
  async bulkCreate(
    input: BulkAttendanceInput,
    actor: AttendanceActor
  ): Promise<BulkAttendanceResult> {
    await assertMayRecord(input.classId, input.date, actor);

    const studentIds = input.records.map((r) => r.studentId);
    if (new Set(studentIds).size !== studentIds.length) {
      throw Errors.badRequest('Satu siswa tercatat lebih dari sekali');
    }

    const enrolled = new Set(
      (
        await prisma.classEnrollment.findMany({
          where: { classId: input.classId, status: 'active' },
          select: { studentId: true },
        })
      ).map((e) => e.studentId)
    );
    if (studentIds.some((id) => !enrolled.has(id))) {
      throw Errors.badRequest('Ada siswa yang tidak terdaftar di kelas ini');
    }

    const date = dayOf(input.date);
    const recorded = new Map(
      (
        await prisma.attendance.findMany({
          where: { classId: input.classId, date, studentId: { in: studentIds } },
          select: { studentId: true, status: true },
        })
      ).map((a) => [a.studentId, a.status])
    );

    await prisma.$transaction(
      input.records.map((record) => {
        const values = {
          status: record.status as unknown as PrismaAttendanceStatus,
          notes: record.notes ?? null,
          recordedById: actor.sub,
        };
        return prisma.attendance.upsert({
          where: {
            studentId_classId_date: { studentId: record.studentId, classId: input.classId, date },
          },
          create: { studentId: record.studentId, classId: input.classId, date, ...values },
          update: values,
        });
      })
    );

    void tellAbsences(
      input.classId,
      input.date,
      input.records.map((r) => ({
        studentId: r.studentId,
        status: r.status as unknown as PrismaAttendanceStatus,
        before: recorded.get(r.studentId),
      }))
    );

    const updated = studentIds.filter((id) => recorded.has(id)).length;
    return { created: studentIds.length - updated, updated };
  }

  /**
   * Change one pupil's day — by someone who records the class's register, for
   * a day they may record.
   */
  async update(
    id: string,
    input: UpdateAttendanceInput,
    actor: AttendanceActor
  ): Promise<Attendance> {
    const attendance = await prisma.attendance.findUnique({
      where: { id },
      select: { classId: true, date: true, studentId: true, status: true },
    });
    if (!attendance) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'Catatan absensi tidak ditemukan');
    }
    await assertMayRecord(attendance.classId, dayString(attendance.date), actor);

    const updated = await prisma.attendance.update({
      where: { id },
      data: {
        status: input.status ? (input.status as unknown as PrismaAttendanceStatus) : undefined,
        notes: input.notes,
        recordedById: actor.sub,
      },
      include: {
        student: { select: STUDENT_SAFE_SELECT },
        class: { select: { id: true, name: true } },
      },
    });

    void tellAbsences(attendance.classId, dayString(attendance.date), [
      { studentId: attendance.studentId, status: updated.status, before: attendance.status },
    ]);

    return this.mapToShared(updated);
  }

  /** GET /attendance/me/classes — the classes whose register the caller takes. */
  async myClasses(actor: AttendanceActor) {
    return recorderScope(actor);
  }

  /**
   * Delete attendance record
   */
  async delete(
    id: string,
    currentUser: { role: string; roleCode?: string | null; unitId: string | null }
  ) {
    const attendance = await prisma.attendance.findUnique({
      where: { id },
      include: {
        student: { select: { unitId: true } },
      },
    });

    if (!attendance) {
      throw Errors.notFound('Attendance record');
    }

    // Check permission for non-super-admins
    /*
     * Gerbang tulis sengaja TETAP pada pemeriksaan SUPER_ADMIN.
     *
     * seesAllUnits() hanya boleh MELEBARKAN klausa `where` — begitu ia
     * dipakai di sini, setiap peran lintas-unit (termasuk perawat,
     * pustakawan, laboran) mendadak boleh mengubah absensi unit mana pun.
     * Memperluas kewenangan menulis adalah keputusan tersendiri, bukan
     * efek samping dari memperbaiki tampilan.
     */
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      if (attendance.student.unitId !== currentUser.unitId) {
        throw Errors.forbidden('Access denied to delete attendance for this unit');
      }
    }

    await prisma.attendance.delete({
      where: { id },
    });

    return { message: 'Attendance record deleted' };
  }

  /**
   * Get attendance summary/statistics
   */
  async getSummary(
    query: AttendanceSummaryQuery,
    currentUser: ScopeActor & { role?: string | null }
  ): Promise<AttendanceSummary> {
    const { classId, studentId, unitId, date, startDate, endDate } = query;

    const where: Prisma.AttendanceWhereInput = {};

    // Same day-boundary handling as the list endpoint: `date` is stored as a
    // timestamp, so a single day has to be a range or it matches only records
    // that happen to sit exactly on midnight.
    if (date) {
      const d = new Date(date);
      where.date = {
        gte: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)),
        lte: new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
        ),
      };
    } else if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // Same scope as the list; a cross-unit account may narrow to one unit.
    if (!seesAllUnits(currentUser)) {
      where.student = studentScope(currentUser);
    } else if (unitId) {
      where.student = { unitId };
    }

    if (classId) {
      where.classId = classId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    // Get counts by status
    const statusCounts = await prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    // Get total count
    const total = await prisma.attendance.count({ where });

    // Transform to summary object
    const counts: Record<string, number> = {
      total,
      present: 0,
      absent: 0,
      late: 0,
      sick: 0,
      excused: 0,
    };

    // Dynamic mapping from DB status to response keys
    // Assumes shared AttendanceStatus keys map to lowercase response keys
    for (const item of statusCounts) {
      const statusKey = item.status.toString().toLowerCase();
      // Only assign if it's a known key to avoid pollution, or just assign everything if dynamic
      if (
        statusKey in counts ||
        ['present', 'absent', 'late', 'sick', 'excused'].includes(statusKey)
      ) {
        counts[statusKey] = item._count._all;
      }
    }

    // Explicitly handle mapping if Enums don't match exactly (e.g. EXCUSED vs PERMISSION)
    // Though we try to align them, let's be safe.
    // 'PERMISSION' in DB -> 'excused' in shared type?
    const permissionCount =
      statusCounts.find((s) => s.status === ('PERMISSION' as PrismaAttendanceStatus))?._count
        ._all || 0;
    if (permissionCount > 0) {
      counts.excused = (counts.excused || 0) + permissionCount;
    }

    // Calculate percentages
    const percentages: Record<string, string> = {
      present: '0',
      absent: '0',
      late: '0',
      sick: '0',
      excused: '0',
    };

    Object.keys(percentages).forEach((key) => {
      percentages[key] = total > 0 ? ((counts[key] / total) * 100).toFixed(1) : '0';
    });

    // Ensure type safety for the return. `date` is the single-day shorthand,
    // so echo it back as both ends of the range.
    return {
      period: { startDate: date ?? startDate, endDate: date ?? endDate },
      counts: counts as AttendanceSummary['counts'],
      percentages: percentages as AttendanceSummary['percentages'],
    };
  }

  /**
   * Get attendance calendar for a class (monthly view)
   */
  async getCalendar(
    classId: string,
    year: number,
    month: number,
    currentUser: { role: string; roleCode?: string | null; unitId: string | null }
  ): Promise<AttendanceCalendarResponse> {
    // Get class info
    const classInfo = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        unit: { select: { id: true, name: true } },
        enrollments: { where: { status: 'active' }, select: { id: true } },
      },
    });

    if (!classInfo) {
      throw Errors.notFound('Class');
    }

    // Check permission for non-super-admins
    if (currentUser.role !== UserRole.SUPER_ADMIN && classInfo.unitId !== currentUser.unitId) {
      throw Errors.forbidden('Access denied to this class');
    }

    const totalStudents = classInfo.enrollments.length;

    // Calculate start and end of month using UTC to avoid timezone issues
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    // Get all attendance records for the month
    const attendances = await prisma.attendance.findMany({
      where: {
        classId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      select: {
        date: true,
        status: true,
      },
    });

    // Group by date and count statuses
    const dayMap = new Map<
      string,
      {
        present: number;
        absent: number;
        late: number;
        sick: number;
        excused: number;
        total: number;
      }
    >();

    for (const att of attendances) {
      const dateKey = att.date.toISOString().split('T')[0];

      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, { present: 0, absent: 0, late: 0, sick: 0, excused: 0, total: 0 });
      }

      const day = dayMap.get(dateKey)!;
      day.total++;

      switch (att.status) {
        case 'PRESENT':
          day.present++;
          break;
        case 'ABSENT':
          day.absent++;
          break;
        case 'LATE':
          day.late++;
          break;
        case 'SICK':
          day.sick++;
          break;
        case 'EXCUSED':
        case 'PERMISSION' as any: // Handle generic prisma mapping
          day.excused++;
          break;
      }
    }

    // Convert to array sorted by date
    const days = Array.from(dayMap.entries())
      .map(([date, counts]) => ({
        date,
        ...counts,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate summary
    const totalSchoolDays = days.length;
    const totalPresent = days.reduce((sum, d) => sum + d.present, 0);
    const totalRecords = days.reduce((sum, d) => sum + d.total, 0);
    const avgAttendanceRate =
      totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

    return {
      classId,
      className: classInfo.name,
      year,
      month,
      days,
      summary: {
        totalStudents,
        totalSchoolDays,
        avgAttendanceRate,
      },
    };
  }
}

export const attendanceService = new AttendanceService();
