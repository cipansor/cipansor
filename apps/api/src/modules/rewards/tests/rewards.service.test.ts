import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reward: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    violation: { aggregate: vi.fn() },
    student: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  createReward,
  getRewards,
  getRewardById,
  updateReward,
  deleteReward,
  getRewardCategories,
  getRewardCategoryById,
  getStudentRewardSummary,
  getStudentPointBalance,
  getTopStudentsByPoints,
} from '../rewards.service';
import type { ScopeActor } from '@/utils/student-scope';

const mocked = prisma as unknown as {
  reward: Record<string, ReturnType<typeof vi.fn>>;
  violation: Record<string, ReturnType<typeof vi.fn>>;
  student: Record<string, ReturnType<typeof vi.fn>>;
};

/** A teacher in SD IT — reaches only their own unit's santri. */
const teacher: ScopeActor = { sub: 'teacher-1', roleCode: 'SDIT_GURU', unitId: 'unit-1' };
/** A santri — reaches only themselves. */
const santri: ScopeActor = { sub: 'santri-user-1', roleCode: 'SDIT_SISWA', unitId: 'unit-1' };
/** A wali — reaches their own children. */
const parent: ScopeActor = { sub: 'parent-1', roleCode: 'SDIT_ORANG_TUA', unitId: 'unit-1' };

const studentId = '11111111-1111-1111-1111-111111111111';

// What `STUDENT_SUMMARY_SELECT` returns for one santri (utils/student-summary.ts).
const summaryStudent = {
  id: studentId,
  nis: '2024001',
  photoUrl: null,
  user: { id: 'user-s1', name: 'Ahmad Santri' },
  unit: { id: 'unit-1', name: 'SD IT', type: 'SD' },
  enrollments: [{ class: { id: 'class-1', name: '4A' } }],
};
const SUMMARY_KEYS = ['enrollments', 'id', 'nis', 'photoUrl', 'unit', 'user'];

describe('rewards service — unit scope (CWE-863)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.student.findFirst.mockResolvedValue({ id: studentId });
  });

  it('scopes the list to the caller\u2019s unit whatever studentId is asked for', async () => {
    mocked.reward.findMany.mockResolvedValue([]);
    mocked.reward.count.mockResolvedValue(0);

    await getRewards({ page: 1, limit: 20, studentId }, teacher);

    const where = mocked.reward.findMany.mock.calls[0][0].where;
    expect(where.student).toEqual({ unitId: 'unit-1' });
    expect(where.studentId).toBe(studentId);
  });

  it('scopes a santri to their own rows', async () => {
    mocked.reward.findMany.mockResolvedValue([]);
    mocked.reward.count.mockResolvedValue(0);

    await getRewards({ page: 1, limit: 20 }, santri);

    const where = mocked.reward.findMany.mock.calls[0][0].where;
    expect(where.student).toEqual({ userId: 'santri-user-1' });
  });

  it('scopes a wali to their own children', async () => {
    mocked.reward.findMany.mockResolvedValue([]);
    mocked.reward.count.mockResolvedValue(0);

    await getRewards({ page: 1, limit: 20 }, parent);

    const where = mocked.reward.findMany.mock.calls[0][0].where;
    expect(where.student).toEqual({ parents: { some: { parentId: 'parent-1' } } });
  });

  it('ANDs the row id with the caller\u2019s scope on a detail read', async () => {
    mocked.reward.findFirst.mockResolvedValue(null);
    await getRewardById('reward-other', teacher);

    const where = mocked.reward.findFirst.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ id: 'reward-other' });
    expect(where.AND[1].student).toEqual({ unitId: 'unit-1' });
  });

  it('404s an update of a row outside the caller\u2019s reach instead of writing it', async () => {
    mocked.reward.findFirst.mockResolvedValue(null);
    await expect(updateReward('reward-other', { points: 5 }, teacher)).resolves.toBeNull();
    expect(mocked.reward.update).not.toHaveBeenCalled();
  });

  it('deletes nothing outside the caller\u2019s reach', async () => {
    mocked.reward.findFirst.mockResolvedValue(null);
    await expect(deleteReward('reward-other', teacher)).resolves.toBe(false);
    expect(mocked.reward.delete).not.toHaveBeenCalled();
  });

  it('scopes the category list to the caller\u2019s unit and reports the points its rows carry', async () => {
    mocked.reward.groupBy.mockResolvedValue([{ category: 'tahfidz', points: 10, _count: 2 }]);

    await expect(getRewardCategories(teacher)).resolves.toEqual([
      { id: 'tahfidz', name: 'Tahfidz', category: 'TAHFIDZ', points: 10, isActive: true },
    ]);
    expect(mocked.reward.groupBy.mock.calls[0][0].where).toEqual({
      student: { unitId: 'unit-1' },
    });
  });

  it('defaults a category to the points its largest group uses, not its last group', async () => {
    // groupBy yields one row per (category, points) in descending count order;
    // a category of twenty 10-point rows and one 0-point row must seed new
    // rewards with 10, not 0.
    mocked.reward.groupBy.mockResolvedValue([
      { category: 'tahfidz', points: 10, _count: 20 },
      { category: 'tahfidz', points: 0, _count: 1 },
    ]);

    await expect(getRewardCategories(teacher)).resolves.toEqual([
      { id: 'tahfidz', name: 'Tahfidz', category: 'TAHFIDZ', points: 10, isActive: true },
    ]);
  });

  it('scopes the category detail to the caller\u2019s unit', async () => {
    mocked.reward.aggregate.mockResolvedValue({ _count: 0 });

    await expect(getRewardCategoryById('tahfidz', teacher)).resolves.toBeNull();

    const where = mocked.reward.aggregate.mock.calls[0][0].where;
    expect(where.student).toEqual({ unitId: 'unit-1' });
    expect(where.category).toEqual({ equals: 'tahfidz', mode: 'insensitive' });
  });

  it('scopes the leaderboard to the caller\u2019s unit', async () => {
    mocked.reward.groupBy.mockResolvedValue([]);
    mocked.student.findMany.mockResolvedValue([]);

    await getTopStudentsByPoints(teacher, 10);

    expect(mocked.reward.groupBy.mock.calls[0][0].where).toEqual({
      student: { unitId: 'unit-1' },
    });
  });

  it('refuses to record a reward for a santri outside the caller\u2019s reach', async () => {
    mocked.student.findFirst.mockResolvedValue(null);

    await expect(
      createReward(
        { studentId, category: 'tahfidz', description: 'Hafal juz 30', points: 10 },
        'teacher-1',
        teacher
      )
    ).rejects.toThrow(/student/i);
    expect(mocked.reward.create).not.toHaveBeenCalled();
  });

  it('refuses a per-santri summary for a santri outside the caller\u2019s reach', async () => {
    mocked.student.findFirst.mockResolvedValue(null);
    await expect(getStudentRewardSummary(studentId, teacher)).rejects.toThrow(/student/i);
    expect(mocked.reward.findMany).not.toHaveBeenCalled();
  });

  it('refuses a point balance for a santri outside the caller\u2019s reach', async () => {
    mocked.student.findFirst.mockResolvedValue(null);
    await expect(getStudentPointBalance(studentId, teacher)).rejects.toThrow(/student/i);
    expect(mocked.reward.aggregate).not.toHaveBeenCalled();
  });
});

