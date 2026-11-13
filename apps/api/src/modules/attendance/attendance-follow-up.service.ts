import {
  AttendanceFollowUpOutcome,
  AttendanceStatus as PrismaAttendanceStatus,
  Prisma,
} from '@prisma/client';
import {
  ATTENDANCE_FOLLOW_UP_WINDOW_DAYS,
  ATTENDANCE_NOTES_MAX,
  type AttendanceFollowUpItem,
  type RecordFollowUpInput,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode } from '@/middleware/error';
import { boardersOfMusyrif, musyrifOfBoarders } from '@/modules/dormitories';
import { type AttendanceActor } from './attendance.access';
import { dayOf, dayString, todayWib } from '@/utils/wib';

/**
 * The second tier of the attendance follow-up (decisions/absensi-harian.md):
 * an absence marked Alpa with no reason is followed up by someone with a
 * relation to the child — the musyrif of a santri mukim, and the wali kelas
 * of everyone else, including a santri mukim whose asrama has no musyrif on
 * record (so no Alpa is left with nobody). They contact the wali and record
 * what came of it; a reason puts it on the register (Sakit or Izin), "no
 * reason" closes it as Alpa, and "could not reach" leaves it open for another
 * try.
 */

const OPEN_UNTIL_CLOSED = { none: { outcome: AttendanceFollowUpOutcome.NO_REASON } };

/** The first day still inside the follow-up window, as a stored date. */
const windowStart = () => {
  const today = dayOf(todayWib());
  return new Date(today.getTime() - (ATTENDANCE_FOLLOW_UP_WINDOW_DAYS - 1) * 86_400_000);
};

const currentYear = (now = new Date()) => ({ startDate: { lte: now }, endDate: { gte: now } });

/**
 * The absences a user may follow up, as a filter: those in the classes they
 * are wali kelas of this year, and those of the santri mukim they are musyrif
 * of. A class's santri mukim who has a musyrif is still in the filter — see
 * `theirs`, which hands them to the musyrif.
 */
async function ownedAbsences(userId: string) {
  const [homeroomClasses, boarders] = await Promise.all([
    prisma.class.findMany({
      where: {
        deletedAt: null,
        homeroomTeacher: { userId },
        academicYear: currentYear(),
      },
      select: { id: true },
    }),
    boardersOfMusyrif(userId),
  ]);
  const or: Prisma.AttendanceWhereInput[] = [];
  if (homeroomClasses.length) or.push({ classId: { in: homeroomClasses.map((c) => c.id) } });
  if (boarders.length) or.push({ studentId: { in: boarders } });
  return { or, boarders: new Set(boarders) };
}

/** Of `studentIds`, the santri mukim someone is musyrif of. */
async function withMusyrif(studentIds: string[]) {
  const musyrif = await musyrifOfBoarders(studentIds);
  return new Set([...musyrif].filter(([, people]) => people.length).map(([id]) => id));
}

/**
 * The rows that are the caller's: a boarder's they are musyrif of, and a
 * homeroom pupil's unless that pupil has a musyrif to follow them up.
 */
async function theirs<T extends { studentId: string }>(rows: T[], boarders: Set<string>) {
  const taken = await withMusyrif(
    rows.filter((r) => !boarders.has(r.studentId)).map((r) => r.studentId)
  );
  return rows.filter((r) => boarders.has(r.studentId) || !taken.has(r.studentId));
}

