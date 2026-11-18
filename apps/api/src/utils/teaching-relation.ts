import { ADMIN_ROLE_CODES, KEPALA_UNIT_ROLE_CODES } from '@cipansor/shared';
import { prisma, type Db } from '@/lib/prisma';
import { activeMusyrifAssignment } from '@/modules/dormitories';
import { isCrossUnitWriter, unitWritable, type WriteActor } from '@/utils/write-scope';

/**
 * Relasi_Pengajaran — the relation between an account and a santri that lets
 * the account write that santri's grades or report card (#987, R13.2, R13.3):
 *
 * - `SUBJECT`  (a): an active `TeacherSubject` of the account's Teacher row,
 *                  for a class the santri is actively in — or for every class
 *                  (`classId` null) when the Teacher is in the santri's unit;
 * - `HALAQOH`  (b): an `ACTIVE` `TakhosusEnrollment` of the santri on a
 *                  Halaqoh the account leads, whatever the Halaqoh's own
 *                  `isActive`/`deletedAt` (R32.20);
 * - `MUSYRIF`  (c): the account is the musyrif on an active assignment
 *                  covering the santri's active room;
 * - `HOMEROOM` (d): the account's Teacher row is the homeroom teacher of a
 *                  class the santri is actively in. Only for report cards and
 *                  ibadah notes, never for grades.
 */
export type TeachingRelation = 'SUBJECT' | 'HALAQOH' | 'MUSYRIF' | 'HOMEROOM';

/**
 * The facts `teachingRelations` reads, reduced to the four questions the
 * relations answer — one set of santri ids per relation. Keeping the pure core
 * here (not the queries) is what lets the relation rule be tested directly.
 */
export interface TeachingState {
  /** (a) santri whose active class the account teaches a subject in. */
  subject: Set<string>;
  /** (b) santri actively enrolled in a Halaqoh the account leads. */
  halaqoh: Set<string>;
  /** (c) santri whose active room the account covers as musyrif. */
  musyrif: Set<string>;
  /** (d) santri whose active class the account leads as homeroom teacher. */
  homeroom: Set<string>;
}

/** The relations of every santri named in the state — the pure half of `teachingRelations`. */
export function teachingRelationsFromState(
  state: TeachingState
): Map<string, Set<TeachingRelation>> {
  const out = new Map<string, Set<TeachingRelation>>();
  const add = (ids: Set<string>, relation: TeachingRelation) => {
    for (const id of ids) {
      const set = out.get(id) ?? new Set<TeachingRelation>();
      set.add(relation);
      out.set(id, set);
    }
  };
  add(state.subject, 'SUBJECT');
  add(state.halaqoh, 'HALAQOH');
  add(state.musyrif, 'MUSYRIF');
  add(state.homeroom, 'HOMEROOM');
  return out;
}

/** Grades may be written through (a), (b) or (c) — never (d) alone (R13.2). */
export const mayWriteGradeVia = (r: Set<TeachingRelation>): boolean =>
  r.has('SUBJECT') || r.has('HALAQOH') || r.has('MUSYRIF');

/** Report cards may be written through any relation, including (d) (R13.3). */
export const mayWriteReportCardVia = (r: Set<TeachingRelation>): boolean => r.size > 0;

/** Ibadah notes may be written through any relation, including (d) (R27.2). */
export const mayWriteIbadahVia = (r: Set<TeachingRelation>): boolean => r.size > 0;

/**
 * Penulis_Catatan_Ibadah — whether `actor` may write a santri's ibadah notes
 * (#989, R27.2). The owner's decision of 2026-11-09 narrowed this: only a
 * Super_Admin writes another unit's notes. Everyone else needs the santri's own
 * unit (an Admin_Unit or Kepala_Unit of that unit), or a Relasi_Pengajaran with
 * the santri — relation (d), wali kelas, included (R32.20 for (b)).
 *
 * Pure: the santri's unit and the actor's relations are passed in, so the rule
 * can be tested directly. A unit leader writes their whole unit and no other,
 * exactly as `isPenulisPenilaian` decides for a grade.
 */
export function isPenulisIbadah(
  actor: WriteActor,
  studentUnitId: string,
  relations: Set<TeachingRelation>
): boolean {
  if (isCrossUnitWriter(actor)) return true;
  const isUnitLeader =
    ADMIN_ROLE_CODES.includes(actor.roleCode) || KEPALA_UNIT_ROLE_CODES.includes(actor.roleCode);
  if (isUnitLeader) return unitWritable(actor, studentUnitId);
  return mayWriteIbadahVia(relations);
}

