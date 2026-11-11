import type { Prisma } from '@prisma/client';
import {
  ALUMNI_ROLE_CODES,
  KOMITE_ROLE_CODES,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { seesAllUnits } from './resolve-unit-id';

/** Who is asking: the verified token, never the request. */
export interface ScopeActor {
  sub: string;
  roleCode?: string | null;
  unitId?: string | null;
}

/** A filter that matches no santri. */
const NO_STUDENT: Prisma.StudentWhereInput = { id: { in: [] } };

/**
 * The santri an account may see, as a `where` on Student. One rule for every
 * list that is about santri (health, grades, report cards, attendance,
 * tahfidz, murojaah, …).
 *
 * - santri: themselves;
 * - wali: their own children (StudentParent);
 * - alumni and komite: none — their portals read their own alumni record or
 *   aggregates, never santri rows;
 * - the yayasan board and the cross-unit service staff (`seesAllUnits`):
 *   every unit;
 * - everyone else: their own unit.
 *
 * Measured 2026-09-24 on staging: a santri account received 276 health
 * records, 3,464 grade rows and 5,089 tahfidz rows of every santri, because
 * these lists filtered by nothing. This decides *which rows*; what a role may
 * do with them is still its route guard.
 */
export function studentScope(actor: ScopeActor): Prisma.StudentWhereInput {
  const code = actor.roleCode ?? '';
  if (STUDENT_ROLE_CODES.includes(code)) return { userId: actor.sub };
  if (PARENT_ROLE_CODES.includes(code)) {
    return { parents: { some: { parentId: actor.sub } } };
  }
  if (ALUMNI_ROLE_CODES.includes(code) || KOMITE_ROLE_CODES.includes(code)) {
    return NO_STUDENT;
  }
  if (seesAllUnits(actor)) return {};
  return actor.unitId ? { unitId: actor.unitId } : NO_STUDENT;
}

/**
 * The santri columns a list may carry. `include: { student }` sends all of
 * them — NIK, No. KK, the parents' NIK and income — which is how the grade,
 * attendance and tahfidz lists came to leak them (see #540 for the same bug in
 * billing).
 */
export const STUDENT_SAFE_SELECT = {
  id: true,
  nis: true,
  nisn: true,
  unitId: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.StudentSelect;

/**
 * The teacher columns a list may carry. A Teacher row also holds NIK, No. KK,
 * home address and the salary bank account; exam and schedule lists only need
 * to say who teaches.
 */
export const TEACHER_SAFE_SELECT = {
  id: true,
  nip: true,
  unitId: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.TeacherSelect;

/**
 * 404 unless `studentId` is a santri this account may see — for endpoints that
 * take the santri from the URL (`/summary/:studentId`, `/map/:studentId`).
 * Not-found rather than forbidden, so the answer does not confirm the id.
 */
export async function assertStudentInScope(studentId: string, actor: ScopeActor): Promise<void> {
  const found = await prisma.student.findFirst({
    where: { AND: [{ id: studentId }, studentScope(actor)] },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Student');
}

/**
 * 404 unless `studentId` is a santri of `unitId` *and* one this account may
 * see — for a record that carries a unit of its own (a visit, a parcel). The
 * scope check alone is not enough: a foundation account reaches every santri,
 * so it could file a unit-A record about a unit-B santri, and unit A's staff
 * would then read that santri's identity from a record they are allowed to
 * see. The record's unit must match the santri's.
 */
export async function assertStudentInUnit(
  studentId: string,
  unitId: string,
  actor: ScopeActor
): Promise<void> {
  const found = await prisma.student.findFirst({
    where: { AND: [{ id: studentId }, { unitId }, studentScope(actor)] },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Student');
}

/**
 * `{ student: scope }` for a record's `where`, or nothing when the scope is
 * unrestricted. An empty filter on an optional relation would also drop rows
 * that have no santri at all (a clinic patient who is staff, say), which an
 * unrestricted account must still see.
 */
export function onlyScopedStudents(scope: Prisma.StudentWhereInput): {
  student?: Prisma.StudentWhereInput;
} {
  return Object.keys(scope).length ? { student: scope } : {};
}
