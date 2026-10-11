import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ACTORS,
  SANTRI_SMA,
  SANTRI_SMP,
  SMA,
  SMP,
  findStudentLike,
} from '../../../../tests/mocks/santri-fixture';
import { relationsLoaded, unsafeRelations } from '../../../../tests/mocks/safe-relations';

/**
 * Which santri's muhadhoroh an account reaches, and which unit a new one
 * belongs to. The pesantren's ustadz and musyrif serve the santri of every
 * school, while their own unit is the pesantren; a school's staff serve their
 * school; a santri sees their own, a wali their children's.
 */

const prismaMock = vi.hoisted(() => ({
  student: { findFirst: vi.fn(), findMany: vi.fn() },
  muhadhoroh: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { muhadhorohService } from '../muhadhoroh.service';

const input = (studentId: string, extra: Record<string, unknown> = {}) => ({
  studentId,
  scheduledAt: '2026-10-10T08:00:00.000Z',
  topic: 'Adab menuntut ilmu',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.student.findFirst.mockImplementation(findStudentLike);
  prismaMock.muhadhoroh.create.mockImplementation(async (args: { data: object }) => args.data);
  prismaMock.muhadhoroh.findMany.mockResolvedValue([]);
  prismaMock.muhadhoroh.count.mockResolvedValue(0);
  prismaMock.muhadhoroh.groupBy.mockResolvedValue([]);
  prismaMock.muhadhoroh.aggregate.mockResolvedValue({ _avg: {} });
  prismaMock.student.findMany.mockResolvedValue([]);
});

describe('a new muhadhoroh', () => {
  it("an ustadz schedules one for an SMA Qur'an santri, and it belongs to the santri's unit", async () => {
    const record = await muhadhorohService.create(input(SANTRI_SMA.id), ACTORS.ustadz);
    expect(record).toMatchObject({ unitId: SMA, studentId: SANTRI_SMA.id });
  });

  it("a school's teacher cannot schedule one for another school's santri", async () => {
    await expect(
      muhadhorohService.create(input(SANTRI_SMA.id), ACTORS.guruSmp)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.muhadhoroh.create).not.toHaveBeenCalled();
  });

  it("a school's teacher schedules one for their own santri, as before", async () => {
    const record = await muhadhorohService.create(input(SANTRI_SMP.id), ACTORS.guruSmp);
    expect(record).toMatchObject({ unitId: SMP });
  });

  it("the unit the form names must be the santri's", async () => {
    await expect(
      muhadhorohService.create(input(SANTRI_SMA.id, { unitId: SMP }), ACTORS.ustadz)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('reading muhadhoroh', () => {
  const whereOf = (fn: ReturnType<typeof vi.fn>) =>
    (fn.mock.calls[0][0] as { where: unknown }).where;

  it("the musyrif's list spans every school's santri", async () => {
    await muhadhorohService.list({ page: 1, limit: 10 }, ACTORS.musyrif);
    expect(whereOf(prismaMock.muhadhoroh.findMany)).toEqual({});
  });

  it("a school's teacher sees their unit's santri, whatever unit the query names", async () => {
    await muhadhorohService.getStatistics(ACTORS.guruSmp, SMA);
    expect(whereOf(prismaMock.muhadhoroh.count)).toEqual({
      student: { unitId: SMP },
      unitId: SMA,
    });
  });

  it('a santri sees their own and a wali their children’s — not the whole unit', async () => {
    await muhadhorohService.getUpcoming(ACTORS.santriSmp);
    expect(whereOf(prismaMock.muhadhoroh.findMany)).toMatchObject({
      student: { userId: ACTORS.santriSmp.sub },
    });

    vi.clearAllMocks();
    prismaMock.muhadhoroh.groupBy.mockResolvedValue([]);
    prismaMock.student.findMany.mockResolvedValue([]);
    await muhadhorohService.getTopPerformers(ACTORS.waliSmp);
    expect(prismaMock.muhadhoroh.groupBy.mock.calls[0][0].where).toMatchObject({
      student: { parents: { some: { parentId: ACTORS.waliSmp.sub } } },
    });
  });

  it("a record opens for the musyrif, and not for another school's teacher", async () => {
    prismaMock.muhadhoroh.findUnique.mockResolvedValue({
      id: 'm1',
      unitId: SMA,
      studentId: SANTRI_SMA.id,
      student: { id: SANTRI_SMA.id, nis: '1', user: { name: 'Santri' }, enrollments: [] },
      evaluator: null,
    });
    await expect(muhadhorohService.getById('m1', ACTORS.musyrif)).resolves.toMatchObject({
      id: 'm1',
    });
    await expect(muhadhorohService.getById('m1', ACTORS.guruSmp)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("a santri's history is refused to another santri's wali", async () => {
    await expect(
      muhadhorohService.getStudentHistory(ACTORS.waliSma, SANTRI_SMP.id)
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      muhadhorohService.getStudentHistory(ACTORS.waliSmp, SANTRI_SMP.id)
    ).resolves.toEqual([]);
  });
});

describe('what a muhadhoroh answer carries about people', () => {
  it('the santri, partner and evaluator by name only — no NIK, No. KK, address or bank account', async () => {
    const m = prismaMock.muhadhoroh;
    await muhadhorohService.list({ page: 1, limit: 10 } as never, ACTORS.musyrif);
    await muhadhorohService.getById('missing', ACTORS.musyrif).catch(() => undefined);
    await muhadhorohService.create(input(SANTRI_SMA.id), ACTORS.musyrif);
    await muhadhorohService.getUpcoming(ACTORS.musyrif);
    await muhadhorohService.getStudentHistory(ACTORS.musyrif, SANTRI_SMP.id);

    const calls = [...m.findMany.mock.calls, ...m.findUnique.mock.calls, ...m.create.mock.calls];
    expect(relationsLoaded(calls)).toBeGreaterThanOrEqual(5);
    expect(unsafeRelations(calls)).toEqual([]);
  });
});
