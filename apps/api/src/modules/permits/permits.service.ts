import { randomInt } from 'crypto';
import {
  AttendanceStatus,
  NotificationType,
  PermitStatus,
  PermitType,
  Prisma,
  UnitType,
} from '@prisma/client';
import {
  PARENT_ROLE_CODES,
  PERMIT_DECIDER_ROLE_CODES,
  PERMIT_OFF_CAMPUS_TYPES,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  type CreatePermitInput,
  type PermitDecision,
  type PermitDeciderPreview,
  type PermitDoctorNote,
  type UpdatePermitInput,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Errors } from '@/middleware/error';
import {
  assertStudentInScope,
  onlyScopedStudents,
  studentScope,
  type ScopeActor,
} from '@/utils/student-scope';
import { wibDayOf, wibDayStart } from '@/utils/wib';
import { createNotification } from '../notifications/notifications.service';
import type { ListPermitsQueryParsed, PermitDeciderQueryParsed } from './permits.schema';
import { decisionFor, mayOpenNote, whoDecides, type Guardianship } from './permits.decider';
import { ACTIVE_ROOM_ASSIGNMENT, activeMusyrifAssignment, coversRoom } from '@/modules/dormitories';

/**
 * Perizinan: a learner's leave, from request to return.
 *
 *   PENDING ──approve──▶ APPROVED ──depart──▶ (outside) ──return──▶ COMPLETED
 *      │ └─reject──▶ REJECTED
 *      └──cancel──▶ CANCELLED
 *
 * Each move checks the state it starts from; a request that does not fit is a
 * 409, not a silent overwrite. Until 2026-09-25 one `PUT /:id/status` set any
 * status from any other (an approved-and-returned permit could be flipped back
 * to PENDING) and "return" completed permits that never left.
 *
 * Every read and every move is limited to the permits of learners the caller
 * may see (`studentScope`): a wali, their own children; staff, their unit;
 * boarding and cross-unit staff, every unit. Outside that, a permit is 404.
 *
 * Approve and reject are further limited to the learner's own mentor — their
 * musyrif if they board (the koordinator asrama when they go home or stay
 * out overnight), else their wali kelas — or the unit head
 * (`permits.decider.ts`). Every permit on the wire carries `decision`: who
 * decides it, and whether the caller may.
 */

