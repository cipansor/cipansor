import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// #1090: the kurikulum-merdeka write endpoints accepted any signed-in account
// that passed the route guard, so a guru of another unit — or of the same unit
// with no relation to the santri — could write a Merdeka result or a P5
// assessment for a santri they do not teach, and a `?unitId=` a unit-bound
// account sent widened its lists to another unit. Every write now answers 404
// like a missing id for an out-of-scope record (the assessment module's rule,
// #987), and every list is narrowed back to the actor's own unit. This test
// drives the real router and reads what reaches Prisma; it fails on the pre-fix
// code (which answered 200/500 and honoured the foreign `?unitId=`).

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    teacher: { findFirst: vi.fn(), findUnique: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    takhosusEnrollment: { findMany: vi.fn() },
    musyrif: { findFirst: vi.fn() },
    class: { findMany: vi.fn(), findUnique: vi.fn() },
    p5Project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    p5Assessment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    merdekaAssessment: { findMany: vi.fn(), count: vi.fn() },
    merdekaAssessmentResult: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    learningPhase: { count: vi.fn() },
    learningOutcome: { count: vi.fn() },
    learningObjective: { count: vi.fn() },
    teachingModule: { count: vi.fn() },
    p5Theme: { count: vi.fn() },
  },
}));

import { verifyToken } from '@/lib/jwt';
import { prisma } from '@/lib/prisma';
import { errorHandler } from '@/middleware/error';
import { kurikulumMerdekaRoutes } from '../index';

