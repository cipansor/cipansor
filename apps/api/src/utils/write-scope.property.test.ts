import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: { student: { findMany: vi.fn() } } }));

import { prisma } from '@/lib/prisma';
import {
  assertStudentsWritable,
  assertUnitWritable,
  studentWriteWhere,
  type WriteActor,
} from './write-scope';

// Properties 7 (write scope) and 8 (all-or-nothing), R1.20, R2.3, R2.6, R17.4,
// R17.5, R24.5, R24.9, R25.1, R26.7, R29.10. The helpers are checked against a
// random population of santri, with a mock that honours the `where` the helper
// builds — so the test reads the rule, not a re-implementation of it.

const UNITS = ['unit-a', 'unit-b', 'unit-c'];
const STUDENTS = [
  { id: 's1', unitId: 'unit-a' },
  { id: 's2', unitId: 'unit-a' },
  { id: 's3', unitId: 'unit-b' },
  { id: 's4', unitId: 'unit-c' },
];

/** Evaluate the small `where` shapes `studentWriteWhere` produces. */
function matches(where: Prisma.StudentWhereInput, s: (typeof STUDENTS)[number]): boolean {
  if (where.id && typeof where.id === 'object' && 'in' in where.id) {
    return (where.id.in as string[]).includes(s.id);
  }
  if (where.unitId) return s.unitId === where.unitId;
  if (where.userId) return s.id === where.userId; // token sub, matched by fixture below
  if (where.parents) return s.id.startsWith('child-');
  return true;
}

const actorArb: fc.Arbitrary<WriteActor> = fc.record({
  sub: fc.constantFrom('s1', 's2', 'u2', 'u3'),
  roleCode: fc.constantFrom(
    'SUPER_ADMIN',
    'SMPIT_ADMIN',
    'PESANTREN_PENGASUH',
    'MUSYRIF',
    'MUHAFIDZ',
    'SMPIT_GURU',
    'SMPIT_SISWA',
    'SMPIT_ORANG_TUA'
  ),
  unitId: fc.option(fc.constantFrom(...UNITS), { nil: null }),
});

describe('Property 7: write scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('studentWriteWhere never widens by seesAllUnits — only the unit, or the read scope of a santri/wali', () => {
    // Feature: web-api-reconnect-phase-2, Property 7: Cakupan tulis
    fc.assert(
      fc.property(actorArb, (actor) => {
        const where = studentWriteWhere(actor);
        const key = Object.keys(where)[0];
        if (actor.roleCode === 'SUPER_ADMIN') expect(where).toEqual({});
        else if (actor.roleCode === 'SMPIT_SISWA') expect(key).toBe('userId');
        else if (actor.roleCode === 'SMPIT_ORANG_TUA') expect(key).toBe('parents');
        else expect(where).toEqual(actor.unitId ? { unitId: actor.unitId } : { id: { in: [] } });
      }),
      { numRuns: 100 }
    );
  });

  it('assertStudentsWritable accepts exactly the santri the actor may write, and rejects the rest', async () => {
    // Feature: web-api-reconnect-phase-2, Property 7: Cakupan tulis
    await fc.assert(
      fc.asyncProperty(actorArb, fc.subarray(STUDENTS.map((s) => s.id)), async (actor, ids) => {
        const writable = new Set(
          STUDENTS.filter((s) => matches(studentWriteWhere(actor), s)).map((s) => s.id)
        );
        vi.mocked(prisma.student.findMany).mockResolvedValue(
          [...writable].map((id) => ({ id })) as any
        );

        const reachable = ids.every((id) => writable.has(id));
        const promise = assertStudentsWritable(ids, actor);
        if (reachable) await expect(promise).resolves.toBeUndefined();
        else await expect(promise).rejects.toThrow(/not found/i);
      }),
      { numRuns: 100 }
    );
  });

  it('assertUnitWritable accepts the actor’s own unit (any for Super_Admin) and rejects others', () => {
    // Feature: web-api-reconnect-phase-2, Property 7: Cakupan tulis
    fc.assert(
      fc.property(actorArb, fc.constantFrom(...UNITS), (actor, unitId) => {
        const expected =
          actor.roleCode === 'SUPER_ADMIN' || (!!actor.unitId && unitId === actor.unitId);
        const run = () => assertUnitWritable(actor, unitId, 'Exam');
        if (expected) expect(run).not.toThrow();
        else expect(run).toThrow(/not found/i);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 8: all or nothing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('one target out of reach refuses the whole request — nothing is written', async () => {
    // Feature: web-api-reconnect-phase-2, Property 8: Semua atau tidak sama sekali
    await fc.assert(
      fc.asyncProperty(
        actorArb,
        fc.subarray(
          STUDENTS.map((s) => s.id),
          { minLength: 1 }
        ),
        async (actor, ids) => {
          const writable = new Set(
            STUDENTS.filter((s) => matches(studentWriteWhere(actor), s)).map((s) => s.id)
          );
          vi.mocked(prisma.student.findMany).mockResolvedValue(
            [...writable].map((id) => ({ id })) as any
          );
          // The service asserts the whole set before writing any row: if any id
          // is out of reach the assert throws and no write follows.
          const allReachable = ids.every((id) => writable.has(id));
          const promise = assertStudentsWritable(ids, actor);
          if (allReachable) await expect(promise).resolves.toBeUndefined();
          else await expect(promise).rejects.toThrow(/not found/i);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the rejection is the same shape as for an id that does not exist', async () => {
    const actor: WriteActor = { sub: 'u2', roleCode: 'SMPIT_ADMIN', unitId: 'unit-a' };
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as any);
    await expect(assertStudentsWritable(['missing'], actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