/**
 * A `viaRelation` callback for `assertStudentsWritable` (`utils/write-scope.ts`):
 * given the ids a write rule could not reach by unit, the subset the account
 * reaches through a Relasi_Pengajaran (a)–(d). This is the relation reach a
 * requirement grants over a santri of another unit — the simaan write surface
 * (#1025) reaches a santri through (a)–(c), the rapor pesantren write surface
 * through any relation including (d), and the caller's own unit alone would
 * refuse them.
 *
 * `via` decides which relations count, defaulting to every relation (the report
 * card rule, R13.3). A score-shaped write passes `mayWriteGradeVia`, so a
 * homeroom teacher alone — relation (d) — cannot reach it (R13.2).
 */
export function teachingRelationReach(
  userId: string,
  via: (relations: Set<TeachingRelation>) => boolean = mayWriteReportCardVia,
  db: Db = prisma
): (ids: string[]) => Promise<Set<string>> {
  return async (ids) => {
    const relations = await teachingRelations(userId, ids, new Date(), db);
    const reached = new Set<string>();
    for (const [id, r] of relations) {
      if (via(r)) reached.add(id);
    }
    return reached;
  };
}

/**
 * The relation of `userId` with each of `studentIds`, read at request time.
 * A santri with no relation is absent from the map.
 */
export async function teachingRelations(
  userId: string,
  studentIds: string[],
  now: Date = new Date(),
  db: Db = prisma
): Promise<Map<string, Set<TeachingRelation>>> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map();

  const [teacher, students] = await Promise.all([
    db.teacher.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, unitId: true },
    }),
    db.student.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        unitId: true,
        enrollments: {
          where: { status: 'active' },
          select: { classId: true },
        },
      },
    }),
  ]);

  const state: TeachingState = {
    subject: new Set(),
    halaqoh: new Set(),
    musyrif: new Set(),
    homeroom: new Set(),
  };

  // (a) SUBJECT — the classes the account teaches, matched to each santri's
  // active classes, plus the all-classes form when the Teacher is in the unit.
  if (teacher) {
    const subjects = await db.teacherSubject.findMany({
      where: { teacherId: teacher.id, isActive: true },
      select: { classId: true },
    });
    const taughtClasses = new Set(
      subjects.map((s) => s.classId).filter((c): c is string => c !== null)
    );
    const teachesAllClasses = subjects.some((s) => s.classId === null);
    for (const s of students) {
      if (s.enrollments.some((e) => taughtClasses.has(e.classId))) {
        state.subject.add(s.id);
      } else if (teachesAllClasses && s.unitId === teacher.unitId) {
        state.subject.add(s.id);
      }
    }
  }

  // (b) HALAQOH — an ACTIVE enrolment on a Halaqoh the account leads. The
  // Halaqoh's own state is deliberately not consulted (R32.20).
  const halaqoh = await db.takhosusEnrollment.findMany({
    where: {
      studentId: { in: ids },
      status: 'ACTIVE',
      halaqoh: { teacherId: userId },
    },
    select: { studentId: true },
  });
  for (const h of halaqoh) state.halaqoh.add(h.studentId);

  // (c) MUSYRIF — an active assignment of the account's Musyrif row covering
  // the santri's active room.
  const musyrif = await db.musyrif.findFirst({
    where: { userId, isActive: true },
    select: { id: true },
  });
  if (musyrif) {
    const assignments = await db.musyrifAssignment.findMany({
      where: { musyrifId: musyrif.id, ...activeMusyrifAssignment(now) },
      select: { dormitoryId: true, roomId: true },
    });
    if (assignments.length) {
      const rooms = await db.roomAssignment.findMany({
        where: { studentId: { in: ids }, isActive: true, endedAt: null },
        select: { studentId: true, room: { select: { id: true, dormitoryId: true } } },
      });
      for (const r of rooms) {
        const covered = assignments.some(
          (a) =>
            a.dormitoryId === r.room.dormitoryId && (a.roomId === null || a.roomId === r.room.id)
        );
        if (covered) state.musyrif.add(r.studentId);
      }
    }
  }

  // (d) HOMEROOM — the account's Teacher row leads a class the santri is in.
  if (teacher) {
    const homeroomClasses = await db.class.findMany({
      where: { homeroomTeacherId: teacher.id, deletedAt: null },
      select: { id: true },
    });
    const led = new Set(homeroomClasses.map((c) => c.id));
    if (led.size) {
      for (const s of students) {
        if (s.enrollments.some((e) => led.has(e.classId))) state.homeroom.add(s.id);
      }
    }
  }

  return teachingRelationsFromState(state);
}