/** The columns a permit carries on the wire — no `include: { student }`. */
const PERMIT_SELECT = {
  id: true,
  code: true,
  studentId: true,
  type: true,
  reason: true,
  destination: true,
  offCampus: true,
  startDate: true,
  endDate: true,
  status: true,
  approvedAt: true,
  rejectionNote: true,
  departedAt: true,
  returnedAt: true,
  decidedAs: true,
  tookOver: true,
  createdAt: true,
  updatedAt: true,
  student: {
    select: {
      id: true,
      nis: true,
      photoUrl: true,
      unit: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  },
  approvedBy: { select: { id: true, name: true } },
  // The note's facts; its content is read only by `openDoctorNote`.
  doctorNote: {
    select: {
      updatedAt: true,
      retainUntil: true,
      erasedAt: true,
      firstViewedAt: true,
      firstViewedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PermitSelect;

export type PermitRow = Prisma.PermitGetPayload<{ select: typeof PERMIT_SELECT }>;

/** A permit as the API sends it: the row, who decides it, and its doctor's note. */
export type PermitView = Omit<PermitRow, 'doctorNote'> & {
  decision: PermitDecision;
  doctorNote: PermitDoctorNote | null;
};

const scopeOf = (actor: ScopeActor): Prisma.PermitWhereInput =>
  onlyScopedStudents(studentScope(actor));

/** Not Found rather than Forbidden outside the caller's scope: the id is not confirmed. */
export async function findInScope(id: string, actor: ScopeActor): Promise<PermitRow> {
  const permit = await prisma.permit.findFirst({
    where: { AND: [{ id }, scopeOf(actor)] },
    select: PERMIT_SELECT,
  });
  if (!permit) throw Errors.notFound('Permit');
  return permit;
}

// ------------------------------------------------------------ who decides

/** `MusyrifAssignment.role` of the asrama's koordinator. */
const KOORDINATOR = 'KOORDINATOR';

/**
 * The learner's mentors as of now, for every learner in `studentIds`, in two
 * queries: the learners (unit, active kamar, active class's wali kelas), then
 * the musyrif assigned to their asrama. A musyrif assigned to the whole asrama
 * (`roomId` null) covers every kamar in it; those assigned as KOORDINATOR are
 * the asrama's koordinator, who decide a boarder's going home.
 */
export async function loadGuardianship(studentIds: string[]): Promise<Map<string, Guardianship>> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map();
  const now = new Date();
  const person = { select: { id: true, name: true, isActive: true } } as const;

  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      unitId: true,
      unit: { select: { type: true } },
      roomAssignments: {
        ...ACTIVE_ROOM_ASSIGNMENT,
        select: { room: { select: { id: true, dormitoryId: true } } },
      },
      enrollments: {
        where: { status: 'active', class: { deletedAt: null } },
        select: { class: { select: { homeroomTeacher: { select: { user: person } } } } },
      },
    },
  });

  const dormitoryIds = [
    ...new Set(students.flatMap((s) => s.roomAssignments.map((r) => r.room.dormitoryId))),
  ];
  const musyrif = dormitoryIds.length
    ? await prisma.musyrifAssignment.findMany({
        where: { dormitoryId: { in: dormitoryIds }, ...activeMusyrifAssignment(now) },
        select: {
          dormitoryId: true,
          roomId: true,
          role: true,
          musyrif: { select: { user: person } },
        },
      })
    : [];
  const active = (people: { id: string; name: string; isActive: boolean }[]) => [
    ...new Map(
      people.filter((p) => p.isActive).map((p) => [p.id, { id: p.id, name: p.name }])
    ).values(),
  ];

  return new Map(
    students.map((s) => {
      const room = s.roomAssignments[0]?.room;
      const people = room
        ? musyrif.filter((a) => coversRoom(a, room)).map((a) => a.musyrif.user)
        : s.enrollments.flatMap((e) =>
            e.class.homeroomTeacher ? [e.class.homeroomTeacher.user] : []
          );
      const coordinators = room
        ? musyrif
            .filter((a) => a.dormitoryId === room.dormitoryId && a.role === KOORDINATOR)
            .map((a) => a.musyrif.user)
        : [];
      return [
        s.id,
        {
          unitId: s.unitId,
          unitType: s.unit.type,
          boarder: !!room,
          mentors: active(people),
          coordinators: active(coordinators),
        },
      ];
    })
  );
}

/** A learner the loader did not return has no mentor on record. */
export const guardianshipOf = (g: Map<string, Guardianship>, row: PermitRow): Guardianship =>
  g.get(row.studentId) ?? {
    unitId: row.student.unit.id,
    unitType: UnitType.OTHER,
    boarder: false,
    mentors: [],
    coordinators: [],
  };

function viewOf(row: PermitRow, g: Guardianship, actor: ScopeActor): PermitView {
  // `capacity` is the service's own business; the wire gets the decision.
  const { capacity: _capacity, ...decision } = decisionFor(row, g, actor);
  const { doctorNote: note, ...rest } = row;
  const doctorNote: PermitDoctorNote | null = note
    ? {
        attachedAt: note.updatedAt.toISOString(),
        retainUntil: note.retainUntil.toISOString().slice(0, 10),
        erasedAt: note.erasedAt?.toISOString() ?? null,
        firstViewedBy: note.firstViewedBy,
        firstViewedAt: note.firstViewedAt?.toISOString() ?? null,
        canOpen: !note.erasedAt && mayOpenNote(row, g, actor),
      }
    : null;
  return { ...rest, decision, doctorNote };
}

async function withDecisions(rows: PermitRow[], actor: ScopeActor): Promise<PermitView[]> {
  const g = await loadGuardianship(rows.map((r) => r.studentId));
  return rows.map((row) => viewOf(row, guardianshipOf(g, row), actor));
}

export const withDecision = async (row: PermitRow, actor: ScopeActor) =>
  (await withDecisions([row], actor))[0];

/**
 * Pending permits in `where` that are the caller's own to decide — routed to
 * them, not merely open to a head's takeover. Which ones those are depends on
 * kamar and class relations a single `where` cannot express next to the
 * permit's length, so it is worked out here; pending permits are few by nature
 * (they get decided), and at most `PENDING_CAP` are looked at.
 */
