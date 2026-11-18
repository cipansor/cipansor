import type { Prisma } from '@prisma/client';
import {
  ADMIN_ROLE_CODES,
  KEPALA_UNIT_ROLE_CODES,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
} from '@cipansor/shared';
import { prisma, type Db } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { studentScope } from './student-scope';
import {
  mayWriteGradeVia,
  mayWriteReportCardVia,
  teachingRelations,
  type TeachingRelation,
} from './teaching-relation';

/**
 * The actor a *write* scope decision is made from — the verified token's
 * identity, never the request. Mirrors `ScopeActor` (reads) but is deliberately
 * a separate type: read breadth and write authority are different questions,
 * and a role that reads across units (see `seesAllUnits`) is not thereby a
 * writer across them (#987, R13.8).
 */
export interface WriteActor {
  sub: string;
  roleCode: string;
  unitId: string | null;
}

/** A filter that matches no santri. */
const NO_STUDENT: Prisma.StudentWhereInput = { id: { in: [] } };

/**
 * Penulis_Lintas_Unit: the roles that may write a record of any unit. Only
 * Super_Admin. A requirement that grants a narrower cross-unit write to another
 * role (the payroll approver, an organ flow) does not make that role a
 * Penulis_Lintas_Unit; such a role is scoped by its own rule, not this one.
 */
export function isCrossUnitWriter(actor: WriteActor): boolean {
  return actor.roleCode === 'SUPER_ADMIN';
}

/**
 * Whether `actor` may write a row that belongs to `unitId`. Super_Admin writes
 * any unit; every other account writes only the unit on its token, and an
 * account whose token carries no unit writes none.
 */
export function unitWritable(actor: WriteActor, unitId: string | null | undefined): boolean {
  if (isCrossUnitWriter(actor)) return true;
  return !!actor.unitId && unitId === actor.unitId;
}

/**
 * The santri `actor` may write without an extra relation, as a `where` on
 * Student.
 *
 * - Super_Admin: every santri;
 * - Akun_Santri: themselves, Wali_Santri: their own children (the read scope);
 * - everyone else: their own unit, or none when the token carries no unit.
 *
 * Unlike `studentScope`, this never widens with `seesAllUnits`: a musyrif or
 * muhafidz who *reads* across units still writes only their own unit's santri,
 * or a santri of another unit reached through a relation a requirement grants
 * explicitly (`viaRelation`). Widening a write scope by a read scope is exactly
 * the leak this helper exists to prevent (#987, R24.9, R25.1).
 */
export function studentWriteWhere(actor: WriteActor): Prisma.StudentWhereInput {
  if (isCrossUnitWriter(actor)) return {};
  const code = actor.roleCode;
  if (STUDENT_ROLE_CODES.includes(code) || PARENT_ROLE_CODES.includes(code)) {
    return studentScope(actor);
  }
  return actor.unitId ? { unitId: actor.unitId } : NO_STUDENT;
}

/**
 * 404 (Di_Luar_Cakupan_Tulis) unless every id in `studentIds` is a santri
 * `actor` may write. `viaRelation` names the extra reach a requirement grants
 * explicitly (Relasi_Pengajaran, Pembimbing, Musyrif_Bertugas): it is handed
 * the ids not already writable by unit and returns the subset it reaches, so a
 * santri of another unit is writable only through a relation that says so.
 *
 * `resource` names the answer's subject so a caller can make the out-of-scope
 * answer read the same as its own missing-id answer — the requirement is 404
 * with the same content as a record that does not exist, not merely 404.
 *
 * `db` lets a caller inside a transaction pass its `tx` handle, so the scope
 * read borrows no second connection while the transaction holds one.
 *
 * Not-found rather than forbidden, so the answer does not confirm the id.
 */
export async function assertStudentsWritable(
  studentIds: string[],
  actor: WriteActor,
  viaRelation?: (ids: string[]) => Promise<Set<string>>,
  resource = 'Student',
  db: Db = prisma
): Promise<void> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return;

  const writable = await db.student.findMany({
    where: { AND: [{ id: { in: ids } }, studentWriteWhere(actor)] },
    select: { id: true },
  });
  const allowed = new Set(writable.map((s) => s.id));

  const rest = ids.filter((id) => !allowed.has(id));
  if (rest.length && viaRelation) {
    for (const id of await viaRelation(rest)) allowed.add(id);
  }

  if (ids.some((id) => !allowed.has(id))) throw Errors.notFound(resource);
}

/**
 * 404 unless `actor` may write a row that belongs to `unitId`. Same shape as
 * the answer for a unit that does not exist.
 */
export function assertUnitWritable(
  actor: WriteActor,
  unitId: string | null | undefined,
  resource: string
): void {
  if (!unitWritable(actor, unitId)) throw Errors.notFound(resource);
}

// ---------------------------------------------------------------------------
// Penulis_Penilaian — who may write a santri's grade or report card
// ---------------------------------------------------------------------------
//
// Moved here from modules/assessment (#987) so a second module that writes a
// santri's grade — kurikulum-merdeka's Merdeka result and P5 assessment — uses
// the same rule rather than a copy. The rule is about a santri's record, so it
// lives with the other write-scope helpers; the assessment module re-exports
// it so its own call sites and tests are unchanged.

/** One active TeacherSubject of the actor, as the exam rule reads it. */
export interface TeacherSubjectFact {
  subjectId: string;
  classId: string | null;
  /** The unit the subject is taught in: the class's, or the Teacher's for `classId` null. */
  unitId: string;
}

