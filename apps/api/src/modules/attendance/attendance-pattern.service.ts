import { AttendancePatternKind, AttendanceStatus as PrismaAttendanceStatus } from '@prisma/client';
import {
  ATTENDANCE_PATTERN_ABSENCE_RATE,
  ATTENDANCE_PATTERN_LATE_COUNT,
  ATTENDANCE_PATTERN_LATE_WINDOW_DAYS,
  ATTENDANCE_PATTERN_MIN_DAYS,
  GURU_BK_ROLE_CODES,
  type AttendancePatternItem,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { boardersOfMusyrif, musyrifOfBoarders } from '@/modules/dormitories';
import { semesterAt } from '@/utils/semester';
import { type AttendanceActor } from './attendance.access';
import { dayOf, dayString, todayWib } from '@/utils/wib';

/**
 * The third tier of the attendance follow-up (decided 2026-09-28,
 * decisions/absensi-harian.md): a santri absent — Alpa, Sakit or Izin — on at
 * least 10% of the days recorded this semester, once 10 days are recorded, or
 * late three times in 30 days, is flagged for their wali kelas, their unit's
 * guru BK and, for a santri mukim, their musyrif.
 *
 * Who shows a pattern is worked out from the register every time it is asked;
 * `attendance_pattern_flags` only remembers that a pattern was raised this
 * semester, so each person is told once.
 */

const ABSENT: PrismaAttendanceStatus[] = [
  PrismaAttendanceStatus.ABSENT,
  PrismaAttendanceStatus.SICK,
  PrismaAttendanceStatus.EXCUSED,
];

export interface PatternCounts {
  recordedDays: number;
  absentDays: number;
  alpa: number;
  sakit: number;
  izin: number;
  lateDays: number;
}

/** Which patterns these counts show — the rule, and nothing else. */
export function patternsOf(c: PatternCounts): AttendancePatternKind[] {
  const kinds: AttendancePatternKind[] = [];
  if (
    c.recordedDays >= ATTENDANCE_PATTERN_MIN_DAYS &&
    c.absentDays >= c.recordedDays * ATTENDANCE_PATTERN_ABSENCE_RATE
  ) {
    kinds.push(AttendancePatternKind.ABSENCE);
  }
  if (c.lateDays >= ATTENDANCE_PATTERN_LATE_COUNT) kinds.push(AttendancePatternKind.LATE);
  return kinds;
}

const DAY_MS = 86_400_000;

/**
 * The window the rule reads, for `now`: this semester's first day, the first
 * day of the late window, and today — or null outside any academic year.
 */
export async function patternWindow(now = new Date()) {
  const year = await prisma.academicYear.findFirst({
    where: { deletedAt: null, startDate: { lte: now }, endDate: { gte: now } },
    orderBy: { startDate: 'desc' },
    select: { startDate: true, endDate: true },
  });
  if (!year) return null;
  const today = todayWib(now);
  const lateFrom = dayString(
    new Date(dayOf(today).getTime() - (ATTENDANCE_PATTERN_LATE_WINDOW_DAYS - 1) * DAY_MS)
  );
  return { semesterStart: semesterAt(year, now).startDay, lateFrom, today };
}

type Window = NonNullable<Awaited<ReturnType<typeof patternWindow>>>;

/**
 * The counts for every santri with a mark in the window — for `studentIds`
 * only, when given. Days, not marks: a santri marked in two classes on one
 * day is absent that day if either mark says so.
 */
export async function patternCounts(
  window: Window,
  studentIds?: string[]
): Promise<Map<string, PatternCounts>> {
  if (studentIds && !studentIds.length) return new Map();
  const from = window.lateFrom < window.semesterStart ? window.lateFrom : window.semesterStart;
  const marks = await prisma.attendance.groupBy({
    by: ['studentId', 'date', 'status'],
    where: {
      ...(studentIds ? { studentId: { in: studentIds } } : {}),
      date: { gte: dayOf(from), lte: dayOf(window.today) },
    },
  });

  const days = new Map<
    string,
    { recorded: Set<string>; status: Map<string, Set<PrismaAttendanceStatus>> }
  >();
  for (const m of marks) {
    const day = dayString(m.date);
    const s = days.get(m.studentId) ?? { recorded: new Set(), status: new Map() };
    days.set(m.studentId, s);
    if (day >= window.semesterStart) s.recorded.add(day);
    s.status.set(day, (s.status.get(day) ?? new Set()).add(m.status));
  }

  return new Map(
    [...days].map(([studentId, s]) => {
      const semester = [...s.status].filter(([day]) => day >= window.semesterStart);
      const on = (status: PrismaAttendanceStatus) =>
        semester.filter(([, st]) => st.has(status)).length;
      const counts: PatternCounts = {
        recordedDays: s.recorded.size,
        absentDays: semester.filter(([, st]) => ABSENT.some((a) => st.has(a))).length,
        alpa: on(PrismaAttendanceStatus.ABSENT),
        sakit: on(PrismaAttendanceStatus.SICK),
        izin: on(PrismaAttendanceStatus.EXCUSED),
        lateDays: [...s.status].filter(
          ([day, st]) => day >= window.lateFrom && st.has(PrismaAttendanceStatus.LATE)
        ).length,
      };
      return [studentId, counts];
    })
  );
}

const currentYear = (now: Date) => ({ startDate: { lte: now }, endDate: { gte: now } });

/** Each santri's class this academic year, and its wali kelas's user. */
async function classesOf(studentIds: string[], now: Date) {
  const enrollments = await prisma.classEnrollment.findMany({
    where: {
      studentId: { in: studentIds },
      status: 'active',
      class: { deletedAt: null, academicYear: currentYear(now) },
    },
    select: {
      studentId: true,
      class: {
        select: {
          id: true,
          name: true,
          homeroomTeacher: { select: { user: { select: { id: true, isActive: true } } } },
        },
      },
    },
  });
  return new Map(enrollments.map((e) => [e.studentId, e.class]));
}

/**
 * Who is told about each santri's pattern: the wali kelas of their class, the
 * guru BK of their unit, and the musyrif of a santri mukim.
 */
export async function recipientsOf(studentIds: string[], now = new Date()) {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map<string, string[]>();
  const [students, classes, musyrif] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: ids } }, select: { id: true, unitId: true } }),
    classesOf(ids, now),
    musyrifOfBoarders(ids),
  ]);
  const counsellors = await prisma.userRoleAssignment.findMany({
    where: {
      isActive: true,
      user: { isActive: true },
      role: { code: { in: [...GURU_BK_ROLE_CODES] } },
      unitId: { in: [...new Set(students.map((s) => s.unitId))] },
    },
    select: { userId: true, unitId: true },
  });
  return new Map(
    students.map((s) => {
      const homeroom = classes.get(s.id)?.homeroomTeacher?.user;
      return [
        s.id,
        [
          ...new Set([
            ...(homeroom?.isActive ? [homeroom.id] : []),
            ...counsellors.filter((c) => c.unitId === s.unitId).map((c) => c.userId),
            ...(musyrif.get(s.id) ?? []).map((p) => p.id),
          ]),
        ],
      ];
    })
  );
}

