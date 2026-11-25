import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoSensitiveStudentFields } from '../../../../tests/helpers/sensitive-fields';

/**
 * Cakupan beasiswa (#988, R26.9–R26.11). A scholarship belongs to a unit; its
 * recipients and criteria are readable only for a unit the caller may read, and
 * the recipients list carries only the columns the screen shows — the old
 * `include: { student }` sent NIK, No. KK and the parents' NIK and income.
 */
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    scholarship: { findUnique: vi.fn() },
    scholarshipRecipient: { findMany: vi.fn(), count: vi.fn() },
    scholarshipCriterion: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { financeEnhancementService } from '../finance-enhancement.service';

const SD = 'unit-sd';
const SMP = 'unit-smp';

const adminSd = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: SD };
const yayasan = { sub: 'u-yayasan', roleCode: 'YAYASAN_KETUA', unitId: null };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scholarshipRecipient.findMany.mockResolvedValue([]);
  prismaMock.scholarshipRecipient.count.mockResolvedValue(0);
  prismaMock.scholarshipCriterion.findMany.mockResolvedValue([]);
});

describe('getScholarshipRecipients', () => {
  it('beasiswa unit lain dijawab 404 dan tidak ada penerima yang dibaca', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SMP });

    await expect(
      financeEnhancementService.getScholarshipRecipients('sch-1', { page: 1, limit: 20 }, adminSd)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.scholarshipRecipient.findMany).not.toHaveBeenCalled();
  });

  it('beasiswa yang tidak ada dijawab 404 yang sama', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue(null);

    await expect(
      financeEnhancementService.getScholarshipRecipients('x', { page: 1, limit: 20 }, adminSd)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.scholarshipRecipient.findMany).not.toHaveBeenCalled();
  });

  it('hanya kolom yang tampil dibaca — bukan seluruh kolom santri', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SD });

    await financeEnhancementService.getScholarshipRecipients(
      'sch-1',
      { page: 1, limit: 20 },
      adminSd
    );

    const args = prismaMock.scholarshipRecipient.findMany.mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select.student.select).sort()).toEqual([
      'enrollments',
      'id',
      'nis',
      'user',
    ]);
  });

  it('jawabannya tidak memuat kolom santri yang sensitif (R24.7)', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SD });
    prismaMock.scholarshipRecipient.count.mockResolvedValue(1);
    // The row carries the sensitive columns, as the old `include` would have
    // returned them; the select + mapper must not pass them on.
    prismaMock.scholarshipRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        scholarshipId: 'sch-1',
        studentId: 's1',
        academicYearId: 'ay-1',
        startDate: new Date('2026-07-01'),
        endDate: null,
        notes: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-07-01'),
        updatedAt: new Date('2026-07-01'),
        student: {
          id: 's1',
          nis: '0099',
          nik: '3200000000000001',
          noKK: '3200000000000002',
          fatherNik: '3200000000000003',
          motherIncome: 5000000,
          user: { name: 'Fulan' },
          enrollments: [{ class: { name: 'Kelas 1' } }],
        },
        academicYear: { name: '2026/2027' },
      },
    ]);

    const res = await financeEnhancementService.getScholarshipRecipients(
      'sch-1',
      { page: 1, limit: 20 },
      adminSd
    );

    expectNoSensitiveStudentFields(res);
    expect(res.data[0].student).toMatchObject({ nis: '0099', name: 'Fulan', class: 'Kelas 1' });
  });

  it('pengurus yayasan membaca beasiswa unit mana pun', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SMP });

    await expect(
      financeEnhancementService.getScholarshipRecipients('sch-1', { page: 1, limit: 20 }, yayasan)
    ).resolves.toMatchObject({ success: true });
  });

  it('membawa skor tersimpan untuk pembaca, dengan penanda tanpa nilai (R11.6)', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SD });
    prismaMock.scholarshipRecipient.count.mockResolvedValue(1);
    prismaMock.scholarshipRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        scholarshipId: 'sch-1',
        studentId: 's1',
        academicYearId: 'ay-1',
        startDate: new Date('2026-07-01'),
        endDate: null,
        notes: null,
        status: 'ACTIVE',
        totalScore: 95,
        assessments: [
          {
            criterionId: 'c1',
            value: '10',
            score: 100,
            criterion: { name: 'Hafalan', weight: 3 },
          },
          {
            criterionId: 'c2',
            value: 'MANUAL_REQUIRED',
            score: 0,
            criterion: { name: 'Wawancara', weight: 1 },
          },
        ],
        createdAt: new Date('2026-07-01'),
        updatedAt: new Date('2026-07-01'),
        student: {
          id: 's1',
          nis: '0099',
          user: { name: 'Fulan' },
          enrollments: [{ class: { name: 'Kelas 1' } }],
        },
        academicYear: { name: '2026/2027' },
      },
    ]);

    const res = await financeEnhancementService.getScholarshipRecipients(
      'sch-1',
      { page: 1, limit: 20 },
      adminSd
    );

    expect(res.data[0].totalScore).toBe(95);
    expect(res.data[0].assessments).toEqual([
      {
        criterionId: 'c1',
        name: 'Hafalan',
        weight: 3,
        value: '10',
        score: 100,
        excluded: false,
      },
      {
        criterionId: 'c2',
        name: 'Wawancara',
        weight: 1,
        value: 'MANUAL_REQUIRED',
        score: null,
        excluded: true,
      },
    ]);

    const args = prismaMock.scholarshipRecipient.findMany.mock.calls[0][0];
    expect(args.select.totalScore).toBe(true);
    expect(args.select.assessments).toBeDefined();
  });
});

describe('getScholarshipCriteria', () => {
  it('beasiswa unit lain dijawab 404 dan kriteria tidak dibaca', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SMP });

    await expect(
      financeEnhancementService.getScholarshipCriteria('sch-1', adminSd)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.scholarshipCriterion.findMany).not.toHaveBeenCalled();
  });

  it('beasiswa unit sendiri membaca kriterianya', async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SD });

    await financeEnhancementService.getScholarshipCriteria('sch-1', adminSd);

    expect(prismaMock.scholarshipCriterion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scholarshipId: 'sch-1' } })
    );
  });
});
