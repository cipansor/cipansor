import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    class: { findMany: vi.fn() },
    schedule: { findMany: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    classEnrollment: { findMany: vi.fn() },
    tahfidzRecord: { count: vi.fn(), findMany: vi.fn() },
    tahfidzTarget: { findMany: vi.fn() },
    academicYear: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/dashboard-metrics', () => ({
  getCurrentDashboardMetrics: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { dashboardService } from './dashboard.service';

const mocked = prisma as unknown as {
  class: { findMany: ReturnType<typeof vi.fn> };
  schedule: { findMany: ReturnType<typeof vi.fn> };
  teacherSubject: { findMany: ReturnType<typeof vi.fn> };
  classEnrollment: { findMany: ReturnType<typeof vi.fn> };
  tahfidzRecord: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  tahfidzTarget: { findMany: ReturnType<typeof vi.fn> };
  academicYear: { findFirst: ReturnType<typeof vi.fn> };
};

const TEACHER = 'teacher-1';
const USER = 'user-1';

/**
 * `class.findMany` is called twice with different shapes — once to collect the
 * homeroom class ids, once to build the class summaries — so the two have to
 * be queued in order rather than given a single resolved value.
 */
function arrange(
  opts: {
    homeroom?: Array<{ id: string }>;
    scheduled?: Array<{ classId: string }>;
    assigned?: Array<{ classId: string }>;
    enrolled?: Array<{ studentId: string }>;
    counts?: [number, number, number, number];
    classSummaries?: unknown[];
    todaySchedule?: unknown[];
    recentSetoran?: unknown[];
    activeYear?: { id: string } | null;
    targets?: Array<{ studentId: string; targetJuz: number }>;
    juzRecords?: Array<{ studentId: string; juz: number }>;
  } = {}
) {
  const [today, yesterday, week, month] = opts.counts ?? [0, 0, 0, 0];

  mocked.class.findMany
    .mockResolvedValueOnce(opts.homeroom ?? [])
    .mockResolvedValueOnce(opts.classSummaries ?? []);
  mocked.schedule.findMany
    .mockResolvedValueOnce(opts.scheduled ?? [])
    .mockResolvedValueOnce(opts.todaySchedule ?? []);
  mocked.teacherSubject.findMany.mockResolvedValue(opts.assigned ?? []);
  mocked.classEnrollment.findMany.mockResolvedValue(opts.enrolled ?? []);
  mocked.tahfidzRecord.count
    .mockResolvedValueOnce(today)
    .mockResolvedValueOnce(yesterday)
    .mockResolvedValueOnce(week)
    .mockResolvedValueOnce(month);
  mocked.tahfidzRecord.findMany
    .mockResolvedValueOnce(opts.recentSetoran ?? [])
    .mockResolvedValueOnce(opts.juzRecords ?? []);
  mocked.academicYear.findFirst.mockResolvedValue(
    opts.activeYear === undefined ? { id: 'ay-1' } : opts.activeYear
  );
  mocked.tahfidzTarget.findMany.mockResolvedValue(opts.targets ?? []);
}

describe('dashboardService.getTeacherStats — scoping', () => {
  // resetAllMocks, not clearAllMocks: clear leaves queued
  // mockResolvedValueOnce values in place, so an unconsumed value from one
  // test would be handed to the next.
  beforeEach(() => vi.resetAllMocks());

  it('counts each class once when a teacher reaches it three different ways', async () => {
    // Homeroom of c1; also timetabled in c1 and c2; also subject-assigned to c1.
    arrange({
      homeroom: [{ id: 'c1' }],
      scheduled: [{ classId: 'c1' }, { classId: 'c2' }],
      assigned: [{ classId: 'c1' }],
      enrolled: [{ studentId: 's1' }, { studentId: 's2' }],
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.totalClasses).toBe(2);
    expect(stats.totalStudents).toBe(2);
    expect(mocked.classEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classId: { in: ['c1', 'c2'] }, status: 'active' },
      })
    );
  });

  it('counts setoran the teacher recorded, not setoran by their students', async () => {
    arrange({ homeroom: [{ id: 'c1' }], counts: [3, 5, 11, 40] });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.setoranToday).toBe(3);
    expect(stats.setoranYesterday).toBe(5);
    expect(stats.weeklySetoranCount).toBe(11);
    expect(stats.monthlySetoranCount).toBe(40);
    for (const call of mocked.tahfidzRecord.count.mock.calls) {
      expect(call[0].where).toMatchObject({ recordedById: USER });
    }
  });

  it('returns an empty dashboard for a teacher with no classes, without querying enrollments', async () => {
    arrange();

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.totalClasses).toBe(0);
    expect(stats.totalStudents).toBe(0);
    expect(stats.classes).toEqual([]);
    expect(mocked.classEnrollment.findMany).not.toHaveBeenCalled();
  });

  it('ignores subject assignments that carry no class', async () => {
    // classId: null means "every class for this subject" and names no class.
    arrange({ assigned: [] });

    await dashboardService.getTeacherStats(TEACHER, USER);

    expect(mocked.teacherSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classId: { not: null } }),
      })
    );
  });
});

