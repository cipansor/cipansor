import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IbadahLeaderboardEntry } from '@cipansor/shared';
import {
  ACTORS,
  SANTRI_SMA,
  SANTRI_SMP,
  SMA,
  SMP,
  studentMatches,
  type SantriLike,
} from '../../../../tests/mocks/santri-fixture';

/**
 * The ranking reads the santri an account reaches (`studentScope`), and a unit
 * in the query narrows within that — it used to be the only filter, so any
 * account could read any unit's ranking by naming it, and the pesantren's
 * staff could read one unit at a time.
 *
 * A row carries the santri's name, class and account — the fields both ibadah
 * pages read (`IbadahLeaderboardEntry`); `totalPoints` holds the bonus once.
 *
 * Prisma answers over an in-memory set of santri and points, evaluating the
 * `where` the service builds, so a test measures who is ranked, not the
 * call's shape.
 */

const SMP_2: SantriLike = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  unitId: SMP,
  userId: 'u-santri-smp-2',
  parentIds: [],
  deletedAt: null,
};
const SANTRI = [SANTRI_SMP, SMP_2, SANTRI_SMA];
const PROFILE: Record<string, { name: string; nis: string; className: string }> = {
  [SANTRI_SMP.id]: { name: 'Ahmad Fauzan', nis: '9001', className: '7A' },
  [SMP_2.id]: { name: 'Bilal Hakim', nis: '9002', className: '7B' },
  [SANTRI_SMA.id]: { name: 'Hasan Basri', nis: '9101', className: '10A' },
};

/** Points this week: SMA's santri first, then SMP's second santri, then ours. */
const RECORDS = [
  { studentId: SANTRI_SMP.id, pointsEarned: 30, bonusEarned: 5, isCompleted: true },
  { studentId: SANTRI_SMP.id, pointsEarned: 15, bonusEarned: 0, isCompleted: true },
  { studentId: SMP_2.id, pointsEarned: 80, bonusEarned: 0, isCompleted: true },
  { studentId: SANTRI_SMA.id, pointsEarned: 100, bonusEarned: 0, isCompleted: true },
];

type Where = Record<string, any>;
const byId = (id: string) => SANTRI.find((s) => s.id === id)!;

const prismaMock = vi.hoisted(() => ({
  dailyIbadahRecord: { groupBy: vi.fn() },
  dailyIbadahTarget: { groupBy: vi.fn() },
  student: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getLeaderboard } from '../ibadah.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dailyIbadahRecord.groupBy.mockImplementation(async ({ where }: { where: Where }) => {
    const rows = RECORDS.filter(
      (r) =>
        (!where.student || studentMatches(byId(r.studentId), where.student)) &&
        (!where.studentId?.in || where.studentId.in.includes(r.studentId)) &&
        (where.isCompleted === undefined || r.isCompleted === where.isCompleted)
    );
    const groups = new Map<string, { pointsEarned: number; bonusEarned: number; n: number }>();
    for (const r of rows) {
      const g = groups.get(r.studentId) ?? { pointsEarned: 0, bonusEarned: 0, n: 0 };
      g.pointsEarned += r.pointsEarned;
      g.bonusEarned += r.bonusEarned;
      g.n += 1;
      groups.set(r.studentId, g);
    }
    return [...groups].map(([studentId, g]) => ({
      studentId,
      _sum: { pointsEarned: g.pointsEarned, bonusEarned: g.bonusEarned },
      _count: { id: g.n },
    }));
  });
  prismaMock.student.findMany.mockImplementation(async ({ where }: { where: Where }) =>
    SANTRI.filter((s) => studentMatches(s, where)).map((s) => ({
      id: s.id,
      unitId: s.unitId,
      userId: s.userId,
      nis: PROFILE[s.id].nis,
      user: { name: PROFILE[s.id].name },
      enrollments: [{ class: { name: PROFILE[s.id].className } }],
    }))
  );
  prismaMock.dailyIbadahTarget.groupBy.mockResolvedValue([
    { unitId: SMP, _count: { id: 2 } },
    { unitId: SMA, _count: { id: 1 } },
  ]);
});

const ask = (actor: object, unitId?: string) =>
  getLeaderboard({ unitId, periodType: 'WEEKLY', limit: 10 } as never, actor as never);
const ranked = async (actor: object, unitId?: string) =>
  (await ask(actor, unitId)).data.map((r) => [r.studentId, r.rank]);

describe('the ibadah ranking', () => {
  it('names the santri, their class and account, with the bonus counted once', async () => {
    const result = await ask(ACTORS.santriSmp);
    expect(result.data).toEqual<IbadahLeaderboardEntry[]>([
      expect.objectContaining({
        studentId: SANTRI_SMP.id,
        userId: 'u-santri-smp',
        studentName: 'Ahmad Fauzan',
        nis: '9001',
        className: '7A',
        totalPoints: 50,
        bonusPoints: 5,
        recordCount: 2,
      }),
    ]);
  });

  it('a santri reads only their own row, at their place in their unit', async () => {
    // Second in SMP IT, behind a santri they do not see; SMA is not counted.
    expect(await ranked(ACTORS.santriSmp)).toEqual([[SANTRI_SMP.id, 2]]);
    // Naming another unit does not widen it.
    expect(await ranked(ACTORS.santriSmp, SMA)).toEqual([]);
  });

  it("a wali reads their child's row, at the child's place", async () => {
    expect(await ranked(ACTORS.waliSmp)).toEqual([[SANTRI_SMP.id, 2]]);
    expect(await ranked(ACTORS.waliSma)).toEqual([[SANTRI_SMA.id, 1]]);
  });

  it("an SMP IT teacher reads SMP IT's ranking, never SMA Qur'an's", async () => {
    expect(await ranked(ACTORS.guruSmp)).toEqual([
      [SMP_2.id, 1],
      [SANTRI_SMP.id, 2],
    ]);
    expect(await ranked(ACTORS.guruSmp, SMA)).toEqual([]);
  });

  it("the pesantren's staff read every unit and can narrow to one", async () => {
    expect(await ranked(ACTORS.musyrif)).toEqual([
      [SANTRI_SMA.id, 1],
      [SMP_2.id, 2],
      [SANTRI_SMP.id, 3],
    ]);
    expect(await ranked(ACTORS.musyrif, SMA)).toEqual([[SANTRI_SMA.id, 1]]);
    expect(await ranked(ACTORS.musyrif, SMP)).toEqual([
      [SMP_2.id, 1],
      [SANTRI_SMP.id, 2],
    ]);
  });

  it("measures completion against the santri's own unit's targets", async () => {
    const rows = (await ask(ACTORS.musyrif)).data;
    const days = 8; // a week back from now, both ends counted
    const sma = rows.find((r) => r.studentId === SANTRI_SMA.id)!;
    const smp = rows.find((r) => r.studentId === SANTRI_SMP.id)!;
    // One record of one SMA target; two records of two SMP targets.
    expect(sma.completionRate).toBeCloseTo((1 / (1 * days)) * 100, 1);
    expect(smp.completionRate).toBeCloseTo((2 / (2 * days)) * 100, 1);
  });
});
