import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyIbadahRecord: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    student: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { calculateStreak, getStudentAchievements, getMyAchievements } from './ibadah.service';

const mocked = prisma as unknown as {
  dailyIbadahRecord: {
    aggregate: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  student: { findFirst: ReturnType<typeof vi.fn> };
};

const day = (iso: string) => new Date(iso);

describe('calculateStreak', () => {
  const now = new Date('2026-07-04T10:00:00Z');

  it('counts consecutive days ending today', () => {
    expect(calculateStreak([day('2026-07-04'), day('2026-07-03'), day('2026-07-02')], now)).toBe(3);
  });

  it('keeps the streak alive when the latest record was yesterday', () => {
    expect(calculateStreak([day('2026-07-03'), day('2026-07-02')], now)).toBe(2);
  });

  it('breaks the streak on a gap and returns 0 when stale', () => {
    // Gap between 07-04 and 07-01 → only the head day counts
    expect(calculateStreak([day('2026-07-04'), day('2026-07-01')], now)).toBe(1);
    // Latest record 3 days ago → no active streak
    expect(calculateStreak([day('2026-07-01')], now)).toBe(0);
    expect(calculateStreak([], now)).toBe(0);
  });
});

describe('calculateStreak on the WIB calendar day', () => {
  // 2026-07-04T22:00:00Z == 2026-07-05 05:00 WIB, inside the 00:00-06:59 WIB
  // window where the UTC and WIB calendar days differ.
  const now = new Date('2026-07-04T22:00:00Z');

  it('returns 0 when the latest record is two WIB days ago', () => {
    // WIB day of `now` is 2026-07-05; latest record 2026-07-03 is two days back.
    expect(calculateStreak([day('2026-07-03')], now)).toBe(0);
  });

  it('counts a record of the previous WIB day as one day back', () => {
    expect(calculateStreak([day('2026-07-04')], now)).toBe(1);
  });

  it('counts the whole WIB run ending yesterday', () => {
    expect(calculateStreak([day('2026-07-04'), day('2026-07-03'), day('2026-07-02')], now)).toBe(3);
  });

  it('reads the WIB day up to 23:59 and switches at 00:00 WIB', () => {
    // 2026-07-04T16:59:00Z == 2026-07-04 23:59 WIB — still 07-04.
    expect(calculateStreak([day('2026-07-04')], new Date('2026-07-04T16:59:00Z'))).toBe(1);
    // 2026-07-04T17:00:00Z == 2026-07-05 00:00 WIB — now 07-05, so 07-04 is yesterday.
    expect(calculateStreak([day('2026-07-04')], new Date('2026-07-04T17:00:00Z'))).toBe(1);
    // 07-04 is two days back once the WIB day is 07-06.
    expect(calculateStreak([day('2026-07-04')], new Date('2026-07-05T17:00:00Z'))).toBe(0);
  });
});

describe('getStudentAchievements', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives points, level, and badges from real records only', async () => {
    mocked.dailyIbadahRecord.aggregate.mockResolvedValue({
      _sum: { pointsEarned: 1100, bonusEarned: 150 },
    });
    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mocked.dailyIbadahRecord.findMany.mockResolvedValue([{ date: today }, { date: yesterday }]);

    const result = await getStudentAchievements('student-1');

    expect(result.totalPoints).toBe(1250);
    expect(result.level).toBe(2); // 1250 / 1000 + 1
    expect(result.currentStreak).toBe(2);
    expect(result.badges.map((b) => b.id)).toEqual(
      expect.arrayContaining(['mubtadi', 'mutawassith'])
    );
    // No streak badges with only a 2-day streak
    expect(result.badges.map((b) => b.id)).not.toContain('weekly-istiqomah');
    expect(result.nextLevelAt).toBe(2000);
    expect(result.progressToNextLevel).toBe(25);
  });

  it('returns zeroed achievements for a student without records', async () => {
    mocked.dailyIbadahRecord.aggregate.mockResolvedValue({
      _sum: { pointsEarned: null, bonusEarned: null },
    });
    mocked.dailyIbadahRecord.findMany.mockResolvedValue([]);

    const result = await getStudentAchievements('student-2');

    expect(result).toMatchObject({
      totalPoints: 0,
      currentStreak: 0,
      level: 1,
      badges: [],
    });
  });
});

describe('getMyAchievements', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when the user has no student profile', async () => {
    mocked.student.findFirst.mockResolvedValue(null);
    expect(await getMyAchievements('user-without-student')).toBeNull();
  });
});