describe('dashboardService.getTeacherStats — targetAchievement', () => {
  // resetAllMocks, not clearAllMocks: clear leaves queued
  // mockResolvedValueOnce values in place, so an unconsumed value from one
  // test would be handed to the next.
  beforeEach(() => vi.resetAllMocks());

  it('is null, not 0, when no student has a target', async () => {
    arrange({
      homeroom: [{ id: 'c1' }],
      enrolled: [{ studentId: 's1' }],
      targets: [],
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.targetAchievement).toBeNull();
    expect(stats.studentsWithTarget).toBe(0);
  });

  it('is null when there is no active academic year', async () => {
    arrange({
      homeroom: [{ id: 'c1' }],
      enrolled: [{ studentId: 's1' }],
      activeYear: null,
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);
    expect(stats.targetAchievement).toBeNull();
  });

  it('averages progress across students with a target', async () => {
    // s1: 3 of 6 juz = 50%. s2: 1 of 4 juz = 25%. Mean = 37.5% -> 38.
    arrange({
      homeroom: [{ id: 'c1' }],
      enrolled: [{ studentId: 's1' }, { studentId: 's2' }],
      targets: [
        { studentId: 's1', targetJuz: 6 },
        { studentId: 's2', targetJuz: 4 },
      ],
      juzRecords: [
        { studentId: 's1', juz: 30 },
        { studentId: 's1', juz: 29 },
        { studentId: 's1', juz: 28 },
        { studentId: 's2', juz: 30 },
      ],
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.targetAchievement).toBe(38);
    expect(stats.studentsWithTarget).toBe(2);
  });

  it('caps a student who is past their target so they cannot mask a class that is behind', async () => {
    // s1: 8 of 2 juz would be 400%; capped at 100%. s2: 0 of 10 = 0%.
    // Mean must be 50%, not 200%.
    arrange({
      homeroom: [{ id: 'c1' }],
      enrolled: [{ studentId: 's1' }, { studentId: 's2' }],
      targets: [
        { studentId: 's1', targetJuz: 2 },
        { studentId: 's2', targetJuz: 10 },
      ],
      juzRecords: Array.from({ length: 8 }, (_, i) => ({ studentId: 's1', juz: i + 1 })),
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);
    expect(stats.targetAchievement).toBe(50);
  });
});

describe('dashboardService.getTeacherStats — shape', () => {
  // resetAllMocks, not clearAllMocks: clear leaves queued
  // mockResolvedValueOnce values in place, so an unconsumed value from one
  // test would be handed to the next.
  beforeEach(() => vi.resetAllMocks());

  it('marks which classes the teacher is homeroom of', async () => {
    arrange({
      homeroom: [{ id: 'c1' }],
      scheduled: [{ classId: 'c2' }],
      classSummaries: [
        {
          id: 'c1',
          name: '1A',
          level: '1',
          homeroomTeacherId: TEACHER,
          _count: { enrollments: 12 },
        },
        {
          id: 'c2',
          name: '2B',
          level: '2',
          homeroomTeacherId: 'other',
          _count: { enrollments: 9 },
        },
      ],
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.classes).toEqual([
      { id: 'c1', name: '1A', level: '1', studentCount: 12, isHomeroom: true },
      { id: 'c2', name: '2B', level: '2', studentCount: 9, isHomeroom: false },
    ]);
  });

  it('passes the setoran score through untouched, including when unscored', async () => {
    arrange({
      homeroom: [{ id: 'c1' }],
      recentSetoran: [
        {
          id: 'r1',
          surahName: 'Al-Baqarah',
          juz: 1,
          ayahStart: 1,
          ayahEnd: 20,
          activityType: 'ZIYADAH',
          score: null,
          recordedAt: new Date('2026-07-31T02:00:00Z'),
          student: { user: { name: 'Santri A' }, enrollments: [{ class: { name: '1A' } }] },
        },
      ],
    });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);

    expect(stats.recentSetoran).toHaveLength(1);
    // Not defaulted to a grade the record does not carry.
    expect(stats.recentSetoran[0].score).toBeNull();
    expect(stats.recentSetoran[0].studentName).toBe('Santri A');
    expect(stats.recentSetoran[0].className).toBe('1A');
  });

  it('returns today’s timetable rather than a fallback when the day is empty', async () => {
    arrange({ homeroom: [{ id: 'c1' }], todaySchedule: [] });

    const stats = await dashboardService.getTeacherStats(TEACHER, USER);
    expect(stats.todaySchedule).toEqual([]);
  });
});

describe('dashboardService.getTeacherStats — “today” is the WIB day', () => {
  beforeEach(() => vi.resetAllMocks());

  afterEach(() => vi.useRealTimers());

  it('asks for the WIB weekday, not the UTC weekday, early in the WIB morning', async () => {
    // 2026-10-29T22:30Z is Friday 30 October 05:30 WIB. A UTC server that reads
    // `new Date().getDay()` would ask for THURSDAY and show the previous day's
    // lessons during the whole 00:00–06:59 WIB window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T22:30:00.000Z'));

    arrange({ homeroom: [{ id: 'c1' }] });

    await dashboardService.getTeacherStats(TEACHER, USER);

    // The second `schedule.findMany` is today's timetable; the first collects
    // the teacher's class ids.
    const todayQuery = mocked.schedule.findMany.mock.calls[1][0];
    expect(todayQuery.where).toMatchObject({ dayOfWeek: 'FRIDAY' });
  });
});
