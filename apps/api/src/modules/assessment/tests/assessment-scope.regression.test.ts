import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// R13.5 and R25.9: every write endpoint of the assessment module refuses an
// account that passes the `isTeacherOrAbove` route guard but is not a
// Penulis_Penilaian of the record — a unit other than the record's, or a Guru
// of the same unit with no relation to the santri. The answer is 404, the same
// shape as for an id that does not exist, and the record is unchanged. This
// test fails on the pre-fix code (which answered 200/500) and passes after.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findMany: vi.fn() },
    teacher: { findFirst: vi.fn(), findUnique: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    takhosusEnrollment: { findMany: vi.fn() },
    musyrif: { findFirst: vi.fn() },
    class: { findUnique: vi.fn(), findMany: vi.fn() },
    unit: { findUnique: vi.fn() },
    subject: { findUnique: vi.fn() },
    exam: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    grade: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    reportCard: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { verifyToken } from '@/lib/jwt';
import { prisma } from '@/lib/prisma';
import { errorHandler } from '@/middleware/error';
import assessmentRoutes from '../assessment.routes';

// Only the two teachers below can be "another unit" or "same unit, no relation"
// — both pass `isTeacherOrAbove` (educators). The service is real; Prisma is
// mocked so the test asserts the scope decision, not the database.
const TOKENS = {
  guruSameUnit: { roleCode: 'SMPIT_GURU', unitId: 'unit-a' },
  guruOtherUnit: { roleCode: 'SMPIT_GURU', unitId: 'unit-b' },
  // A homeroom teacher: passes `isTeacherOrAbove`, but holds only relation (d)
  // with the santri — enough for a report card, never for a grade.
  wali: { roleCode: 'SMPIT_GURU', unitId: 'unit-a' },
  // A Pembaca_Lintas_Unit (reads every unit) that is not a Penulis_Penilaian.
  ustadz: { roleCode: 'USTADZ', unitId: null },
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  student: { roleCode: 'SMPIT_SISWA', unitId: 'unit-a' },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/assessment', assessmentRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);

  // A santri exists in unit A only; the teacher rows exist but grant no
  // relation (empty TeacherSubject, no TakhosusEnrollment, no Musyrif).
  vi.mocked(prisma.student.findMany).mockResolvedValue([
    { id: ST, unitId: 'unit-a', enrollments: [] },
  ] as any);
  vi.mocked(prisma.teacher.findFirst).mockResolvedValue({ id: 't-1', unitId: 'unit-a' } as any);
  vi.mocked(prisma.teacher.findUnique).mockResolvedValue({ unitId: 'unit-a' } as any);
  vi.mocked(prisma.subject.findUnique).mockResolvedValue({ unitId: 'unit-a' } as any);
  vi.mocked(prisma.teacherSubject.findMany).mockResolvedValue([] as any);
  vi.mocked(prisma.takhosusEnrollment.findMany).mockResolvedValue([] as any);
  vi.mocked(prisma.musyrif.findFirst).mockResolvedValue(null as any);
  // The records live in unit A; the santri too.
  vi.mocked(prisma.exam.findUnique).mockResolvedValue({
    id: EX,
    unitId: 'unit-a',
    subjectId: SUB,
    classId: CLS,
  } as any);
  vi.mocked(prisma.grade.findUnique).mockResolvedValue({
    studentId: ST,
    examId: null,
    score: 80,
    maxScore: 100,
  } as any);
  vi.mocked(prisma.reportCard.findUnique).mockResolvedValue({ studentId: ST } as any);
  vi.mocked(prisma.class.findMany).mockResolvedValue([] as any);
  vi.mocked(prisma.unit.findUnique).mockResolvedValue({ id: 'unit-a' } as any);
});

const ST = '11111111-1111-4111-8111-111111111111';
const EX = '22222222-2222-4222-8222-222222222222';
const GR = '33333333-3333-4333-8333-333333333333';
const RC = '44444444-4444-4444-8444-444444444444';
const SUB = '55555555-5555-4555-8555-555555555555';
const CLS = '66666666-6666-4666-8666-666666666666';
const YR = '77777777-7777-4777-8777-777777777777';
const GRADER = '88888888-8888-4888-8888-888888888888';
const UNIT_A = '99999999-9999-4999-8999-999999999999';

const send = (
  who: Who,
  method: 'get' | 'patch' | 'delete' | 'post',
  path: string,
  body?: object
) => {
  const req = request(app)[method](path).set('Authorization', `Bearer ${who}`);
  return body ? req.send(body) : req;
};

