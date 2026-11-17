import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who reaches a class's homeroom data (decided 2026-09-26): its wali kelas —
// the teacher on `Class.homeroomTeacherId` — who writes notes while the
// class's academic year is the current one; the kepala sekolah and its admin
// unit and the super admin, who read. Another teacher of the same unit,
// and anyone of another unit, gets 404, as for a class that does not exist.

vi.mock('@/lib/prisma', () => {
  const prisma = {
    class: { findFirst: vi.fn(), findMany: vi.fn() },
    teacher: { findFirst: vi.fn() },
    student: { findFirst: vi.fn(), findMany: vi.fn() },
    classEnrollment: {
      findMany: vi.fn(async () => [{ studentId: '22222222-2222-4222-8222-222222222222' }]),
    },
    attendance: { groupBy: vi.fn() },
    grade: { findMany: vi.fn() },
    violation: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reward: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    tahfidzRecord: { findMany: vi.fn() },
  };
  return { prisma };
});

import { prisma } from '@/lib/prisma';
import { classAccess, studentAccess, viewerOf } from '../homeroom.access';
import { homeroomService } from '../homeroom.service';

type Mocked = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const db = prisma as unknown as Mocked;

const SD = 'unit-sd';
const SMP = 'unit-smp';
const DAY = 24 * 60 * 60 * 1000;
const thisYear = {
  startDate: new Date(Date.now() - 60 * DAY),
  endDate: new Date(Date.now() + 300 * DAY),
};
const lastYear = {
  startDate: new Date(Date.now() - 425 * DAY),
  endDate: new Date(Date.now() - 65 * DAY),
};

// Teacher rows: the wali kelas of 1A this year, and of 6A last year.
const TEACHER_OF: Record<string, string> = { 't-wali-1a': 'u-wali', 't-wali-6a': 'u-wali-lama' };
const class1A = { id: 'c-1a', unitId: SD, homeroomTeacherId: 't-wali-1a', academicYear: thisYear };
const class6A = { id: 'c-6a', unitId: SD, homeroomTeacherId: 't-wali-6a', academicYear: lastYear };

const wali = { sub: 'u-wali', role: 'TEACHER', roleCode: 'SDIT_GURU', unitId: SD };
const waliLama = { sub: 'u-wali-lama', role: 'TEACHER', roleCode: 'SDIT_GURU', unitId: SD };
const guruLain = { sub: 'u-guru', role: 'TEACHER', roleCode: 'SDIT_GURU', unitId: SD };
const kepala = { sub: 'u-kepala', role: 'TEACHER', roleCode: 'SDIT_KEPALA_SEKOLAH', unitId: SD };
const adminUnit = { sub: 'u-admin', role: 'UNIT_ADMIN', roleCode: 'SDIT_ADMIN', unitId: SD };
const superAdmin = { sub: 'u-sa', role: 'SUPER_ADMIN', roleCode: 'SUPER_ADMIN', unitId: null };
const kepalaSmp = {
  sub: 'u-kepala-smp',
  role: 'TEACHER',
  roleCode: 'SMPIT_KEPALA_SEKOLAH',
  unitId: SMP,
};
const ketua = { sub: 'u-ketua', role: 'UNIT_ADMIN', roleCode: 'YAYASAN_KETUA', unitId: null };

const PUPIL = '22222222-2222-4222-8222-222222222222';
/** A pupil of SD IT, enrolled in the given classes. */
const pupilIn = (...classes: (typeof class1A)[]) => ({
  unitId: SD,
  enrollments: classes.map((c) => ({ class: c })),
});

beforeEach(() => {
  vi.clearAllMocks();
  db.teacher.findFirst.mockImplementation(async ({ where }) =>
    TEACHER_OF[where.id] === where.userId ? { id: where.id } : null
  );
  db.class.findFirst.mockResolvedValue(class1A);
  db.student.findFirst.mockResolvedValue(pupilIn(class1A));
  db.reward.create.mockImplementation(async ({ data }) => ({ id: 'rw-1', ...data }));
  db.violation.create.mockImplementation(async ({ data }) => ({ id: 'v-1', ...data }));
});

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { statusCode?: number }) => e.statusCode
  );