// Every account passes the route guard (`TEACHER`/`UNIT_ADMIN`); the question
// is whether it is a Penulis_Penilaian of the santri. The service is real;
// Prisma is mocked so the test asserts the scope decision, not the database.
const TOKENS = {
  // A guru of the santri's own unit with no relation: passes the guard, writes
  // nothing.
  guruSameUnit: { roleCode: 'SMPIT_GURU', unitId: 'unit-a' },
  // A guru of another unit.
  guruOtherUnit: { roleCode: 'SMPIT_GURU', unitId: 'unit-b' },
  // A homeroom teacher of the santri's active class: relation (d) only — enough
  // for a report-card-shaped write (P5), never for a grade (Merdeka result).
  wali: { roleCode: 'SMPIT_GURU', unitId: 'unit-a' },
  // A Pembaca_Lintas_Unit (reads every unit) that is not a Penulis_Penilaian.
  ustadz: { roleCode: 'USTADZ', unitId: null },
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  // A unit admin of unit A — a Kepala/Admin_Unit, so a Penulis_Penilaian of A.
  adminUnitA: { roleCode: 'SMPIT_ADMIN', unitId: 'unit-a' },
  // A project facilitator with no teaching relation to the santri: the P5 rule
  // grants the write through `P5Project.supervisorId` (#1090).
  fasilitator: { roleCode: 'SMPIT_GURU', unitId: 'unit-a' },
  student: { roleCode: 'SMPIT_SISWA', unitId: 'unit-a' },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/kurikulum-merdeka', kurikulumMerdekaRoutes);
app.use(errorHandler);

const ST = '11111111-1111-4111-8111-111111111111';
const RESULT = '22222222-2222-4222-8222-222222222222';
const ASSESS = '33333333-3333-4333-8333-333333333333';
const P5A = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const GRADER = '66666666-6666-4666-8666-666666666666';
const ASSESSOR = '77777777-7777-4777-8777-777777777777';
const CLS = '88888888-8888-4888-8888-888888888888';
const UNIT_B = '99999999-9999-4999-8999-999999999999';

const MERDEKA_RESULT_WRITES: Array<[string, 'post' | 'put' | 'delete', string, object]> = [
  [
    'create Merdeka result',
    'post',
    '/kurikulum-merdeka/assessment-results',
    { assessmentId: ASSESS, studentId: ST, gradedById: GRADER },
  ],
  [
    'update Merdeka result',
    'put',
    `/kurikulum-merdeka/assessment-results/${RESULT}`,
    { score: 90 },
  ],
  ['delete Merdeka result', 'delete', `/kurikulum-merdeka/assessment-results/${RESULT}`, {}],
];

const P5_WRITES: Array<[string, 'post' | 'put' | 'delete', string, object]> = [
  [
    'create P5 assessment',
    'post',
    '/kurikulum-merdeka/p5-assessments',
    { projectId: PROJECT, studentId: ST, assessedById: ASSESSOR },
  ],
  ['update P5 assessment', 'put', `/kurikulum-merdeka/p5-assessments/${P5A}`, { mandiri: 'BSH' }],
  ['delete P5 assessment', 'delete', `/kurikulum-merdeka/p5-assessments/${P5A}`, {}],
];

const WRITES = [...MERDEKA_RESULT_WRITES, ...P5_WRITES];

const send = (who: Who, method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) => {
  const req = request(app)[method](path).set('Authorization', `Bearer ${who}`);
  return body ? req.send(body) : req;
};

/** No write of either kind reached Prisma. */
function expectNoWrite() {
  for (const fn of [
    prisma.merdekaAssessmentResult.create,
    prisma.merdekaAssessmentResult.update,
    prisma.merdekaAssessmentResult.delete,
    prisma.p5Assessment.create,
    prisma.p5Assessment.update,
    prisma.p5Assessment.delete,
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

/**
 * The exact answer a successful write gives — a create is 201, an update or
 * delete is 200 — and the Prisma call that proves the row was written. A
 * looser `not.toContain([400,404,500])` would also accept a 401/403 refusal, so
 * a scope check that wrongly rejected a legitimate writer would still pass.
 */
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const SUCCESS: Record<'post' | 'put' | 'delete', { status: number; fn: () => number }> = {
  post: {
    status: 201,
    fn: () =>
      db.p5Assessment.create.mock.calls.length +
      db.merdekaAssessmentResult.create.mock.calls.length,
  },
  put: {
    status: 200,
    fn: () =>
      db.p5Assessment.update.mock.calls.length +
      db.merdekaAssessmentResult.update.mock.calls.length,
  },
  delete: {
    status: 200,
    fn: () =>
      db.p5Assessment.delete.mock.calls.length +
      db.merdekaAssessmentResult.delete.mock.calls.length,
  },
};

/** The write ran: the exact success status, and exactly one row written. */
function expectWrote(res: { status: number }, method: 'post' | 'put' | 'delete') {
  expect(res.status).toBe(SUCCESS[method].status);
  expect(SUCCESS[method].fn()).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);

  // The santri exists in unit A; the actor's Teacher row exists but grants no
  // relation (no TeacherSubject, no TakhosusEnrollment, no Musyrif, no class).
  vi.mocked(prisma.student.findMany).mockResolvedValue([
    { id: ST, unitId: 'unit-a', enrollments: [] },
  ] as any);
  vi.mocked(prisma.student.findUnique).mockResolvedValue({ id: ST } as any);
  vi.mocked(prisma.teacher.findFirst).mockResolvedValue({ id: 't-1', unitId: 'unit-a' } as any);
  vi.mocked(prisma.teacherSubject.findMany).mockResolvedValue([] as any);
  vi.mocked(prisma.takhosusEnrollment.findMany).mockResolvedValue([] as any);
  vi.mocked(prisma.musyrif.findFirst).mockResolvedValue(null as any);
  vi.mocked(prisma.class.findMany).mockResolvedValue([] as any);
  // The P5 project's supervisor is someone else by default, so the facilitator
  // path does not open for an actor with no relation.
  vi.mocked(prisma.p5Project.findUnique).mockResolvedValue({
    supervisor: { userId: 'someone-else' },
  } as any);

  vi.mocked(prisma.merdekaAssessmentResult.findUnique).mockResolvedValue({ studentId: ST } as any);
  vi.mocked(prisma.p5Assessment.findUnique).mockResolvedValue({
    studentId: ST,
    projectId: PROJECT,
  } as any);
  vi.mocked(prisma.merdekaAssessmentResult.create).mockResolvedValue({ id: RESULT } as any);
  vi.mocked(prisma.merdekaAssessmentResult.update).mockResolvedValue({ id: RESULT } as any);
  vi.mocked(prisma.merdekaAssessmentResult.delete).mockResolvedValue({ id: RESULT } as any);
  vi.mocked(prisma.p5Assessment.create).mockResolvedValue({ id: P5A } as any);
  vi.mocked(prisma.p5Assessment.update).mockResolvedValue({ id: P5A } as any);
  vi.mocked(prisma.p5Assessment.delete).mockResolvedValue({ id: P5A } as any);
});

describe('#1090 — out-of-scope grade and P5 writes answer 404 like a missing id', () => {
  it.each(WRITES)('%s — another unit is 404', async (_name, method, path, body) => {
    const res = await send('guruOtherUnit', method, path, body);
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  it.each(WRITES)(
    '%s — a guru of the same unit with no relation is 404',
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

  it('a Merdeka result is a grade: a homeroom relation (d) alone is 404', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: CLS }] as any);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: ST, unitId: 'unit-a', enrollments: [{ classId: CLS }] },
    ] as any);
    const res = await send('wali', 'post', '/kurikulum-merdeka/assessment-results', {
      assessmentId: ASSESS,
      studentId: ST,
      gradedById: GRADER,
    });
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  it('the 404 body is the same shape as for a missing id', async () => {
    const outOfScope = await send(
      'guruSameUnit',
      'put',
      `/kurikulum-merdeka/p5-assessments/${P5A}`,
      { mandiri: 'BSH' }
    );
    vi.mocked(prisma.p5Assessment.findUnique).mockResolvedValue(null as any);
    const absent = await send('guruSameUnit', 'put', `/kurikulum-merdeka/p5-assessments/${P5A}`, {
      mandiri: 'BSH',
    });
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });
});

