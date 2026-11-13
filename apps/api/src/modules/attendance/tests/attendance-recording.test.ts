import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who records a class's daily register (2026-09-27): its wali kelas, a
// teacher with a lesson in it, the operator of its unit, and the super admin.
// The kepala sekolah records only where they are one of those. A class of
// another unit is 404; one of the caller's own unit they have no part in is
// 403. The day is a calendar day inside the class's academic year, not after
// today. Saving a day again updates it.

vi.mock('@/lib/prisma', () => {
  const prisma = {
    class: { findFirst: vi.fn(), findMany: vi.fn() },
    teacher: { findFirst: vi.fn() },
    schedule: { findFirst: vi.fn() },
    classEnrollment: { findFirst: vi.fn(), findMany: vi.fn() },
    attendance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma };
});

vi.mock('../attendance.notice', () => ({ tellAbsences: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { AttendanceStatus } from '@cipansor/shared';
import { attendanceService } from '../attendance.service';
import { tellAbsences } from '../attendance.notice';
import { todayWib } from '@/utils/wib';

type Mocked = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const db = prisma as unknown as Mocked;
const $transaction = (prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction;

const SD = 'unit-sd';
const SMP = 'unit-smp';
const DAY = 24 * 60 * 60 * 1000;
const thisYear = {
  startDate: new Date(Date.now() - 60 * DAY),
  endDate: new Date(Date.now() + 300 * DAY),
};
const class1A = { id: 'c-1a', unitId: SD, homeroomTeacherId: 't-wali', academicYear: thisYear };

// Teacher rows by user; the lesson a teacher has in 1A.
const TEACHER_OF_USER: Record<string, string> = {
  'u-wali': 't-wali',
  'u-pengampu': 't-pengampu',
  'u-guru': 't-guru',
  'u-kepala-mengajar': 't-kepala',
};
const LESSONS_IN_1A = new Set(['t-pengampu', 't-kepala']);

const actor = (sub: string, roleCode: string, unitId: string | null = SD) => ({
  sub,
  roleCode,
  unitId,
});
const wali = actor('u-wali', 'SDIT_GURU');
const pengampu = actor('u-pengampu', 'SDIT_GURU');
const guruLain = actor('u-guru', 'SDIT_GURU');
const kepala = actor('u-kepala', 'SDIT_KEPALA_SEKOLAH');
const kepalaMengajar = actor('u-kepala-mengajar', 'SDIT_KEPALA_SEKOLAH');
const operator = actor('u-admin', 'SDIT_ADMIN');
const operatorSmp = actor('u-admin-smp', 'SMPIT_ADMIN', SMP);
const guruSmp = actor('u-guru-smp', 'SMPIT_GURU', SMP);
const superAdmin = actor('u-sa', 'SUPER_ADMIN', null);

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const today = todayWib();
const register = (day = today) => ({
  classId: 'c-1a',
  date: day,
  records: [
    { studentId: P1, status: AttendanceStatus.PRESENT },
    { studentId: P2, status: AttendanceStatus.SICK, notes: 'Demam' },
  ],
});

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { statusCode?: number }) => e.statusCode
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.class.findFirst.mockResolvedValue(class1A);
  db.teacher.findFirst.mockImplementation(async ({ where }) =>
    TEACHER_OF_USER[where.userId] ? { id: TEACHER_OF_USER[where.userId] } : null
  );
  db.schedule.findFirst.mockImplementation(async ({ where }) =>
    where.classId === 'c-1a' && LESSONS_IN_1A.has(where.teacherId) ? { id: 'lesson' } : null
  );
  db.classEnrollment.findMany.mockResolvedValue([{ studentId: P1 }, { studentId: P2 }]);
  db.classEnrollment.findFirst.mockResolvedValue({ id: 'enr' });
  db.attendance.findMany.mockResolvedValue([]);
  db.attendance.upsert.mockImplementation(async (args) => args);
  $transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

describe("who records a class's day", () => {
  it.each([
    ['its wali kelas', wali],
    ['a teacher with a lesson in it', pengampu],
    ['a kepala sekolah who teaches in it', kepalaMengajar],
    ["the unit's operator", operator],
    ['the super admin', superAdmin],
  ])('%s', async (_who, who) => {
    expect(await attendanceService.bulkCreate(register(), who)).toEqual({ created: 2, updated: 0 });
    expect(db.attendance.upsert).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['another teacher of the unit', guruLain],
    ['the kepala sekolah, who reads', kepala],
  ])('not %s: 403', async (_who, who) => {
    const refused = attendanceService.bulkCreate(register(), who);
    await expect(refused).rejects.toMatchObject({
      statusCode: 403,
      message:
        'Absensi kelas ini dicatat oleh wali kelasnya, guru yang mengajar di kelas itu, atau operator unit',
    });
    expect(db.attendance.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["another unit's operator", operatorSmp],
    ["another unit's teacher", guruSmp],
  ])('%s does not reach the class: 404', async (_who, who) => {
    expect(await status(attendanceService.bulkCreate(register(), who))).toBe(404);
    expect(db.attendance.upsert).not.toHaveBeenCalled();
  });

  it('a class that does not exist is 404', async () => {
    db.class.findFirst.mockResolvedValue(null);
    expect(await status(attendanceService.bulkCreate(register(), superAdmin))).toBe(404);
  });
});

describe('the day', () => {
  const shift = (days: number) =>
    new Date(Date.now() + days * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  it('is stored as the calendar day picked, at UTC midnight (a @db.Date)', async () => {
    const yesterday = shift(-1);
    await attendanceService.bulkCreate(register(yesterday), wali);
    const { where } = db.attendance.upsert.mock.calls[0][0];
    expect(where.studentId_classId_date.date.toISOString()).toBe(`${yesterday}T00:00:00.000Z`);
  });

  it('cannot be after today', async () => {
    const refused = attendanceService.bulkCreate(register(shift(1)), wali);
    await expect(refused).rejects.toMatchObject({ statusCode: 400 });
  });

  it("cannot be outside the class's academic year", async () => {
    expect(await status(attendanceService.bulkCreate(register(shift(-90)), operator))).toBe(400);
  });
});

describe('saving a day again', () => {
  it('updates the pupils already recorded, and says how many', async () => {
    db.attendance.findMany.mockResolvedValue([{ studentId: P2 }]);

    const result = await attendanceService.bulkCreate(register(), wali);

    expect(result).toEqual({ created: 1, updated: 1 });
    const sick = db.attendance.upsert.mock.calls
      .map(([a]) => a)
      .find((a) => a.where.studentId_classId_date.studentId === P2);
    expect(sick.update).toEqual({ status: 'SICK', notes: 'Demam', recordedById: 'u-wali' });
  });

  it('hands every mark to the notice with what the day had before', async () => {
    db.attendance.findMany.mockResolvedValue([{ studentId: P2, status: 'ABSENT' }]);

    await attendanceService.bulkCreate(register(), wali);

    expect(tellAbsences).toHaveBeenCalledWith('c-1a', today, [
      { studentId: P1, status: 'PRESENT', before: undefined },
      { studentId: P2, status: 'SICK', before: 'ABSENT' },
    ]);
  });

  it('refuses a pupil who is not in the class, and one listed twice', async () => {
    db.classEnrollment.findMany.mockResolvedValue([{ studentId: P1 }]);
    expect(await status(attendanceService.bulkCreate(register(), wali))).toBe(400);

    db.classEnrollment.findMany.mockResolvedValue([{ studentId: P1 }, { studentId: P2 }]);
    const twice = { ...register(), records: [register().records[0], register().records[0]] };
    expect(await status(attendanceService.bulkCreate(twice, wali))).toBe(400);
    expect(db.attendance.upsert).not.toHaveBeenCalled();
  });
});

describe("one pupil's day", () => {
  const one = { studentId: P1, classId: 'c-1a', date: today, status: AttendanceStatus.LATE };

  it('is recorded by the wali kelas, with the pupil columns a list may carry', async () => {
    db.attendance.findUnique.mockResolvedValue(null);
    db.attendance.create.mockResolvedValue({
      id: 'a-1',
      ...one,
      studentId: P1,
      student: { id: P1, unitId: SD, user: { name: 'Ahmad' }, unit: { name: 'SD IT' } },
      class: { name: '1A' },
    });

    await attendanceService.create(one, wali);

    const { data, include } = db.attendance.create.mock.calls[0][0];
    expect(data.recordedById).toBe('u-wali');
    expect(Object.keys(include.student.select).sort()).toEqual([
      'id',
      'nis',
      'nisn',
      'unit',
      'unitId',
      'user',
    ]);
  });

  it('twice is a conflict', async () => {
    db.attendance.findUnique.mockResolvedValue({ id: 'a-1' });
    expect(await status(attendanceService.create(one, wali))).toBe(409);
  });

  it('is changed only by someone who records the class, for its class and day', async () => {
    db.attendance.findUnique.mockResolvedValue({
      classId: 'c-1a',
      date: new Date(`${today}T00:00:00.000Z`),
    });
    db.attendance.update.mockResolvedValue({ id: 'a-1', status: 'SICK' });

    expect(
      await status(attendanceService.update('a-1', { status: AttendanceStatus.SICK }, guruLain))
    ).toBe(403);
    expect(
      await status(attendanceService.update('a-1', { status: AttendanceStatus.SICK }, guruSmp))
    ).toBe(404);
    expect(db.attendance.update).not.toHaveBeenCalled();

    await attendanceService.update('a-1', { status: AttendanceStatus.SICK }, pengampu);
    expect(db.attendance.update.mock.calls[0][0].data.recordedById).toBe('u-pengampu');
  });

  it("a change to one pupil's day reaches the notice with the mark it replaced", async () => {
    db.attendance.findUnique.mockResolvedValue({
      classId: 'c-1a',
      date: new Date(`${today}T00:00:00.000Z`),
      studentId: P1,
      status: 'PRESENT',
    });
    db.attendance.update.mockResolvedValue({ id: 'a-1', status: 'ABSENT' });

    await attendanceService.update('a-1', { status: AttendanceStatus.ABSENT }, wali);

    expect(tellAbsences).toHaveBeenCalledWith('c-1a', today, [
      { studentId: P1, status: 'ABSENT', before: 'PRESENT' },
    ]);
  });

  it('a refused change tells no one', async () => {
    db.attendance.findUnique.mockResolvedValue({
      classId: 'c-1a',
      date: new Date(`${today}T00:00:00.000Z`),
      studentId: P1,
      status: 'PRESENT',
    });
    await status(attendanceService.update('a-1', { status: AttendanceStatus.ABSENT }, guruLain));
    expect(tellAbsences).not.toHaveBeenCalled();
  });
});

describe('the classes a user records (GET /attendance/me/classes)', () => {
  it('the super admin: any class; an operator: their unit', async () => {
    expect(await attendanceService.myClasses(superAdmin)).toEqual({
      scope: 'ALL',
      unitId: null,
      classes: [],
    });
    expect(await attendanceService.myClasses(operator)).toEqual({
      scope: 'UNIT',
      unitId: SD,
      classes: [],
    });
    expect(db.class.findMany).not.toHaveBeenCalled();
  });

  it("a teacher: this year's classes they are wali kelas of or teach in, their own first", async () => {
    db.class.findMany.mockResolvedValue([
      {
        id: 'c-3a',
        name: '3A',
        homeroomTeacherId: 't-lain',
        unit: { id: SD, name: 'SD IT' },
        academicYear: { id: 'ay', name: '2026/2027' },
      },
      {
        id: 'c-1a',
        name: '1A',
        homeroomTeacherId: 't-wali',
        unit: { id: SD, name: 'SD IT' },
        academicYear: { id: 'ay', name: '2026/2027' },
      },
    ]);

    const scope = await attendanceService.myClasses(wali);

    expect(scope.scope).toBe('ASSIGNED');
    expect(scope.classes.map((c) => [c.id, c.as])).toEqual([
      ['c-1a', 'HOMEROOM'],
      ['c-3a', 'TEACHER'],
    ]);
    const { where } = db.class.findMany.mock.calls[0][0];
    expect(where.OR).toEqual([
      { homeroomTeacherId: 't-wali' },
      { schedules: { some: { teacherId: 't-wali', isActive: true } } },
    ]);
    expect(where.academicYear.startDate.lte).toBeInstanceOf(Date);
  });

  it('someone with no teacher row records nothing', async () => {
    expect(await attendanceService.myClasses(kepala)).toEqual({
      scope: 'ASSIGNED',
      unitId: SD,
      classes: [],
    });
  });
});

describe('a day recorded by another module (the UKS sending a pupil home sick)', () => {
  const sick = (on: Date) => ({
    studentId: P1,
    classId: 'c-1a',
    on,
    status: AttendanceStatus.SICK,
    notes: 'Sakit: demam (via UKS)',
  });

  it("is dated the visit's day in WIB", async () => {
    db.attendance.findUnique.mockResolvedValue(null);
    // 20:30 UTC is 03:30 the next morning in WIB.
    await attendanceService.recordFromIntegration(
      sick(new Date('2026-09-27T20:30:00Z')),
      'u-perawat'
    );
    const { data } = db.attendance.create.mock.calls[0][0];
    expect(data.date.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(data.recordedById).toBe('u-perawat');
  });

  it('leaves a day the teachers already recorded as it is', async () => {
    db.attendance.findUnique.mockResolvedValue({ id: 'a-1' });
    const outcome = await attendanceService.recordFromIntegration(sick(new Date()), 'u-perawat');
    expect(outcome).toBe('already-recorded');
    expect(db.attendance.create).not.toHaveBeenCalled();
  });
});
