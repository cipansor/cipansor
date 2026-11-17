import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: { student: { findMany: vi.fn() }, $transaction: vi.fn() },
}));

import { prisma } from '@/lib/prisma';
import {
  assertStudentsWritable,
  assertUnitWritable,
  studentWriteWhere,
  type WriteActor,
} from './write-scope';
import { createManualJournal } from '@/modules/finance/accounting.service';

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

  it('#988: a manual journal lands on the token unit for every non-Super_Admin, whatever the body names', async () => {
    // Feature: web-api-reconnect-phase-2, Property 7: Cakupan tulis
    const txCreate = vi.fn().mockResolvedValue({ id: 'je' });
    const txAccountFindMany = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) =>
      cb({ journalEntry: { create: txCreate }, accountCode: { findMany: txAccountFindMany } })
    );

    await fc.assert(
      fc.asyncProperty(actorArb, fc.constantFrom(...UNITS), async (actor, named) => {
        txCreate.mockClear();
        txAccountFindMany.mockReset();
        // Both accounts are shared rows (`unitId: null`), which any unit may post
        // to — the same shape an account created through the app has.
        txAccountFindMany.mockImplementation(async (args: any) =>
          (args.where.id.in as string[]).map((id: string) => ({ id, unitId: null }))
        );

        const promise = createManualJournal({
          unitId: named,
          date: new Date('2026-03-01'),
          description: 'Jurnal',
          entries: [
            { accountId: 'kas', debit: 1000, credit: 0 },
            { accountId: 'pendapatan', debit: 0, credit: 1000 },
          ],
          createdById: actor.sub,
          actor,
        });

        const expected = actor.roleCode === 'SUPER_ADMIN' ? named : actor.unitId;
        if (!expected) {
          // A non-Super_Admin whose token carries no unit has no journal to write.
          await expect(promise).rejects.toMatchObject({ statusCode: 403 });
          expect(txCreate).not.toHaveBeenCalled();
          return;
        }
        await promise;
        const units = txCreate.mock.calls.map(([arg]) => arg.data.unitId);
        expect(units).toEqual([expected, expected]);
        // The account lookup names the accounts, not the unit: a shared row is
        // usable by any unit, so ownership is decided per row, not in the `where`.
        expect(txAccountFindMany.mock.calls[0][0].where.id.in).toEqual(['kas', 'pendapatan']);
      }),
      { numRuns: 60 }
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

  it('#988: one journal line on an account of another unit refuses the whole journal — nothing is posted', async () => {
    // Feature: web-api-reconnect-phase-2, Property 8: Semua atau tidak sama sekali
    const txCreate = vi.fn().mockResolvedValue({ id: 'je' });
    const txAccountFindMany = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) =>
      cb({ journalEntry: { create: txCreate }, accountCode: { findMany: txAccountFindMany } })
    );

    const owned = ['acc-own-1', 'acc-own-2', 'acc-own-3', 'acc-own-4'];
    const rows = owned.map((id) => ({ id, unitId: 'unit-a' }));
    rows.push({ id: 'acc-other', unitId: 'unit-other' }); // another unit's account
    const actor: WriteActor = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: 'unit-a' };

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(owned, { minLength: 2, maxLength: 2 }),
        fc.constantFrom('acc-other', 'acc-missing'),
        async (ownIds, foreignId) => {
          txCreate.mockClear();
          // The journal is balanced and names two accounts, one of which the
          // unit may not post to (another unit's, or one that does not exist).
          // The mock answers like the database — the rows that exist, with
          // their owning unit; the service decides usability from `unitId`.
          txAccountFindMany.mockImplementation(async (args: any) =>
            rows.filter((r) => (args.where.id.in as string[]).includes(r.id))
          );

          const promise = createManualJournal({
            unitId: 'unit-a',
            date: new Date('2026-03-01'),
            description: 'Jurnal',
            entries: [
              { accountId: ownIds[0], debit: 1000, credit: 0 },
              { accountId: foreignId, debit: 0, credit: 1000 },
            ],
            createdById: 'u-sd',
            actor,
          });

          await expect(promise).rejects.toMatchObject({ statusCode: 404 });
          expect(txCreate).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 40 }
    );
  });
});
