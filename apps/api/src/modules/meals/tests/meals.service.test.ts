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
  mealMenu: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mealAttendance: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
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

/**
 * A musyrif: a cross-unit service role (`seesAllUnits`), seeded into one unit
 * but serving santri of several. Its remit is the whole campus, so its reads
 * widen — but its writes stay on its own unit.
 */
const musyrif = (over: Record<string, unknown> = {}) =>
  actor({ role: 'TEACHER', roleCode: 'MUSYRIF', unitId: UNIT_A, ...over });

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

  it('menolak peran yayasan (hanya baca) menulis menu, walau body menyebut unit', async () => {
    // Semua peran YAYASAN_* adalah YAYASAN_OVERSIGHT: "read broadly, change
    // nothing". `writeUnitScopeFor` masih dipakai modul lain yang mengizinkan
    // peran yayasan menulis; di sini gerbang penulis menolaknya lebih dulu.
    prismaMock.mealMenu.findUnique.mockResolvedValue(null);

    await expect(
      mealsService.createMenu(
        { unitId: UNIT_B, date: '2026-11-01', mealType: 'LUNCH', mainDish: 'Nasi' } as never,
        yayasan()
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.mealMenu.create).not.toHaveBeenCalled();
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

describe('mealsService — peran lintas unit: baca melebar, tulis tetap', () => {
  it('musyrif boleh membuka menu unit lain yang ditampilkan listMenus', async () => {
    // listMenus menampilkan menu unit lain kepada musyrif (`seesAllUnits`);
    // getMenuById dulu memakai `actorReachesUnit`, yang hanya melebarkan organ
    // yayasan, sehingga musyrif melihat barisnya di daftar lalu 404 saat
    // membukanya. Baca kini memakai `actorSeesUnit` — baris yang sama, satu
    // jawaban.
    prismaMock.mealMenu.findUnique.mockResolvedValue(menuOf(UNIT_B));

    await expect(mealsService.getMenuById('m-1', musyrif())).resolves.toMatchObject({
      unitId: UNIT_B,
    });
  });

  it('musyrif boleh membaca riwayat makan santri unit lain', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: 's-1', unitId: UNIT_B });

    await expect(mealsService.getStudentHistory('s-1', musyrif())).resolves.toEqual([]);
  });

  it('admin unit TIDAK boleh mengubah menu unit lain (baca bukan tulis)', async () => {
    // Lebar untuk melihat bukan kuasa untuk mengubah: tulis tetap pada
    // `actorReachesUnit`, jadi menu unit lain dijawab 404.
    prismaMock.mealMenu.findUnique.mockResolvedValue({ id: 'm-1', unitId: UNIT_B });

    await expect(
      mealsService.updateMenu('m-1', { mainDish: 'Soto' }, actor())
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.mealMenu.update).not.toHaveBeenCalled();
  });

  it('admin unit TIDAK boleh menghapus menu unit lain', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue({ id: 'm-1', unitId: UNIT_B });

    await expect(mealsService.deleteMenu('m-1', actor())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('guru bukan penulis menu — 403, bukan diam-diam lolos', async () => {
    // Menulis menu bukan tugas guru; ia mencatat absensi. Layanan menolak
    // perannya, jadi ia tidak bisa menyentuh menu apa pun walau unitnya sama.
    await expect(
      mealsService.updateMenu('m-1', { mainDish: 'Soto' }, actor({ roleCode: 'SDIT_GURU' }))
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.mealMenu.update).not.toHaveBeenCalled();
  });

  it('guru boleh mencatat absensi makan (penulis absensi, bukan penulis menu)', async () => {
    // Jalur absensi punya daftar penulis yang lebih lebar dari menu: guru dan
    // musyrif mencatat, walau keduanya tidak boleh menyentuh menu.
    prismaMock.mealMenu.findUnique.mockResolvedValue({ id: 'm-1', unitId: UNIT_A });
    prismaMock.student.findUnique.mockResolvedValue({ id: 's-1', unitId: UNIT_A });
    prismaMock.mealAttendance.upsert.mockResolvedValue({ id: 'a-1' });

    await expect(
      mealsService.recordAttendance(
        { menuId: 'm-1', studentId: 's-1', status: 'PRESENT' } as never,
        musyrif()
      )
    ).resolves.toMatchObject({ id: 'a-1' });
  });

  it('admin unit menulis ke unitnya sendiri', async () => {
    prismaMock.mealMenu.findUnique.mockResolvedValue({ id: 'm-1', unitId: UNIT_A });
    prismaMock.mealMenu.update.mockResolvedValue({ id: 'm-1' });

    await expect(
      mealsService.updateMenu('m-1', { mainDish: 'Soto' }, actor())
    ).resolves.toMatchObject({
      id: 'm-1',
    });
  });
});
