import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ADMIN_ROLE_CODES, KEPALA_UNIT_ROLE_CODES } from '@cipansor/shared';
import type { TeachingRelation } from './teaching-relation';
import type { WriteActor } from './write-scope';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    teacher: { findFirst: vi.fn() },
    student: { findMany: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    takhosusEnrollment: { findMany: vi.fn() },
    musyrif: { findFirst: vi.fn() },
    musyrifAssignment: { findMany: vi.fn() },
    roomAssignment: { findMany: vi.fn() },
    class: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  isPenulisIbadah,
  mayWriteGradeVia,
  mayWriteReportCardVia,
  teachingRelations,
  teachingRelationsFromState,
  type TeachingState,
} from './teaching-relation';

// Property 10 (R27.2, R32.20): `teachingRelationsFromState` maps each state set
// to its relation and invents nothing else; relation (b) is counted whatever
// the Halaqoh's own isActive/deletedAt.

const setOf = fc.subarray(['a', 'b', 'c', 'd']).map((ids) => new Set(ids));
// The relation names themselves — the permission property must generate members
// of `TeachingRelation`, not the santri ids `setOf` produces, or it never sees
// a set that allows a write.
const relationsArb = fc
  .subarray(['SUBJECT', 'HALAQOH', 'MUSYRIF', 'HOMEROOM'] as const)
  .map((rs) => new Set<TeachingRelation>(rs));
const stateArb: fc.Arbitrary<TeachingState> = fc.record({
  subject: setOf,
  halaqoh: setOf,
  musyrif: setOf,
  homeroom: setOf,
});

describe('Property 10: teaching relations', () => {
  it('maps every id to exactly the relations its sets name, and no other id', () => {
    // Feature: web-api-reconnect-phase-2, Property 10: Relasi pengajaran dan penulis ibadah
    fc.assert(
      fc.property(stateArb, (state) => {
        const relations = teachingRelationsFromState(state);
        const all = new Set([
          ...state.subject,
          ...state.halaqoh,
          ...state.musyrif,
          ...state.homeroom,
        ]);
        expect(new Set(relations.keys())).toEqual(all);
        for (const id of all) {
          const expected = new Set<TeachingRelation>();
          if (state.subject.has(id)) expected.add('SUBJECT');
          if (state.halaqoh.has(id)) expected.add('HALAQOH');
          if (state.musyrif.has(id)) expected.add('MUSYRIF');
          if (state.homeroom.has(id)) expected.add('HOMEROOM');
          expect(relations.get(id)).toEqual(expected);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('a grade needs (a), (b) or (c); a report card any relation', () => {
    // Feature: web-api-reconnect-phase-2, Property 10: Relasi pengajaran dan penulis ibadah
    fc.assert(
      fc.property(relationsArb, (r) => {
        expect(mayWriteGradeVia(r)).toBe(r.has('SUBJECT') || r.has('HALAQOH') || r.has('MUSYRIF'));
        expect(mayWriteReportCardVia(r)).toBe(r.size > 0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 10: ibadah writer (#989, R27.2)', () => {
  const ibadahActorArb: fc.Arbitrary<WriteActor> = fc.record({
    sub: fc.constant('u1'),
    roleCode: fc.constantFrom(
      'SUPER_ADMIN',
      'SMPIT_ADMIN',
      'SMPIT_KEPALA_SEKOLAH',
      'PESANTREN_PENGASUH',
      'SMPIT_GURU',
      'USTADZ',
      'MUSYRIF',
      'SMPIT_SISWA',
      'SMPIT_ORANG_TUA',
      'PESANTREN_TATA_USAHA',
      'YAYASAN_KETUA'
    ),
    unitId: fc.option(fc.constantFrom('unit-a', 'unit-b'), { nil: null }),
  });

  it('accepts exactly Super_Admin, a leader of the santri’s unit, or any relation — including (d)', () => {
    // Feature: web-api-reconnect-phase-2, Property 10: Relasi pengajaran dan penulis ibadah
    fc.assert(
      fc.property(
        ibadahActorArb,
        fc.constantFrom('unit-a', 'unit-b'),
        relationsArb,
        (actor, studentUnitId, relations) => {
          const isUnitLeader =
            ADMIN_ROLE_CODES.includes(actor.roleCode) ||
            KEPALA_UNIT_ROLE_CODES.includes(actor.roleCode);
          const expected =
            actor.roleCode === 'SUPER_ADMIN' ||
            (isUnitLeader && !!actor.unitId && studentUnitId === actor.unitId) ||
            (!isUnitLeader && relations.size > 0);
          expect(isPenulisIbadah(actor, studentUnitId, relations)).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a unit leader writes no other unit even with a relation; a relation never extends a leader', () => {
    const leader: WriteActor = { sub: 'u1', roleCode: 'SMPIT_ADMIN', unitId: 'unit-a' };
    expect(isPenulisIbadah(leader, 'unit-b', new Set(['SUBJECT']))).toBe(false);
    expect(isPenulisIbadah(leader, 'unit-a', new Set())).toBe(true);
  });
});

describe('relation (b) regardless of Halaqoh state (R32.20)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts HALAQOH for an ACTIVE enrolment on a Halaqoh the account leads, even when the Halaqoh is inactive or deleted', async () => {
    vi.mocked(prisma.teacher.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: 's1', unitId: 'unit-a', enrollments: [] },
    ] as any);
    // The query must not filter on the Halaqoh's isActive/deletedAt; the mock
    // returns the enrolment regardless, mirroring that.
    vi.mocked(prisma.takhosusEnrollment.findMany).mockResolvedValue([{ studentId: 's1' }] as any);
    vi.mocked(prisma.musyrif.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.class.findMany).mockResolvedValue([] as any);

    const relations = await teachingRelations('u1', ['s1']);
    expect(relations.get('s1')).toEqual(new Set(['HALAQOH']));

    const where = vi.mocked(prisma.takhosusEnrollment.findMany).mock.calls[0][0] as any;
    expect(where.where.halaqoh).toEqual({ teacherId: 'u1' });
    expect(where.where.halaqoh.isActive).toBeUndefined();
    expect(where.where.halaqoh.deletedAt).toBeUndefined();
  });
});