describe('R13.5 — out-of-scope writes answer 404 like a missing id', () => {
  const WRITES: Array<[string, 'get' | 'patch' | 'delete' | 'post', string, object]> = [
    ['update exam', 'patch', `/assessment/exams/${EX}`, { title: 'Ujian baru' }],
    ['delete exam', 'delete', `/assessment/exams/${EX}`, {}],
    ['update exam status', 'patch', `/assessment/exams/${EX}/status`, { status: 'SCHEDULED' }],
    ['update grade', 'patch', `/assessment/grades/${GR}`, { score: 90 }],
    ['delete grade', 'delete', `/assessment/grades/${GR}`, {}],
    ['update report card', 'patch', `/assessment/report-cards/${RC}`, { teacherNotes: 'x' }],
    ['delete report card', 'delete', `/assessment/report-cards/${RC}`, {}],
    ['publish report card', 'patch', `/assessment/report-cards/${RC}/publish`, {}],
  ];

  it.each(WRITES)('%s — another unit is 404', async (_name, method, path, body) => {
    const res = await send('guruOtherUnit', method, path, body);
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  it.each(WRITES)(
    '%s — a Guru of the same unit with no relation is 404',
    async (_name, method, path, body) => {
      const res = await send('guruSameUnit', method, path, body);
      expect(res.status).toBe(404);
      expectNoWrite();
    }
  );

  // R13.8: a Pembaca_Lintas_Unit that passes the guard but is not a
  // Penulis_Penilaian is refused even for a record it may read.
  it.each(WRITES)(
    '%s — a cross-unit reader with no relation is 404 (R13.8)',
    async (_name, method, path, body) => {
      const res = await send('ustadz', method, path, body);
      expect(res.status).toBe(404);
      expectNoWrite();
    }
  );

  it('update grade — a Wali_Kelas with relation (d) only is 404 (R13.2)', async () => {
    // The homeroom teacher of the santri's active class: relation (d) reaches a
    // report card but never a grade, so this is out of scope.
    vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: CLS }] as any);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: ST, unitId: 'unit-a', enrollments: [{ classId: CLS }] },
    ] as any);
    const res = await send('wali', 'patch', `/assessment/grades/${GR}`, { score: 90 });
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  it('the 404 body is the same shape as for a missing id', async () => {
    const outOfScope = await send('guruSameUnit', 'patch', `/assessment/grades/${GR}`, {
      score: 90,
    });
    vi.mocked(prisma.grade.findUnique).mockResolvedValue(null as any);
    const absent = await send('guruSameUnit', 'patch', `/assessment/grades/${GR}`, { score: 90 });
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });

  // R13.5: the out-of-scope answer is indistinguishable from the missing-id
  // answer for every write endpoint, not just the grade one above.
  it.each(WRITES)(
    '%s — the out-of-scope 404 reads like a missing id',
    async (name, method, path, body) => {
      const outOfScope = await send('guruSameUnit', method, path, body);
      const missing =
        name.includes('exam') || name.includes('Exam')
          ? prisma.exam.findUnique
          : name.includes('grade')
            ? prisma.grade.findUnique
            : prisma.reportCard.findUnique;
      vi.mocked(missing).mockResolvedValue(null as any);
      const absent = await send('guruSameUnit', method, path, body);
      expect(outOfScope.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(absent.body).toEqual(outOfScope.body);
    }
  );

  it('update report card — a Wali_Kelas with relation (d) is allowed (200, R13.6)', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: CLS }] as any);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: ST, unitId: 'unit-a', enrollments: [{ classId: CLS }] },
    ] as any);
    vi.mocked(prisma.reportCard.update).mockResolvedValue({ id: RC, studentId: ST } as any);
    const res = await send('wali', 'patch', `/assessment/report-cards/${RC}`, {
      teacherNotes: 'Baik',
    });
    expect(res.status).toBe(200);
  });
});

/** No write of any kind happened — the record and its child rows are untouched. */
function expectNoWrite() {
  expect(prisma.exam.update).not.toHaveBeenCalled();
  expect(prisma.grade.update).not.toHaveBeenCalled();
  expect(prisma.reportCard.update).not.toHaveBeenCalled();
}