describe('a class', () => {
  it('its wali kelas reads and writes, this academic year', async () => {
    const access = await classAccess('c-1a', wali);
    expect(viewerOf(access)).toEqual({ access: 'HOMEROOM', canWrite: true });
  });

  it("last year's class is read-only to its wali kelas", async () => {
    db.class.findFirst.mockResolvedValue(class6A);
    const access = await classAccess('c-6a', waliLama);
    expect(viewerOf(access)).toEqual({ access: 'HOMEROOM', canWrite: false });
  });

  it.each([
    ['the kepala sekolah', kepala],
    ['the admin unit', adminUnit],
    ['the super admin', superAdmin],
  ])('%s of its unit reads, and does not write', async (_who, actor) => {
    const access = await classAccess('c-1a', actor);
    expect(viewerOf(access)).toEqual({ access: 'OVERSEER', canWrite: false });
  });

  it.each([
    ['another teacher of the same unit', guruLain],
    ["another class's wali kelas", waliLama],
    ["another unit's kepala sekolah", kepalaSmp],
    ['a yayasan organ', ketua],
  ])('%s does not reach it: 404', async (_who, actor) => {
    await expect(classAccess('c-1a', actor)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Kelas tidak ditemukan',
    });
  });

  it('a class that does not exist is 404 too', async () => {
    db.class.findFirst.mockResolvedValue(null);
    expect(await status(classAccess('c-x', superAdmin))).toBe(404);
  });

  it('the dashboard tells the page how the caller stands, and lists pupils without their private columns', async () => {
    db.class.findFirst.mockImplementation(async ({ select }) =>
      select.enrollments
        ? {
            id: 'c-1a',
            name: '1A',
            enrollments: [
              {
                studentId: PUPIL,
                student: {
                  id: PUPIL,
                  nis: '1',
                  gender: 'MALE',
                  photoUrl: null,
                  user: { name: 'Ahmad' },
                },
              },
            ],
          }
        : class1A
    );
    db.attendance.groupBy.mockResolvedValue([]);
    db.grade.findMany.mockResolvedValue([]);
    db.violation.findMany.mockResolvedValue([]);
    db.violation.count.mockResolvedValue(0);
    db.reward.findMany.mockResolvedValue([]);
    db.tahfidzRecord.findMany.mockResolvedValue([]);
    db.student.findMany.mockResolvedValue([]);

    const dashboard = await homeroomService.getClassDashboard('c-1a', kepala);

    expect(dashboard.viewer).toEqual({ access: 'OVERSEER', canWrite: false });
    expect(dashboard.class).not.toHaveProperty('enrollments');
    const pupilSelect = db.class.findFirst.mock.calls
      .map(([arg]) => arg.select.enrollments?.select.student.select)
      .find(Boolean);
    expect(Object.keys(pupilSelect).sort()).toEqual(['gender', 'id', 'nis', 'photoUrl', 'user']);
  });
});

describe('a pupil', () => {
  it("is reached through this year's class, not last year's", async () => {
    db.student.findFirst.mockResolvedValue(pupilIn(class6A, class1A));
    expect(viewerOf(await studentAccess(PUPIL, wali))).toEqual({
      access: 'HOMEROOM',
      canWrite: true,
    });
    // Last year's wali kelas no longer reads a pupil who has moved on.
    expect(await status(studentAccess(PUPIL, waliLama))).toBe(404);
  });

  it('in no class, is read by the overseers of their unit only', async () => {
    db.student.findFirst.mockResolvedValue(pupilIn());
    expect(viewerOf(await studentAccess(PUPIL, kepala))).toEqual({
      access: 'OVERSEER',
      canWrite: false,
    });
    expect(await status(studentAccess(PUPIL, wali))).toBe(404);
    expect(await status(studentAccess(PUPIL, kepalaSmp))).toBe(404);
  });
});

describe('writing a note', () => {
  const note = { studentId: PUPIL, type: 'POSITIVE' as const, title: 'Membantu teman' };

  it('the wali kelas writes it, and is recorded as its author', async () => {
    await homeroomService.createStudentNote(note, wali);
    expect(db.reward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: PUPIL, givenById: 'u-wali' }),
    });
  });

  it.each([
    ['the kepala sekolah', kepala, 403],
    ['the super admin', superAdmin, 403],
    ['another teacher of the same unit', guruLain, 404],
  ])('%s does not: %i', async (_who, actor, code) => {
    expect(await status(homeroomService.createStudentNote(note, actor))).toBe(code);
    expect(db.reward.create).not.toHaveBeenCalled();
  });

  it("not in last year's class", async () => {
    db.student.findFirst.mockResolvedValue(pupilIn(class6A));
    const refused = homeroomService.createStudentNote(note, waliLama);
    await expect(refused).rejects.toMatchObject({ statusCode: 403 });
    expect(db.reward.create).not.toHaveBeenCalled();
  });
});