/**
 * The santri a user is told about, and why: their homeroom classes' pupils,
 * the santri mukim they are musyrif of, and their unit's pupils when they are
 * a guru BK.
 */
async function watchedBy(actor: AttendanceActor, now: Date) {
  const isCounsellor = !!actor.roleCode && GURU_BK_ROLE_CODES.includes(actor.roleCode);
  const [homeroom, boarders, unitPupils] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: {
        status: 'active',
        class: {
          deletedAt: null,
          homeroomTeacher: { userId: actor.sub },
          academicYear: currentYear(now),
        },
      },
      select: { studentId: true },
    }),
    boardersOfMusyrif(actor.sub),
    isCounsellor && actor.unitId
      ? prisma.student.findMany({
          where: { unitId: actor.unitId, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const as = new Map<string, AttendancePatternItem['as']>();
  const add = (id: string, why: AttendancePatternItem['as'][number]) =>
    as.set(id, [...(as.get(id) ?? []), why]);
  for (const e of homeroom) add(e.studentId, 'WALI_KELAS');
  for (const id of unitPupils.map((s) => s.id)) add(id, 'GURU_BK');
  for (const id of boarders) add(id, 'MUSYRIF');
  return as;
}

/** GET /attendance/patterns — the caller's santri who show a pattern now. */
export async function listPatterns(
  actor: AttendanceActor,
  now = new Date()
): Promise<AttendancePatternItem[]> {
  const window = await patternWindow(now);
  if (!window) return [];
  const watched = await watchedBy(actor, now);
  const counts = await patternCounts(window, [...watched.keys()]);
  const flagged = [...counts]
    .map(([studentId, c]) => ({ studentId, c, kinds: patternsOf(c) }))
    .filter((f) => f.kinds.length);
  if (!flagged.length) return [];

  const ids = flagged.map((f) => f.studentId);
  const [students, classes, raised] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, nis: true, user: { select: { name: true } } },
    }),
    classesOf(ids, now),
    prisma.attendancePatternFlag.findMany({
      where: { studentId: { in: ids }, semesterStart: dayOf(window.semesterStart) },
      select: { studentId: true, kind: true, raisedAt: true },
    }),
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));

  return flagged
    .flatMap(({ studentId, c, kinds }) => {
      const student = byId.get(studentId);
      if (!student) return [];
      const cls = classes.get(studentId);
      const item: AttendancePatternItem = {
        student: { id: student.id, name: student.user.name, nis: student.nis },
        class: cls ? { id: cls.id, name: cls.name } : null,
        as: watched.get(studentId) ?? [],
        kinds,
        absence: {
          since: window.semesterStart,
          recordedDays: c.recordedDays,
          absentDays: c.absentDays,
          alpa: c.alpa,
          sakit: c.sakit,
          izin: c.izin,
        },
        lateDays: c.lateDays,
        raisedAt: Object.fromEntries(
          raised
            .filter((r) => r.studentId === studentId)
            .map((r) => [r.kind, r.raisedAt.toISOString()])
        ),
      };
      return [item];
    })
    .sort(
      (a, b) =>
        b.absence.absentDays / Math.max(b.absence.recordedDays, 1) -
          a.absence.absentDays / Math.max(a.absence.recordedDays, 1) || b.lateDays - a.lateDays
    );
}

