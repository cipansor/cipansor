import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Dapodik module exports santri and family personal data (nik, nisn, the
// parents' NIK and phone) to Kemendikbud. Nothing ran it before this file, and
// the exports scoped with `options.unitId || currentUser.unitId` behind a
// legacy-role gate: a unit admin naming another unit on `?unitId=` was let
// through, and `getExportSummary`/`validateData` took the unit raw with no
// check at all. These tests pin the unit scope the repo already enforces
// everywhere else (utils/resolve-unit-id.ts).

vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findMany: vi.fn(), count: vi.fn() },
    teacher: { findMany: vi.fn(), count: vi.fn() },
    class: { findMany: vi.fn(), count: vi.fn() },
    unit: { findUnique: vi.fn() },
  },
}));

// `exportSekolahData` reads the certificate in force through the units module;
// mocked so the service under test does not pull the whole module graph.
vi.mock('@/modules/units', () => ({ currentAccreditations: vi.fn() }));

import { prisma } from '@/lib/prisma';

const studentFindMany = vi.mocked(prisma.student.findMany);
const teacherFindMany = vi.mocked(prisma.teacher.findMany);
const classFindMany = vi.mocked(prisma.class.findMany);
const studentCount = vi.mocked(prisma.student.count);

type Where = Record<string, unknown>;
const studentWhere = () => studentFindMany.mock.calls[0][0]?.where as Where;
const teacherWhere = () => teacherFindMany.mock.calls[0][0]?.where as Where;
const classWhere = () => classFindMany.mock.calls[0][0]?.where as Where;
const countWhere = () => studentCount.mock.calls[0][0]?.where as Where;
import { dapodikService } from '../dapodik.service';

const UNIT_A = 'unit-a';
const UNIT_B = 'unit-b';

/** A school's own admin: bound to one unit, not foundation-scoped. */
const ADMIN_A = { sub: 'u-a', role: 'UNIT_ADMIN', roleCode: 'SDIT_ADMIN', unitId: UNIT_A };
const SUPER_ADMIN = { sub: 'u-s', role: 'SUPER_ADMIN', roleCode: 'SUPER_ADMIN', unitId: null };

beforeEach(() => {
  vi.clearAllMocks();
  studentFindMany.mockResolvedValue([]);
  teacherFindMany.mockResolvedValue([]);
  classFindMany.mockResolvedValue([]);
  studentCount.mockResolvedValue(0);
  vi.mocked(prisma.teacher.count).mockResolvedValue(0);
  vi.mocked(prisma.class.count).mockResolvedValue(0);
});

describe('export unit scope', () => {
  it('a unit admin naming another unit still exports only their own students', async () => {
    await dapodikService.exportStudentData({ unitId: UNIT_B }, ADMIN_A);

    expect(studentWhere().unitId).toBe(UNIT_A);
  });

  it('a unit admin naming another unit still exports only their own teachers', async () => {
    await dapodikService.exportTeacherData({ unitId: UNIT_B }, ADMIN_A);

    expect(teacherWhere().unitId).toBe(UNIT_A);
  });

  it('a unit admin naming another unit still exports only their own rombel', async () => {
    await dapodikService.exportRombelData({ unitId: UNIT_B }, ADMIN_A);

    expect(classWhere().unitId).toBe(UNIT_A);
  });

  it('a unit admin with no unit named exports their own', async () => {
    await dapodikService.exportStudentData({}, ADMIN_A);

    expect(studentWhere().unitId).toBe(UNIT_A);
  });

  it('a super admin may narrow the export to one unit', async () => {
    await dapodikService.exportStudentData({ unitId: UNIT_B }, SUPER_ADMIN);

    expect(studentWhere().unitId).toBe(UNIT_B);
  });
});

describe('summary and validate unit scope', () => {
  it('refuses a unit outside a unit admin’s reach', async () => {
    await expect(dapodikService.getExportSummary(UNIT_B, ADMIN_A)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(dapodikService.validateData(UNIT_B, ADMIN_A)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('a super admin may narrow the summary to one unit', async () => {
    await dapodikService.getExportSummary(UNIT_B, SUPER_ADMIN);

    expect(countWhere().unitId).toBe(UNIT_B);
  });
});

describe('the active filter', () => {
  it('without includeInactive only active students are queried', async () => {
    await dapodikService.exportStudentData({}, ADMIN_A);

    expect(studentWhere().status).toBe('active');
  });

  it('with includeInactive the status filter is dropped', async () => {
    await dapodikService.exportStudentData({ includeInactive: true }, ADMIN_A);

    expect(studentWhere().status).toBeUndefined();
  });
});
