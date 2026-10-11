import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    teacher: { create: vi.fn(), update: vi.fn() },
    staff: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed'), compare: vi.fn() },
  hash: vi.fn().mockResolvedValue('hashed'),
  compare: vi.fn(),
}));

import { prisma } from '../../../lib/prisma';
import {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  assertMayReadEmployeeRecord,
  type HrActor,
} from '../hr.service';

const mocked = prisma as unknown as {
  user: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  teacher: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  staff: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

/** A unit-bound HR admin — the actor most of these tests speak as. */
const admin: HrActor = { sub: 'admin-1', roleCode: 'SDIT_ADMIN', unitId: 'unit-1' };
/** The yayasan super admin — reaches every unit. */
const superAdmin: HrActor = { sub: 'root-1', roleCode: 'SUPER_ADMIN', unitId: null };

describe('hr getEmployees', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to TEACHER + STAFF and paginates', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 2, limit: 10 }, admin);

    expect(mocked.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('narrows to one role when asked', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 1, limit: 20, role: 'STAFF' }, admin);

    expect(mocked.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'STAFF' }),
      })
    );
  });

  it('reads unit, teacher and staff — the directory columns only, for every caller', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 1, limit: 20 }, admin);

    const select = mocked.user.findMany.mock.calls[0][0].select;
    expect(select.unit).toEqual({ select: { id: true, name: true } });
    // A roster is a directory: name, NIP/NUPTK, position, unit, status. A
    // teacher's NIK, KK, address, birth and bank account never ride along.
    for (const column of [
      'nik',
      'noKK',
      'address',
      'birthPlace',
      'birthDate',
      'bankAccountNumber',
    ]) {
      expect(select.teacher.select[column]).toBeUndefined();
    }
    expect(select.teacher.select.nip).toBe(true);
    expect(select.staff.select.position).toBe(true);
  });

  it('never selects credential columns', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 1, limit: 20 }, admin);

    const select = mocked.user.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('twoFactorSecret');
    expect(select).not.toHaveProperty('twoFactorRecoveryCodes');
    expect(select).not.toHaveProperty('resetTokenHash');
    expect(mocked.user.findMany.mock.calls[0][0]).not.toHaveProperty('include');
  });

  it('reports the total so the page can show a count, not an empty roster', async () => {
    mocked.user.findMany.mockResolvedValue([{ id: 'u-1' }]);
    mocked.user.count.mockResolvedValue(4);

    const result = await getEmployees({ page: 1, limit: 20 }, admin);

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
  });

  it('searches name, email and both employee profiles', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 1, limit: 20, search: 'sri' }, admin);

    const where = mocked.user.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { name: { contains: 'sri', mode: 'insensitive' } },
      { email: { contains: 'sri', mode: 'insensitive' } },
      { teacher: { nip: { contains: 'sri', mode: 'insensitive' } } },
      { staff: { nip: { contains: 'sri', mode: 'insensitive' } } },
    ]);
  });
});

describe('hr getEmployees — unit scope (CWE-863)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pins a unit admin to their own unit whatever unitId the query asks for', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 1, limit: 20, unitId: 'unit-other' }, admin);

    const where = mocked.user.findMany.mock.calls[0][0].where;
    expect(where.unitId).toBe('unit-1');
    expect(mocked.user.count.mock.calls[0][0].where.unitId).toBe('unit-1');
  });

  it('lets a foundation role read another unit when it names one', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    await getEmployees({ page: 1, limit: 20, unitId: 'unit-9' }, superAdmin);

    expect(mocked.user.findMany.mock.calls[0][0].where.unitId).toBe('unit-9');
  });

  it('gives a foundation role the whole yayasan when it names no unit, even if its token carries one', async () => {
    mocked.user.findMany.mockResolvedValue([]);
    mocked.user.count.mockResolvedValue(0);

    // A board member assigned to one unit still oversees them all: the roster
    // must not be narrowed back to that unit by the token's own `unitId`.
    await getEmployees(
      { page: 1, limit: 20 },
      { sub: 'ketua-1', roleCode: 'YAYASAN_KETUA', unitId: 'unit-3' }
    );

    expect(mocked.user.findMany.mock.calls[0][0].where.unitId).toBeUndefined();
  });

  it('refuses a unit-bound role with no unit at all', async () => {
    await expect(
      getEmployees({ page: 1, limit: 20 }, { sub: 'x', roleCode: 'SDIT_ADMIN', unitId: null })
    ).rejects.toThrow(/unit/i);
    expect(mocked.user.findMany).not.toHaveBeenCalled();
  });

  it('shows a santri only their own row, never the roster', async () => {
    mocked.user.findMany.mockResolvedValue([{ id: 'santri-1' }]);

    await getEmployees(
      { page: 1, limit: 20 },
      { sub: 'santri-1', roleCode: 'SMPIT_SISWA', unitId: 'unit-1' }
    );

    const where = mocked.user.findMany.mock.calls[0][0].where;
    expect(where.id).toBe('santri-1');
    expect(where.unitId).toBeUndefined();
  });
});