const PENDING_CAP = 500;
async function awaitingDecisionBy(
  actor: ScopeActor,
  where: Prisma.PermitWhereInput
): Promise<PermitView[]> {
  if (!PERMIT_DECIDER_ROLE_CODES.includes(actor.roleCode ?? '')) return [];
  const pending = await prisma.permit.findMany({
    where: { AND: [where, { status: PermitStatus.PENDING }] },
    select: PERMIT_SELECT,
    orderBy: { createdAt: 'asc' },
    take: PENDING_CAP,
  });
  return (await withDecisions(pending, actor)).filter(
    (p) => p.decision.canDecide && !p.decision.asTakeover
  );
}

/**
 * Off the pondok during the leave: always for PULANG, KELUAR and KELUARGA;
 * for SAKIT and OTHER as the filer says, else as it was (true for a new one —
 * the stricter reading when nobody said).
 */
export function offCampusOf(type: PermitType, said: boolean | undefined, was = true): boolean {
  if (PERMIT_OFF_CAMPUS_TYPES.includes(type)) return true;
  return said ?? was;
}

/**
 * GET /permits/decider — who would decide a permit with these facts, before it
 * is filed, for a learner the caller may file for. The form uses `boarder` to
 * ask where a sick santri will be, and shows who decides.
 */
export async function previewDecider(
  query: PermitDeciderQueryParsed,
  actor: ScopeActor
): Promise<PermitDeciderPreview> {
  await assertStudentInScope(query.studentId, actor);
  const guardianship = await loadGuardianship([query.studentId]);
  const g = guardianship.get(query.studentId);
  if (!g) throw Errors.notFound('Student');
  const permit = {
    status: PermitStatus.PENDING,
    type: query.type,
    offCampus: offCampusOf(query.type, query.offCampus),
    startDate: new Date(query.startDate),
    endDate: new Date(query.endDate),
  };
  const { route, mentorKind, mentors } = decisionFor(permit, g, actor);
  return { boarder: g.boarder, decision: { route, mentorKind, mentors } };
}

/** Ambiguous characters (0/O, 1/I/L) left out: the code is read aloud and typed at the gate. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function permitCode(): string {
  let code = 'PMT-';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Permits still in force for a learner: waiting, or approved and not yet back. */
const LIVE: Prisma.PermitWhereInput = {
  OR: [{ status: PermitStatus.PENDING }, { status: PermitStatus.APPROVED, returnedAt: null }],
};

async function assertNoOverlap(
  studentId: string,
  startDate: Date,
  endDate: Date,
  exceptId?: string
): Promise<void> {
  const clash = await prisma.permit.findFirst({
    where: {
      studentId,
      ...(exceptId && { id: { not: exceptId } }),
      startDate: { lt: endDate },
      endDate: { gt: startDate },
      ...LIVE,
    },
    select: { code: true },
  });
  if (clash) {
    throw Errors.conflict(`Sudah ada izin yang berjalan pada waktu itu (${clash.code ?? '-'})`);
  }
}

export async function createPermit(
  input: CreatePermitInput,
  actor: ScopeActor
): Promise<PermitView> {
  await assertStudentInScope(input.studentId, actor);
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  await assertNoOverlap(input.studentId, startDate, endDate);

  const row = await insertWithCode(input, startDate, endDate);
  const g = guardianshipOf(await loadGuardianship([row.studentId]), row);
  const permit = viewOf(row, g, actor);
  await notifyFiled(permit, g, actor);
  return permit;
}

async function insertWithCode(
  input: CreatePermitInput,
  startDate: Date,
  endDate: Date
): Promise<PermitRow> {
  // The code is unique; on the rare collision draw again rather than
  // check-then-insert, which races.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.permit.create({
        data: {
          studentId: input.studentId,
          type: input.type,
          reason: input.reason,
          destination: input.destination,
          offCampus: offCampusOf(input.type, input.offCampus),
          startDate,
          endDate,
          code: permitCode(),
        },
        select: PERMIT_SELECT,
      });
    } catch (e) {
      if (!isUniqueViolation(e) || attempt >= 4) throw e;
    }
  }
}

export interface ListPermitsResult {
  data: PermitView[];
  total: number;
  page: number;
  limit: number;
}

