import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScopeActor } from '@/utils/student-scope';
import { listSimaanQuerySchema } from '../simaan.schema';

// The simaan read surface took the caller's scope from nothing: `findAll`
// built its `where` from a raw `query.unitId`, `findById` looked the exam up
// by id alone, and `getUpcomingExams` listed every unit. Any signed-in account
// could read another unit's exam scores and the santri's NISN by guessing an
// id — the same class of defect `santri-data-scope.test.ts` was written for,
// with simaan left out of it. These tests drive the real service and read the
// `where` that reaches Prisma.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    simaanExam: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'e-1' }),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { simaanService } from '../simaan.service';

const OTHER_UNIT = '22222222-2222-4222-8222-222222222222';

const guru: ScopeActor = { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' };
const santri: ScopeActor = { sub: 'u-santri', roleCode: 'SMPIT_SISWA', unitId: 'unit-smp' };
const ketua: ScopeActor = { sub: 'u-ketua', roleCode: 'YAYASAN_KETUA', unitId: null };

const findMany = vi.mocked(prisma.simaanExam.findMany);
const findFirstOrThrow = vi.mocked(prisma.simaanExam.findFirstOrThrow);

/** The `where` the Nth `findMany` call reached Prisma with. */
const whereOf = (n = 0) =>
  findMany.mock.calls[n][0]?.where as unknown as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([] as never);
  findFirstOrThrow.mockResolvedValue({ id: 'e-1' } as never);
});

describe('simaanService.findAll — the list is the caller’s santri', () => {
  it('scopes a unit teacher to their own unit, not a bare filter', async () => {
    await simaanService.findAll({ page: 1, limit: 20 }, guru);

    expect(whereOf()?.student).toEqual({ unitId: 'unit-smp' });
  });

  it('?unitId= narrows the scope instead of replacing it', async () => {
    await simaanService.findAll({ page: 1, limit: 20, unitId: OTHER_UNIT }, guru);

    expect(whereOf()?.student).toEqual({ AND: [{ unitId: 'unit-smp' }, { unitId: OTHER_UNIT }] });
  });

  it('a santri sees only their own records', async () => {
    await simaanService.findAll({ page: 1, limit: 20 }, santri);

    expect(whereOf()?.student).toEqual({ userId: 'u-santri' });
  });

  it('the yayasan board reads every unit', async () => {
    await simaanService.findAll({ page: 1, limit: 20 }, ketua);

    const student = whereOf()?.student;
    expect(Object.keys(student ?? {}).length).toBe(0);
  });

  it('never asks for the whole Student row — only safe columns', async () => {
    await simaanService.findAll({ page: 1, limit: 20 }, guru);

    const student = findMany.mock.calls[0][0]?.include?.student as { select?: object };
    expect(student).toHaveProperty('select');
    expect(Object.keys(student.select ?? {})).not.toContain('nik');
  });
});

describe('simaanService.findById — one exam, only if its santri is in scope', () => {
  it('scopes the lookup by the caller’s santri, not by id alone', async () => {
    await simaanService.findById('e-1', guru);

    expect(findFirstOrThrow.mock.calls[0][0]?.where).toEqual({
      id: 'e-1',
      student: { unitId: 'unit-smp' },
    });
  });

  it('a santri may open only their own exam', async () => {
    await simaanService.findById('e-1', santri);

    expect(findFirstOrThrow.mock.calls[0][0]?.where).toEqual({
      id: 'e-1',
      student: { userId: 'u-santri' },
    });
  });
});

describe('simaanService.getUpcomingExams — the window is also the caller’s santri', () => {
  it('carries the unit scope alongside the date window', async () => {
    await simaanService.getUpcomingExams(guru, undefined, 7);

    const where = whereOf();
    expect(where?.student).toEqual({ unitId: 'unit-smp' });
    expect(where?.examDate).toBeTruthy();
  });

  it('narrows to the given halaqoh within the scope', async () => {
    await simaanService.getUpcomingExams(guru, 'halaqoh-1', 7);

    expect(whereOf()).toMatchObject({ halaqohId: 'halaqoh-1', student: { unitId: 'unit-smp' } });
  });
});

describe('listSimaanQuerySchema — `passed` reads the query string as a boolean', () => {
  // The list page's status filter maps "Terjadwal" onto `passed=false`. With
  // `z.coerce.boolean()` that string is non-empty, so it parsed to `true` and
  // the filter returned the graded exams instead — the opposite of the choice.
  it('parses the string "false" as false', () => {
    expect(listSimaanQuerySchema.parse({ passed: 'false' }).passed).toBe(false);
  });

  it('parses the string "true" as true', () => {
    expect(listSimaanQuerySchema.parse({ passed: 'true' }).passed).toBe(true);
  });

  it('leaves `passed` unset when it is absent', () => {
    expect(listSimaanQuerySchema.parse({}).passed).toBeUndefined();
  });

  it('still rejects a value that is not a boolean', () => {
    expect(listSimaanQuerySchema.safeParse({ passed: 'yes' }).success).toBe(false);
  });
});