const ITEM_SELECT = {
  id: true,
  date: true,
  studentId: true,
  student: {
    select: {
      id: true,
      nis: true,
      parentName: true,
      parentPhone: true,
      user: { select: { name: true } },
      parents: {
        select: { relation: true, parent: { select: { name: true, phone: true } } },
        orderBy: { isPrimary: 'desc' },
      },
    },
  },
  class: { select: { id: true, name: true } },
  followUps: {
    select: {
      id: true,
      channel: true,
      outcome: true,
      note: true,
      createdAt: true,
      contactedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.AttendanceSelect;

type ItemRow = Prisma.AttendanceGetPayload<{ select: typeof ITEM_SELECT }>;

/**
 * Whom to contact: the walis with an account, then the contact given at
 * enrolment — which every pupil has, linked account or not — unless it is
 * one of them already.
 */
const walisOf = (student: ItemRow['student']) => {
  const linked = student.parents.map((p) => ({
    name: p.parent.name,
    phone: p.parent.phone,
    relation: p.relation,
  }));
  const known = new Set(linked.map((w) => w.phone).filter(Boolean));
  return student.parentPhone && !known.has(student.parentPhone)
    ? [...linked, { name: student.parentName, phone: student.parentPhone, relation: 'contact' }]
    : linked;
};

const toItem = (row: ItemRow, boarders: Set<string>): AttendanceFollowUpItem => ({
  attendanceId: row.id,
  date: dayString(row.date),
  student: { id: row.student.id, name: row.student.user.name, nis: row.student.nis },
  class: row.class,
  as: boarders.has(row.studentId) ? 'MUSYRIF' : 'WALI_KELAS',
  walis: walisOf(row.student),
  followUps: row.followUps.map((f) => ({
    id: f.id,
    channel: f.channel,
    outcome: f.outcome,
    note: f.note,
    at: f.createdAt.toISOString(),
    by: f.contactedBy,
  })),
});

/** GET /attendance/follow-ups — the caller's open absences, newest first. */
export async function listFollowUps(actor: AttendanceActor): Promise<AttendanceFollowUpItem[]> {
  const { or, boarders } = await ownedAbsences(actor.sub);
  if (!or.length) return [];
  const rows = await prisma.attendance.findMany({
    where: {
      status: PrismaAttendanceStatus.ABSENT,
      date: { gte: windowStart() },
      followUps: OPEN_UNTIL_CLOSED,
      OR: or,
    },
    select: ITEM_SELECT,
    orderBy: [{ date: 'desc' }, { class: { name: 'asc' } }],
  });
  return (await theirs(rows, boarders)).map((r) => toItem(r, boarders));
}

const NEW_MARK: Partial<Record<AttendanceFollowUpOutcome, PrismaAttendanceStatus>> = {
  ILL: PrismaAttendanceStatus.SICK,
  EXCUSED: PrismaAttendanceStatus.EXCUSED,
};
const OUTCOME_NOTE: Record<AttendanceFollowUpOutcome, string> = {
  ILL: 'sakit',
  EXCUSED: 'izin',
  NO_REASON: 'tanpa keterangan',
  UNREACHABLE: 'wali tidak terhubungi',
};

/**
 * POST /attendance/:id/follow-ups — record one contact about an absence the
 * caller follows up. An absence that is not theirs is not found; one that is
 * no longer Alpa, already closed, or older than the window is a conflict.
 */
export async function recordFollowUp(
  attendanceId: string,
  input: RecordFollowUpInput,
  actor: AttendanceActor
): Promise<AttendanceFollowUpItem> {
  const { or, boarders } = await ownedAbsences(actor.sub);
  const found = or.length
    ? await prisma.attendance.findFirst({
        where: { id: attendanceId, OR: or },
        select: { ...ITEM_SELECT, status: true, notes: true },
      })
    : null;
  const [row] = found ? await theirs([found], boarders) : [];
  if (!row) throw new ApiError(ErrorCode.NOT_FOUND, 'Absensi ini tidak Anda tindak lanjuti');
  if (row.status !== PrismaAttendanceStatus.ABSENT) {
    throw new ApiError(ErrorCode.CONFLICT, 'Absensi ini sudah bukan Alpa');
  }
  if (row.followUps.some((f) => f.outcome === AttendanceFollowUpOutcome.NO_REASON)) {
    throw new ApiError(ErrorCode.CONFLICT, 'Absensi ini sudah ditutup sebagai Alpa');
  }
  if (row.date < windowStart()) {
    throw new ApiError(
      ErrorCode.CONFLICT,
      `Tindak lanjut hanya untuk ${ATTENDANCE_FOLLOW_UP_WINDOW_DAYS} hari terakhir`
    );
  }

  const outcome = input.outcome as AttendanceFollowUpOutcome;
  const mark = NEW_MARK[outcome];
  const said = input.note ? ` — ${input.note}` : '';
  // What the teacher wrote on the mark stays; the follow-up is added after it,
  // within what the register accepts back on its next save — the whole note
  // is in the contact log.
  const joined = [row.notes, `Tindak lanjut: ${OUTCOME_NOTE[outcome]}${said}`]
    .filter(Boolean)
    .join(' · ');
  const notes =
    joined.length > ATTENDANCE_NOTES_MAX ? `${joined.slice(0, ATTENDANCE_NOTES_MAX - 1)}…` : joined;
  await prisma.$transaction([
    prisma.attendanceFollowUp.create({
      data: {
        attendanceId,
        contactedById: actor.sub,
        channel: input.channel,
        outcome,
        note: input.note ?? null,
      },
    }),
    ...(mark
      ? [
          prisma.attendance.update({
            where: { id: attendanceId },
            data: {
              status: mark,
              notes,
              recordedById: actor.sub,
            },
          }),
        ]
      : []),
  ]);

  const updated = await prisma.attendance.findUniqueOrThrow({
    where: { id: attendanceId },
    select: ITEM_SELECT,
  });
  return toItem(updated, boarders);
}

/**
 * The afternoon sweep: today's Alpa marks still open, grouped by the people
 * who follow them up — a santri mukim's musyrif, else the class's wali kelas.
 * What the reminder job tells each of them.
 */
export async function openAbsencesByOwner(day = todayWib()): Promise<Map<string, number>> {
  const rows = await prisma.attendance.findMany({
    where: {
      status: PrismaAttendanceStatus.ABSENT,
      date: dayOf(day),
      followUps: OPEN_UNTIL_CLOSED,
    },
    select: {
      studentId: true,
      class: { select: { homeroomTeacher: { select: { userId: true } } } },
    },
  });
  if (!rows.length) return new Map();
  const musyrif = await musyrifOfBoarders(rows.map((r) => r.studentId));
  const counts = new Map<string, number>();
  const add = (userId: string) => counts.set(userId, (counts.get(userId) ?? 0) + 1);
  for (const r of rows) {
    const mentors = musyrif.get(r.studentId) ?? [];
    if (mentors.length) mentors.forEach((m) => add(m.id));
    else if (r.class.homeroomTeacher) add(r.class.homeroomTeacher.userId);
  }
  return counts;
}
