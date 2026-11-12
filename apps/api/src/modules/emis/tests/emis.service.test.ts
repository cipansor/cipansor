import { describe, it, expect, vi, beforeEach } from 'vitest';

// EMIS exports official pesantren data to Kemenag. Until now nothing ran the
// service: `student-nis.guard.test.ts` only matches source text, so a silent
// regression (a wrong NIS, a status spelled in the wrong case, an invented
// teacher field) reached the government report without a single failing test.
//
// `nisMapForUnit` is NOT mocked: it is the rule under test. Only
// `prisma.studentUnitIdentifier.findMany` is mocked, so the real NIS-per-unit
// resolution runs on top of it.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findMany: vi.fn(), count: vi.fn() },
    teacher: { findMany: vi.fn(), count: vi.fn() },
    class: { findMany: vi.fn(), count: vi.fn() },
    unit: { findUnique: vi.fn() },
    studentUnitIdentifier: { findMany: vi.fn() },
  },
}));

// `exportInstitutionData` reads the certificate in force through the units
// module (decisions/akreditasi-unit.md); the same mock pattern as
// modules/assessment/tests/skhun-accreditation.test.ts:15.
vi.mock('@/modules/units', () => ({ currentAccreditations: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { currentAccreditations } from '@/modules/units';
import { Gender, UserRole } from '@prisma/client';
import { EmisService } from '../emis.service';

const SUPER_ADMIN = { sub: 'u-1', role: UserRole.SUPER_ADMIN, unitId: null };
const UNIT_ADMIN = { sub: 'u-2', role: UserRole.UNIT_ADMIN, unitId: 'unit-a' };

const DOC_UNIT = 'unit-a';
const OTHER_UNIT = 'unit-b';

/** A student row shaped like what `prisma.student.findMany` returns. */
function student(over: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    unitId: DOC_UNIT,
    nis: 'STUDENTS-NIS',
    nisn: '1234567890',
    gender: Gender.MALE,
    birthPlace: 'Tasikmalaya',
    birthDate: new Date('2010-05-01'),
    address: 'Jl. Pesantren',
    parentName: 'Ayah',
    parentPhone: '0812',
    status: 'active',
    entryYear: 2024,
    graduateYear: null,
    user: { name: 'Santri Satu', email: 's1@example.com', phone: '0812' },
    enrollments: [],
    parents: [],
    ...over,
  };
}

/** A teacher row shaped like what `prisma.teacher.findMany` returns. */
function teacher(over: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    unitId: DOC_UNIT,
    nip: '19850101',
    nuptk: '1234567890123456',
    specialization: 'Matematika',
    joinDate: new Date('2015-07-01'),
    gender: Gender.FEMALE,
    birthPlace: 'Ciamis',
    birthDate: new Date('1985-03-12'),
    user: { name: 'Guru Satu', email: 't1@example.com', phone: '0813' },
    homeroomClasses: [],
    ...over,
  };
}

describe('EmisService', () => {
  let service: EmisService;

  beforeEach(() => {
    service = new EmisService();
    vi.clearAllMocks();
    vi.mocked(prisma.studentUnitIdentifier.findMany).mockResolvedValue([] as never);
  });

  describe('exportStudentData — NIS comes from the document unit (#868 K12)', () => {
    it('prefers the document unit NIS over a different students.nis', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([
        student({ nis: 'DECOY-STUDENTS-NIS' }),
      ] as never);
      vi.mocked(prisma.studentUnitIdentifier.findMany).mockResolvedValue([
        { studentId: 's-1', unitId: DOC_UNIT, nis: 'DOC-UNIT-NIS' },
      ] as never);

      const [row] = await service.exportStudentData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      // The service must read the unit's own NIS, not `student.nis`.
      expect(row.nis).toBe('DOC-UNIT-NIS');
      expect(row.nisLokal).toBe('DOC-UNIT-NIS');
    });

    it('falls back to students.nis when the student has no unit identifier at all', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([student()] as never);
      vi.mocked(prisma.studentUnitIdentifier.findMany).mockResolvedValue([] as never);

      const [row] = await service.exportStudentData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      expect(row.nis).toBe('STUDENTS-NIS');
      expect(row.nisLokal).toBe('STUDENTS-NIS');
    });
  });

  describe('exportStudentData — unit access control (#868 criterion 2)', () => {
    it('forces a non-SUPER_ADMIN to its own unit, ignoring the requested unit', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);

      await service.exportStudentData({ unitId: OTHER_UNIT }, UNIT_ADMIN);

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ unitId: DOC_UNIT }) })
      );
    });

    it('lets a SUPER_ADMIN read any requested unit', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);

      await service.exportStudentData({ unitId: OTHER_UNIT }, SUPER_ADMIN);

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ unitId: OTHER_UNIT }) })
      );
    });
  });

  describe('unit-scoped endpoints reject a foreign unit (#868 criterion 2)', () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['getExportSummary', () => service.getExportSummary(OTHER_UNIT, UNIT_ADMIN)],
      ['validateDataCompleteness', () => service.validateDataCompleteness(OTHER_UNIT, UNIT_ADMIN)],
      ['exportInstitutionData', () => service.exportInstitutionData(OTHER_UNIT, UNIT_ADMIN)],
    ];

    it.each(cases)('%s throws forbidden', async (_name, call) => {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows the unit its own data', async () => {
      vi.mocked(prisma.student.count).mockResolvedValue(0 as never);
      vi.mocked(prisma.teacher.count).mockResolvedValue(0 as never);
      vi.mocked(prisma.class.count).mockResolvedValue(0 as never);

      await expect(service.getExportSummary(DOC_UNIT, UNIT_ADMIN)).resolves.toBeDefined();
    });

    it('states the certificate in force, never a guess', async () => {
      vi.mocked(prisma.unit.findUnique).mockResolvedValue({
        id: DOC_UNIT,
        name: 'SMP IT Cipansor',
        officialName: null,
        type: 'SMP_IT',
        npsn: '69988558',
        address: 'Tasikmalaya',
        phone: null,
        email: null,
        foundation: null,
      } as never);
      vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.class.findMany).mockResolvedValue([] as never);
      vi.mocked(currentAccreditations).mockResolvedValue(
        new Map([[DOC_UNIT, { rating: 'B' }]]) as never
      );

      const data = await service.exportInstitutionData(DOC_UNIT, UNIT_ADMIN);

      expect(data.akreditasi).toBe('B');
    });
  });

  describe('exportStudentData — status filter follows one vocabulary (#868 criterion 3)', () => {
    it('filters to active, non-deleted students by default', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);

      await service.exportStudentData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as Record<
        string,
        unknown
      >;
      // Lowercase 'active': an 'ACTIVE' spelling returns zero rows, silently.
      expect(where.status).toBe('active');
      expect(where.deletedAt).toBeNull();
    });

    it('drops both filters when includeInactive is set', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);

      await service.exportStudentData({ unitId: DOC_UNIT, includeInactive: true }, SUPER_ADMIN);

      const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as Record<
        string,
        unknown
      >;
      expect(where).not.toHaveProperty('status');
      expect(where).not.toHaveProperty('deletedAt');
    });
  });

  describe('exportTeacherData — exports the real columns, invents nothing (#873 K11)', () => {
    it('maps gender instead of hardcoding L', async () => {
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([teacher()] as never);

      const [row] = await service.exportTeacherData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      expect(row.jenisKelamin).toBe('P');
    });

    it('exports MALE as L', async () => {
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([
        teacher({ gender: Gender.MALE }),
      ] as never);

      const [row] = await service.exportTeacherData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      expect(row.jenisKelamin).toBe('L');
    });

    it('exports empty (not a guessed gender) when gender is null', async () => {
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([teacher({ gender: null })] as never);

      const [row] = await service.exportTeacherData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      // Every teacher on the seeded stack has gender NULL; guessing 'P' here
      // would invent data exactly like the old hardcoded 'L' did.
      expect(row.jenisKelamin).toBe('');
    });

    it('takes birthPlace and birthDate from the columns', async () => {
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([teacher()] as never);

      const [row] = await service.exportTeacherData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      expect(row.tempatLahir).toBe('Ciamis');
      // Same formatDate as every other EMIS date; assert the year so a hardcoded
      // '' (the old behaviour) fails.
      expect(row.tanggalLahir).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(row.tanggalLahir).toContain('1985');
    });

    it('exports empty strings when the birth columns are null', async () => {
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([
        teacher({ birthPlace: null, birthDate: null }),
      ] as never);

      const [row] = await service.exportTeacherData({ unitId: DOC_UNIT }, SUPER_ADMIN);

      expect(row.tempatLahir).toBe('');
      expect(row.tanggalLahir).toBe('');
    });

    it('forces a non-SUPER_ADMIN to its own unit', async () => {
      vi.mocked(prisma.teacher.findMany).mockResolvedValue([] as never);

      await service.exportTeacherData({ unitId: OTHER_UNIT }, UNIT_ADMIN);

      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ unitId: DOC_UNIT }) })
      );
    });
  });
});
