import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WriteActor } from '@/utils/write-scope';

// #1025 — the rapor-pesantren write surface must follow the yayasan write-scope
// rule (owner decision 2026-11-09). The rapor *configuration* is stored per
// unit, so it is scoped by unit; a rapor *record* is scoped by its santri:
// Super Admin for any, everyone else the santri's own unit or one reached
// through a Relasi_Pengajaran (any relation, R13.3). All three used to run
// unscoped — `saveRaporConfig` wrote any unit's settings by its id, and
// `updateRaporPesantren`/`deleteRaporPesantren` changed any rapor by its id.
// A record outside the caller's write reach now answers 404 with the same
// content as one that does not exist. These tests drive the real service.

const STUDENTS: Record<string, { id: string; unitId: string; enrollments: { classId: string }[] }> =
  {
    's-smp': { id: 's-smp', unitId: 'unit-smp', enrollments: [{ classId: 'c-smp' }] },
    's-other': { id: 's-other', unitId: 'unit-other', enrollments: [{ classId: 'c-other' }] },
  };

function inScope(student: { unitId: string }, scope: Record<string, any>): boolean {
  if (Object.keys(scope).length === 0) return true;
  if (scope.id?.in?.length === 0) return false;
  if (scope.unitId) return student.unitId === scope.unitId;
  return false;
}

vi.mock('@/lib/prisma', () => {
  const prisma: any = {
    student: {
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (Array.isArray(where.AND)) {
          const ids: string[] = where.AND[0]?.id?.in ?? [];
          const scope = where.AND[1] ?? {};
          return ids
            .map((id) => STUDENTS[id])
            .filter(Boolean)
            .filter((s) => inScope(s!, scope))
            .map((s) => ({ id: s!.id }));
        }
        const ids: string[] = where.id?.in ?? [];
        return ids.map((id) => STUDENTS[id]).filter(Boolean);
      }),
    },
    teacher: { findFirst: vi.fn().mockResolvedValue({ id: 't-1', unitId: 'unit-smp' }) },
    teacherSubject: { findMany: vi.fn().mockResolvedValue([]) },
    takhosusEnrollment: { findMany: vi.fn().mockResolvedValue([]) },
    musyrif: { findFirst: vi.fn().mockResolvedValue(null) },
    class: { findMany: vi.fn().mockResolvedValue([]) },
    setting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    raporPesantren: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'r-1', studentId: 's-smp' }),
      delete: vi.fn().mockResolvedValue({ id: 'r-1' }),
    },
  };
  return { prisma };
});

