import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getExamAnalytics } from './assessment.service';
import { prisma } from '@/lib/prisma';
import type { WriteActor } from '@/utils/write-scope';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    exam: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

const SUPER: WriteActor = { sub: 'u1', roleCode: 'SUPER_ADMIN', unitId: null };

describe('Assessment Service - getExamAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null if exam is not found', async () => {
    (prisma.exam.findFirst as any).mockResolvedValue(null);

    const result = (await getExamAnalytics('exam-1', SUPER))!;
    expect(result).toBeNull();
  });

  it('should return zeros for analytics if no grades exist', async () => {
    const mockExam = {
      id: 'exam-1',
      passingScore: 70,
      maxScore: 100,
      class: { _count: { enrollments: 2 } },
      grades: [],
    };
    (prisma.exam.findFirst as any).mockResolvedValue(mockExam);

    const result = (await getExamAnalytics('exam-1', SUPER))!;
    expect(result).toMatchObject({
      examId: 'exam-1',
      totalStudents: 2,
      gradedCount: 0,
      averageScore: 0,
      highestScore: 0,
      lowestScore: 0,
      passCount: 0,
      failCount: 0,
      passRate: 0,
    });
    expect(result.scoreDistribution).toHaveLength(5);
  });

  it('should correctly calculate analytics with valid grades', async () => {
    const mockExam = {
      id: 'exam-2',
      passingScore: 75,
      maxScore: 100,
      class: { _count: { enrollments: 4 } },
      grades: [
        { studentId: 's1', score: 80, student: { user: { name: 'Alice' } } },
        { studentId: 's2', score: 60, student: { user: { name: 'Bob' } } },
        { studentId: 's3', score: 90, student: { user: { name: 'Charlie' } } },
        { studentId: 's4', score: 95, student: { user: { name: 'David' } } },
      ],
    };

    (prisma.exam.findFirst as any).mockResolvedValue(mockExam);

    const result = (await getExamAnalytics('exam-2', SUPER))!;
    // totalScore = 80 + 60 + 90 + 95 = 325
    // average = 325 / 4 = 81.25
    expect(result).toMatchObject({
      examId: 'exam-2',
      totalStudents: 4,
      gradedCount: 4,
      averageScore: 81.25,
      highestScore: 95,
      lowestScore: 60,
      passCount: 3, // 80, 90, 95
      failCount: 1, // 60
      passRate: 75, // 3 / 4 * 100
    });

    // David: 95, Charlie: 90, Alice: 80, Bob: 60
    expect(result.topStudents[0].studentName).toBe('David');
    expect(result.topStudents[0].score).toBe(95);

    // Distribution
    const d90_100 = result.scoreDistribution.find((d) => d.range === '90-100%');
    expect(d90_100?.count).toBe(2); // Charlie and David
    const d60_69 = result.scoreDistribution.find((d) => d.range === '60-69%');
    expect(d60_69?.count).toBe(1); // Bob
    const d80_89 = result.scoreDistribution.find((d) => d.range === '80-89%');
    expect(d80_89?.count).toBe(1); // Alice
  });
});
