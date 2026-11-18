import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the service
const { prismaMock, notificationMock } = vi.hoisted(() => {
  return {
    prismaMock: {
      raporPesantren: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      classEnrollment: {
        findMany: vi.fn(),
      },
      studentUnitIdentifier: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      student: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 's1' }]),
      },
      teacher: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      teacherSubject: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      takhosusEnrollment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      musyrif: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      class: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      academicYear: {
        findUnique: vi.fn(),
      },
      setting: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      dailyIbadahRecord: {
        findMany: vi.fn(),
      },
      tahfidzRecord: {
        findMany: vi.fn(),
      },
      muhadhoroh: {
        findMany: vi.fn(),
      },
      muhadatsah: {
        findMany: vi.fn(),
      },
      kitabProgress: {
        findMany: vi.fn(),
      },
      violation: {
        findMany: vi.fn(),
      },
      reward: {
        findMany: vi.fn(),
      },
      attendance: {
        findMany: vi.fn(),
      },
    },
    notificationMock: {
      createNotification: vi.fn(),
    },
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/modules/notifications/notifications.service', () => notificationMock);

// Import the service under test
import {
  getLegerPesantren,
  updateRaporPesantren,
} from '@/modules/rapor-pesantren/rapor-pesantren.service';

const SUPER_ADMIN = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };

describe('Rapor Pesantren Enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The rapor write scope (#1025) reads the rapor's santri and checks it is
    // writable; the santri exists in the caller's unit.
    prismaMock.raporPesantren.findUnique.mockResolvedValue({ studentId: 's1' });
    prismaMock.student.findMany.mockResolvedValue([{ id: 's1' }]);
    prismaMock.teacher.findFirst.mockResolvedValue(null);
    prismaMock.teacherSubject.findMany.mockResolvedValue([]);
    prismaMock.takhosusEnrollment.findMany.mockResolvedValue([]);
    prismaMock.musyrif.findFirst.mockResolvedValue(null);
    prismaMock.class.findMany.mockResolvedValue([]);
  });

  describe('getLegerPesantren (Ranking)', () => {
    it('should calculate ranks based on overallScore', async () => {
      // Setup mock data
      const mockEnrollments = [
        { student: { id: 's1', user: { name: 'Alice' }, nis: '123' } },
        { student: { id: 's2', user: { name: 'Bob' }, nis: '124' } },
        { student: { id: 's3', user: { name: 'Charlie' }, nis: '125' } },
      ];

      const mockRapors = [
        {
          studentId: 's1',
          overallScore: 85,
          id: 'r1',
          tahfidzData: {},
          ibadahData: {},
          muhadhorohData: {},
          muhadatsahData: {},
          kitabProgressData: {},
          akhlakData: {},
          attendanceData: {},
        },
        {
          studentId: 's2',
          overallScore: 92,
          id: 'r2',
          tahfidzData: {},
          ibadahData: {},
          muhadhorohData: {},
          muhadatsahData: {},
          kitabProgressData: {},
          akhlakData: {},
          attendanceData: {},
        },
        {
          studentId: 's3',
          overallScore: 78,
          id: 'r3',
          tahfidzData: {},
          ibadahData: {},
          muhadhorohData: {},
          muhadatsahData: {},
          kitabProgressData: {},
          akhlakData: {},
          attendanceData: {},
        },
      ];

      // @ts-ignore
      prismaMock.classEnrollment.findMany.mockResolvedValue(mockEnrollments);
      // @ts-ignore
      prismaMock.raporPesantren.findMany.mockResolvedValue(mockRapors);

      const result = await getLegerPesantren({
        unitId: 'u1',
        classId: 'c1',
        academicYearId: 'ay1',
        semester: 1,
      });

      // Assertions
      expect(result).toHaveLength(3);

      // Bob (92) should be Rank 1
      const bob = result.find((r) => r.studentName === 'Bob');
      expect(bob?.rank).toBe(1);

      // Alice (85) should be Rank 2
      const alice = result.find((r) => r.studentName === 'Alice');
      expect(alice?.rank).toBe(2);

      // Charlie (78) should be Rank 3
      const charlie = result.find((r) => r.studentName === 'Charlie');
      expect(charlie?.rank).toBe(3);
    });

    // Leger dokumen unit: santri yang kini di unit lain tetap tercetak dengan
    // NIS unit leger ini (student_unit_identifiers), bukan NIS barunya.
    it('mencetak NIS unit leger, bukan NIS unit santri sekarang', async () => {
      // @ts-ignore
      prismaMock.classEnrollment.findMany.mockResolvedValue([
        { student: { id: 's1', unitId: 'u-smp', user: { name: 'Alice' }, nis: 'SMP-2026-01' } },
        { student: { id: 's2', unitId: 'u1', user: { name: 'Bob' }, nis: 'SD-124' } },
      ]);
      // @ts-ignore
      prismaMock.raporPesantren.findMany.mockResolvedValue([]);
      // @ts-ignore
      prismaMock.studentUnitIdentifier.findMany.mockResolvedValueOnce([
        { studentId: 's1', unitId: 'u1', nis: 'SD-123' },
        { studentId: 's1', unitId: 'u-smp', nis: 'SMP-2026-01' },
      ]);

      const result = await getLegerPesantren({
        unitId: 'u1',
        classId: 'c1',
        academicYearId: 'ay1',
        semester: 1,
      });

      expect(result.map((r) => [r.studentName, r.studentNis])).toEqual([
        ['Alice', 'SD-123'],
        ['Bob', 'SD-124'],
      ]);
    });
  });

  describe('updateRaporPesantren (Notifications)', () => {
    it('should send notifications when status becomes PUBLISHED', async () => {
      const mockResult = {
        id: 'r1',
        studentId: 's1',
        semester: 1,
        student: {
          user: { name: 'Alice' },
          parents: [{ parent: { id: 'p1', email: 'parent@test.com' } }],
        },
        academicYear: { name: '2024/2025' },
      };

      // @ts-ignore
      prismaMock.raporPesantren.update.mockResolvedValue(mockResult);

      await updateRaporPesantren('r1', { status: 'PUBLISHED' }, SUPER_ADMIN);

      expect(prismaMock.raporPesantren.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({ status: 'PUBLISHED' }),
        })
      );

      expect(notificationMock.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'p1',
          title: 'Rapor Pesantren Diterbitkan',
          data: expect.objectContaining({ raporId: 'r1' }),
        })
      );
    });

    it('should NOT send notifications when status is DRAFT', async () => {
      const mockResult = {
        id: 'r1',
        studentId: 's1',
        status: 'DRAFT',
        student: {
          user: { name: 'Alice' },
          parents: [{ parent: { id: 'p1', email: 'parent@test.com' } }],
        },
        academicYear: { name: '2024/2025' },
      };

      // @ts-ignore
      prismaMock.raporPesantren.update.mockResolvedValue(mockResult);

      await updateRaporPesantren('r1', { status: 'DRAFT' }, SUPER_ADMIN);

      expect(notificationMock.createNotification).not.toHaveBeenCalled();
    });
  });
});