describe('hr getEmployeeById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the user with both profile relations', async () => {
    mocked.user.findUnique.mockResolvedValue({
      id: 'u-1',
      unitId: 'unit-1',
      teacher: null,
      staff: {},
    });

    const result = await getEmployeeById('u-1', admin);

    expect(result).toMatchObject({ id: 'u-1' });
    expect(mocked.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' } })
    );
  });

  // Decided by the owner on 2026-10-10: a teacher's personal columns are for
  // the employee and whoever keeps the HR record (admin, Tata Usaha, the board).
  it.each([
    ['the unit admin', admin, 'u-1'],
    ['the unit Tata Usaha', { sub: 'tu-1', roleCode: 'SDIT_TATA_USAHA', unitId: 'unit-1' }, 'u-1'],
    ['the employee themselves', { sub: 'u-1', roleCode: 'SDIT_GURU', unitId: 'unit-1' }, 'u-1'],
    ['the super admin', superAdmin, 'u-1'],
  ] as const)('gives %s the full record', async (_who, actor, id) => {
    mocked.user.findUnique.mockResolvedValue({ id, unitId: 'unit-1' });

    await getEmployeeById(id, actor as HrActor);

    const select = mocked.user.findUnique.mock.calls[0][0].select;
    expect(select.teacher).toBe(true);
  });

  it.each([
    ['a colleague teacher', { sub: 'guru-2', roleCode: 'SDIT_GURU', unitId: 'unit-1' }],
    ['the principal', { sub: 'kepsek-1', roleCode: 'SDIT_KEPALA_SEKOLAH', unitId: 'unit-1' }],
    ['the nurse', { sub: 'perawat-1', roleCode: 'PERAWAT', unitId: 'unit-1' }],
  ] as const)('gives %s the directory columns only', async (_who, actor) => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-1', unitId: 'unit-1' });

    await getEmployeeById('u-1', actor as HrActor);

    const select = mocked.user.findUnique.mock.calls[0][0].select;
    expect(select.teacher.select.nik).toBeUndefined();
    expect(select.teacher.select.bankAccountNumber).toBeUndefined();
    expect(select.teacher.select.nip).toBe(true);
  });

  it('never selects credential columns for the detail view', async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-1', unitId: 'unit-1' });

    await getEmployeeById('u-1', admin);

    const select = mocked.user.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('twoFactorSecret');
    expect(mocked.user.findUnique.mock.calls[0][0]).not.toHaveProperty('include');
  });

  it('404s an unknown id so the controller can 404', async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    await expect(getEmployeeById('nope', admin)).rejects.toThrow(/not found/i);
  });

  it("404s another unit's employee rather than revealing it", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-2', unitId: 'unit-other' });

    await expect(getEmployeeById('u-2', admin)).rejects.toThrow(/not found/i);
  });

  it('reaches an employee of another unit for a foundation role', async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-2', unitId: 'unit-other' });

    await expect(getEmployeeById('u-2', superAdmin)).resolves.toMatchObject({ id: 'u-2' });
  });

  it("refuses a santri a colleague's record even in the same unit", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-2', unitId: 'unit-1' });

    await expect(
      getEmployeeById('u-2', { sub: 'santri-1', roleCode: 'SMPIT_SISWA', unitId: 'unit-1' })
    ).rejects.toThrow(/not found/i);
  });
});

