import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncomeRange, OccupationType } from '@prisma/client';
import { createScholarshipCriterionSchema } from '@cipansor/shared';

/**
 * Skor beasiswa (#1003, R11.1–R11.3, R11.7, R11.8, R11.12).
 *
 * The scoring moved into `finance-enhancement` with the rest of the scholarship
 * work, and it now answers a caller rather than a bare id: a recipient of
 * another unit's program, or a santri outside the caller's scope, is a 404 that
 * writes nothing. The scorer itself is pure — the same facts twice give the same
 * answer — and a criterion it cannot read is left out of the total instead of
 * being counted as a zero.
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

import {
  criterionKind,
  factsOf,
  MANUAL_REQUIRED,
  scoreCriteria,
  scholarshipScoringService,
} from '../scholarship-scoring.service';

const SD = 'unit-sd';
const SMP = 'unit-smp';

const adminSd = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: SD };
const superAdmin = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };

interface CriterionFixture {
  id: string;
  name: string;
  weight: number;
  targetValue?: string | null;
}

interface StudentFixture {
  tahfidzRecords?: Array<{ juz: number }>;
  grades?: Array<{ score: unknown; maxScore?: unknown }>;
  fatherIncome?: IncomeRange | null;
  fatherOccupation?: OccupationType | null;
  motherIncome?: IncomeRange | null;
  motherOccupation?: OccupationType | null;
  guardianIncome?: IncomeRange | null;
  guardianOccupation?: OccupationType | null;
}

function recipientFixture(options: {
  criteria: CriterionFixture[];
  student?: StudentFixture;
  unitId?: string;
}) {
  // Scholarship.unitId is required in the schema; the impossible null-unit
  // case is pinned at actorSeesUnit in resolve-unit-id.test.ts instead.
  return {
    id: 'rec-1',
    studentId: 'stu-1',
    scholarship: {
      unitId: options.unitId ?? SD,
      criteria: options.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        weight: c.weight,
        targetValue: c.targetValue ?? null,
      })),
    },
    student: {
      id: 'stu-1',
      tahfidzRecords: options.student?.tahfidzRecords ?? [],
      grades: options.student?.grades ?? [],
      fatherIncome: options.student?.fatherIncome ?? null,
      fatherOccupation: options.student?.fatherOccupation ?? null,
      motherIncome: options.student?.motherIncome ?? null,
      motherOccupation: options.student?.motherOccupation ?? null,
      guardianIncome: options.student?.guardianIncome ?? null,
      guardianOccupation: options.student?.guardianOccupation ?? null,
    },
  };
}

const facts = (student: StudentFixture = {}) =>
  factsOf(recipientFixture({ criteria: [], student }).student);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockResolvedValue([]);
  prismaMock.student.findFirst.mockResolvedValue({ id: 'stu-1' });
});

describe('scoreCriteria', () => {
  it('classifies a criterion by its name alone, case-insensitively', () => {
    expect(criterionKind('Hafalan Al-Quran')).toBe('HAFALAN');
    expect(criterionKind('setoran TAHFIDZ')).toBe('HAFALAN');
    expect(criterionKind('Nilai Akademik')).toBe('AKADEMIK');
    expect(criterionKind('nilai rata-rata rapor')).toBe('AKADEMIK');
    expect(criterionKind('Penghasilan Orang Tua')).toBe('PENGHASILAN');
    expect(criterionKind('Wawancara')).toBe('MANUAL');
  });

  it('scores tahfidz against targetValue and caps the result at 100', () => {
    const half = scoreCriteria(
      [{ id: 'c1', name: 'Hafalan', weight: 1, targetValue: '10' }],
      facts({ tahfidzRecords: [{ juz: 5 }] })
    );
    expect(half.criteria[0]).toMatchObject({ value: '5', score: 50, excluded: false });
    expect(half.totalScore).toBe(50);
    expect(half.complete).toBe(true);

    const over = scoreCriteria(
      [{ id: 'c1', name: 'Tahfidz', weight: 1, targetValue: '5' }],
      facts({ tahfidzRecords: [{ juz: 30 }] })
    );
    expect(over.criteria[0].score).toBe(100);
  });

  it('averages the recent grades for an academic criterion', () => {
    const result = scoreCriteria(
      [{ id: 'c1', name: 'Nilai Akademik', weight: 1, targetValue: '100' }],
      facts({ grades: [{ score: 80 }, { score: 90 }] })
    );
    expect(result.totalScore).toBe(85);
  });

  it('puts each grade on its own scale before averaging (CBT 20/20 is 100)', () => {
    const result = scoreCriteria(
      [{ id: 'c1', name: 'Nilai Akademik', weight: 1, targetValue: '100' }],
      facts({
        grades: [
          { score: 20, maxScore: 20 },
          { score: 80, maxScore: 100 },
        ],
      })
    );

    // (100 + 80) / 2 = 90, not (20 + 80) / 2 = 50.
    expect(result.criteria[0]).toMatchObject({ value: '90', score: 90 });
    expect(result.totalScore).toBe(90);
  });

  it('reads a target that carries its unit', () => {
    const hafalan = scoreCriteria(
      [{ id: 'c1', name: 'Hafalan', weight: 1, targetValue: '10 juz' }],
      facts({ tahfidzRecords: [{ juz: 5 }] })
    );
    expect(hafalan.criteria[0].score).toBe(50);

    const akademik = scoreCriteria(
      [{ id: 'c1', name: 'Nilai Akademik', weight: 1, targetValue: '85%' }],
      facts({ grades: [{ score: 85, maxScore: 100 }] })
    );
    expect(akademik.criteria[0].score).toBe(100);
  });

  it('marks a percentage target on a hafalan criterion as manual, not a tiny score', () => {
    const result = scoreCriteria(
      [{ id: 'c1', name: 'Hafalan Al-Quran', weight: 1, targetValue: '85%' }],
      facts({ tahfidzRecords: [{ juz: 5 }] })
    );

    // 5 juz against "85%" is not 5.88/100; the target's unit is unusable here.
    expect(result.criteria[0]).toMatchObject({
      value: MANUAL_REQUIRED,
      score: null,
      excluded: true,
    });
    expect(result.totalScore).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('reads a decimal target written with a comma or a dot', () => {
    const akademik = scoreCriteria(
      [{ id: 'c1', name: 'Nilai Akademik', weight: 1, targetValue: '85,5%' }],
      facts({ grades: [{ score: 85, maxScore: 100 }] })
    );
    expect(akademik.criteria[0].score).toBeCloseTo((85 / 85.5) * 100, 6);

    const hafalan = scoreCriteria(
      [{ id: 'c1', name: 'Hafalan', weight: 1, targetValue: '7.5' }],
      facts({ tahfidzRecords: [{ juz: 7 }] })
    );
    expect(hafalan.criteria[0].score).toBeCloseTo((7 / 7.5) * 100, 6);

    const hafalanComma = scoreCriteria(
      [{ id: 'c1', name: 'Hafalan', weight: 1, targetValue: '7,5 juz' }],
      facts({ tahfidzRecords: [{ juz: 7 }] })
    );
    expect(hafalanComma.criteria[0].score).toBeCloseTo((7 / 7.5) * 100, 6);
  });

  it('reads income across the household, not the father alone', () => {
    const fromMother = scoreCriteria(
      [{ id: 'c1', name: 'Penghasilan Orang Tua', weight: 1, targetValue: null }],
      facts({ motherIncome: IncomeRange.KURANG_500K })
    );
    expect(fromMother.criteria[0]).toMatchObject({
      value: 'KURANG_500K',
      score: 100,
      excluded: false,
    });
  });

  it('excludes a criterion it cannot read instead of scoring it 0', () => {
    const result = scoreCriteria(
      [
        { id: 'c1', name: 'Hafalan', weight: 1, targetValue: '10' },
        { id: 'c2', name: 'Penghasilan', weight: 1, targetValue: null },
        { id: 'c3', name: 'Nilai Akademik', weight: 1, targetValue: '100' },
        { id: 'c4', name: 'Wawancara', weight: 1, targetValue: null },
      ],
      facts()
    );

    expect(result.criteria.map((c) => c.value)).toEqual([
      'NO_DATA',
      'UNKNOWN',
      'NO_DATA',
      'MANUAL_REQUIRED',
    ]);
    expect(result.criteria.every((c) => c.excluded && c.score === null)).toBe(true);
    // Nothing could be scored: no evidence is not a score of zero (R11.12).
    expect(result.totalScore).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('takes the weighted mean over the criteria it could read, and flags the rest', () => {
    const result = scoreCriteria(
      [
        { id: 'c1', name: 'Tahfidz', weight: 3, targetValue: '10' },
        { id: 'c2', name: 'Penghasilan', weight: 1, targetValue: null },
        { id: 'c3', name: 'Wawancara', weight: 5, targetValue: null },
      ],
      facts({ tahfidzRecords: [{ juz: 10 }], fatherIncome: IncomeRange.RANGE_1JT_2JT })
    );

    // (100 * 3 + 80 * 1) / 4 = 95 — the interview is left out, not weighted 0.
    expect(result.totalScore).toBe(95);
    expect(result.complete).toBe(false);
  });

  it('never reports a total above 100, however the weights round', () => {
    // Summing `100 * w` and dividing by `Σw` lands at 100.00000000000001 for
    // this pair; a score above 100 is not a score.
    const result = scoreCriteria(
      [
        { id: 'c1', name: 'Tahfidz', weight: 2.7359314591149215, targetValue: '5' },
        { id: 'c2', name: 'Tahfidz B', weight: 0.3, targetValue: '5' },
      ],
      facts({ tahfidzRecords: [{ juz: 30 }] })
    );

    expect(result.criteria.every((c) => c.score === 100)).toBe(true);
    expect(result.totalScore).toBe(100);
  });

  it('gives the same answer for the same facts, twice (R11.8)', () => {
    const criteria = [
      { id: 'c1', name: 'Tahfidz', weight: 2, targetValue: '30' },
      { id: 'c2', name: 'Penghasilan', weight: 1, targetValue: null },
    ];
    const student = facts({
      tahfidzRecords: [{ juz: 7 }],
      fatherIncome: IncomeRange.RANGE_2JT_5JT,
    });
    expect(scoreCriteria(criteria, student)).toEqual(scoreCriteria(criteria, student));
  });

  it('keeps the deprecated `assessments` alias beside `criteria`', () => {
    const result = scoreCriteria(
      [{ id: 'c1', name: 'Hafalan', weight: 1, targetValue: '10' }],
      facts({ tahfidzRecords: [{ juz: 5 }] })
    );
    expect(result.assessments).toEqual(result.criteria);
  });
});

describe('scholarshipScoringService.assessRecipient', () => {
  it('answers 404 when the recipient does not exist', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(null);

    await expect(
      scholarshipScoringService.assessRecipient(adminSd, 'missing')
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.scholarshipRecipient.update).not.toHaveBeenCalled();
  });

  it("answers 404 for another unit's program, writing nothing (R11.3)", async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({
        unitId: SMP,
        criteria: [{ id: 'c1', name: 'Tahfidz', weight: 1, targetValue: '10' }],
        student: { tahfidzRecords: [{ juz: 5 }] },
      })
    );

    await expect(scholarshipScoringService.assessRecipient(adminSd, 'rec-1')).rejects.toMatchObject(
      { statusCode: 404 }
    );
    expect(prismaMock.scholarshipAssessment.upsert).not.toHaveBeenCalled();
    expect(prismaMock.scholarshipRecipient.update).not.toHaveBeenCalled();
  });

  it('answers 404 for a santri outside the caller scope, writing nothing (R11.3)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({
        criteria: [{ id: 'c1', name: 'Tahfidz', weight: 1, targetValue: '10' }],
        student: { tahfidzRecords: [{ juz: 5 }] },
      })
    );
    prismaMock.student.findFirst.mockResolvedValue(null);

    await expect(scholarshipScoringService.assessRecipient(adminSd, 'rec-1')).rejects.toMatchObject(
      { statusCode: 404 }
    );
    expect(prismaMock.scholarshipAssessment.upsert).not.toHaveBeenCalled();
  });

  it('reads only the santri columns the criteria use, never the whole row (R11.2)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({ criteria: [], student: {} })
    );

    await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');

    const args = prismaMock.scholarshipRecipient.findUnique.mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select.student.select).sort()).toEqual([
      'fatherIncome',
      'fatherOccupation',
      'grades',
      'guardianIncome',
      'guardianOccupation',
      'id',
      'motherIncome',
      'motherOccupation',
      'tahfidzRecords',
    ]);
    // The gradebook keeps points and points-possible apart; both are read.
    expect(args.select.student.select.grades.select).toEqual({
      score: true,
      maxScore: true,
    });
  });

  it('writes only the assessments and totalScore, leaving the decision columns alone (R11.7)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({
        criteria: [{ id: 'c1', name: 'Tahfidz', weight: 1, targetValue: '10' }],
        student: { tahfidzRecords: [{ juz: 10 }] },
      })
    );

    await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');

    expect(prismaMock.scholarshipRecipient.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { totalScore: 100 },
    });
  });

  it('upserts one assessment per criterion, so a second run updates instead of duplicating (R11.8)', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({
        criteria: [
          { id: 'c1', name: 'Tahfidz', weight: 3, targetValue: '10' },
          { id: 'c2', name: 'Penghasilan', weight: 1, targetValue: null },
        ],
        student: { tahfidzRecords: [{ juz: 10 }], fatherIncome: IncomeRange.RANGE_1JT_2JT },
      })
    );

    const first = await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');
    const second = await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');

    expect(first).toEqual(second);
    expect(first.totalScore).toBe(95);

    const upsertArgs = prismaMock.scholarshipAssessment.upsert.mock.calls.map((c) => c[0]);
    expect(upsertArgs.map((a) => a.where.recipientId_criterionId.criterionId)).toEqual([
      'c1',
      'c2',
      'c1',
      'c2',
    ]);
    // Each criterion carries its own composite key — the table's unique index.
    expect(upsertArgs[0].where.recipientId_criterionId).toEqual({
      recipientId: 'rec-1',
      criterionId: 'c1',
    });
  });

  it('stores a null total when every criterion was excluded', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({ criteria: [{ id: 'c1', name: 'Wawancara', weight: 1 }] })
    );

    const result = await scholarshipScoringService.assessRecipient(adminSd, 'rec-1');

    expect(result.totalScore).toBeNull();
    expect(prismaMock.scholarshipRecipient.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { totalScore: null },
    });
  });

  it('lets a Super Admin assess a program in any unit', async () => {
    prismaMock.scholarshipRecipient.findUnique.mockResolvedValue(
      recipientFixture({
        unitId: SMP,
        criteria: [{ id: 'c1', name: 'Tahfidz', weight: 1, targetValue: '10' }],
        student: { tahfidzRecords: [{ juz: 5 }] },
      })
    );

    await expect(
      scholarshipScoringService.assessRecipient(superAdmin, 'rec-1')
    ).resolves.toMatchObject({ totalScore: 50 });
  });
});

describe('scholarshipScoringService.createCriterion', () => {
  it("answers 404 for another unit's program and writes nothing", async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SMP });

    await expect(
      scholarshipScoringService.createCriterion(adminSd, 'sch-1', {
        name: 'Wawancara',
        weight: 1,
        type: 'NUMERIC',
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.scholarshipCriterion.create).not.toHaveBeenCalled();
  });

  it("adds the criterion to the caller's own program", async () => {
    prismaMock.scholarship.findUnique.mockResolvedValue({ unitId: SD });
    prismaMock.scholarshipCriterion.create.mockResolvedValue({ id: 'crit-1' });

    await scholarshipScoringService.createCriterion(adminSd, 'sch-1', {
      name: 'Hafalan',
      weight: 2,
      type: 'NUMERIC',
      targetValue: '30',
    });

    expect(prismaMock.scholarshipCriterion.create).toHaveBeenCalledWith({
      data: {
        name: 'Hafalan',
        weight: 2,
        type: 'NUMERIC',
        targetValue: '30',
        scholarshipId: 'sch-1',
      },
    });
  });
});

describe('createScholarshipCriterionSchema', () => {
  it('accepts a juz target for a hafalan criterion', () => {
    for (const targetValue of ['10 juz', '7,5', '7.5']) {
      expect(
        createScholarshipCriterionSchema.safeParse({
          name: 'Hafalan',
          weight: 1,
          type: 'NUMERIC',
          targetValue,
        }).success
      ).toBe(true);
    }
  });

  it('accepts a percentage target for an academic criterion', () => {
    for (const targetValue of ['85%', '85,5%', '85.5%', '7,5', '7.5']) {
      expect(
        createScholarshipCriterionSchema.safeParse({
          name: 'Nilai Akademik',
          weight: 1,
          type: 'NUMERIC',
          targetValue,
        }).success
      ).toBe(true);
    }
  });

  it('rejects a percentage target for a hafalan criterion', () => {
    for (const name of ['Hafalan', 'Hafalan Al-Quran', 'TAHFIDZ', 'setoran hafalan']) {
      for (const targetValue of ['85%', '85,5%', '85.5%']) {
        const parsed = createScholarshipCriterionSchema.safeParse({
          name,
          weight: 1,
          type: 'NUMERIC',
          targetValue,
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0]?.message).toContain('jumlah juz');
        }
      }
    }
  });

  it('rejects a numeric target the scorer cannot read', () => {
    for (const targetValue of ['sepuluh', '0', '0,0', '-5']) {
      const parsed = createScholarshipCriterionSchema.safeParse({
        name: 'Hafalan',
        weight: 1,
        type: 'NUMERIC',
        targetValue,
      });
      expect(parsed.success).toBe(false);
    }
  });
});