vi.mock('@/modules/notifications/notifications.service', () => ({
  createNotification: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import {
  saveRaporConfig,
  updateRaporPesantren,
  deleteRaporPesantren,
} from '../rapor-pesantren.service';

const adminSmp: WriteActor = { sub: 'u-admin', roleCode: 'SMPIT_ADMIN', unitId: 'unit-smp' };
// A Pembaca_Lintas_Unit: reads every unit (seesAllUnits), so it must NOT get
// write breadth from that (R13.8).
const musyrif: WriteActor = { sub: 'u-musyrif', roleCode: 'MUSYRIF', unitId: 'unit-smp' };
const superAdmin: WriteActor = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };
const guruSmp: WriteActor = { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' };

const raporFindUnique = vi.mocked(prisma.raporPesantren.findUnique);
const raporUpdate = vi.mocked(prisma.raporPesantren.update);
const raporDelete = vi.mocked(prisma.raporPesantren.delete);
const settingUpsert = vi.mocked(prisma.setting.upsert);
const takhosusFindMany = vi.mocked(prisma.takhosusEnrollment.findMany);

const notFound = { code: 'NOT_FOUND' };

const config = (unitId: string) => ({
  unitId,
  componentWeights: {
    tahfidz: 20,
    takhosus: 10,
    ibadah: 15,
    muhadhoroh: 15,
    muhadatsah: 15,
    kitabProgress: 15,
    akhlak: 10,
  },
  gradeThresholds: { mumtaz: 90, jayyidJiddan: 80, jayyid: 70, maqbul: 60 },
  includeAttendance: true,
  includeViolations: true,
  includeRewards: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.teacher.findFirst).mockResolvedValue({ id: 't-1', unitId: 'unit-smp' } as never);
  vi.mocked(prisma.teacherSubject.findMany).mockResolvedValue([] as never);
  takhosusFindMany.mockResolvedValue([] as never);
  vi.mocked(prisma.musyrif.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.class.findMany).mockResolvedValue([] as never);
  raporFindUnique.mockResolvedValue({ studentId: 's-smp' } as never);
});

describe('saveRaporConfig — a unit configuration is scoped by unit', () => {
  it('writes the caller’s own unit', async () => {
    await saveRaporConfig(config('unit-smp'), adminSmp);
    expect(settingUpsert).toHaveBeenCalled();
  });

  it('Super Admin writes any unit', async () => {
    await saveRaporConfig(config('unit-other'), superAdmin);
    expect(settingUpsert).toHaveBeenCalled();
  });

  it('refuses another unit with 404 and writes nothing', async () => {
    await expect(saveRaporConfig(config('unit-other'), adminSmp)).rejects.toMatchObject(notFound);
    expect(settingUpsert).not.toHaveBeenCalled();
  });

  it('a cross-unit reader with no relation is refused 404 (R13.8)', async () => {
    await expect(saveRaporConfig(config('unit-other'), musyrif)).rejects.toMatchObject(notFound);
    expect(settingUpsert).not.toHaveBeenCalled();
  });
});

describe('updateRaporPesantren — a rapor is scoped by its santri', () => {
  it('writes a rapor of the caller’s own unit', async () => {
    await updateRaporPesantren('r-1', { notes: 'x' }, adminSmp);
    expect(raporFindUnique.mock.calls[0][0]?.where).toEqual({ id: 'r-1' });
    expect(raporUpdate).toHaveBeenCalled();
  });

  it('Super Admin writes a rapor of any unit', async () => {
    raporFindUnique.mockResolvedValue({ studentId: 's-other' } as never);
    await updateRaporPesantren('r-2', { notes: 'x' }, superAdmin);
    expect(raporUpdate).toHaveBeenCalled();
  });

  it('reaches a rapor of another unit through a relation', async () => {
    raporFindUnique.mockResolvedValue({ studentId: 's-other' } as never);
    takhosusFindMany.mockResolvedValue([{ studentId: 's-other' }] as never);
    await updateRaporPesantren('r-2', { notes: 'x' }, guruSmp);
    expect(raporUpdate).toHaveBeenCalled();
  });

  it('refuses another unit’s rapor with 404 and writes nothing', async () => {
    raporFindUnique.mockResolvedValue({ studentId: 's-other' } as never);
    await expect(updateRaporPesantren('r-2', { notes: 'x' }, adminSmp)).rejects.toMatchObject(
      notFound
    );
    expect(raporUpdate).not.toHaveBeenCalled();
  });

  it('the out-of-scope 404 reads like a missing id', async () => {
    raporFindUnique.mockResolvedValue({ studentId: 's-other' } as never);
    const outOfScope = await updateRaporPesantren('r-2', { notes: 'x' }, adminSmp).catch((e) => e);
    raporFindUnique.mockResolvedValue(null as never);
    const absent = await updateRaporPesantren('r-2', { notes: 'x' }, adminSmp).catch((e) => e);

    expect(outOfScope.code).toBe('NOT_FOUND');
    expect(absent.code).toBe('NOT_FOUND');
    expect(absent.message).toBe(outOfScope.message);
  });
});

describe('deleteRaporPesantren — a rapor is scoped by its santri', () => {
  it('deletes a rapor of the caller’s own unit', async () => {
    await deleteRaporPesantren('r-1', adminSmp);
    expect(raporDelete).toHaveBeenCalled();
  });

  it('refuses another unit’s rapor with 404 and deletes nothing', async () => {
    raporFindUnique.mockResolvedValue({ studentId: 's-other' } as never);
    await expect(deleteRaporPesantren('r-2', adminSmp)).rejects.toMatchObject(notFound);
    expect(raporDelete).not.toHaveBeenCalled();
  });
});