/** The target of an assessment write, from facts the caller has already loaded. */
export type AssessmentTarget =
  | {
      kind: 'EXAM';
      unitId: string;
      subjectId: string;
      classId: string;
      actorSubjects: TeacherSubjectFact[];
    }
  | {
      kind: 'GRADE' | 'REPORT_CARD';
      studentUnitId: string;
      relations: Set<TeachingRelation>;
    };

/**
 * Penulis_Penilaian — whether `actor` may write the given exam, grade or report
 * card (#987). Pure: every fact is passed in, so the rule can be tested
 * directly. The glossary's rule:
 *
 * - Super_Admin: any unit;
 * - Admin_Unit or Kepala_Unit of the record's unit;
 * - anyone else (a teacher-level account): a grade needs relation (a), (b) or
 *   (c); a report card needs any relation; an exam needs an active
 *   TeacherSubject for its subject and class (or all classes) in its unit.
 *
 * A role that reads across units (`seesAllUnits`) gets no write from that
 * breadth: only the rules above apply (R13.8).
 */
export function isPenulisPenilaian(actor: WriteActor, target: AssessmentTarget): boolean {
  if (isCrossUnitWriter(actor)) return true;

  const unit = target.kind === 'EXAM' ? target.unitId : target.studentUnitId;
  const isUnitLeader =
    ADMIN_ROLE_CODES.includes(actor.roleCode) || KEPALA_UNIT_ROLE_CODES.includes(actor.roleCode);
  // A unit leader writes their whole unit and no other — a relation does not
  // extend a leader's reach to another unit (the relation clause is for the
  // teacher-level accounts below).
  if (isUnitLeader) return unitWritable(actor, unit);

  if (target.kind === 'EXAM') {
    return target.actorSubjects.some(
      (s) =>
        s.subjectId === target.subjectId &&
        (s.classId === target.classId || s.classId === null) &&
        s.unitId === target.unitId
    );
  }
  if (target.kind === 'GRADE') return mayWriteGradeVia(target.relations);
  return mayWriteReportCardVia(target.relations);
}

/** The actor's active TeacherSubjects as exam facts, or none if they have no Teacher row. */
export async function actorExamSubjects(actor: WriteActor): Promise<TeacherSubjectFact[]> {
  const teacher = await prisma.teacher.findFirst({
    where: { userId: actor.sub, deletedAt: null },
    select: { unitId: true },
  });
  if (!teacher) return [];
  const rows = await prisma.teacherSubject.findMany({
    where: { teacher: { userId: actor.sub, deletedAt: null }, isActive: true },
    select: { subjectId: true, classId: true, class: { select: { unitId: true } } },
  });
  return rows.map((r) => ({
    subjectId: r.subjectId,
    classId: r.classId,
    unitId: r.classId ? (r.class?.unitId ?? teacher.unitId) : teacher.unitId,
  }));
}

/**
 * 404 unless `examId` is an exam `actor` may write — same answer as an id that
 * does not exist. Returns the row so a caller can reuse it. `resource` names
 * the answer's subject so it reads the same as the endpoint's own missing-id
 * answer (R13.1, R25.4).
 */
export async function assertExamWritable(actor: WriteActor, examId: string, resource = 'Exam') {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, unitId: true, subjectId: true, classId: true },
  });
  if (!exam) throw Errors.notFound(resource);

  const target: AssessmentTarget = {
    kind: 'EXAM',
    unitId: exam.unitId,
    subjectId: exam.subjectId,
    classId: exam.classId,
    actorSubjects: await actorExamSubjects(actor),
  };
  if (!isPenulisPenilaian(actor, target)) throw Errors.notFound(resource);
  return exam;
}

/**
 * 404 unless every santri among `studentIds`, and every exam among `examIds`,
 * is one `actor` may write. `resource` names the answer so a grade endpoint's
 * out-of-scope answer reads like its own missing-id answer (R13.2, R25.4).
 */
export async function assertGradesWritable(
  actor: WriteActor,
  studentIds: string[],
  examIds: string[] = [],
  resource = 'Student'
): Promise<void> {
  const ids = [...new Set(studentIds)];
  if (ids.length) {
    const students = await prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, unitId: true },
    });
    if (students.length !== ids.length) throw Errors.notFound(resource);
    // A Penulis_Lintas_Unit writes any santri; relations are not consulted.
    if (!isCrossUnitWriter(actor)) {
      const relations = await teachingRelations(actor.sub, ids);
      for (const s of students) {
        if (
          !isPenulisPenilaian(actor, {
            kind: 'GRADE',
            studentUnitId: s.unitId,
            relations: relations.get(s.id) ?? new Set(),
          })
        ) {
          throw Errors.notFound(resource);
        }
      }
    }
  }
  for (const examId of [...new Set(examIds)].filter(Boolean)) {
    await assertExamWritable(actor, examId, resource);
  }
}

/**
 * 404 unless every santri among `studentIds` is one `actor` may write a report
 * card for. `resource` names the answer so a report card endpoint's
 * out-of-scope answer reads like its own missing-id answer (R13.3, R25.5).
 */
export async function assertReportCardsWritable(
  actor: WriteActor,
  studentIds: string[],
  resource = 'Student'
): Promise<void> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return;
  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: { id: true, unitId: true },
  });
  if (students.length !== ids.length) throw Errors.notFound(resource);
  if (isCrossUnitWriter(actor)) return;
  const relations = await teachingRelations(actor.sub, ids);
  for (const s of students) {
    if (
      !isPenulisPenilaian(actor, {
        kind: 'REPORT_CARD',
        studentUnitId: s.unitId,
        relations: relations.get(s.id) ?? new Set(),
      })
    ) {
      throw Errors.notFound(resource);
    }
  }
}