describe('rewards service — behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.student.findFirst.mockResolvedValue({ id: studentId });
  });

  it('paginates and reports the total', async () => {
    mocked.reward.findMany.mockResolvedValue([{ id: 'a', student: summaryStudent }]);
    mocked.reward.count.mockResolvedValue(11);

    const result = await getRewards({ page: 2, limit: 2 }, teacher);

    expect(result.meta).toEqual({ page: 2, limit: 2, total: 11, totalPages: 6 });
    expect(mocked.reward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 2, take: 2 })
    );
  });

  it('filters an exact category via categoryId', async () => {
    mocked.reward.findMany.mockResolvedValue([]);
    mocked.reward.count.mockResolvedValue(0);

    await getRewards({ page: 1, limit: 20, categoryId: 'tahfidz' }, teacher);

    expect(mocked.reward.findMany.mock.calls[0][0].where.category).toEqual({
      equals: 'tahfidz',
      mode: 'insensitive',
    });
  });

  it('returns a balance that subtracts violations from rewards', async () => {
    mocked.reward.aggregate.mockResolvedValue({ _sum: { points: 30 } });
    mocked.violation.aggregate.mockResolvedValue({ _sum: { points: 10 } });

    await expect(getStudentPointBalance(studentId, teacher)).resolves.toEqual({
      earned: 30,
      deducted: 10,
      balance: 20,
    });
  });
});

describe('rewards service — names the santri, nothing more', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.student.findFirst.mockResolvedValue({ id: studentId });
    mocked.reward.findMany.mockResolvedValue([{ id: 'reward-1', student: summaryStudent }]);
    mocked.reward.count.mockResolvedValue(1);
    mocked.reward.findFirst.mockResolvedValue({ id: 'reward-1', student: summaryStudent });
    mocked.reward.create.mockResolvedValue({ id: 'reward-1', student: summaryStudent });
    mocked.reward.update.mockResolvedValue({ id: 'reward-1', student: summaryStudent });
  });

  it('selects only the summary columns of the santri on every read and write', async () => {
    await getRewards({ page: 1, limit: 20 }, teacher);
    await getRewardById('reward-1', teacher);
    await createReward(
      { studentId, category: 'tahfidz', description: 'Hafal juz 30', points: 10 },
      'teacher-1',
      teacher
    );
    await updateReward('reward-1', { description: 'Hafal juz 29 dan 30' }, teacher);

    const calls = [
      mocked.reward.findMany.mock.calls[0][0],
      mocked.reward.findFirst.mock.calls[0][0],
      mocked.reward.create.mock.calls[0][0],
      mocked.reward.update.mock.calls[0][0],
    ];
    for (const call of calls) {
      // `include` on the relation would send every column of the santri row.
      expect(call.include.student.include).toBeUndefined();
      expect(Object.keys(call.include.student.select).sort()).toEqual(SUMMARY_KEYS);
    }
  });

  it('puts the name and the active class at the top of the santri', async () => {
    const { data } = await getRewards({ page: 1, limit: 20 }, teacher);
    const one = await getRewardById('reward-1', teacher);

    for (const row of [data[0], one]) {
      expect(row?.student).toEqual({
        id: studentId,
        nis: '2024001',
        photoUrl: null,
        user: { id: 'user-s1', name: 'Ahmad Santri' },
        unit: { id: 'unit-1', name: 'SD IT', type: 'SD' },
        name: 'Ahmad Santri',
        class: { id: 'class-1', name: '4A' },
      });
    }
  });

  it('answers null for a row outside the caller\u2019s reach, not an empty santri', async () => {
    mocked.reward.findFirst.mockResolvedValue(null);
    await expect(getRewardById('reward-1', teacher)).resolves.toBeNull();
  });
});