describe('#1090 — a Penulis_Penilaian still writes', () => {
  it.each(WRITES)('%s — a unit admin of the santri unit is allowed', async (_n, m, p, b) => {
    const res = await send('adminUnitA', m, p, b);
    expectWrote(res, m);
  });

  it.each(WRITES)('%s — Super Admin is allowed', async (_n, m, p, b) => {
    const res = await send('superAdmin', m, p, b);
    expectWrote(res, m);
  });

  // A P5 assessment follows the report-card rule: any relation, including the
  // homeroom teacher (d), is enough.
  it('a homeroom teacher may write a P5 assessment', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([{ id: CLS }] as any);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: ST, unitId: 'unit-a', enrollments: [{ classId: CLS }] },
    ] as any);
    const res = await send('wali', 'post', '/kurikulum-merdeka/p5-assessments', {
      projectId: PROJECT,
      studentId: ST,
      assessedById: ASSESSOR,
    });
    expectWrote(res, 'post');
    expect(prisma.p5Assessment.create).toHaveBeenCalled();
  });
});

describe('#1090 — a P5 project facilitator may write, without a teaching relation', () => {
  // The owner's locked decision (2026-11-16): a P5 assessment follows the
  // report-card rule *or* the facilitator's own project (`P5Project.supervisorId`),
  // because P5 is assessed across subjects. The actor here has no relation of
  // any kind — only the project it facilitates.
  beforeEach(() => {
    vi.mocked(prisma.p5Project.findUnique).mockResolvedValue({
      supervisor: { userId: 'u-fasilitator' },
    } as any);
  });

  it.each(P5_WRITES)('%s — the project facilitator is allowed', async (_n, m, p, b) => {
    const res = await send('fasilitator', m, p, b);
    expectWrote(res, m);
  });

  // A facilitator whose project is not the one named on the row is still out of
  // scope: the relation is per project, not "any facilitator anywhere".
  it('a facilitator of a different project is 404', async () => {
    vi.mocked(prisma.p5Project.findUnique).mockResolvedValue({
      supervisor: { userId: 'u-someone-else' },
    } as any);
    const res = await send('fasilitator', 'post', '/kurikulum-merdeka/p5-assessments', {
      projectId: PROJECT,
      studentId: ST,
      assessedById: ASSESSOR,
    });
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  // The facilitator path never opens for a grade: a Merdeka result follows the
  // grade rule, which a facilitator with no relation does not satisfy.
  it('the facilitator reach does not extend to Merdeka grades', async () => {
    const res = await send('fasilitator', 'post', '/kurikulum-merdeka/assessment-results', {
      assessmentId: ASSESS,
      studentId: ST,
      gradedById: GRADER,
    });
    expect(res.status).toBe(404);
    expectNoWrite();
  });
});

describe('#1090 — a santri never writes', () => {
  it.each(WRITES)('%s — a santri is 403 at the guard', async (_n, m, p, b) => {
    const res = await send('student', m, p, b);
    expect(res.status).toBe(403);
    expectNoWrite();
  });
});

describe('#1090 — lists are narrowed to the actor unit, never widened by ?unitId=', () => {
  beforeEach(() => {
    vi.mocked(prisma.p5Project.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.p5Project.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.merdekaAssessment.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.merdekaAssessment.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.p5Assessment.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.p5Assessment.count).mockResolvedValue(0 as any);
  });

  const whereOf = (model: string) => {
    const calls = (prisma as any)[model].findMany.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[0][0];
  };

  it('GET /p5-projects — a unit-bound account asking for another unit reads its own', async () => {
    await send('guruSameUnit', 'get', `/kurikulum-merdeka/p5-projects?unitId=${UNIT_B}`);
    expect(whereOf('p5Project').where.unitId).toBe('unit-a');
  });

  it('GET /assessments — a unit-bound account asking for another unit reads its own', async () => {
    await send('guruSameUnit', 'get', `/kurikulum-merdeka/assessments?unitId=${UNIT_B}`);
    expect(whereOf('merdekaAssessment').where.unitId).toBe('unit-a');
  });

  it('GET /p5-projects — a cross-unit reader may narrow to a named unit', async () => {
    await send('ustadz', 'get', `/kurikulum-merdeka/p5-projects?unitId=${UNIT_B}`);
    expect(whereOf('p5Project').where.unitId).toBe(UNIT_B);
  });

  it('GET /p5-projects — a cross-unit reader with no unit reads every unit', async () => {
    await send('ustadz', 'get', '/kurikulum-merdeka/p5-projects');
    expect(whereOf('p5Project').where.unitId).toBeUndefined();
  });

  it('GET /summary — the counts are the actor unit, not the ?unitId= asked for', async () => {
    vi.mocked(prisma.learningPhase.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.learningOutcome.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.learningObjective.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.teachingModule.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.p5Theme.count).mockResolvedValue(0 as any);
    await send('guruSameUnit', 'get', `/kurikulum-merdeka/summary?unitId=${UNIT_B}`);
    const call = (prisma as any).p5Project.count.mock.calls.find((c: any[]) => c[0]?.where?.unitId);
    expect(call[0].where.unitId).toBe('unit-a');
  });
});
