import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendanceFollowUpChannel, AttendanceFollowUpOutcome } from '@prisma/client';
import {
  ATTENDANCE_FOLLOW_UP_CHANNELS,
  ATTENDANCE_FOLLOW_UP_OUTCOMES,
  ATTENDANCE_NOTES_MAX,
} from '@cipansor/shared';

// The second tier of the attendance follow-up (decisions/absensi-harian.md):
// an Alpa with no reason is followed up by the santri mukim's musyrif, or by
// the wali kelas of everyone else — a santri mukim with no musyrif on record
// included, so no Alpa is left with nobody. A reason changes the mark; "no
// reason" closes it; "could not reach" leaves it open.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    class: { findMany: vi.fn() },
    attendance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn((args) => ({ op: 'update', args })),
    },
    attendanceFollowUp: { create: vi.fn((args) => ({ op: 'create', args })) },
    $transaction: vi.fn(async (ops) => ops),
  },
}));
vi.mock('@/modules/dormitories', () => ({
  boardersOfMusyrif: vi.fn(),
  musyrifOfBoarders: vi.fn(),
}));
vi.mock('@/utils/wib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/wib')>()),
  todayWib: () => '2026-09-28',
}));

import { prisma } from '@/lib/prisma';
import { boardersOfMusyrif, musyrifOfBoarders } from '@/modules/dormitories';
import {
  listFollowUps,
  openAbsencesByOwner,
  recordFollowUp,
} from '../attendance-follow-up.service';

const WALI_KELAS = { sub: 'u-wali-kelas', roleCode: 'SDIT_GURU', unitId: 'unit-sd' };
const MUSYRIF = { sub: 'u-musyrif', roleCode: 'MUSYRIF', unitId: 'unit-pesantren' };

const row = (id: string, studentId: string, extra: Record<string, unknown> = {}) => ({
  id,
  date: new Date('2026-09-28T00:00:00.000Z'),
  studentId,
  status: 'ABSENT',
  student: {
    id: studentId,
    nis: `nis-${studentId}`,
    parentName: 'Kontak Pendaftaran',
    parentPhone: '081200000000',
    user: { name: `Nama ${studentId}` },
    parents: [{ relation: 'mother', parent: { name: 'Ibu', phone: '081211111111' } }],
  },
  class: { id: 'class-1a', name: '1A' },
  followUps: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: 'class-1a' }] as never);
  vi.mocked(boardersOfMusyrif).mockResolvedValue([]);
  vi.mocked(musyrifOfBoarders).mockResolvedValue(new Map());
});

describe('the vocabulary', () => {
  it('is the database enums, in the shared contract', () => {
    expect([...ATTENDANCE_FOLLOW_UP_CHANNELS].sort()).toEqual(
      Object.values(AttendanceFollowUpChannel).sort()
    );
    expect([...ATTENDANCE_FOLLOW_UP_OUTCOMES].sort()).toEqual(
      Object.values(AttendanceFollowUpOutcome).sort()
    );
  });
});