describe('changing or removing a note', () => {
  it('the wali kelas changes a note they wrote', async () => {
    db.reward.findUnique.mockResolvedValue({ studentId: PUPIL, givenById: 'u-wali' });
    await homeroomService.updateStudentNote('rw-1', { description: 'Rajin' }, 'reward', wali);
    expect(db.reward.update).toHaveBeenCalledWith({
      where: { id: 'rw-1' },
      data: { description: 'Rajin' },
    });
  });

  it('not one somebody else wrote — a violation the guru BK recorded stays theirs', async () => {
    db.violation.findUnique.mockResolvedValue({ studentId: PUPIL, reportedById: 'u-guru-bk' });
    const refused = homeroomService.deleteStudentNote('v-1', 'violation', wali);
    await expect(refused).rejects.toMatchObject({
      statusCode: 403,
      message: 'Catatan ini ditulis orang lain',
    });
    expect(db.violation.delete).not.toHaveBeenCalled();
  });

  it('a note on a pupil the caller does not reach reads as not found', async () => {
    db.violation.findUnique.mockResolvedValue({ studentId: PUPIL, reportedById: 'u-guru' });
    const refused = homeroomService.deleteStudentNote('v-1', 'violation', guruLain);
    await expect(refused).rejects.toMatchObject({
      statusCode: 404,
      message: 'Catatan tidak ditemukan',
    });
    expect(db.violation.delete).not.toHaveBeenCalled();
  });

  it('a database failure is not dressed up as a 404', async () => {
    db.violation.findUnique.mockResolvedValue({ studentId: PUPIL, reportedById: 'u-wali' });
    db.student.findFirst.mockRejectedValue(new Error('connection lost'));
    await expect(homeroomService.deleteStudentNote('v-1', 'violation', wali)).rejects.toThrow(
      'connection lost'
    );
  });
});

describe('my classes', () => {
  it("lists the current academic year's class first, and says which it is", async () => {
    db.teacher.findFirst.mockResolvedValue({ id: 't-wali-1a' });
    db.class.findMany.mockResolvedValue([
      { id: 'c-6a', name: '6A', academicYear: { id: 'ay-lalu', name: '2025/2026', ...lastYear } },
      { id: 'c-1a', name: '1A', academicYear: { id: 'ay-kini', name: '2026/2027', ...thisYear } },
    ]);

    const classes = await homeroomService.getMyClasses(wali);

    expect(classes.map((c) => [c.id, c.isCurrent])).toEqual([
      ['c-1a', true],
      ['c-6a', false],
    ]);
    expect(classes[0].academicYear).toEqual({ id: 'ay-kini', name: '2026/2027' });
  });

  it('is empty for an account with no teacher row', async () => {
    db.teacher.findFirst.mockResolvedValue(null);
    expect(await homeroomService.getMyClasses(kepala)).toEqual([]);
    expect(db.class.findMany).not.toHaveBeenCalled();
  });
});

describe("a class's notes (GET /homeroom/behavior)", () => {
  const brief = { id: PUPIL, nis: '1', user: { name: 'Ahmad' } };

  beforeEach(() => {
    db.violation.findMany.mockResolvedValue([
      {
        id: 'v-1',
        category: 'Kedisiplinan',
        description: 'Terlambat',
        action: 'Dinasihati',
        occurredAt: new Date('2026-09-20T01:00:00Z'),
        student: brief,
        reportedBy: { id: 'u-wali', name: 'Wali' },
      },
    ]);
    db.reward.findMany.mockResolvedValue([
      {
        id: 'r-1',
        category: 'Akhlak',
        description: 'Membantu teman',
        givenAt: new Date('2026-09-22T01:00:00Z'),
        student: brief,
        givenBy: { id: 'u-guru-bk', name: 'Guru BK' },
      },
    ]);
  });

  it('is one list, newest first, and says which notes the caller may change', async () => {
    const notes = await homeroomService.getBehaviorRecords('c-1a', wali);

    expect(notes.map((n) => [n.id, n.kind, n.canChange])).toEqual([
      ['r-1', 'reward', false], // written by someone else
      ['v-1', 'violation', true], // the wali kelas's own
    ]);
    expect(notes[1]).toMatchObject({ action: 'Dinasihati', at: '2026-09-20T01:00:00.000Z' });
  });

  it('the kepala sekolah reads it and changes nothing', async () => {
    const notes = await homeroomService.getBehaviorRecords('c-1a', kepala);
    expect(notes.every((n) => !n.canChange)).toBe(true);
  });

  it('needs the class', async () => {
    expect(await status(homeroomService.getBehaviorRecords('', wali))).toBe(400);
  });
});

describe('what a note stores', () => {
  it('a note needing attention keeps what was done about it, and no points', async () => {
    await homeroomService.createStudentNote(
      {
        studentId: PUPIL,
        type: 'NEGATIVE',
        description: 'Tidak membawa buku',
        category: 'Kedisiplinan',
        action: 'Dinasihati',
      },
      wali
    );
    expect(db.violation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Tidak membawa buku',
        action: 'Dinasihati',
        points: 0,
        reportedById: 'u-wali',
      }),
    });
  });

  it('a positive note is a reward, never a violation', async () => {
    await homeroomService.recordBehavior(
      { studentId: PUPIL, type: 'POSITIVE', description: 'Rajin' },
      wali
    );
    expect(db.reward.create).toHaveBeenCalled();
    expect(db.violation.create).not.toHaveBeenCalled();
  });
});
