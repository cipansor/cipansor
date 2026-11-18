import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    grade: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getAcademicSummary } from '../rapor-pesantren.service';

const mocked = prisma as any;

const config = {
  gradeThresholds: { mumtaz: 90, jayyidJiddan: 80, jayyid: 70 },
  componentWeights: {},
} as any;

describe('rapor getAcademicSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates per subject with passing flags and monthly trend', async () => {
    mocked.grade.findMany.mockResolvedValue([
      {
        subjectId: 'sub-1',
        score: 80,
        gradedAt: new Date('2026-01-10'),
        subject: { name: 'Fiqih', passingScore: 70 },
      },
      {
        subjectId: 'sub-1',
        score: 90,
        gradedAt: new Date('2026-02-10'),
        subject: { name: 'Fiqih', passingScore: 70 },
      },
      {
        subjectId: 'sub-2',
        score: 60,
        gradedAt: new Date('2026-02-15'),
        subject: { name: 'Nahwu', passingScore: 70 },
      },
    ]);

    const result = await getAcademicSummary(
      's1',
      new Date('2026-01-01'),
      new Date('2026-06-30'),
      config
    );

    expect(result.totalSubjects).toBe(2);
    const fiqih = result.subjects.find((s) => s.subjectName === 'Fiqih');
    expect(fiqih).toMatchObject({ score: 85, isPassing: true });
    const nahwu = result.subjects.find((s) => s.subjectName === 'Nahwu');
    expect(nahwu).toMatchObject({ score: 60, isPassing: false });
    expect(result.averageScore).toBe(72.5);
    expect(result.monthlyTrend).toEqual([
      { month: '2026-01', average: 80 },
      { month: '2026-02', average: 75 },
    ]);
  });

  it('returns an empty summary when there are no grades', async () => {
    mocked.grade.findMany.mockResolvedValue([]);
    const result = await getAcademicSummary(
      's1',
      new Date('2026-01-01'),
      new Date('2026-06-30'),
      config
    );
    expect(result).toEqual({
      averageScore: 0,
      grade: 'MAQBUL',
      totalSubjects: 0,
      subjects: [],
      monthlyTrend: [],
    });
  });
});