export async function listPermits(
  query: ListPermitsQueryParsed,
  actor: ScopeActor
): Promise<ListPermitsResult> {
  const { studentId, type, status, outside, from, to, awaitingMe, page, limit } = query;
  const where: Prisma.PermitWhereInput = {
    AND: [
      scopeOf(actor),
      {
        ...(studentId && { studentId }),
        ...(type && { type }),
        ...(status && { status }),
        ...(outside && { departedAt: { not: null }, returnedAt: null }),
        // A permit is in the window if its period touches it.
        ...(to && { startDate: { lt: dayAfter(to) } }),
        ...(from && { endDate: { gte: wibDayStart(from) } }),
      },
    ],
  };
  if (awaitingMe) {
    // Oldest first: a queue of decisions to make.
    const mine = await awaitingDecisionBy(actor, where);
    return { data: mine.slice((page - 1) * limit, page * limit), total: mine.length, page, limit };
  }
  const [rows, total] = await Promise.all([
    prisma.permit.findMany({
      where,
      select: PERMIT_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.permit.count({ where }),
  ]);
  return { data: await withDecisions(rows, actor), total, page, limit };
}

export async function getPermit(id: string, actor: ScopeActor): Promise<PermitView> {
  return withDecision(await findInScope(id, actor), actor);
}

/** The gate types the code from the learner's slip. */
export async function getPermitByCode(code: string, actor: ScopeActor) {
  const permit = await prisma.permit.findFirst({
    where: { AND: [{ code: code.trim().toUpperCase() }, scopeOf(actor)] },
    select: PERMIT_SELECT,
  });
  if (!permit) throw Errors.notFound('Permit');
  return withDecision(permit, actor);
}

export async function getSummary(actor: ScopeActor) {
  const scope = scopeOf(actor);
  const now = new Date();
  const count = (where: Prisma.PermitWhereInput) =>
    prisma.permit.count({ where: { AND: [scope, where] } });
  const [pending, approved, outside, overdue, mine] = await Promise.all([
    count({ status: PermitStatus.PENDING }),
    count({ status: PermitStatus.APPROVED, departedAt: null, endDate: { gte: now } }),
    count({ departedAt: { not: null }, returnedAt: null }),
    count({ departedAt: { not: null }, returnedAt: null, endDate: { lt: now } }),
    awaitingDecisionBy(actor, scope),
  ]);
  return { pending, awaitingMe: mine.length, approved, outside, overdue };
}

export async function updatePermit(id: string, input: UpdatePermitInput, actor: ScopeActor) {
  const permit = await findInScope(id, actor);
  if (permit.status !== PermitStatus.PENDING) {
    throw Errors.conflict('Hanya izin yang masih menunggu yang dapat diubah');
  }
  const startDate = input.startDate ? new Date(input.startDate) : permit.startDate;
  const endDate = input.endDate ? new Date(input.endDate) : permit.endDate;
  if (endDate <= startDate) {
    throw Errors.badRequest('Waktu kembali harus sesudah waktu berangkat');
  }
  await assertNoOverlap(permit.studentId, startDate, endDate, id);
  const row = await prisma.permit.update({
    where: { id },
    data: {
      type: input.type,
      reason: input.reason,
      destination: input.destination,
      offCampus: offCampusOf(input.type ?? permit.type, input.offCampus, permit.offCampus),
      startDate,
      endDate,
    },
    select: PERMIT_SELECT,
  });
  return withDecision(row, actor);
}

/**
 * Move a permit from `from` to its next state in one statement, so two people
 * pressing the button at once cannot both succeed: the second finds nothing
 * left in `from` and gets a 409.
 */
async function transition(
  id: string,
  actor: ScopeActor,
  from: Prisma.PermitWhereInput,
  data: Prisma.PermitUncheckedUpdateManyInput,
  refusal: string
): Promise<PermitView> {
  await findInScope(id, actor);
  const { count } = await prisma.permit.updateMany({ where: { id, ...from }, data });
  if (count === 0) throw Errors.conflict(refusal);
  const row = await prisma.permit.findUniqueOrThrow({ where: { id }, select: PERMIT_SELECT });
  return withDecision(row, actor);
}

/**
 * 409 once decided; 403 unless the caller decides this permit (its learner's
 * mentor, or a unit head). The move that follows is guarded on what decides
 * the route — dates, type, off the pondok — as read here, so a permit changed
 * in the meantime (lengthened, which sends it to the head; made izin pulang,
 * which sends it to the koordinator) is not decided on the old reading.
 */
async function assertDecides(id: string, actor: ScopeActor) {
  const permit = await findInScope(id, actor);
  if (permit.status !== PermitStatus.PENDING) throw Errors.conflict('Izin ini sudah diputuskan');
  const g = guardianshipOf(await loadGuardianship([permit.studentId]), permit);
  const d = decisionFor(permit, g, actor);
  if (!d.canDecide || !d.capacity) throw Errors.forbidden(whoDecides(d));
  return {
    from: {
      status: PermitStatus.PENDING,
      type: permit.type,
      offCampus: permit.offCampus,
      startDate: permit.startDate,
      endDate: permit.endDate,
    } satisfies Prisma.PermitWhereInput,
    as: { decidedAs: d.capacity, tookOver: d.asTakeover },
  };
}

const DECIDED_OR_CHANGED = 'Izin ini sudah diputuskan atau baru saja diubah';

export async function approvePermit(id: string, actor: ScopeActor) {
  const { from, as } = await assertDecides(id, actor);
  const permit = await transition(
    id,
    actor,
    from,
    { status: PermitStatus.APPROVED, approvedById: actor.sub, approvedAt: new Date(), ...as },
    DECIDED_OR_CHANGED
  );
  await recordAttendance(permit, actor.sub);
  await notifyParents(
    permit.studentId,
    'Izin disetujui',
    `Izin ${TYPE_LABEL[permit.type]} untuk ${permit.student.user.name} disetujui.`,
    permit.id
  );
  if (as.tookOver) await notifyTakenOver(permit, 'disetujui');
  return permit;
}

export async function rejectPermit(id: string, rejectionNote: string, actor: ScopeActor) {
  const { from, as } = await assertDecides(id, actor);
  const permit = await transition(
    id,
    actor,
    from,
    { status: PermitStatus.REJECTED, approvedById: actor.sub, rejectionNote, ...as },
    DECIDED_OR_CHANGED
  );
  await notifyParents(
    permit.studentId,
    'Izin ditolak',
    `Izin untuk ${permit.student.user.name} ditolak. Alasan: ${rejectionNote}`,
    permit.id
  );
  if (as.tookOver) await notifyTakenOver(permit, 'ditolak');
  return permit;
}

/**
 * Withdraw a request before it is decided. An approved permit is not
 * cancelled: approval has already written the attendance for its days, and
 * unwinding that is a correction to attendance, not to the permit.
 */
export async function cancelPermit(id: string, actor: ScopeActor) {
  return transition(
    id,
    actor,
    { status: PermitStatus.PENDING },
    { status: PermitStatus.CANCELLED },
    'Hanya izin yang masih menunggu yang dapat dibatalkan'
  );
}

export async function departPermit(id: string, actor: ScopeActor) {
  const now = new Date();
  const permit = await transition(
    id,
    actor,
    { status: PermitStatus.APPROVED, departedAt: null, endDate: { gt: now } },
    { departedAt: now },
    'Izin belum disetujui, sudah dipakai, atau sudah lewat masa berlakunya'
  );
  await notifyParents(
    permit.studentId,
    'Sudah berangkat',
    `${permit.student.user.name} keluar melalui gerbang sesuai izin ${permit.code ?? ''}.`.trim(),
    permit.id
  );
  return permit;
}

export async function returnPermit(id: string, returnedAt: string | undefined, actor: ScopeActor) {
  const at = returnedAt ? new Date(returnedAt) : new Date();
  const permit = await transition(
    id,
    actor,
    { status: PermitStatus.APPROVED, departedAt: { not: null, lte: at }, returnedAt: null },
    { status: PermitStatus.COMPLETED, returnedAt: at },
    'Izin ini belum tercatat berangkat, atau sudah selesai'
  );
  await notifyParents(
    permit.studentId,
    'Sudah kembali',
    `${permit.student.user.name} sudah kembali.`,
    permit.id
  );
  return permit;
}

// ---------------------------------------------------------------- effects

const TYPE_LABEL: Record<PermitType, string> = {
  PULANG: 'pulang',
  KELUAR: 'keluar',
  SAKIT: 'sakit',
  KELUARGA: 'keperluan keluarga',
  OTHER: 'lainnya',
};

/** `YYYY-MM-DD` + 1 day, as the instant that day starts in WIB. */
function dayAfter(date: string): Date {
  return new Date(wibDayStart(date).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * The calendar days (in WIB) a permit touches, as UTC midnights — the form a
 * `@db.Date` column compares equal to. A permit from Friday 13:00 to Sunday
 * 17:00 covers Friday, Saturday and Sunday.
 */
export function daysCovered(start: Date, end: Date): Date[] {
  const day = Date.parse(`${wibDayOf(start)}T00:00:00.000Z`);
  const stop = Date.parse(`${wibDayOf(end)}T00:00:00.000Z`);
  const days: Date[] = [];
  for (let t = day; t <= stop && days.length < 62; t += 24 * 60 * 60 * 1000) {
    days.push(new Date(t));
  }
  return days;
}

/**
 * An approved permit excuses the learner's class attendance for its days
 * (SICK for sick leave, EXCUSED otherwise), overwriting a mark already taken
 * and creating the missing ones. A learner with no active class has nothing
 * to write.
 */
async function recordAttendance(
  permit: Pick<PermitRow, 'id' | 'code' | 'studentId' | 'type' | 'startDate' | 'endDate'>,
  recordedById: string
) {
  const enrollment = await prisma.classEnrollment.findFirst({
    where: { studentId: permit.studentId, status: 'active' },
    select: { classId: true },
  });
  if (!enrollment) return;
  const days = daysCovered(permit.startDate, permit.endDate);
  const status =
    permit.type === PermitType.SAKIT ? AttendanceStatus.SICK : AttendanceStatus.EXCUSED;
  const notes = `Izin ${permit.code ?? permit.id}`;
  await prisma.$transaction([
    prisma.attendance.updateMany({
      where: { studentId: permit.studentId, classId: enrollment.classId, date: { in: days } },
      data: { status, notes },
    }),
    prisma.attendance.createMany({
      data: days.map((date) => ({
        studentId: permit.studentId,
        classId: enrollment.classId,
        date,
        status,
        notes,
        recordedById,
      })),
      skipDuplicates: true,
    }),
  ]);
}

/** A failed notification is logged and never undoes the move. */
async function notifyUsers(userIds: string[], title: string, message: string, permitId: string) {
  await Promise.all(
    [...new Set(userIds)].map((userId) =>
      createNotification({
        userId,
        type: NotificationType.INFO,
        title,
        message,
        data: { permitId },
      }).catch((error) =>
        logger.warn('Permit notification failed', { permitId, error: String(error) })
      )
    )
  );
}

/** Tell the learner's walis. */
async function notifyParents(studentId: string, title: string, message: string, permitId: string) {
  const parents = await prisma.studentParent.findMany({
    where: { studentId },
    select: { parentId: true },
  });
  await notifyUsers(
    parents.map((p) => p.parentId),
    title,
    message,
    permitId
  );
}

/** A head decided what was the mentor's: the mentor hears of it. */
async function notifyTakenOver(permit: PermitView, outcome: 'disetujui' | 'ditolak') {
  await notifyUsers(
    permit.decision.mentors.map((m) => m.id),
    'Izin diputuskan kepala unit',
    `Izin ${TYPE_LABEL[permit.type]} untuk ${permit.student.user.name} ${outcome} oleh ${
      permit.approvedBy?.name ?? 'kepala unit'
    }.`,
    permit.id
  );
}

/** The unit heads over this learner (see `headCapacity`). */
async function headsOf(g: Guardianship): Promise<string[]> {
  const overPesantren = g.boarder || g.unitType === UnitType.PESANTREN;
  const rows = await prisma.userRoleAssignment.findMany({
    where: {
      isActive: true,
      user: { isActive: true },
      OR: [
        { role: { code: { in: [...PRINCIPAL_ROLE_CODES] } }, unitId: g.unitId },
        ...(overPesantren ? [{ role: { code: { in: [...PESANTREN_LEADER_ROLE_CODES] } } }] : []),
      ],
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * A new permit: whoever decides it is told it is waiting — the mentor, or the
 * heads when it goes to them. When staff filed it, the walis are told at once
 * rather than only once it is decided: leave from the pesantren is theirs to
 * know about.
 */
async function notifyFiled(permit: PermitView, g: Guardianship, actor: ScopeActor) {
  const who = permit.student.user.name;
  const what = `Izin ${TYPE_LABEL[permit.type]} untuk ${who}`;
  const deciders =
    permit.decision.route === 'MENTOR'
      ? permit.decision.mentors.map((m) => m.id)
      : await headsOf(g);
  await notifyUsers(
    deciders.filter((id) => id !== actor.sub),
    'Izin menunggu keputusan Anda',
    `${what} menunggu keputusan.`,
    permit.id
  );
  if (!PARENT_ROLE_CODES.includes(actor.roleCode ?? '')) {
    await notifyParents(
      permit.studentId,
      'Izin diajukan',
      `${what} diajukan dan menunggu keputusan.`,
      permit.id
    );
  }
}
