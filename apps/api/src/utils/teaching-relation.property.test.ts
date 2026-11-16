import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { TeachingRelation } from './teaching-relation';

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
      fc.property(setOf, (ids) => {
        const r = new Set<TeachingRelation>([...ids] as TeachingRelation[]);
        expect(mayWriteGradeVia(r)).toBe(r.has('SUBJECT') || r.has('HALAQOH') || r.has('MUSYRIF'));
        expect(mayWriteReportCardVia(r)).toBe(r.size > 0);
      }),
      { numRuns: 100 }
    );
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
