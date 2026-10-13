import { DayOfWeek, EventType, Prisma } from '@prisma/client';
import { CLASS_ENROLLMENT_STATUS, STUDENT_STATUS } from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { dayOf, todayWib } from './attendance.access';

/**
 * The register reminder (decisions/absensi-harian.md): a class whose register
 * is still not taken 30 minutes after its first lesson of the day — some
 * pupil has no mark — is a reminder to the teacher of that lesson and to the
 * class's wali kelas.
 *
 * "Taken" means every pupil enrolled has a mark: an approved leave or a UKS
 * visit writes a mark on its own, so a class with a few marks may still have
 * nobody's register. A day the calendar marks as a holiday reminds no one.
 */

/** How long after the first lesson the register may stay open. */
export const REGISTER_GRACE_MINUTES = 30;
/** How often the job looks; a class is due in exactly one look. */
export const REGISTER_CHECK_EVERY_MINUTES = 5;

const DAYS: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

/** "07:30" as minutes after midnight; null for anything that is not a time. */
export const minutesOf = (time: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h < 24 && min < 60 ? h * 60 + min : null;
};

/** Minutes after midnight in WIB. */
const wibMinutes = (now: Date) => {
  const [h, m] = now
    .toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false })
    .split(':')
    .map(Number);
  return (h % 24) * 60 + m;
};

export interface RegisterDue {
  classId: string;
  className: string;
  /** yyyy-MM-dd, WIB. */
  day: string;
  /** "07:30" — the first lesson of the day. */
  firstLesson: string;
  enrolled: number;
  unmarked: number;
  /** Who to remind: the first lesson's teacher(s) and the wali kelas. */
  userIds: string[];
}

interface FirstLesson {
  start: number;
  time: string;
  className: string;
  unitId: string;
  userIds: Set<string>;
}

/** Of `classes`, those on a holiday today: all units, their unit, or the class. */
async function onHoliday(day: string, classes: Map<string, FirstLesson>) {
  const from = new Date(`${day}T00:00:00+07:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const units = [...new Set([...classes.values()].map((c) => c.unitId))];
  const [events, islamic] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        eventType: EventType.HOLIDAY,
        deletedAt: null,
        // An unapproved import is not a holiday; do not suppress a reminder for it.
        isDraft: false,
        startDate: { lt: to },
        OR: [{ endDate: { gte: from } }, { endDate: null, startDate: { gte: from } }],
        AND: [
          {
            OR: [
              { unitId: null, classId: null },
              { unitId: { in: units }, classId: null },
              { classId: { in: [...classes.keys()] } },
            ],
          },
        ],
      },
      select: { unitId: true, classId: true },
    }),
    prisma.islamicEvent.findMany({
      where: {
        isHoliday: true,
        gregorianDate: { gte: from, lt: to },
        OR: [{ unitId: null }, { unitId: { in: units } }],
      },
      select: { unitId: true },
    }),
  ]);
  const off = [...events, ...islamic.map((e) => ({ ...e, classId: null }))];
  return new Set(
    [...classes].flatMap(([classId, c]) =>
      off.some((e) => e.classId === classId || (!e.classId && (!e.unitId || e.unitId === c.unitId)))
        ? [classId]
        : []
    )
  );
}

/**
 * The registers due for a reminder at `now`: the classes whose first lesson
 * today began 30 minutes ago, within the last look, with a pupil unmarked.
 */
export async function registersDue(now = new Date()): Promise<RegisterDue[]> {
  const day = todayWib(now);
  const minutes = wibMinutes(now);
  const lessons = await prisma.schedule.findMany({
    where: {
      isActive: true,
      dayOfWeek: DAYS[dayOf(day).getUTCDay()],
      academicYear: { startDate: { lte: now }, endDate: { gte: now } },
      class: { deletedAt: null },
    },
    select: {
      classId: true,
      startTime: true,
      teacher: { select: { userId: true } },
      class: {
        select: { name: true, unitId: true, homeroomTeacher: { select: { userId: true } } },
      },
    },
  });

  const first = new Map<string, FirstLesson>();
  for (const l of lessons) {
    const start = minutesOf(l.startTime);
    if (start === null) continue;
    const seen = first.get(l.classId);
    if (!seen || start < seen.start) {
      first.set(l.classId, {
        start,
        time: l.startTime.trim(),
        className: l.class.name,
        unitId: l.class.unitId,
        userIds: new Set([
          l.teacher.userId,
          ...(l.class.homeroomTeacher ? [l.class.homeroomTeacher.userId] : []),
        ]),
      });
    } else if (start === seen.start) {
      seen.userIds.add(l.teacher.userId); // team teaching: both are "the teacher of that lesson"
    }
  }

  const due = new Map(
    [...first].filter(([, f]) => {
      const at = f.start + REGISTER_GRACE_MINUTES;
      return at > minutes - REGISTER_CHECK_EVERY_MINUTES && at <= minutes;
    })
  );
  if (!due.size) return [];
  for (const classId of await onHoliday(day, due)) due.delete(classId);
  if (!due.size) return [];

  const active = {
    status: CLASS_ENROLLMENT_STATUS.ACTIVE,
    student: { status: STUDENT_STATUS.ACTIVE, deletedAt: null },
  } satisfies Prisma.ClassEnrollmentWhereInput;
  const [enrolments, marks] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId: { in: [...due.keys()] }, ...active },
      select: { classId: true, studentId: true },
    }),
    prisma.attendance.findMany({
      where: { classId: { in: [...due.keys()] }, date: dayOf(day) },
      select: { classId: true, studentId: true },
    }),
  ]);
  const marked = new Set(marks.map((m) => `${m.classId}:${m.studentId}`));

  return [...due].flatMap(([classId, f]) => {
    const pupils = enrolments.filter((e) => e.classId === classId);
    const unmarked = pupils.filter((e) => !marked.has(`${classId}:${e.studentId}`)).length;
    return pupils.length && unmarked
      ? [
          {
            classId,
            className: f.className,
            day,
            firstLesson: f.time,
            enrolled: pupils.length,
            unmarked,
            userIds: [...f.userIds],
          },
        ]
      : [];
  });
}
