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
    teacher: { findFirst: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    takhosusEnrollment: { findMany: vi.fn() },
    musyrif: { findFirst: vi.fn() },
    class: { findUnique: vi.fn(), findMany: vi.fn() },
    subject: { findUnique: vi.fn() },
    exam: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    grade: { findUnique: vi.fn() },
    reportCard: { findUnique: vi.fn() },
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
});

const ST = '11111111-1111-4111-8111-111111111111';
const EX = '22222222-2222-4222-8222-222222222222';
const GR = '33333333-3333-4333-8333-333333333333';
const RC = '44444444-4444-4444-8444-444444444444';
const SUB = '55555555-5555-4555-8555-555555555555';
const CLS = '66666666-6666-4666-8666-666666666666';
const YR = '77777777-7777-4777-8777-777777777777';
const GRADER = '88888888-8888-4888-8888-888888888888';

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
  });

  it.each(WRITES)(
    '%s — a Guru of the same unit with no relation is 404',
    async (_name, method, path, body) => {
      const res = await send('guruSameUnit', method, path, body);
      expect(res.status).toBe(404);
    }
  );
});

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