describe('R25.9 — out-of-scope creates answer 404 and change nothing', () => {
  it('a grade for a santri of another unit is 404', async () => {
    // The santri is in unit A; a unit-B teacher reaches no santri.
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as any);
    const res = await send('guruOtherUnit', 'post', '/assessment/grades', {
      studentId: ST,
      subjectId: SUB,
      academicYearId: YR,
      type: 'EXAM',
      score: 90,
      gradedById: GRADER,
    });
    expect(res.status).toBe(404);
  });

  it('a grade for a same-unit santri with no relation is 404', async () => {
    const res = await send('guruSameUnit', 'post', '/assessment/grades', {
      studentId: ST,
      subjectId: SUB,
      academicYearId: YR,
      type: 'EXAM',
      score: 90,
      gradedById: GRADER,
    });
    expect(res.status).toBe(404);
  });

  it('a report card for a same-unit santri with no relation is 404', async () => {
    const res = await send('guruSameUnit', 'post', '/assessment/report-cards', {
      studentId: ST,
      classId: CLS,
      academicYearId: YR,
      semester: 1,
    });
    expect(res.status).toBe(404);
  });

  it('an exam for a class of another unit is 404 (R25.1, R25.3)', async () => {
    // The Guru is in unit B; the class is in unit A, so the exam has no
    // same-unit class — 404, nothing written.
    vi.mocked(prisma.class.findUnique).mockResolvedValue({ unitId: 'unit-a' } as any);
    const res = await send('guruOtherUnit', 'post', '/assessment/exams', {
      unitId: UNIT_A,
      academicYearId: YR,
      subjectId: SUB,
      classId: CLS,
      teacherId: GRADER,
      type: 'DAILY_TEST',
      title: 'Ujian baru',
      scheduledAt: '2026-11-20T08:00:00.000Z',
    });
    expect(res.status).toBe(404);
    expect(prisma.exam.create).not.toHaveBeenCalled();
  });

  it('a report card for a santri of another unit is 404', async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as any);
    const res = await send('guruOtherUnit', 'post', '/assessment/report-cards', {
      studentId: ST,
      classId: CLS,
      academicYearId: YR,
      semester: 1,
    });
    expect(res.status).toBe(404);
  });

  it('a grade for a Wali_Kelas’s own class is 404 when it holds no relation (a)–(c)', async () => {
    // The homeroom teacher of the santri's active class: relation (d) alone
    // never creates a grade (R25.4).
    vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: CLS }] as any);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: ST, unitId: 'unit-a', enrollments: [{ classId: CLS }] },
    ] as any);
    const res = await send('wali', 'post', '/assessment/grades', {
      studentId: ST,
      subjectId: SUB,
      academicYearId: YR,
      type: 'EXAM',
      score: 90,
      gradedById: GRADER,
    });
    expect(res.status).toBe(404);
    expect(prisma.grade.create).not.toHaveBeenCalled();
  });
});

describe('R25.9 — GET /assessment/exams lists only in-scope exams', () => {
  it('a unit-B teacher does not see unit-A exams', async () => {
    vi.mocked(prisma.exam.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.exam.count).mockResolvedValue(0 as any);
    await send('guruOtherUnit', 'get', '/assessment/exams');
    const where = vi.mocked(prisma.exam.findMany).mock.calls[0][0]!.where as any;
    expect(where.unitId).toBe('unit-b');
  });

  it('a unit-A teacher sees only unit-A exams', async () => {
    vi.mocked(prisma.exam.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.exam.count).mockResolvedValue(0 as any);
    await send('guruSameUnit', 'get', '/assessment/exams');
    const where = vi.mocked(prisma.exam.findMany).mock.calls[0][0]!.where as any;
    expect(where.unitId).toBe('unit-a');
  });

  it('a cross-unit reader sees exams of every unit (R25.7)', async () => {
    vi.mocked(prisma.exam.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.exam.count).mockResolvedValue(0 as any);
    await send('ustadz', 'get', '/assessment/exams');
    const where = vi.mocked(prisma.exam.findMany).mock.calls[0][0]!.where as any;
    expect(where.unitId).toBeUndefined();
  });
});

describe('R25.9 — GET /assessment/exams/:id and analytics are 404 out of scope', () => {
  it('an exam of another unit answers 404 for the detail', async () => {
    vi.mocked(prisma.exam.findFirst).mockResolvedValue(null as any);
    const res = await send('guruOtherUnit', 'get', `/assessment/exams/${EX}`);
    expect(res.status).toBe(404);
  });

  it('an exam of another unit answers 404 for the analytics', async () => {
    vi.mocked(prisma.exam.findFirst).mockResolvedValue(null as any);
    const res = await send('guruOtherUnit', 'get', `/assessment/exams/${EX}/analytics`);
    expect(res.status).toBe(404);
  });
});