describe('GET /attendance/follow-ups', () => {
  it('asks nothing of the register for someone who is neither wali kelas nor musyrif', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([]);
    expect(await listFollowUps(WALI_KELAS)).toEqual([]);
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  it('asks for open Alpa of the last 7 days in their classes and of their boarders', async () => {
    vi.mocked(boardersOfMusyrif).mockResolvedValue(['boarder']);
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([]);
    await listFollowUps(WALI_KELAS);

    const where = vi.mocked(prisma.attendance.findMany).mock.calls[0][0]?.where;
    expect(where).toMatchObject({
      status: 'ABSENT',
      // 2026-09-22 … 2026-09-28: seven calendar days, today included.
      date: { gte: new Date('2026-09-22T00:00:00.000Z') },
      followUps: { none: { outcome: 'NO_REASON' } },
      OR: [{ classId: { in: ['class-1a'] } }, { studentId: { in: ['boarder'] } }],
    });
  });

  it('leaves a santri mukim who has a musyrif to the musyrif, not the wali kelas', async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([
      row('a-day', 'day-pupil'),
      row('a-boarder', 'boarder-with-musyrif'),
      row('a-orphan', 'boarder-without-musyrif'),
    ] as never);
    vi.mocked(musyrifOfBoarders).mockResolvedValue(
      new Map([
        ['boarder-with-musyrif', [{ id: 'u-musyrif', name: 'Ustadz Hasan' }]],
        ['boarder-without-musyrif', []],
      ])
    );

    const items = await listFollowUps(WALI_KELAS);
    expect(items.map((i) => [i.attendanceId, i.as])).toEqual([
      ['a-day', 'WALI_KELAS'],
      ['a-orphan', 'WALI_KELAS'],
    ]);
  });

  it("gives the musyrif their boarders, whoever the class's wali kelas is", async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([]);
    vi.mocked(boardersOfMusyrif).mockResolvedValue(['boarder']);
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([row('a-1', 'boarder')] as never);

    const [item] = await listFollowUps(MUSYRIF);
    expect(item).toMatchObject({
      attendanceId: 'a-1',
      date: '2026-09-28',
      as: 'MUSYRIF',
      student: { id: 'boarder', name: 'Nama boarder', nis: 'nis-boarder' },
      class: { id: 'class-1a', name: '1A' },
    });
  });

  it('lists the linked walis, then the enrolment contact unless it is one of them', async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([
      row('a-1', 'p1'),
      row('a-2', 'p2', {
        student: {
          ...row('x', 'p2').student,
          parentPhone: '081211111111', // the mother's own number
        },
      }),
    ] as never);

    const [first, second] = await listFollowUps(WALI_KELAS);
    expect(first.walis).toEqual([
      { name: 'Ibu', phone: '081211111111', relation: 'mother' },
      { name: 'Kontak Pendaftaran', phone: '081200000000', relation: 'contact' },
    ]);
    expect(second.walis).toEqual([{ name: 'Ibu', phone: '081211111111', relation: 'mother' }]);
  });
});

