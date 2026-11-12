import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The unit-scope of the meals module (#897). Every menu and attendance read is
 * filtered by unit, and a menu of a unit the actor does not reach must answer
 * 404 — as for an id that does not exist — never 403, so the answer does not
 * confirm the row (K10, decisions/akses-data-pegawai.md).
 *
 * These paths used the legacy `role` (`role !== UserRole.SUPER_ADMIN`), which
 * deriveLegacyRole() files every YAYASAN_* account under 'UNIT_ADMIN': the
 * foundation board was refused a menu `listMenus` had just shown it, and a
 * unit admin could read another unit by naming it in `?unitId=`.
 */

const prismaMock = vi.hoisted(() => ({
  mealMenu: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  mealAttendance: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
  },
  student: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { mealsService } from '../meals.service';

const UNIT_A = 'unit-a';
const UNIT_B = 'unit-b';

const actor = (over: Record<string, unknown> = {}) => ({
  sub: 'u-1',
  role: 'UNIT_ADMIN',
  roleCode: 'SDIT_ADMIN',
  unitId: UNIT_A,
  ...over,
});

/** The legacy `role` a YAYASAN_* roleCode derives to — the value that hid the board. */
const yayasan = (over: Record<string, unknown> = {}) =>
  actor({ role: 'UNIT_ADMIN', roleCode: 'YAYASAN_KETUA', unitId: null, ...over });

const menuOf = (unitId: string) => ({
  id: 'm-1',
  unitId,
  mealType: 'BREAKFAST',
  mainDish: 'Nasi',
  attendances: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.mealMenu.findMany.mockResolvedValue([]);
  prismaMock.mealMenu.count.mockResolvedValue(0);
  prismaMock.mealAttendance.findMany.mockResolvedValue([]);
  prismaMock.mealAttendance.count.mockResolvedValue(0);
  prismaMock.mealAttendance.groupBy.mockResolvedValue([]);
});

describe('mealsService.getMenuById — unit scope', () => {
  it('menjawab 404 (bukan 403) untuk menu unit lain bagi admin unit', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue(menuOf(UNIT_B));

    await expect(mealsService.getMenuById('m-1', actor())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('mengizinkan admin unit membaca menunya sendiri', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue(menuOf(UNIT_A));

    await expect(mealsService.getMenuById('m-1', actor())).resolves.toMatchObject({
      unitId: UNIT_A,
    });
  });

  it('mengizinkan peran yayasan membaca menu unit mana pun', async () => {
    // A yayasan account carries no `unitId`; the legacy comparison classified it
    // as a unit admin and refused the menu `listMenus` had just shown it.
    prismaMock.mealMenu.findUnique.mockResolvedValue(menuOf(UNIT_B));

    await expect(mealsService.getMenuById('m-1', yayasan())).resolves.toMatchObject({
      unitId: UNIT_B,
    });
  });

  it('menjawab 404 untuk menu yang tidak ada', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue(null);

    await expect(mealsService.getMenuById('m-1', actor())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('mealsService.listMenus vs getMenuById — peran lintas unit konsisten', () => {
  it('menyaring admin unit ke unitnya sendiri', async () => {
    await mealsService.listMenus({ page: 1, limit: 20 }, actor());

    const where = prismaMock.mealMenu.findMany.mock.calls[0][0].where;
    expect(where.unitId).toBe(UNIT_A);
  });

  it('tidak menyaring peran yayasan ke unit mana pun, sama seperti getMenuById', async () => {
    await mealsService.listMenus({ page: 1, limit: 20 }, yayasan());

    const where = prismaMock.mealMenu.findMany.mock.calls[0][0].where;
    expect(where.unitId).toBeUndefined();
  });
});

describe('mealsService.createMenu — unit ditulis dari aktor, bukan body', () => {
  it('memaksa admin unit menulis ke unitnya sendiri walau body menyebut unit lain', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue(null);
    prismaMock.mealMenu.create.mockImplementation(async (args: { data: object }) => args.data);

    await mealsService.createMenu(
      { unitId: UNIT_B, date: '2026-11-01', mealType: 'LUNCH', mainDish: 'Nasi' } as never,
      actor()
    );

    expect(prismaMock.mealMenu.create.mock.calls[0][0].data.unitId).toBe(UNIT_A);
  });

  it('mengizinkan peran yayasan menulis ke unit yang disebut body', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue(null);
    prismaMock.mealMenu.create.mockImplementation(async (args: { data: object }) => args.data);

    await mealsService.createMenu(
      { unitId: UNIT_B, date: '2026-11-01', mealType: 'LUNCH', mainDish: 'Nasi' } as never,
      yayasan()
    );

    expect(prismaMock.mealMenu.create.mock.calls[0][0].data.unitId).toBe(UNIT_B);
  });
});

describe('mealsService.updateAttendance — unit scope', () => {
  it('menjawab 404 untuk absensi unit lain bagi admin unit', async () => {
    prismaMock.mealAttendance.findUnique.mockResolvedValue({
      id: 'a-1',
      menu: { unitId: UNIT_B },
    });

    await expect(
      mealsService.updateAttendance('a-1', { status: 'PRESENT' }, actor())
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('mengizinkan admin unit mengubah absensi unitnya sendiri', async () => {
    prismaMock.mealAttendance.findUnique.mockResolvedValue({
      id: 'a-1',
      menu: { unitId: UNIT_A },
    });
    prismaMock.mealAttendance.update.mockResolvedValue({ id: 'a-1' });

    await expect(
      mealsService.updateAttendance('a-1', { status: 'PRESENT' }, actor())
    ).resolves.toMatchObject({ id: 'a-1' });
  });
});

describe('mealsService.getStudentHistory — unit scope', () => {
  it('menjawab 404 untuk santri unit lain bagi admin unit', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: 's-1', unitId: UNIT_B });

    await expect(mealsService.getStudentHistory('s-1', actor())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('mengizinkan peran yayasan membaca riwayat santri unit mana pun', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: 's-1', unitId: UNIT_B });

    await expect(mealsService.getStudentHistory('s-1', yayasan())).resolves.toEqual([]);
  });
});

describe('mealsService.getStatistics — tidak bocor lewat ?unitId=', () => {
  it('memaku admin unit ke unitnya sendiri walau query menyebut unit lain', async () => {
    await mealsService.getStatistics(actor(), UNIT_B);

    expect(prismaMock.mealMenu.count.mock.calls[0][0].where.unitId).toBe(UNIT_A);
  });

  it('mengizinkan peran yayasan menyempitkan ke satu unit', async () => {
    await mealsService.getStatistics(yayasan(), UNIT_B);

    expect(prismaMock.mealMenu.count.mock.calls[0][0].where.unitId).toBe(UNIT_B);
  });
});