describe('R13.7 — an account outside isTeacherOrAbove stays 403', () => {
  it('a santri is refused before the service, for an id that exists or not', async () => {
    const res = await send('student', 'patch', `/assessment/grades/${GR}`, { score: 90 });
    expect(res.status).toBe(403);
  });
});

describe('R13.4, R13.6, R13.8 — the paths that are allowed, and the one that is not', () => {
  it('R13.4 — Super_Admin updates an exam of any unit (200)', async () => {
    vi.mocked(prisma.exam.findUnique).mockResolvedValue({
      id: EX,
      unitId: 'unit-b',
      subjectId: SUB,
      classId: CLS,
    } as any);
    vi.mocked(prisma.exam.update).mockResolvedValue({ id: EX } as any);
    const res = await send('superAdmin', 'patch', `/assessment/exams/${EX}`, {
      title: 'Ujian baru',
    });
    expect(res.status).toBe(200);
  });

  it('R13.4 — Super_Admin updates a grade of any unit (200)', async () => {
    vi.mocked(prisma.grade.findUnique).mockResolvedValue({
      studentId: ST,
      score: 80,
      maxScore: 100,
    } as any);
    vi.mocked(prisma.grade.update).mockResolvedValue({ id: GR } as any);
    const res = await send('superAdmin', 'patch', `/assessment/grades/${GR}`, { score: 95 });
    expect(res.status).toBe(200);
  });

  it('R13.6 — a Guru teaching the santri updates that santri’s grade (200)', async () => {
    // The Guru teaches the santri's active class (relation (a)).
    vi.mocked(prisma.teacherSubject.findMany).mockResolvedValue([
      { subjectId: SUB, classId: CLS, class: { unitId: 'unit-a' } },
    ] as any);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: ST, unitId: 'unit-a', enrollments: [{ classId: CLS }] },
    ] as any);
    vi.mocked(prisma.grade.findUnique).mockResolvedValue({
      studentId: ST,
      score: 80,
      maxScore: 100,
    } as any);
    vi.mocked(prisma.grade.update).mockResolvedValue({ id: GR } as any);
    const res = await send('guruSameUnit', 'patch', `/assessment/grades/${GR}`, { score: 95 });
    expect(res.status).toBe(200);
  });

  it('R25.2 — Super_Admin naming a unit that does not exist answers 400 "Pilih unit"', async () => {
    vi.mocked(prisma.unit.findUnique).mockResolvedValue(null as any);
    const res = await send('superAdmin', 'post', '/assessment/exams', {
      unitId: '99999999-9999-4999-8999-999999999999',
      academicYearId: YR,
      subjectId: SUB,
      classId: CLS,
      teacherId: GRADER,
      type: 'DAILY_TEST',
      title: 'Ujian baru',
      scheduledAt: '2026-11-20T08:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(res.body?.error?.message ?? res.body?.message).toMatch(/Pilih unit/i);
  });

  it('R25.3 — a Guru creating an exam without the subject in that class is 404', async () => {
    // Same unit, but the caller has no TeacherSubject for the subject/class —
    // refused as if the class were not there, and nothing is written (R25.3).
    vi.mocked(prisma.class.findUnique).mockResolvedValue({ unitId: 'unit-a' } as any);
    const res = await send('guruSameUnit', 'post', '/assessment/exams', {
      unitId: UNIT_A,
      academicYearId: YR,
      subjectId: SUB,
      classId: CLS,
      teacherId: GRADER,
      type: 'DAILY_TEST',
      title: 'Ujian baru',
      scheduledAt: '2026-11-20T08:00:00.000Z',
    });
    expect(res.status).toBe(404);
    expect(prisma.exam.create).not.toHaveBeenCalled();
  });

  it('R25.3 — a class outside the exam unit is 404 and nothing is written', async () => {
    vi.mocked(prisma.class.findUnique).mockResolvedValue({ unitId: 'unit-b' } as any);
    const res = await send('guruSameUnit', 'post', '/assessment/exams', {
      unitId: UNIT_A,
      academicYearId: YR,
      subjectId: SUB,
      classId: CLS,
      teacherId: GRADER,
      type: 'DAILY_TEST',
      title: 'Ujian baru',
      scheduledAt: '2026-11-20T08:00:00.000Z',
    });
    expect(res.status).toBe(404);
    expect(prisma.exam.create).not.toHaveBeenCalled();
  });
});
