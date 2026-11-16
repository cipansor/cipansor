import type { Prisma } from '@prisma/client';
import { PARENT_ROLE_CODES, STUDENT_ROLE_CODES } from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { studentScope } from './student-scope';

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
 * Not-found rather than forbidden, so the answer does not confirm the id — the
 * same shape as the answer for an id that does not exist.
 */
export async function assertStudentsWritable(
  studentIds: string[],
  actor: WriteActor,
  viaRelation?: (ids: string[]) => Promise<Set<string>>
): Promise<void> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return;

  const writable = await prisma.student.findMany({
    where: { AND: [{ id: { in: ids } }, studentWriteWhere(actor)] },
    select: { id: true },
  });
  const allowed = new Set(writable.map((s) => s.id));

  const rest = ids.filter((id) => !allowed.has(id));
  if (rest.length && viaRelation) {
    for (const id of await viaRelation(rest)) allowed.add(id);
  }

  if (ids.some((id) => !allowed.has(id))) throw Errors.notFound('Student');
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
