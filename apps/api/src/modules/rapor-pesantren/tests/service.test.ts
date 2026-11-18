import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as raporService from '../rapor-pesantren.service';
import { prisma } from '@/lib/prisma';

// Mock prisma and other external dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(),
    },
    takhosusEnrollment: {
      findMany: vi.fn(),
    },
    sanadRecord: {
      findMany: vi.fn(),
    },
    student: {
      findUnique: vi.fn(),
    },
    raporPesantren: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    academicYear: {
      findUnique: vi.fn(),
    },
    simaanExam: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('RaporPesantrenService - Kepesantrenan Terpadu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTakhosusSummary', () => {
    it('should calculate Takhosus progress correctly with only enrollments (no sanad)', async () => {
      // Mock grade thresholds
      const mockConfig = {
        gradeThresholds: {
          mumtaz: 90,
          jayyidJiddan: 80,
          jayyid: 70,
          maqbul: 60,
        },
      } as any;

      // Mock enrollment (1 per student — schema has @@unique([studentId]))
      const mockEnrollments = [
        {
          id: 'enr1',
          halaqohId: 'hal1',
          studentId: 'stud1',
          status: 'ACTIVE',
          targetJuz: 5,
          completedJuz: 2, // 40% progress
          halaqoh: { name: 'Takhosus A' },
          sanadRecords: [],
        },
      ];

      (prisma.takhosusEnrollment.findMany as any).mockResolvedValue(mockEnrollments);
      (prisma.sanadRecord.findMany as any).mockResolvedValue([]);
      (prisma.simaanExam.count as any).mockResolvedValue(0);

      const result = await raporService.getTakhosusSummary(
        'stud1',
        new Date('2024-01-01'),
        new Date('2024-06-30'),
        mockConfig
      );

      // Single enrollment: progress = 40% (2/5 * 100)
      expect(result.score).toBe(40);
      expect(result.enrolledHalaqoh).toBe(1);
      expect(result.totalSessions).toBe(0); // 0 sanads
      expect(result.grade).toBe('RASIB'); // 40 < 60 (maqbul threshold) → RASIB
      expect(result.halaqohDetails).toHaveLength(1);
      expect(result.halaqohDetails[0].progress).toBe(40);
    });

    it('should calculate Takhosus progress correctly when Sanad records exist', async () => {
      const mockConfig = {
        gradeThresholds: {
          mumtaz: 90,
          jayyidJiddan: 80,
          jayyid: 70,
          maqbul: 60,
        },
      } as any;

      const mockSanads = [
        { id: 's1', enrollmentId: 'enr1', score: 95, grade: 'MUMTAZ' },
        { id: 's2', enrollmentId: 'enr1', score: 85, grade: 'JAYYID JIDDAN' },
      ];

      const mockEnrollments = [
        {
          id: 'enr1',
          halaqohId: 'hal1',
          studentId: 'stud1',
          status: 'ACTIVE',
          targetJuz: 5,
          completedJuz: 2,
          halaqoh: { name: 'Takhosus A' },
          sanadRecords: mockSanads,
        },
      ];

      (prisma.takhosusEnrollment.findMany as any).mockResolvedValue(mockEnrollments);
      (prisma.sanadRecord.findMany as any).mockResolvedValue(mockSanads);
      (prisma.simaanExam.count as any).mockResolvedValue(0);

      const result = await raporService.getTakhosusSummary(
        'stud1',
        new Date('2024-01-01'),
        new Date('2024-06-30'),
        mockConfig
      );

      // Average score of sanads = (95 + 85) / 2 = 90
      expect(result.score).toBe(90);
      expect(result.enrolledHalaqoh).toBe(1);
      expect(result.totalSessions).toBe(2);
      expect(result.grade).toBe('MUMTAZ'); // 90 is Mumtaz

      const detail = result.halaqohDetails[0];
      expect(detail.progress).toBe(40);
      expect(detail.sessionsCount).toBe(2);
      expect(detail.latestGrade).toBe('MUMTAZ'); // 90 avg
    });

    it('should not apply simaan bonus when baseScore is zero', async () => {
      const mockConfig = {
        gradeThresholds: {
          mumtaz: 90,
          jayyidJiddan: 80,
          jayyid: 70,
          maqbul: 60,
        },
      } as any;

      // Enrollment with zero progress and no sanad records
      const mockEnrollments = [
        {
          id: 'enr1',
          halaqohId: 'hal1',
          studentId: 'stud1',
          status: 'ACTIVE',
          targetJuz: 30,
          completedJuz: 0, // 0% progress → baseScore = 0
          halaqoh: { name: 'Takhosus A' },
          sanadRecords: [],
        },
      ];

      (prisma.takhosusEnrollment.findMany as any).mockResolvedValue(mockEnrollments);
      (prisma.sanadRecord.findMany as any).mockResolvedValue([]);
      // Student has 3 passed simaan exams — bonus would be 15 if applied
      (prisma.simaanExam.count as any).mockResolvedValue(3);

      const result = await raporService.getTakhosusSummary(
        'stud1',
        new Date('2024-01-01'),
        new Date('2024-06-30'),
        mockConfig
      );

      // Bonus should NOT inflate a zero base score
      expect(result.baseScore).toBe(0);
      expect(result.simaanBonus).toBe(0);
      expect(result.score).toBe(0);
      expect(result.simaanExamCount).toBe(3);
    });

    it('should apply simaan bonus when baseScore is positive', async () => {
      const mockConfig = {
        gradeThresholds: {
          mumtaz: 90,
          jayyidJiddan: 80,
          jayyid: 70,
          maqbul: 60,
        },
      } as any;

      const mockSanads = [{ id: 's1', enrollmentId: 'enr1', score: 75, grade: 'JAYYID' }];

      const mockEnrollments = [
        {
          id: 'enr1',
          halaqohId: 'hal1',
          studentId: 'stud1',
          status: 'ACTIVE',
          targetJuz: 10,
          completedJuz: 3,
          halaqoh: { name: 'Takhosus A' },
          sanadRecords: mockSanads,
        },
      ];

      (prisma.takhosusEnrollment.findMany as any).mockResolvedValue(mockEnrollments);
      (prisma.sanadRecord.findMany as any).mockResolvedValue(mockSanads);
      // 2 passed simaan exams → bonus = 10
      (prisma.simaanExam.count as any).mockResolvedValue(2);

      const result = await raporService.getTakhosusSummary(
        'stud1',
        new Date('2024-01-01'),
        new Date('2024-06-30'),
        mockConfig
      );

      // baseScore = 75 (sanad avg), simaanBonus = 10, finalScore = 85
      expect(result.baseScore).toBe(75);
      expect(result.simaanBonus).toBe(10);
      expect(result.score).toBe(85);
      expect(result.grade).toBe('JAYYID_JIDDAN'); // 85 >= 80
      expect(result.formulaVersion).toBe(2);
    });
  });
});
