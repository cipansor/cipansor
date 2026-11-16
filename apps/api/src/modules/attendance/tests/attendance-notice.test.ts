import { describe, it, expect, vi, beforeEach } from 'vitest';

// The first tier of the attendance follow-up (decisions/absensi-harian.md):
// marked Alpa or Terlambat on today's register → the wali is told at once,
// and a santri mukim's musyrif too. Only a change is told, only today's
// register, and a failed notice never throws.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    class: { findUnique: vi.fn() },
    student: { findMany: vi.fn() },
    studentParent: { findMany: vi.fn() },
  },
}));
vi.mock('@/modules/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/modules/dormitories', () => ({ musyrifOfBoarders: vi.fn() }));
vi.mock('@/utils/wib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/wib')>()),
  todayWib: () => '2026-09-28',
}));

import { prisma } from '@/lib/prisma';
import { createNotification } from '@/modules/notifications';
import { musyrifOfBoarders } from '@/modules/dormitories';
import { marksToTell, tellAbsences } from '../attendance.notice';

const TODAY = '2026-09-28';
const CLASS = 'class-1a';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.class.findUnique).mockResolvedValue({ name: '1A' } as never);
  vi.mocked(prisma.student.findMany).mockResolvedValue([
    { id: 'day-pupil', user: { name: 'Ananda' } },
    { id: 'boarder', user: { name: 'Yusuf' } },
  ] as never);
  vi.mocked(prisma.studentParent.findMany).mockResolvedValue([
    { studentId: 'day-pupil', parentId: 'wali-ananda' },
    { studentId: 'boarder', parentId: 'wali-yusuf' },
  ] as never);
  vi.mocked(musyrifOfBoarders).mockResolvedValue(
    new Map([['boarder', [{ id: 'musyrif-1', name: 'Ustadz Hasan' }]]])
  );
  vi.mocked(createNotification).mockResolvedValue({} as never);
});

const to = (userId: string) =>
  vi.mocked(createNotification).mock.calls.filter(([n]) => n.userId === userId);

describe('which marks are news', () => {
  it('Alpa and Terlambat, when they are not what the day already had', () => {
    expect(
      marksToTell([
        { studentId: 'a', status: 'ABSENT' },
        { studentId: 'b', status: 'LATE', before: 'PRESENT' },
        { studentId: 'c', status: 'ABSENT', before: 'ABSENT' },
        { studentId: 'd', status: 'PRESENT', before: 'ABSENT' },
        { studentId: 'e', status: 'SICK' },
        { studentId: 'f', status: 'EXCUSED' },
      ]).map((m) => m.studentId)
    ).toEqual(['a', 'b']);
  });
});

describe('telling', () => {
  it('a day pupil marked Alpa: the wali, in the app and by email', async () => {
    await tellAbsences(CLASS, TODAY, [{ studentId: 'day-pupil', status: 'ABSENT' }]);
    expect(to('wali-ananda')).toHaveLength(1);
    const [notice] = to('wali-ananda')[0];
    expect(notice.channels).toEqual(['IN_APP', 'EMAIL']);
    expect(notice.message).toContain('Ananda tercatat tidak hadir tanpa keterangan (Alpa)');
    expect(notice.message).toContain('kelas 1A');
    expect(notice.data).toMatchObject({ studentId: 'day-pupil', classId: CLASS, date: TODAY });
    expect(to('musyrif-1')).toHaveLength(0);
  });

  it('a santri mukim marked Terlambat: the wali and the musyrif of their asrama', async () => {
    await tellAbsences(CLASS, TODAY, [{ studentId: 'boarder', status: 'LATE', before: 'PRESENT' }]);
    expect(to('wali-yusuf')).toHaveLength(1);
    expect(to('musyrif-1')).toHaveLength(1);
    const [notice] = to('musyrif-1')[0];
    expect(notice.channels).toEqual(['IN_APP']);
    expect(notice.message).toContain('santri mukim');
  });

  it('saving the day again with the same mark tells no one', async () => {
    await tellAbsences(CLASS, TODAY, [
      { studentId: 'boarder', status: 'ABSENT', before: 'ABSENT' },
    ]);
    expect(createNotification).not.toHaveBeenCalled();
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it('filling in an earlier day tells no one', async () => {
    await tellAbsences(CLASS, '2026-09-21', [{ studentId: 'day-pupil', status: 'ABSENT' }]);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('a notice that fails does not throw', async () => {
    vi.mocked(createNotification).mockRejectedValue(new Error('smtp down'));
    await expect(
      tellAbsences(CLASS, TODAY, [{ studentId: 'boarder', status: 'ABSENT' }])
    ).resolves.toBeUndefined();
  });

  it('a lookup that fails does not throw either', async () => {
    vi.mocked(prisma.studentParent.findMany).mockRejectedValue(new Error('db down'));
    await expect(
      tellAbsences(CLASS, TODAY, [{ studentId: 'boarder', status: 'ABSENT' }])
    ).resolves.toBeUndefined();
  });
});