describe('POST /attendance/:id/follow-ups', () => {
  const ownRow = (extra: Record<string, unknown> = {}) => {
    const r = row('a-1', 'day-pupil', extra);
    vi.mocked(prisma.attendance.findFirst).mockResolvedValue(r as never);
    vi.mocked(prisma.attendance.findUniqueOrThrow).mockResolvedValue(r as never);
    return r;
  };

  it("is not found for an absence that is not the caller's, and writes nothing", async () => {
    vi.mocked(prisma.attendance.findFirst).mockResolvedValue(null);
    await expect(
      recordFollowUp('a-1', { channel: 'PHONE', outcome: 'ILL' }, WALI_KELAS)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is not found for the wali kelas once the pupil's musyrif follows them up", async () => {
    ownRow();
    vi.mocked(musyrifOfBoarders).mockResolvedValue(
      new Map([['day-pupil', [{ id: 'u-musyrif', name: 'Ustadz Hasan' }]]])
    );
    await expect(
      recordFollowUp('a-1', { channel: 'PHONE', outcome: 'ILL' }, WALI_KELAS)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['no longer Alpa', { status: 'SICK' }],
    ['already closed as Alpa', { followUps: [{ outcome: 'NO_REASON' }] }],
    ['older than 7 days', { date: new Date('2026-09-21T00:00:00.000Z') }],
  ])('is a conflict when the absence is %s', async (_what, extra) => {
    ownRow(extra);
    await expect(
      recordFollowUp('a-1', { channel: 'PHONE', outcome: 'ILL' }, WALI_KELAS)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['ILL', 'SICK', 'Tindak lanjut: sakit — demam'],
    ['EXCUSED', 'EXCUSED', 'Tindak lanjut: izin — demam'],
  ] as const)('%s logs the contact and makes the mark %s', async (outcome, status, notes) => {
    ownRow();
    await recordFollowUp('a-1', { channel: 'WHATSAPP', outcome, note: 'demam' }, WALI_KELAS);

    const [ops] = vi.mocked(prisma.$transaction).mock.calls[0] as unknown as [unknown[]];
    expect(ops).toEqual([
      {
        op: 'create',
        args: {
          data: {
            attendanceId: 'a-1',
            contactedById: 'u-wali-kelas',
            channel: 'WHATSAPP',
            outcome,
            note: 'demam',
          },
        },
      },
      {
        op: 'update',
        args: { where: { id: 'a-1' }, data: { status, notes, recordedById: 'u-wali-kelas' } },
      },
    ]);
  });

  it('keeps what the teacher wrote on the mark, and adds the follow-up after it', async () => {
    ownRow({ notes: 'Tidak ada kabar pagi ini' });
    await recordFollowUp('a-1', { channel: 'PHONE', outcome: 'EXCUSED' }, WALI_KELAS);
    expect(prisma.attendance.update).toHaveBeenCalledWith({
      where: { id: 'a-1' },
      data: {
        status: 'EXCUSED',
        notes: 'Tidak ada kabar pagi ini · Tindak lanjut: izin',
        recordedById: 'u-wali-kelas',
      },
    });
  });

  it("keeps the mark's note within what the register takes back; the log keeps it whole", async () => {
    ownRow({ notes: 'x'.repeat(400) });
    const long = 'y'.repeat(300);
    await recordFollowUp('a-1', { channel: 'PHONE', outcome: 'ILL', note: long }, WALI_KELAS);
    const notes = vi.mocked(prisma.attendance.update).mock.calls[0][0].data.notes as string;
    expect(notes).toHaveLength(ATTENDANCE_NOTES_MAX);
    expect(notes.endsWith('…')).toBe(true);
    expect(prisma.attendanceFollowUp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: long }),
    });
  });

  it.each(['NO_REASON', 'UNREACHABLE'] as const)(
    '%s logs the contact and leaves the mark Alpa',
    async (outcome) => {
      ownRow();
      await recordFollowUp('a-1', { channel: 'PHONE', outcome }, WALI_KELAS);
      const [ops] = vi.mocked(prisma.$transaction).mock.calls[0] as unknown as [unknown[]];
      expect(ops).toHaveLength(1);
      expect(prisma.attendance.update).not.toHaveBeenCalled();
    }
  );
});

describe('the afternoon reminder', () => {
  it("counts today's open Alpa per musyrif, else per wali kelas", async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([
      { studentId: 'day-1', class: { homeroomTeacher: { userId: 'u-wali-1a' } } },
      { studentId: 'day-2', class: { homeroomTeacher: { userId: 'u-wali-1a' } } },
      { studentId: 'boarder', class: { homeroomTeacher: { userId: 'u-wali-1a' } } },
      { studentId: 'orphan', class: { homeroomTeacher: { userId: 'u-wali-7a' } } },
      { studentId: 'no-wali-kelas', class: { homeroomTeacher: null } },
    ] as never);
    vi.mocked(musyrifOfBoarders).mockResolvedValue(
      new Map([
        ['boarder', [{ id: 'u-musyrif', name: 'Ustadz Hasan' }]],
        ['orphan', []],
      ])
    );

    const counts = await openAbsencesByOwner('2026-09-28');
    expect(Object.fromEntries(counts)).toEqual({
      'u-wali-1a': 2,
      'u-musyrif': 1,
      'u-wali-7a': 1,
    });
    expect(vi.mocked(prisma.attendance.findMany).mock.calls[0][0]?.where).toMatchObject({
      status: 'ABSENT',
      date: new Date('2026-09-28T00:00:00.000Z'),
      followUps: { none: { outcome: 'NO_REASON' } },
    });
  });

  it('asks nothing more on a day with no open Alpa', async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([]);
    expect((await openAbsencesByOwner('2026-09-28')).size).toBe(0);
    expect(musyrifOfBoarders).not.toHaveBeenCalled();
  });
});
