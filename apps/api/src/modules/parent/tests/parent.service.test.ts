import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Prisma before importing the service.
vi.mock('../../../lib/prisma', () => {
  const mockPrisma = {
    studentParent: { findUnique: vi.fn(), findMany: vi.fn() },
    attendance: { groupBy: vi.fn(), findMany: vi.fn() },
    invoice: { groupBy: vi.fn() },
    permit: { groupBy: vi.fn() },
    tahfidzRecord: { findMany: vi.fn(), groupBy: vi.fn() },
    academicYear: { findMany: vi.fn() },
    roomAssignment: { findMany: vi.fn() },
    grade: { findMany: vi.fn(), groupBy: vi.fn() },
    reward: { findMany: vi.fn() },
    violation: { findMany: vi.fn(), groupBy: vi.fn() },
    notification: { count: vi.fn() },
    counselingSession: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

// External module-load imports the service pulls in — stub so import succeeds.
vi.mock('../../ibadah/ibadah.service', () => ({ getStudentIbadahStats: vi.fn() }));
vi.mock('../../dormitories/dormitories.service', () => ({
  getRoomSocialAnalytics: vi.fn(),
}));
vi.mock('@/modules/announcements', () => ({ recentAnnouncements: vi.fn() }));

import { prisma } from '../../../lib/prisma';
import * as DormitoryService from '../../dormitories/dormitories.service';
import { recentAnnouncements } from '@/modules/announcements';
import { parentService } from '../parent.service';

const mockPrisma = prisma as unknown as {
  studentParent: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  attendance: {
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  invoice: { groupBy: ReturnType<typeof vi.fn> };
  permit: { groupBy: ReturnType<typeof vi.fn> };
  tahfidzRecord: { findMany: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
  academicYear: { findMany: ReturnType<typeof vi.fn> };
  roomAssignment: { findMany: ReturnType<typeof vi.fn> };
  grade: {
    findMany: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  reward: { findMany: ReturnType<typeof vi.fn> };
  violation: {
    findMany: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  notification: { count: ReturnType<typeof vi.fn> };
  counselingSession: { findMany: ReturnType<typeof vi.fn> };
};

const mockRoomAnalytics = DormitoryService.getRoomSocialAnalytics as ReturnType<typeof vi.fn>;
const mockAnnouncements = recentAnnouncements as ReturnType<typeof vi.fn>;

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

describe('ParentService.getDashboardSummary (#869)', () => {
  /** A `getChildren` row: the student id is on `id`. */
  const childRow = {
    id: 's1',
    name: 'Ahmad',
    nis: '20240001',
    gender: 'MALE',
    status: 'active',
    relation: 'father',
    isPrimary: true,
    unitId: 'u1',
    unit: { id: 'u1', name: 'SD IT', type: 'SD_IT' },
    currentClass: { id: 'c1', name: '6A', level: '6' },
  };

  function primeEmpty() {
    mockPrisma.studentParent.findMany.mockResolvedValue([
      { student: { id: 's1', enrollments: [], unit: childRow.unit, user: {} } },
    ]);
    mockPrisma.attendance.findMany.mockResolvedValue([]);
    mockPrisma.invoice.groupBy.mockResolvedValue([]);
    mockPrisma.permit.groupBy.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.groupBy.mockResolvedValue([]);
    mockPrisma.academicYear.findMany.mockResolvedValue([]);
    mockPrisma.roomAssignment.findMany.mockResolvedValue([]);
    mockPrisma.grade.groupBy.mockResolvedValue([]);
    mockPrisma.violation.groupBy.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);
    mockAnnouncements.mockResolvedValue([]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns each child keyed by `child.id` with the canonical summary shape', async () => {
    // `getChildren` maps `sp.student` into the `child` object; feed the join row.
    mockPrisma.studentParent.findMany.mockResolvedValue([
      {
        student: {
          id: 's1',
          nis: '20240001',
          nisn: null,
          gender: 'MALE',
          birthPlace: null,
          birthDate: null,
          address: null,
          parentPhone: null,
          photoUrl: null,
          status: 'active',
          unitId: 'u1',
          unit: { id: 'u1', name: 'SD IT', type: 'SD_IT' },
          user: { id: 'usr1', name: 'Ahmad', email: null, isActive: true },
          enrollments: [{ class: childRow.currentClass }],
        },
        relation: 'father',
        isPrimary: true,
      },
    ]);
    mockPrisma.attendance.findMany.mockResolvedValue([
      { id: 'a1', studentId: 's1', status: 'PRESENT' },
      { id: 'a2', studentId: 's1', status: 'PRESENT' },
      { id: 'a3', studentId: 's1', status: 'SICK' },
    ]);
    mockPrisma.invoice.groupBy.mockResolvedValue([{ studentId: 's1', _count: { id: 2 } }]);
    mockPrisma.permit.groupBy.mockResolvedValue([]);
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([{ id: 't1', studentId: 's1', juz: 5 }]);
    // A full juz 1 (148 ayat) is 1 juz; the last setoran's `juz: 5` must not be
    // read as "5 juz memorized" (#869 review).
    mockPrisma.tahfidzRecord.groupBy.mockResolvedValue([
      { studentId: 's1', juz: 1, _sum: { totalAyah: 148 } },
    ]);
    mockPrisma.academicYear.findMany.mockResolvedValue([{ id: 'ay1' }]);
    mockPrisma.grade.groupBy.mockResolvedValue([{ studentId: 's1', _avg: { percentage: 88 } }]);
    mockPrisma.violation.groupBy.mockResolvedValue([]);
    mockPrisma.roomAssignment.findMany.mockResolvedValue([{ studentId: 's1', roomId: 'r1' }]);
    mockRoomAnalytics.mockResolvedValue({ harmonyScore: 91 });
    mockPrisma.notification.count.mockResolvedValue(0);
    mockAnnouncements.mockResolvedValue([]);

    const result = await parentService.getDashboardSummary('p1');

    expect(result.children).toHaveLength(1);
    const entry = result.children[0];
    // The wali page looks the summary up by `child.id`; nothing may carry
    // `studentId` on the entry itself.
    expect(entry.child.id).toBe('s1');
    expect(entry).not.toHaveProperty('studentId');
    expect(entry.recentAttendance).toHaveLength(3);
    expect(entry.pendingInvoices).toBe(2);
    expect(entry.lastTahfidz).toEqual({ id: 't1', studentId: 's1', juz: 5 });
    expect(entry.memorizedJuz).toBe(1);
    expect(entry.holisticScore).not.toBeNull();
    expect(entry.boardingHarmonyScore).toBe(91);
  });

  it('returns holisticScore null — never 0 — when no dimension produced data', async () => {
    primeEmpty();

    const result = await parentService.getDashboardSummary('p1');

    expect(result.children[0].holisticScore).toBeNull();
    expect(result.children[0].boardingHarmonyScore).toBeNull();
    expect(result.children[0].lastTahfidz).toBeNull();
    // No ZIYADAH record → no memorization figure, not "0 juz" (#869 review).
    expect(result.children[0].memorizedJuz).toBeNull();
  });

  it('reads hafalan from the ZIYADAH aggregate, not the last setoran juz number (#869 review)', async () => {
    // The santri recited a single ayah of juz 30; the last setoran's `juz` is
    // 30 but the memorized amount is a fraction of one juz, and the tahfidz
    // dimension must not read as a full 100.
    primeEmpty();
    mockPrisma.tahfidzRecord.findMany.mockResolvedValue([{ id: 't1', studentId: 's1', juz: 30 }]);
    mockPrisma.tahfidzRecord.groupBy.mockResolvedValue([
      { studentId: 's1', juz: 30, _sum: { totalAyah: 6 } },
    ]);

    const result = await parentService.getDashboardSummary('p1');

    const entry = result.children[0];
    // 6 of juz 30's 564 ayat = 0.0106… → 0.01, never 30.
    expect(entry.memorizedJuz).toBe(0.01);
    expect(entry.memorizedJuz).not.toBe(30);
    // The only dimension with data is a sliver of a juz, so the score is tiny.
    expect(entry.holisticScore).not.toBeNull();
    expect(entry.holisticScore).toBeLessThan(1);
  });

  it('does not let a murojaah of another juz change the hafalan figure (#869 review)', async () => {
    // Only ZIYADAH records count; the murojaah rows are not in the aggregate
    // the service reads (the mock's `groupBy` returns ZIYADAH sums only).
    primeEmpty();
    mockPrisma.tahfidzRecord.groupBy.mockResolvedValue([
      { studentId: 's1', juz: 28, _sum: { totalAyah: 137 } },
    ]);

    const result = await parentService.getDashboardSummary('p1');

    // A full juz 28 (137 ayat) is 1 juz, and a murojaah of juz 1 adds nothing.
    expect(result.children[0].memorizedJuz).toBe(1);
  });

  it('sums a partially-memorized juz as a fraction (#869 review)', async () => {
    primeEmpty();
    // Half of juz 29 (431 ayat) plus all of juz 30 (564 ayat) = 1.5 juz.
    mockPrisma.tahfidzRecord.groupBy.mockResolvedValue([
      { studentId: 's1', juz: 29, _sum: { totalAyah: 215.5 } },
      { studentId: 's1', juz: 30, _sum: { totalAyah: 564 } },
    ]);

    const result = await parentService.getDashboardSummary('p1');

    expect(result.children[0].memorizedJuz).toBe(1.5);
  });

  it('keeps boardingHarmonyScore null for a santri with no asrama placement', async () => {
    primeEmpty();
    // Data exists for the other dimensions, but there is no room assignment.
    mockPrisma.grade.groupBy.mockResolvedValue([{ studentId: 's1', _avg: { percentage: 80 } }]);

    const result = await parentService.getDashboardSummary('p1');

    expect(result.children[0].holisticScore).not.toBeNull();
    expect(result.children[0].boardingHarmonyScore).toBeNull();
  });
});
