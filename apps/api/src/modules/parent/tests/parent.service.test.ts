import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Prisma before importing the service.
vi.mock('../../../lib/prisma', () => {
  const mockPrisma = {
    studentParent: { findUnique: vi.fn() },
    attendance: { groupBy: vi.fn(), findMany: vi.fn() },
    tahfidzRecord: { findMany: vi.fn() },
    grade: { findMany: vi.fn() },
    reward: { findMany: vi.fn() },
    violation: { findMany: vi.fn() },
    counselingSession: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

// External module-load imports the service pulls in — stub so import succeeds.
vi.mock('../../ibadah/ibadah.service', () => ({ getStudentIbadahStats: vi.fn() }));
vi.mock('../../dormitories/dormitories.service', () => ({}));

import { prisma } from '../../../lib/prisma';
import { parentService } from '../parent.service';

const mockPrisma = prisma as unknown as {
  studentParent: { findUnique: ReturnType<typeof vi.fn> };
  attendance: { groupBy: ReturnType<typeof vi.fn> };
  tahfidzRecord: { findMany: ReturnType<typeof vi.fn> };
  grade: { findMany: ReturnType<typeof vi.fn> };
  reward: { findMany: ReturnType<typeof vi.fn> };
  violation: { findMany: ReturnType<typeof vi.fn> };
  counselingSession: { findMany: ReturnType<typeof vi.fn> };
};

describe('ParentService.getChildWeeklyProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Parent has access by default.
    mockPrisma.studentParent.findUnique.mockResolvedValue({ id: 'link-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when the parent has no access to the child', async () => {
    mockPrisma.studentParent.findUnique.mockResolvedValue(null);
    await expect(parentService.getChildWeeklyProgress('p1', 's1')).rejects.toThrow();
  });

  it('aggregates attendance, tahfidz, behavior and academic for the week', async () => {
    mockPrisma.attendance.groupBy.mockResolvedValue([
      { status: 'PRESENT', _count: { id: 5 } },
      { status: 'SICK', _count: { id: 1 } },
      { status: 'EXCUSED', _count: { id: 2 } },
    ]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([
      { activityType: 'ZIYADAH', totalAyah: 10, score: null },
      { activityType: 'ZIYADAH', totalAyah: 5, score: null },
      { activityType: 'MUROJAAH', totalAyah: 30, score: null },
      { activityType: 'ASSESSMENT', totalAyah: 0, score: 92 },
    ]);
    // Current week grades avg 85; previous week avg 80 -> "Naik 5.0 poin".
    mockPrisma.grade.findMany
      .mockResolvedValueOnce([
        { percentage: 80, score: null, maxScore: null },
        { percentage: 90, score: null, maxScore: null },
      ])
      .mockResolvedValueOnce([{ percentage: 80, score: null, maxScore: null }]);
    mockPrisma.reward.findMany.mockResolvedValue([{ description: 'Membantu teman', points: 3 }]);
    mockPrisma.violation.findMany.mockResolvedValue([]);

    const result = await parentService.getChildWeeklyProgress('p1', 's1');

    expect(result.attendance).toEqual({
      present: 5,
      absent: 0,
      sick: 1,
      permitted: 2,
    });
    expect(result.tahfidz.newMemorization).toBe(15);
    expect(result.tahfidz.review).toBe(30);
    expect(result.tahfidz.grade).toBe('Mumtaz'); // avg assessment score 92
    expect(result.behavior).toEqual({
      positive: 1,
      negative: 0,
      notes: 'Membantu teman',
    });
    expect(result.academic.averageScore).toBe(85);
    expect(result.academic.improvement).toContain('Naik 5.0 poin');
    expect(typeof result.week).toBe('string');
  });

  it('falls back gracefully when there is no data', async () => {
    mockPrisma.attendance.groupBy.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([]);
    mockPrisma.grade.findMany.mockResolvedValue([]);
    mockPrisma.reward.findMany.mockResolvedValue([]);
    mockPrisma.violation.findMany.mockResolvedValue([]);

    const result = await parentService.getChildWeeklyProgress('p1', 's1');

    expect(result.attendance).toEqual({
      present: 0,
      absent: 0,
      sick: 0,
      permitted: 0,
    });
    expect(result.tahfidz).toEqual({
      newMemorization: 0,
      review: 0,
      grade: '—',
    });
    expect(result.behavior).toEqual({ positive: 0, negative: 0, notes: '' });
    expect(result.academic).toEqual({ averageScore: 0, improvement: '' });
  });

  // Regression: the default window was computed from the server (UTC) clock, so
  // during 00:00–06:59 WIB — still the previous day in UTC — the whole week
  // rolled back to the previous Monday and the wali saw last week's recap.
  it('uses the WIB Monday–Sunday week on a Monday 00:00–06:59 WIB instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T22:00:00Z')); // Mon 2026-03-02 05:00 WIB
    mockPrisma.attendance.groupBy.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([]);
    mockPrisma.grade.findMany.mockResolvedValue([]);
    mockPrisma.reward.findMany.mockResolvedValue([]);
    mockPrisma.violation.findMany.mockResolvedValue([]);

    const result = await parentService.getChildWeeklyProgress('p1', 's1');

    expect(mockPrisma.attendance.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: 's1',
          date: {
            gte: new Date('2026-03-01T17:00:00.000Z'),
            lt: new Date('2026-03-08T17:00:00.000Z'),
          },
        },
      })
    );
    expect(result.week).toBe('2 Mar – 8 Mar 2026');
  });

  it('gives the same window for any instant within the same WIB week', async () => {
    mockPrisma.attendance.groupBy.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([]);
    mockPrisma.grade.findMany.mockResolvedValue([]);
    mockPrisma.reward.findMany.mockResolvedValue([]);
    mockPrisma.violation.findMany.mockResolvedValue([]);

    // Monday 00:00 WIB, Monday 23:59 WIB, Wednesday and Sunday 23:59 WIB.
    const instants = [
      '2026-03-01T17:00:00Z',
      '2026-03-02T16:59:00Z',
      '2026-03-04T03:00:00Z',
      '2026-03-08T16:59:00Z',
    ];
    for (const instant of instants) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));
      mockPrisma.attendance.groupBy.mockClear();

      await parentService.getChildWeeklyProgress('p1', 's1');

      expect(mockPrisma.attendance.groupBy.mock.calls[0][0].where.date).toEqual({
        gte: new Date('2026-03-01T17:00:00.000Z'),
        lt: new Date('2026-03-08T17:00:00.000Z'),
      });
      vi.useRealTimers();
    }
  });

  it('honours an explicit weekStart as a WIB calendar day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T03:00:00Z')); // Tue 2026-03-10 WIB
    mockPrisma.attendance.groupBy.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([]);
    mockPrisma.grade.findMany.mockResolvedValue([]);
    mockPrisma.reward.findMany.mockResolvedValue([]);
    mockPrisma.violation.findMany.mockResolvedValue([]);

    const result = await parentService.getChildWeeklyProgress('p1', 's1', {
      weekStart: '2026-03-04',
    });

    expect(mockPrisma.attendance.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: 's1',
          date: {
            gte: new Date('2026-03-01T17:00:00.000Z'),
            lt: new Date('2026-03-08T17:00:00.000Z'),
          },
        },
      })
    );
    expect(result.week).toBe('2 Mar – 8 Mar 2026');
  });
});

