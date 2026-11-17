import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// R27.6–R27.7 (#989, PR-03): the two takhosus reads. GET
// /takhosus/student/:studentId/progress answers 404 — the same body as a santri
// that does not exist — for a santri outside the caller's Cakupan_Santri, and
// GET /takhosus/enrollment returns only enrolments of santri inside it, with
// the metadata count over that same set, whatever studentId/halaqohId ask for.
// Fails on the pre-fix code (no scope at all) and passes after.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  student: { findFirst: vi.fn(), findMany: vi.fn() },
  takhosusEnrollment: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  academicYear: { findFirst: vi.fn() },
  tahfidzTarget: { findMany: vi.fn() },
  tahfidzRecord: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import takhosusRoutes from '../takhosus.routes';

const SMP = '11111111-1111-4111-8111-111111111111';
const SMA = '22222222-2222-4222-8222-222222222222';
const SANTRI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const TOKENS = {
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  guruSmp: { roleCode: 'SMPIT_GURU', unitId: SMP },
  adminSma: { roleCode: 'SMAQ_ADMIN', unitId: SMA },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/takhosus', takhosusRoutes);
app.use(errorHandler);

const auth = (who: Who) => ({ Authorization: `Bearer ${who}` });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);

  prismaMock.student.findFirst.mockResolvedValue({ id: SANTRI });
  prismaMock.takhosusEnrollment.findMany.mockResolvedValue([]);
  prismaMock.takhosusEnrollment.count.mockResolvedValue(0);
  prismaMock.takhosusEnrollment.findUnique.mockResolvedValue(null);
  prismaMock.academicYear.findFirst.mockResolvedValue(null);
  prismaMock.tahfidzTarget.findMany.mockResolvedValue([]);
  prismaMock.tahfidzRecord.findMany.mockResolvedValue([]);
});

describe('R27.6 — progress for a santri outside the caller’s scope is 404', () => {
  it('a Guru of the santri’s unit reaches the service', async () => {
    const res = await request(app).get(`/takhosus/student/${SANTRI}/progress`).set(auth('guruSmp'));
    expect(prismaMock.student.findFirst).toHaveBeenCalled();
    expect([200, 404]).toContain(res.status);
  });

  it('an Admin_Unit of another unit is 404, and the enrolment is never read', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get(`/takhosus/student/${SANTRI}/progress`)
      .set(auth('adminSma'));
    expect(res.status).toBe(404);
    expect(prismaMock.takhosusEnrollment.findUnique).not.toHaveBeenCalled();
  });

  it('the out-of-scope 404 reads like a missing santri', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    const outOfScope = await request(app)
      .get(`/takhosus/student/${SANTRI}/progress`)
      .set(auth('adminSma'));
    const absent = await request(app)
      .get('/takhosus/student/ffffffff-ffff-4fff-8fff-ffffffffffff/progress')
      .set(auth('adminSma'));
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });
});

describe('R27.7 — the enrolment list is only santri in scope, whatever the filters', () => {
  it('narrows by the caller’s studentScope, not the studentId asked for', async () => {
    await request(app)
      .get(`/takhosus/enrollment?studentId=${SANTRI}&halaqohId=h1`)
      .set(auth('guruSmp'));
    const where = prismaMock.takhosusEnrollment.findMany.mock.calls[0][0].where;
    expect(where.student).toEqual({ unitId: SMP });
    expect(where.studentId).toBe(SANTRI);
    expect(where.halaqohId).toBe('h1');
  });

  it('counts over the same where as the rows', async () => {
    await request(app).get('/takhosus/enrollment').set(auth('guruSmp'));
    const listWhere = prismaMock.takhosusEnrollment.findMany.mock.calls[0][0].where;
    const countWhere = prismaMock.takhosusEnrollment.count.mock.calls[0][0].where;
    expect(countWhere).toEqual(listWhere);
  });

  it('a cross-unit reader (Super_Admin) is not narrowed by a unit', async () => {
    await request(app).get('/takhosus/enrollment').set(auth('superAdmin'));
    const where = prismaMock.takhosusEnrollment.findMany.mock.calls[0][0].where;
    expect(where.student).toBeUndefined();
  });
});