describe('hr createEmployee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a duplicate email before touching the transaction', async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      createEmployee(
        {
          name: 'A',
          email: 'a@x.id',
          role: 'STAFF',
          unitId: 'unit-1',
          position: 'Petugas',
        },
        admin
      )
    ).rejects.toThrow(/already exists/i);

    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("writes a unit admin's new employee into their own unit, not the body's", async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    const txUserCreate = vi.fn().mockResolvedValue({ id: 'u-new' });
    const txStaffCreate = vi.fn();
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: txUserCreate },
        teacher: { create: vi.fn() },
        staff: { create: txStaffCreate },
      })
    );

    await createEmployee(
      {
        name: 'Sri',
        email: 'sri@x.id',
        role: 'STAFF',
        unitId: 'unit-other',
        position: 'Petugas Kesehatan',
      },
      admin
    );

    expect(txUserCreate.mock.calls[0][0].data.unitId).toBe('unit-1');
    expect(txStaffCreate.mock.calls[0][0].data.unitId).toBe('unit-1');
    // The created row is the API's answer, so it carries no credential column.
    const select = txUserCreate.mock.calls[0][0].select;
    expect(select).toBeDefined();
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('twoFactorSecret');
  });

  it('lets a foundation role place an employee in the unit it names', async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    const txUserCreate = vi.fn().mockResolvedValue({ id: 'u-new' });
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: txUserCreate },
        teacher: { create: vi.fn() },
        staff: { create: vi.fn() },
      })
    );

    await createEmployee(
      { name: 'Sri', email: 'sri@x.id', role: 'STAFF', unitId: 'unit-9', position: 'Petugas' },
      superAdmin
    );

    expect(txUserCreate.mock.calls[0][0].data.unitId).toBe('unit-9');
  });

  it('creates a Staff row for a STAFF employee', async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    const txStaffCreate = vi.fn();
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: vi.fn().mockResolvedValue({ id: 'u-new' }) },
        teacher: { create: vi.fn() },
        staff: { create: txStaffCreate },
      })
    );

    await createEmployee(
      {
        name: 'Sri',
        email: 'sri@x.id',
        role: 'STAFF',
        unitId: 'unit-1',
        position: 'Petugas Kesehatan',
        department: 'Kesehatan',
      },
      admin
    );

    expect(txStaffCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          position: 'Petugas Kesehatan',
          department: 'Kesehatan',
        }),
      })
    );
  });

  it('requires a position for a STAFF employee — a Staff row cannot be built without it', async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: vi.fn().mockResolvedValue({ id: 'u-new' }) },
        teacher: { create: vi.fn() },
        staff: { create: vi.fn() },
      })
    );

    await expect(
      createEmployee({ name: 'Sri', email: 'sri@x.id', role: 'STAFF', unitId: 'unit-1' }, admin)
    ).rejects.toThrow(/position/i);
  });

  it('creates a Teacher row (not Staff) for a TEACHER employee', async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    const txTeacherCreate = vi.fn();
    const txStaffCreate = vi.fn();
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: vi.fn().mockResolvedValue({ id: 'u-new' }) },
        teacher: { create: txTeacherCreate },
        staff: { create: txStaffCreate },
      })
    );

    await createEmployee(
      { name: 'Ust. A', email: 'a@x.id', role: 'TEACHER', unitId: 'unit-1' },
      admin
    );

    expect(txTeacherCreate).toHaveBeenCalled();
    expect(txStaffCreate).not.toHaveBeenCalled();
  });

  it('gives an employee created without a password a random one, never a fixed default', async () => {
    const bcrypt = (await import('bcryptjs')).default as unknown as {
      hash: ReturnType<typeof vi.fn>;
    };
    mocked.user.findUnique.mockResolvedValue(null);
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: vi.fn().mockResolvedValue({ id: 'u-new' }) },
        teacher: { create: vi.fn() },
        staff: { create: vi.fn() },
      })
    );

    await createEmployee(
      { name: 'Siti Aminah', email: 'siti@example.com', role: 'TEACHER', unitId: 'unit-1' },
      admin
    );

    const hashed = bcrypt.hash.mock.calls[0][0] as string;
    expect(hashed).not.toBe('password123');
    expect(hashed.length).toBeGreaterThanOrEqual(24);
  });
});