describe('ParentService.getChildCounseling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.studentParent.findUnique.mockResolvedValue({ id: 'link-1' });
  });

  it('only queries parent-shareable sessions and never exposes psychology data', async () => {
    mockPrisma.counselingSession.findMany.mockResolvedValue([
      {
        id: 'cs-1',
        scheduledAt: new Date('2026-06-01'),
        status: 'COMPLETED',
        summary: 'Sesi adaptasi berjalan baik',
        recommendations: 'Lanjutkan pendampingan ringan',
        counselor: { user: { name: 'Ustz. Konselor' } },
      },
    ]);

    const result = await parentService.getChildCounseling('p1', 's1');

    // The where clause must restrict to parentNotified/non-confidential
    expect(mockPrisma.counselingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: 's1',
          OR: [{ parentNotified: true }, { isConfidential: false }],
        },
      })
    );
    // And the select must not include psychologyData or raw notes
    const callArgs = mockPrisma.counselingSession.findMany.mock.calls[0][0];
    expect(callArgs.select).not.toHaveProperty('psychologyData');
    expect(callArgs.select).not.toHaveProperty('notes');

    expect(result[0]).toEqual({
      id: 'cs-1',
      scheduledAt: new Date('2026-06-01'),
      status: 'COMPLETED',
      summary: 'Sesi adaptasi berjalan baik',
      recommendations: 'Lanjutkan pendampingan ringan',
      counselorName: 'Ustz. Konselor',
    });
  });

  it('denies parents without access to the child', async () => {
    mockPrisma.studentParent.findUnique.mockResolvedValue(null);
    await expect(parentService.getChildCounseling('p1', 's1')).rejects.toThrow();
  });
});
