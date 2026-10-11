import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ACTORS,
  SANTRI_SMA,
  SANTRI_SMP,
  SMA,
  SMP,
  findStudentLike,
  studentMatches,
} from '../../../../tests/mocks/santri-fixture';

/**
 * The ibadah journal's reads follow `studentScope`: a santri their own
 * records, a wali their children's, the pesantren's staff every unit's,
 * anyone else their own unit's. A unit in the query narrows within that.
 *
 * The record list took its unit from the query and filtered nothing when none
 * was named, so it answered every santri's records to any account; a single
 * record and the per-santri figures answered any id.
 */

const RECORDS = [
  { id: 'r-smp', studentId: SANTRI_SMP.id, isCompleted: true, pointsEarned: 10 },
  { id: 'r-sma', studentId: SANTRI_SMA.id, isCompleted: true, pointsEarned: 20 },
];
const SANTRI = [SANTRI_SMP, SANTRI_SMA];
const byId = (id: string) => SANTRI.find((s) => s.id === id)!;

type Where = Record<string, any>;
const visible = (where: Where) =>
  RECORDS.filter(
    (r) =>
      (!where.id || r.id === where.id) &&
      (!where.studentId || r.studentId === where.studentId) &&
      (!where.student || studentMatches(byId(r.studentId), where.student))
  );

const prismaMock = vi.hoisted(() => ({
  dailyIbadahRecord: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
  student: { findFirst: vi.fn(), count: vi.fn() },
  classEnrollment: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  getClassIbadahStats,
  getRecordById,
  getStudentAchievementsFor,
  getStudentIbadahStatsFor,
  getUnitIbadahStats,
  listRecords,
} from '../ibadah.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dailyIbadahRecord.findMany.mockImplementation(async ({ where }: { where: Where }) =>
    visible(where).map((r) => ({
      ...r,
      date: new Date('2026-10-08'),
      target: { category: 'SHOLAT' },
    }))
  );
  prismaMock.dailyIbadahRecord.count.mockImplementation(
    async ({ where }: { where: Where }) => visible(where).length
  );
  prismaMock.dailyIbadahRecord.findFirst.mockImplementation(
    async ({ where }: { where: Where }) => visible(where)[0] ?? null
  );
  prismaMock.student.findFirst.mockImplementation(findStudentLike);
  // `{ AND: [scope, { status: ACTIVE }] }`; the fixture's santri are all active.
  prismaMock.student.count.mockImplementation(
    async ({ where }: { where: Where }) =>
      SANTRI.filter((s) => studentMatches(s, where.AND[0])).length
  );
  // Both santri enrolled in one class, as a mixed asrama halaqah would be.
  prismaMock.classEnrollment.findMany.mockImplementation(async ({ where }: { where: Where }) =>
    SANTRI.filter((s) => studentMatches(s, where.student)).map((s) => ({ studentId: s.id }))
  );
});

const PAGE = { page: 1, limit: 20 };
const ids = async (actor: object, unitId?: string) =>
  (await listRecords({ ...PAGE, unitId } as never, actor as never)).data.map((r) => r.id);

describe('the ibadah record list', () => {
  it('a santri reads their own records only, whatever unit they name', async () => {
    expect(await ids(ACTORS.santriSmp)).toEqual(['r-smp']);
    expect(await ids(ACTORS.santriSmp, SMA)).toEqual([]);
  });

  it("a wali reads their child's", async () => {
    expect(await ids(ACTORS.waliSma)).toEqual(['r-sma']);
  });

  it("an SMP IT teacher reads SMP IT's, never SMA Qur'an's", async () => {
    expect(await ids(ACTORS.guruSmp)).toEqual(['r-smp']);
    expect(await ids(ACTORS.guruSmp, SMA)).toEqual([]);
  });

  it("the pesantren's staff read every unit's and can narrow to one", async () => {
    expect(await ids(ACTORS.musyrif)).toEqual(['r-smp', 'r-sma']);
    expect(await ids(ACTORS.musyrif, SMA)).toEqual(['r-sma']);
  });

  it('a single record outside the scope is not found', async () => {
    expect(await getRecordById('r-sma', ACTORS.guruSmp as never)).toBeNull();
    expect(await getRecordById('r-sma', ACTORS.musyrif as never)).toMatchObject({ id: 'r-sma' });
  });
});

describe("a santri's figures", () => {
  const RANGE = { startDate: new Date('2026-10-01'), endDate: new Date('2026-10-09') };

  it('404 for a santri outside the scope', async () => {
    await expect(
      getStudentIbadahStatsFor({ studentId: SANTRI_SMA.id, ...RANGE }, ACTORS.santriSmp as never)
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      getStudentAchievementsFor(SANTRI_SMA.id, ACTORS.guruSmp as never)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('answered for a santri in scope', async () => {
    const stats = await getStudentIbadahStatsFor(
      { studentId: SANTRI_SMP.id, ...RANGE },
      ACTORS.santriSmp as never
    );
    expect(stats.summary.totalPoints).toBe(10);
  });
});

describe("a unit's and a class's figures", () => {
  const RANGE = { startDate: new Date('2026-10-01'), endDate: new Date('2026-10-09') };

  it("an SMP IT teacher asking for SMA Qur'an's figures gets none of its santri", async () => {
    const stats = await getUnitIbadahStats(
      { unitId: SMA, groupBy: 'DAY', ...RANGE } as never,
      ACTORS.guruSmp as never
    );
    expect(stats.summary).toMatchObject({ totalRecords: 0, totalPoints: 0, studentCount: 0 });
  });

  it("the pesantren's staff get SMA Qur'an's", async () => {
    const stats = await getUnitIbadahStats(
      { unitId: SMA, groupBy: 'DAY', ...RANGE } as never,
      ACTORS.musyrif as never
    );
    expect(stats.summary).toMatchObject({ totalRecords: 1, totalPoints: 20, studentCount: 1 });
  });

  it("a class's figures cover only the santri in scope", async () => {
    prismaMock.dailyIbadahRecord.findMany.mockImplementation(async ({ where }: { where: Where }) =>
      RECORDS.filter((r) => where.studentId.in.includes(r.studentId)).map((r) => ({
        ...r,
        student: { user: { name: r.studentId } },
      }))
    );
    const own = await getClassIbadahStats(
      { classId: 'class-1', ...RANGE } as never,
      ACTORS.guruSmp as never
    );
    expect(own.studentStats.map((s) => s.studentId)).toEqual([SANTRI_SMP.id]);
    const all = await getClassIbadahStats(
      { classId: 'class-1', ...RANGE } as never,
      ACTORS.musyrif as never
    );
    expect(all.studentCount).toBe(2);
  });
});
