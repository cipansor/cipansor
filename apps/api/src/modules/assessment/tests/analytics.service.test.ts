import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { AssessmentAnalyticsService } from '../analytics.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    academicYear: { findUnique: vi.fn() },
    grade: { aggregate: vi.fn(), groupBy: vi.fn() },
    tahfidzRecord: { aggregate: vi.fn() },
    violation: { aggregate: vi.fn() },
    reward: { aggregate: vi.fn() },
    attendance: { groupBy: vi.fn() },
    dailyIbadahRecord: { aggregate: vi.fn() },
    examAttempt: { findMany: vi.fn() },
    dashboardHistory: { findMany: vi.fn() },
    student: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    roomAssignment: { findFirst: vi.fn() },
  },
}));

describe('AssessmentAnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks for new dependencies to prevent null pointer errors
    (prisma.reward.aggregate as any).mockResolvedValue({ _sum: { points: 0 } });
    (prisma.examAttempt.findMany as any).mockResolvedValue([]);
    (prisma.dashboardHistory.findMany as any).mockResolvedValue([]);
    (prisma.roomAssignment.findFirst as any).mockResolvedValue(null);
  });

  it('should calculate student holistic score correctly', async () => {
    const studentId = 's1';
    const academicYearId = 'ay1';

    // Mock Academic Year date range
    (prisma.academicYear.findUnique as any).mockResolvedValue({
      startDate: new Date('2024-07-01'),
      endDate: new Date('2025-06-30'),
    });

    // Mock Academic (80%)
    (prisma.grade.aggregate as any).mockResolvedValue({ _avg: { percentage: 80 } });

    // Mock Tahfidz (15 juz = 50% relative to 30 juz)
    (prisma.tahfidzRecord.aggregate as any).mockResolvedValue({
      _sum: { totalAyah: 1000 },
      _max: { juz: 15 },
    });

    // Mock Behavior (20 points violation, 0 rewards = 80%)
    (prisma.violation.aggregate as any).mockResolvedValue({ _sum: { points: 20 } });
    (prisma.reward.aggregate as any).mockResolvedValue({ _sum: { points: 0 } });

    // Mock Attendance (9/10 days = 90%)
    (prisma.attendance.groupBy as any).mockResolvedValue([
      { status: 'PRESENT', _count: { _all: 9 } },
      { status: 'ABSENT', _count: { _all: 1 } },
    ]);

    // Mock Ibadah (1500 points / 3000 target = 50%)
    (prisma.dailyIbadahRecord.aggregate as any).mockResolvedValue({ _sum: { pointsEarned: 1500 } });

    // Mock CBT (100% since no attempts mocked by default, but let's mock one)
    (prisma.examAttempt.findMany as any).mockResolvedValue([
      { score: 100, exam: { maxScore: 100 } },
    ]);

    const result = await AssessmentAnalyticsService.getStudentHolisticAnalytics(
      studentId,
      academicYearId
    );

    // Expected Calculation with new weights:
    // Academic: 80 * 0.25 = 20
    // Tahfidz: 50 * 0.2 = 10
    // Behavior: 80 * 0.15 = 12
    // Attendance: 90 * 0.1 = 9
    // Ibadah: 50 * 0.1 = 5
    // CBT: 100 * 0.2 = 20
    // Total: 20 + 10 + 12 + 9 + 5 + 20 = 76

    expect(result.holisticScore).toBe(76);
    expect(result.breakdown.academic).toBe(80);
    expect(result.breakdown.tahfidz).toBe(50);
    expect(result.interpretation).toContain('Jayyid');
    expect(result.recommendation).toBeDefined();
  });

  it('should score behavior as 100 for students with zero violations', async () => {
    const studentId = 's2';
    const academicYearId = 'ay1';

    (prisma.academicYear.findUnique as any).mockResolvedValue({
      startDate: new Date('2024-07-01'),
      endDate: new Date('2025-06-30'),
    });

    // Mock Academic (80%)
    (prisma.grade.aggregate as any).mockResolvedValue({ _avg: { percentage: 80 } });

    // Mock Tahfidz (15 juz = 50%)
    (prisma.tahfidzRecord.aggregate as any).mockResolvedValue({
      _sum: { totalAyah: 1000 },
      _max: { juz: 15 },
    });

    // Mock Behavior: zero violations/rewards
    (prisma.violation.aggregate as any).mockResolvedValue({ _sum: { points: null } });
    (prisma.reward.aggregate as any).mockResolvedValue({ _sum: { points: null } });

    // Mock Attendance (10/10 days = 100%)
    (prisma.attendance.groupBy as any).mockResolvedValue([
      { status: 'PRESENT', _count: { _all: 10 } },
    ]);

    // Mock Ibadah (1500 points / 3000 target = 50%)
    (prisma.dailyIbadahRecord.aggregate as any).mockResolvedValue({ _sum: { pointsEarned: 1500 } });

    // No CBT data
    (prisma.examAttempt.findMany as any).mockResolvedValue([]);

    const result = await AssessmentAnalyticsService.getStudentHolisticAnalytics(
      studentId,
      academicYearId
    );

    // Behavior should be 100 (clean record)
    expect(result.breakdown.behavior).toBe(100);

    // Expected Calculation (CBT excluded from weights):
    // Active weights: Academic(0.25), Tahfidz(0.2), Behavior(0.15), Attendance(0.1), Ibadah(0.1)
    // Total weight = 0.8
    // Academic: 80 * (0.25 / 0.8) = 25
    // Tahfidz: 50 * (0.2 / 0.8) = 12.5
    // Behavior: 100 * (0.15 / 0.8) = 18.75
    // Attendance: 100 * (0.1 / 0.8) = 12.5
    // Ibadah: 50 * (0.1 / 0.8) = 6.25
    // Total: 25 + 12.5 + 18.75 + 12.5 + 6.25 = 75
    expect(result.holisticScore).toBe(75);
  });

  it('should return score 0 for students with only behavior data (insufficient)', async () => {
    const studentId = 's3';
    const academicYearId = 'ay1';

    (prisma.academicYear.findUnique as any).mockResolvedValue({
      startDate: new Date('2024-07-01'),
      endDate: new Date('2025-06-30'),
    });

    (prisma.grade.aggregate as any).mockResolvedValue({ _avg: { percentage: null } });
    (prisma.tahfidzRecord.aggregate as any).mockResolvedValue({
      _sum: { totalAyah: null },
      _max: { juz: null },
    });
    (prisma.violation.aggregate as any).mockResolvedValue({ _sum: { points: null } });
    (prisma.reward.aggregate as any).mockResolvedValue({ _sum: { points: null } });
    (prisma.attendance.groupBy as any).mockResolvedValue([]);
    (prisma.dailyIbadahRecord.aggregate as any).mockResolvedValue({ _sum: { pointsEarned: null } });
    (prisma.examAttempt.findMany as any).mockResolvedValue([]);

    const result = await AssessmentAnalyticsService.getStudentHolisticAnalytics(
      studentId,
      academicYearId
    );

    expect(result.holisticScore).toBe(0);
    expect(result.dataCompleteness).toBe('INSUFFICIENT');
  });

  it('should throw error for non-existent academic year', async () => {
    const studentId = 's1';
    const academicYearId = 'non-existent';

    (prisma.academicYear.findUnique as any).mockResolvedValue(null);

    await expect(
      AssessmentAnalyticsService.getStudentHolisticAnalytics(studentId, academicYearId)
    ).rejects.toThrow('Academic year with id non-existent not found');
  });

  it('should calculate unit education analytics correctly', async () => {
    const unitId = 'u1';
    const academicYearId = 'ay1';

    (prisma.grade.groupBy as any).mockResolvedValue([
      { subjectId: 'sub1', _avg: { percentage: 88.5 } },
    ]);
    (prisma.tahfidzRecord.aggregate as any).mockResolvedValue({
      _avg: { juz: 12.4 },
      _count: { id: 150 },
    });
    (prisma.student.count as any).mockResolvedValue(200);

    const result = await AssessmentAnalyticsService.getUnitEducationAnalytics(
      unitId,
      academicYearId
    );

    expect(result.studentCount).toBe(200);
    expect(result.averageJuz).toBe(12.4);
  });
});