export interface RaisedPattern {
  studentId: string;
  name: string;
  className: string | null;
  kind: AttendancePatternKind;
  counts: PatternCounts;
  recipients: string[];
}

/**
 * For the daily job: the patterns not yet raised this semester, recorded as
 * raised now, with whom to tell. A pattern that fades and returns in the same
 * semester is not raised twice; the page still shows it while it holds.
 */
export async function raiseNewPatterns(now = new Date()): Promise<RaisedPattern[]> {
  const window = await patternWindow(now);
  if (!window) return [];
  const counts = await patternCounts(window);
  const showing = [...counts].flatMap(([studentId, c]) =>
    patternsOf(c).map((kind) => ({ studentId, kind, c }))
  );
  if (!showing.length) return [];

  const semesterStart = dayOf(window.semesterStart);
  const already = await prisma.attendancePatternFlag.findMany({
    where: { semesterStart, studentId: { in: [...new Set(showing.map((s) => s.studentId))] } },
    select: { studentId: true, kind: true },
  });
  const known = new Set(already.map((a) => `${a.studentId}:${a.kind}`));
  const fresh = showing.filter((s) => !known.has(`${s.studentId}:${s.kind}`));
  if (!fresh.length) return [];

  await prisma.attendancePatternFlag.createMany({
    data: fresh.map((f) => ({
      studentId: f.studentId,
      kind: f.kind,
      semesterStart,
      raisedAt: now,
    })),
    skipDuplicates: true,
  });

  const ids = [...new Set(fresh.map((f) => f.studentId))];
  const [students, classes, recipients] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { name: true } } },
    }),
    classesOf(ids, now),
    recipientsOf(ids, now),
  ]);
  const names = new Map(students.map((s) => [s.id, s.user.name]));
  return fresh.map((f) => ({
    studentId: f.studentId,
    name: names.get(f.studentId) ?? 'Santri',
    className: classes.get(f.studentId)?.name ?? null,
    kind: f.kind,
    counts: f.c,
    recipients: recipients.get(f.studentId) ?? [],
  }));
}
