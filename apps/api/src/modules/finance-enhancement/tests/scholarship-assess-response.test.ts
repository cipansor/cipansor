import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoSensitiveStudentFields } from '../../../../tests/helpers/sensitive-fields';

/**
 * Skor penerima beasiswa (#1003, R11.2, R11.3, R11.7, R24.7).
 *
 * Two things the screen depends on: the answer names the criteria and their
 * scores but carries no santri column the scorer did not need (NIK, No. KK, the
 * parents' NIK — and, beyond the income *band*, no income figure); and a
 * recipient the caller may not reach is a 404 that writes nothing at all.
 */
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    scholarshipRecipient: { findUnique: vi.fn(), update: vi.fn() },
    scholarshipAssessment: { upsert: vi.fn() },
    scholarshipCriterion: { create: vi.fn() },
    scholarship: { findUnique: vi.fn() },
    student: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { scholarshipScoringService } from '../scholarship-scoring.service';

const SD = 'unit-sd';
const SMP = 'unit-smp';
const adminSd = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: SD };

/** A recipient row as the select returns it, with every sensitive column the
 * old `include: { student }` would have carried. */
function recipientWithSensitiveColumns() {
  return {
    id: 'rec-1',
    studentId: 'stu-1',
    scholarship: {
      unitId: SD,
      criteria: [
        { id: 'c1', name: 'Hafalan Al-Quran', weight: 3, targetValue: '10' },
        { id: 'c2', name: 'Penghasilan Orang Tua', weight: 1, targetValue: null },
        { id: 'c3', name: 'Wawancara', weight: 2, targetValue: null },
      ],
    },
    student: {
      id: 'stu-1',
      nik: '3200000000000001',
      noKK: '3200000000000002',
      fatherNik: '3200000000000003',
      motherNik: '3200000000000004',
      guardianNik: '3200000000000005',
      tahfidzRecords: [{ juz: 10 }],
      grades: [{ score: 80 }, { score: 90 }],
      fatherIncome: 'RANGE_1JT_2JT',
      fatherOccupation: null,
      motherIncome: 'KURANG_500K',
      motherOccupation: null,
      guardianIncome: null,
      guardianOccupation: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockResolvedValue([]);
  prismaMock.student.findFirst.mockResolvedValue({ id: 'stu-1' });
});

describe('POST /finance-enhancement/scholarship-recipients/:id/assess', () => {
  it('answers with each criterion and the total, and no santri column (R11.2, R24.7)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(recipientWithSensitiveColumns());

    const result = await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');

    expectNoSensitiveStudentFields(result);
    // The income *band* is the one thing the answer carries about the household,
    // and it is what a scholarship decision reads.
    expect(result.criteria.map((c) => c.name)).toEqual([
      'Hafalan Al-Quran',
      'Penghasilan Orang Tua',
      'Wawancara',
    ]);
    // The band is the household's: father Rp1–2 jt plus mother < Rp500 rb
    // falls back into the same Rp1–2 jt bucket.
    expect(result.criteria[1].value).toBe('RANGE_1JT_2JT');
    expect(result.criteria[2]).toMatchObject({ value: 'MANUAL_REQUIRED', excluded: true });
    expect(result.complete).toBe(false);
  });

  it('answers 404 and writes nothing for a recipient outside the caller scope (R11.3)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue({
      ...recipientWithSensitiveColumns(),
      scholarship: { unitId: SMP, criteria: [] },
    });

    await expect(scholarshipScoringService.assessRecipient(adminSd, 'rec-1')).rejects.toMatchObject(
      { statusCode: 404 }
    );

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.scholarshipRecipient.update).not.toHaveBeenCalled();
    expect(prismaMock.scholarshipAssessment.upsert).not.toHaveBeenCalled();
  });

  it('writes only assessments and totalScore, leaving status and the decision columns (R11.7)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(recipientWithSensitiveColumns());

    await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');

    const writes = prismaMock.$transaction.mock.calls[0][0];
    // Exactly one upsert per criterion, plus the single recipient update.
    expect(writes).toHaveLength(4);
    expect(prismaMock.scholarshipRecipient.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.scholarshipRecipient.update.mock.calls[0][0];
    expect(Object.keys(updateArg.data)).toEqual(['totalScore']);
  });
});
