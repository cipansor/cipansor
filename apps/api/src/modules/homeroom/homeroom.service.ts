import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import { Prisma, ViolationType } from '@prisma/client';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { assertMayWrite, classAccess, notFound, studentAccess, viewerOf } from './homeroom.access';
import type { HomeroomNote, HomeroomNoteInput } from '@cipansor/shared';
import { wibDayOf } from '@/utils/wib-day';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The class's birthdays in the next 30 WIB calendar days, soonest first, with
 * `daysUntil` 0 for a birthday today (#948).
 *
 * Both sides are calendar days. "Today" is the WIB day the moment falls on —
 * the UTC container's `new Date()` is still yesterday between 00:00 and 06:59
 * WIB — and a birth date is the calendar day it holds at midnight UTC, the form
 * a date input writes, so it is read by its UTC fields. Comparing the birthday's
 * midnight with the current instant made a birthday later today count as
 * already past, so it dropped out of the list until next year.
 *
 * A 29 February birthday falls on 1 March in a common year (`Date.UTC` rolls
 * the day over), as the previous `new Date(year, 1, 29)` did.
 */
export function upcomingBirthdaysOf<
  T extends { id: string; nis: string | null; birthDate: Date; user: { name: string } },
>(students: T[], now: Date) {
  const [y, m, d] = wibDayOf(now).split('-').map(Number);
  const today = Date.UTC(y, m - 1, d);
  return students
    .map((student) => {
      const dob = new Date(student.birthDate);
      let next = Date.UTC(y, dob.getUTCMonth(), dob.getUTCDate());
      if (next < today) next = Date.UTC(y + 1, dob.getUTCMonth(), dob.getUTCDate());
      return {
        student: { id: student.id, name: student.user.name, nis: student.nis },
        date: dob,
        daysUntil: Math.round((next - today) / DAY_MS),
      };
    })
    .filter((item) => item.daysUntil >= 0 && item.daysUntil <= 30)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * A pupil as the homeroom pages show them. Never the whole row: a Student
 * carries NIK, No. KK, the parents' NIK and income
 * (lessons/prisma-include-leaks-pii).
 */
const STUDENT_BRIEF = {
  id: true,
  nis: true,
  gender: true,
  photoUrl: true,
  user: { select: { name: true } },
} satisfies Prisma.StudentSelect;

// User type from JwtPayload
interface AuthenticatedUser {
  sub: string;
  role: string;
  /**
   * RoleCode granular. Wajib ada agar scoping bisa memakai seesAllUnits():
   * `role` legacy memetakan setiap YAYASAN_* menjadi 'UNIT_ADMIN', sehingga
   * pemeriksaan yang ditulis atas `role` menggolongkan pengurus yayasan
   * sebagai admin unit — itulah yang menyembunyikan datanya.
   */
  roleCode?: string | null;
  unitId: string | null;
}

export class HomeroomService {
  /**
   * Get classes where user is homeroom teacher
   */
  async getMyClasses(currentUser: AuthenticatedUser) {
    const teacher = await prisma.teacher.findFirst({
      where: { userId: currentUser.sub, deletedAt: null },
      select: { id: true },
    });
    if (!teacher) return [];

    const now = new Date();
    const classes = await prisma.class.findMany({
      where: { homeroomTeacherId: teacher.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        level: true,
        unit: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true, startDate: true, endDate: true } },
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
      orderBy: [{ academicYear: { startDate: 'desc' } }, { name: 'asc' }],
    });

    // The current year's classes first: the one a wali kelas works in.
    return classes
      .map(({ academicYear: { startDate, endDate, ...year }, ...cls }) => ({
        ...cls,
        academicYear: year,
        isCurrent: startDate <= now && endDate >= now,
      }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  }

  /**
   * Get class dashboard
   */
  async getClassDashboard(classId: string, currentUser: AuthenticatedUser) {
    const access = await classAccess(classId, currentUser);

    const classData = await prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        id: true,
        name: true,
        level: true,
        academicYearId: true,
        unit: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
        homeroomTeacher: { select: { id: true, user: { select: { name: true } } } },
        enrollments: {
          where: { status: 'active' },
          select: { studentId: true, student: { select: STUDENT_BRIEF } },
        },
      },
    });

    if (!classData) {
      throw notFound('Kelas tidak ditemukan');
    }

    const studentIds = classData.enrollments.map((e) => e.studentId);

    // 1. Attendance Summary (Current Month)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const attendanceSummary = await prisma.attendance.groupBy({
      by: ['status'],
      where: {
        classId,
        date: { gte: monthStart, lte: monthEnd },
      },
      _count: { status: true },
    });

    const totalAttendance = attendanceSummary.reduce((acc, curr) => acc + curr._count.status, 0);
    const presentCount = attendanceSummary.find((s) => s.status === 'PRESENT')?._count.status || 0;
    const averageAttendance =
      totalAttendance > 0 ? Number(((presentCount / totalAttendance) * 100).toFixed(1)) : 0;

    // 2. Academic Score Average (Current Academic Year)
    const grades = await prisma.grade.findMany({
      where: {
        studentId: { in: studentIds },
        academicYearId: classData.academicYearId,
      },
      select: { score: true },
    });

    const totalScore = grades.reduce((acc, curr) => acc + Number(curr.score), 0);
    const averageAcademicScore =
      grades.length > 0 ? Number((totalScore / grades.length).toFixed(1)) : 0;

    // 3. Recent Violations & Pending Notes
    const recentViolations = await prisma.violation.findMany({
      where: { studentId: { in: studentIds } },
      include: { student: { select: STUDENT_BRIEF } },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    });

    const pendingBehaviorNotes = await prisma.violation.count({
      where: {
        studentId: { in: studentIds },
        OR: [{ action: null }, { action: '' }],
      },
    });

    // 4. Recent Achievements (Rewards + Tahfidz Assessment)
    const recentRewards = await prisma.reward.findMany({
      where: { studentId: { in: studentIds } },
      include: { student: { select: STUDENT_BRIEF } },
      orderBy: { givenAt: 'desc' },
      take: 5,
    });

    const recentTahfidz = await prisma.tahfidzRecord.findMany({
      where: {
        studentId: { in: studentIds },
        activityType: 'ASSESSMENT', // Only milestones
      },
      include: { student: { select: STUDENT_BRIEF } },
      orderBy: { recordedAt: 'desc' },
      take: 5,
    });

    // Combine and sort achievements
    const recentAchievements = [
      ...recentRewards.map((r) => ({
        id: r.id,
        type: 'REWARD',
        student: r.student,
        category: r.category,
        description: r.description,
        date: r.givenAt,
        points: r.points,
      })),
      ...recentTahfidz.map((t) => ({
        id: t.id,
        type: 'TAHFIDZ',
        student: t.student,
        category: 'Tahfidz',
        description: `Hafalan Surat ${t.surahName} (Juz ${t.juz})`,
        date: t.recordedAt,
        points: t.score, // Use score as points for display
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5);

    // 5. Upcoming Birthdays (Next 30 days)
    // Fetch all students birthdates and filter in memory
    const studentsWithBirthdays = await prisma.student.findMany({
      where: {
        id: { in: studentIds },
        birthDate: { not: undefined }, // Ensure birthDate exists
      },
      select: {
        id: true,
        nis: true,
        birthDate: true,
        user: { select: { name: true } },
      },
    });

    const upcomingBirthdays = upcomingBirthdaysOf(studentsWithBirthdays, new Date());

    const { enrollments, ...classInfo } = classData;
    return {
      class: classInfo,
      viewer: viewerOf(access),
      studentCount: enrollments.length,
      students: enrollments.map((e) => e.student),
      attendanceSummary: attendanceSummary.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
      dashboardSummary: {
        averageAttendance,
        averageAcademicScore,
        pendingBehaviorNotes,
        recentViolations,
        recentAchievements,
        upcomingBirthdays,
      },
    };
  }

  /**
   * Get students in homeroom class
   */
  async getHomeroomStudents(classId: string, currentUser: AuthenticatedUser) {
    await classAccess(classId, currentUser);

    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'active' },
      select: {
        student: {
          select: {
            ...STUDENT_BRIEF,
            parentName: true,
            parentPhone: true,
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { student: { user: { name: 'asc' } } },
    });

    return enrollments.map((e: { student: unknown }) => e.student);
  }

  /**
   * Get attendance summary for class
   */
  async getAttendanceSummary(
    classId: string,
    startDate: string,
    endDate: string,
    currentUser: AuthenticatedUser
  ) {
    await classAccess(classId, currentUser);

    const summary = await prisma.attendance.groupBy({
      by: ['studentId', 'status'],
      where: {
        classId,
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      _count: { status: true },
    });

    return summary;
  }

  /**
   * Get academic monitoring
   */
  async getAcademicMonitoring(classId: string, currentUser: AuthenticatedUser) {
    await classAccess(classId, currentUser);

    const classData = await prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: {
        enrollments: {
          where: { status: 'active' },
          select: {
            student: {
              select: {
                id: true,
                user: { select: { name: true } },
                tahfidzRecords: {
                  take: 1,
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    });

    if (!classData) {
      throw notFound('Kelas tidak ditemukan');
    }

    return {
      classId,
      students: classData.enrollments.map((e) => ({
        id: e.student.id,
        name: e.student.user.name,
        latestTahfidz: e.student.tahfidzRecords[0] || null,
      })),
    };
  }

  /**
   * A pupil's page: who they are, their class, recent tahfidz and attendance.
   * Shaped for the page rather than the whole row.
   */
  async getStudentDetail(studentId: string, currentUser: AuthenticatedUser) {
    const access = await studentAccess(studentId, currentUser);

    const student = await prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        nis: true,
        gender: true,
        birthPlace: true,
        birthDate: true,
        address: true,
        parentName: true,
        parentPhone: true,
        parentEmail: true,
        fatherName: true,
        fatherPhone: true,
        motherName: true,
        motherPhone: true,
        photoUrl: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        unit: { select: { id: true, name: true } },
        enrollments: {
          where: { status: 'active' },
          select: { id: true, status: true, class: { select: { id: true, name: true } } },
        },
        tahfidzRecords: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        attendances: {
          take: 30,
          orderBy: { date: 'desc' },
          select: { id: true, date: true, status: true, notes: true },
        },
      },
    });

    if (!student) {
      throw notFound('Siswa tidak ditemukan');
    }

    const { user, photoUrl, ...rest } = student;
    return {
      ...rest,
      name: user.name,
      email: user.email,
      phone: user.phone,
      photo: photoUrl,
      user: { id: user.id, name: user.name, email: user.email },
      viewer: viewerOf(access),
    };
  }

  /**
   * Get student notes - using violations/rewards as notes system
   */
  async getStudentNotes(studentId: string, currentUser: AuthenticatedUser) {
    await studentAccess(studentId, currentUser);

    // Use violations as behavior notes
    const violations = await prisma.violation.findMany({
      where: { studentId },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });

    const rewards = await prisma.reward.findMany({
      where: { studentId },
      orderBy: { givenAt: 'desc' },
      take: 20,
    });

    return {
      violations,
      rewards,
    };
  }

  /**
   * Create student note - using violation/reward system. Written by the
   * pupil's wali kelas, in the current academic year.
   */
  async createStudentNote(input: HomeroomNoteInput, currentUser: AuthenticatedUser) {
    assertMayWrite(await studentAccess(input.studentId, currentUser));

    const text = (input.description || input.title) as string;
    if (input.type === 'POSITIVE') {
      const reward = await prisma.reward.create({
        data: {
          studentId: input.studentId,
          category: input.category || 'general',
          description: text,
          points: 0,
          givenById: currentUser.sub,
          givenAt: new Date(),
        },
      });
      return { type: 'reward', data: reward };
    } else {
      const violation = await prisma.violation.create({
        data: {
          studentId: input.studentId,
          type: ViolationType.MINOR,
          category: input.category || 'general',
          description: text,
          action: input.action || null,
          points: 0,
          reportedById: currentUser.sub,
          occurredAt: new Date(),
        },
      });
      return { type: 'violation', data: violation };
    }
  }

  /**
   * The note, if the caller may change it: the pupil's wali kelas, in the
   * current academic year, and only a note they wrote themselves — a
   * violation the guru BK or kesiswaan recorded is not the wali kelas's to
   * rewrite or remove.
   */
  private async changeableNote(
    noteId: string,
    noteType: 'violation' | 'reward',
    currentUser: AuthenticatedUser
  ) {
    const note =
      noteType === 'violation'
        ? await prisma.violation
            .findUnique({ where: { id: noteId }, select: { studentId: true, reportedById: true } })
            .then((v) => v && { studentId: v.studentId, authorId: v.reportedById })
        : await prisma.reward
            .findUnique({ where: { id: noteId }, select: { studentId: true, givenById: true } })
            .then((r) => r && { studentId: r.studentId, authorId: r.givenById });

    if (!note) throw notFound('Catatan tidak ditemukan');
    // A note on a pupil the caller does not reach reads as not found.
    const access = await studentAccess(note.studentId, currentUser).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === ErrorCode.NOT_FOUND) return null;
      throw error;
    });
    if (!access) throw notFound('Catatan tidak ditemukan');
    assertMayWrite(access);
    if (note.authorId !== currentUser.sub) {
      throw Errors.forbidden('Catatan ini ditulis orang lain');
    }
  }

  /**
   * Update student note
   */
  async updateStudentNote(
    noteId: string,
    input: { description?: string; category?: string },
    noteType: 'violation' | 'reward',
    currentUser: AuthenticatedUser
  ) {
    await this.changeableNote(noteId, noteType, currentUser);

    const data: { description?: string; category?: string } = {};
    if (input.description) data.description = input.description;
    if (input.category) data.category = input.category;

    return noteType === 'violation'
      ? prisma.violation.update({ where: { id: noteId }, data })
      : prisma.reward.update({ where: { id: noteId }, data });
  }

  /**
   * Delete student note
   */
  async deleteStudentNote(
    noteId: string,
    noteType: 'violation' | 'reward',
    currentUser: AuthenticatedUser
  ) {
    await this.changeableNote(noteId, noteType, currentUser);

    if (noteType === 'violation') {
      await prisma.violation.delete({ where: { id: noteId } });
    } else {
      await prisma.reward.delete({ where: { id: noteId } });
    }
    return { success: true };
  }

  /**
   * Get behavior records
   */
  async getBehaviorRecords(
    classId: string,
    currentUser: AuthenticatedUser
  ): Promise<HomeroomNote[]> {
    if (!classId) throw Errors.badRequest('classId wajib diisi');
    const { canWrite } = viewerOf(await classAccess(classId, currentUser));

    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'active' },
      select: { studentId: true },
    });
    const studentIds = enrollments.map((e: { studentId: string }) => e.studentId);

    const pupil = { select: { id: true, nis: true, user: { select: { name: true } } } } as const;
    const author = { select: { id: true, name: true } } as const;
    const [violations, rewards] = await Promise.all([
      prisma.violation.findMany({
        where: { studentId: { in: studentIds } },
        select: {
          id: true,
          category: true,
          description: true,
          action: true,
          occurredAt: true,
          student: pupil,
          reportedBy: author,
        },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
      prisma.reward.findMany({
        where: { studentId: { in: studentIds } },
        select: {
          id: true,
          category: true,
          description: true,
          givenAt: true,
          student: pupil,
          givenBy: author,
        },
        orderBy: { givenAt: 'desc' },
        take: 50,
      }),
    ]);

    // One list, newest first. Only its author, while they still write for the
    // class, may change or remove a note — as updateStudentNote enforces.
    const mine = (authorId: string | undefined) => canWrite && authorId === currentUser.sub;
    return [
      ...violations.map(({ occurredAt, reportedBy, ...v }) => ({
        ...v,
        kind: 'violation' as const,
        at: occurredAt.toISOString(),
        author: reportedBy,
        canChange: mine(reportedBy?.id),
      })),
      ...rewards.map(({ givenAt, givenBy, ...r }) => ({
        ...r,
        kind: 'reward' as const,
        action: null,
        at: givenAt.toISOString(),
        author: givenBy,
        canChange: mine(givenBy?.id),
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Cross-class homeroom (wali kelas) performance overview.
   * Composite of measurable signals only: attendance quality + recording
   * discipline (30d), academic average (90d), tahfidz activity (30d) and
   * behavior balance. Unit-scoped for non-super-admins.
   */
  async getPerformanceOverview(currentUser: AuthenticatedUser, unitId?: string) {
    const effectiveUnitId = seesAllUnits(currentUser) ? unitId : (currentUser.unitId ?? 'none');

    const classes = await prisma.class.findMany({
      where: {
        deletedAt: null,
        homeroomTeacherId: { not: null },
        academicYear: { isActive: true },
        ...(effectiveUnitId ? { unitId: effectiveUnitId } : {}),
      },
      select: {
        id: true,
        name: true,
        unit: { select: { name: true } },
        homeroomTeacher: {
          select: { id: true, user: { select: { name: true } } },
        },
        enrollments: {
          where: { status: 'active' },
          select: { studentId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (classes.length === 0) return { items: [], averageScore: 0 };

    const classIds = classes.map((c) => c.id);
    const studentToClass = new Map<string, string>();
    for (const cls of classes) {
      for (const enrollment of cls.enrollments) {
        studentToClass.set(enrollment.studentId, cls.id);
      }
    }
    const studentIds = [...studentToClass.keys()];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [
      attendanceByStatus,
      attendanceDays,
      gradeByStudent,
      tahfidzByStudent,
      violationByStudent,
      rewardByStudent,
    ] = await Promise.all([
      prisma.attendance.groupBy({
        by: ['classId', 'status'],
        where: { classId: { in: classIds }, date: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),
      prisma.attendance.groupBy({
        by: ['classId', 'date'],
        where: { classId: { in: classIds }, date: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),
      prisma.grade.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, gradedAt: { gte: ninetyDaysAgo } },
        _avg: { percentage: true },
      }),
      prisma.tahfidzRecord.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, recordedAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),
      prisma.violation.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, occurredAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),
      prisma.reward.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, givenAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),
    ]);

    // Weekdays in the last 30 days = expected school days for recording discipline
    let weekdays = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.getDay();
      if (day !== 0 && day !== 6) weekdays++;
    }

    const perClass = new Map<
      string,
      {
        present: number;
        totalAttendance: number;
        recordedDays: number;
        gradeSum: number;
        gradeCount: number;
        tahfidzCount: number;
        violations: number;
        rewards: number;
      }
    >();
    const bucket = (classId: string) => {
      let entry = perClass.get(classId);
      if (!entry) {
        entry = {
          present: 0,
          totalAttendance: 0,
          recordedDays: 0,
          gradeSum: 0,
          gradeCount: 0,
          tahfidzCount: 0,
          violations: 0,
          rewards: 0,
        };
        perClass.set(classId, entry);
      }
      return entry;
    };

    for (const row of attendanceByStatus) {
      const entry = bucket(row.classId);
      entry.totalAttendance += row._count.id;
      if (row.status === 'PRESENT') entry.present += row._count.id;
    }
    for (const row of attendanceDays) {
      bucket(row.classId).recordedDays++;
    }
    for (const row of gradeByStudent) {
      const classId = studentToClass.get(row.studentId);
      if (!classId || row._avg.percentage === null) continue;
      const entry = bucket(classId);
      entry.gradeSum += Number(row._avg.percentage);
      entry.gradeCount++;
    }
    for (const row of tahfidzByStudent) {
      const classId = studentToClass.get(row.studentId);
      if (classId) bucket(classId).tahfidzCount += row._count.id;
    }
    for (const row of violationByStudent) {
      const classId = studentToClass.get(row.studentId);
      if (classId) bucket(classId).violations += row._count.id;
    }
    for (const row of rewardByStudent) {
      const classId = studentToClass.get(row.studentId);
      if (classId) bucket(classId).rewards += row._count.id;
    }

    const round1 = (v: number) => Math.round(v * 10) / 10;
    const items = classes.map((cls) => {
      const stats = perClass.get(cls.id);
      const studentCount = cls.enrollments.length;

      const attendanceRate =
        stats && stats.totalAttendance > 0 ? (stats.present / stats.totalAttendance) * 100 : 0;
      const recordingDiscipline =
        stats && weekdays > 0 ? Math.min((stats.recordedDays / weekdays) * 100, 100) : 0;
      const academicAverage = stats && stats.gradeCount > 0 ? stats.gradeSum / stats.gradeCount : 0;
      const tahfidzActivityPerStudent =
        stats && studentCount > 0 ? stats.tahfidzCount / studentCount : 0;
      const behaviorBalance = stats ? stats.rewards - stats.violations : 0;

      // Tahfidz component: ~20 records/student/month counts as full marks
      const tahfidzScore = Math.min(tahfidzActivityPerStudent / 20, 1) * 100;
      const overallScore = round1(
        attendanceRate * 0.35 +
          recordingDiscipline * 0.15 +
          academicAverage * 0.3 +
          tahfidzScore * 0.2
      );

      return {
        classId: cls.id,
        className: cls.name,
        unitName: cls.unit.name,
        teacherId: cls.homeroomTeacher!.id,
        teacherName: cls.homeroomTeacher!.user.name,
        studentCount,
        metrics: {
          attendanceRate: round1(attendanceRate),
          recordingDiscipline: round1(recordingDiscipline),
          academicAverage: round1(academicAverage),
          tahfidzActivityPerStudent: round1(tahfidzActivityPerStudent),
          behaviorBalance,
        },
        overallScore,
      };
    });

    const averageScore =
      items.length > 0
        ? round1(items.reduce((sum, item) => sum + item.overallScore, 0) / items.length)
        : 0;

    return { items, averageScore };
  }

  /** POST /homeroom/behavior — the behaviour page's name for a note. */
  async recordBehavior(input: HomeroomNoteInput, currentUser: AuthenticatedUser) {
    return this.createStudentNote(input, currentUser);
  }
}

export const homeroomService = new HomeroomService();