describe('hr updateEmployee / deleteEmployee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('404s on an unknown employee', async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    await expect(updateEmployee('nope', { name: 'X' }, admin)).rejects.toThrow(/not found/i);
  });

  it("404s editing another unit's employee", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-2', unitId: 'unit-other' });
    await expect(updateEmployee('u-2', { name: 'X' }, admin)).rejects.toThrow(/not found/i);
  });

  it('pins an edit to the caller\u2019s unit, ignoring a move the caller may not make', async () => {
    mocked.user.findUnique.mockResolvedValue({
      id: 'u-1',
      unitId: 'unit-1',
      role: 'TEACHER',
      teacher: { id: 't-1' },
      staff: null,
    });
    const txUserUpdate = vi.fn().mockResolvedValue({ id: 'u-1' });
    const txTeacherUpdate = vi.fn();
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: txUserUpdate },
        teacher: { update: txTeacherUpdate },
        staff: { update: vi.fn() },
      })
    );

    await updateEmployee('u-1', { unitId: 'unit-other' }, admin);

    expect(txUserUpdate.mock.calls[0][0].data.unitId).toBe('unit-1');
    expect(txTeacherUpdate.mock.calls[0][0].data.unitId).toBe('unit-1');
    // The updated row is the API's answer, so it carries no credential column.
    const select = txUserUpdate.mock.calls[0][0].select;
    expect(select).toBeDefined();
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('twoFactorSecret');
  });

  it("404s deleting another unit's employee", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-2', unitId: 'unit-other' });
    await expect(deleteEmployee('u-2', admin)).rejects.toThrow(/not found/i);
  });

  it('soft-deletes the user and both profiles rather than removing rows', async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-1', unitId: 'unit-1' });
    const txUserUpdate = vi.fn().mockResolvedValue({
      id: 'u-1',
      teacher: { id: 't-1' },
      staff: { id: 's-1' },
    });
    const txTeacherUpdate = vi.fn();
    const txStaffUpdate = vi.fn();
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: txUserUpdate },
        teacher: { update: txTeacherUpdate },
        staff: { update: txStaffUpdate },
      })
    );

    await deleteEmployee('u-1', admin);

    expect(txUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
      })
    );
    // NIP is released too, or a later employee cannot reuse the number.
    expect(txTeacherUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nip: null }) })
    );
    expect(txStaffUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nip: null }) })
    );
  });

  it('frees the email so the address can be reused', async () => {
    mocked.user.findUnique.mockResolvedValue({ id: 'u-1', unitId: 'unit-1' });
    const txUserUpdate = vi.fn().mockResolvedValue({ id: 'u-1' });
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: txUserUpdate },
        teacher: { update: vi.fn() },
        staff: { update: vi.fn() },
      })
    );

    await deleteEmployee('u-1', admin);

    const email = txUserUpdate.mock.calls[0][0].data.email as string;
    expect(email).toMatch(/^deleted_u-1_\d+@example\.com$/);
  });
});

describe('hr assertMayReadEmployeeRecord — who reads a record beyond the directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The employee being asked about works at unit-1.
    mocked.user.findUnique.mockResolvedValue({ unitId: 'unit-1' });
  });

  const colleague: HrActor = { sub: 'teacher-2', roleCode: 'SDIT_GURU', unitId: 'unit-1' };
  const kepala: HrActor = { sub: 'head-1', roleCode: 'SDIT_KEPALA_SEKOLAH', unitId: 'unit-1' };
  const tataUsaha: HrActor = { sub: 'tu-1', roleCode: 'SDIT_TATA_USAHA', unitId: 'unit-1' };
  const otherAdmin: HrActor = { sub: 'admin-9', roleCode: 'SMPIT_ADMIN', unitId: 'unit-9' };
  const pengurus: HrActor = { sub: 'org-1', roleCode: 'YAYASAN_KETUA', unitId: null };

  it('lets the employee read their own record without a lookup', async () => {
    await expect(assertMayReadEmployeeRecord(colleague, 'teacher-2')).resolves.toBeUndefined();
    expect(mocked.user.findUnique).not.toHaveBeenCalled();
  });

  it('lets the unit admin, the unit Tata Usaha and the foundation read it', async () => {
    for (const keeper of [admin, tataUsaha, pengurus, superAdmin]) {
      await expect(assertMayReadEmployeeRecord(keeper, 'teacher-7')).resolves.toBeUndefined();
    }
  });

  it('answers 404 to a colleague and to the kepala sekolah', async () => {
    for (const reader of [colleague, kepala]) {
      await expect(assertMayReadEmployeeRecord(reader, 'teacher-7')).rejects.toMatchObject({
        statusCode: 404,
      });
    }
  });

  it('answers 404 to another unit\u2019s admin and for an unknown employee', async () => {
    await expect(assertMayReadEmployeeRecord(otherAdmin, 'teacher-7')).rejects.toMatchObject({
      statusCode: 404,
    });
    mocked.user.findUnique.mockResolvedValue(null);
    await expect(assertMayReadEmployeeRecord(admin, 'nobody')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
