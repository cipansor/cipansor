import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// R27.4–R27.5 (#989, PR-03): GET /extracurricular/students/:studentId. A santri
// reads their own enrolment, a wali their child's; a santri outside the
// caller's Cakupan_Santri is answered 404 — the same body as a santri that does
// not exist — not the 403 the old unit check returned. Fails on the pre-fix
// code (403 for a wali's other-unit santri, and the santri's own account
// refused outright) and passes after.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  student: { findFirst: vi.fn(), findMany: vi.fn() },
  extracurricularEnrollment: { findMany: vi.fn() },
  extracurricularAchievement: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import routes from '../extracurricular.routes';

const SMP = '11111111-1111-4111-8111-111111111111';
const SANTRI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const TOKENS = {
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  santri: { roleCode: 'SMPIT_SISWA', unitId: SMP },
  wali: { roleCode: 'SMPIT_ORANG_TUA', unitId: SMP },
  guruSmp: { roleCode: 'SMPIT_GURU', unitId: SMP },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/extracurricular', routes);
app.use(errorHandler);

const get = (who: Who, studentId: string) =>
  request(app).get(`/extracurricular/students/${studentId}`).set('Authorization', `Bearer ${who}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);

  // assertStudentInScope: the santri is inside the caller's scope.
  prismaMock.student.findFirst.mockResolvedValue({ id: SANTRI });
  prismaMock.extracurricularEnrollment.findMany.mockResolvedValue([
    { id: 'e1', studentId: SANTRI },
  ]);
  prismaMock.extracurricularAchievement.findMany.mockResolvedValue([]);
});

describe('R27.4 — a santri reads their own, a wali their child’s, staff an in-scope santri', () => {
  it('a santri reads their own enrolment (200)', async () => {
    const res = await get('santri', SANTRI);
    expect(res.status).toBe(200);
    expect(res.body.data.enrollments).toEqual([{ id: 'e1', studentId: SANTRI }]);
  });

  it('a wali reads their child’s enrolment (200)', async () => {
    expect((await get('wali', SANTRI)).status).toBe(200);
  });

  it('a Guru of the santri’s unit reads it (200)', async () => {
    expect((await get('guruSmp', SANTRI)).status).toBe(200);
  });

  it('a Super_Admin reads any santri (200)', async () => {
    expect((await get('superAdmin', SANTRI)).status).toBe(200);
  });
});

describe('R27.5 — a santri outside the caller’s Cakupan_Santri is 404, like one that does not exist', () => {
  it('a Guru of another unit is 404, not 403', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    const res = await get('guruSmp', SANTRI);
    expect(res.status).toBe(404);
    expect(prismaMock.extracurricularEnrollment.findMany).not.toHaveBeenCalled();
  });

  it('a wali asking for another unit’s santri is 404', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    expect((await get('wali', SANTRI)).status).toBe(404);
  });

  it('the out-of-scope 404 reads like a missing santri', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    const outOfScope = await get('guruSmp', SANTRI);
    const absent = await get('guruSmp', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });

  it('the request is scoped by studentScope, not the santri’s unit alone', async () => {
    await get('guruSmp', SANTRI);
    const where = prismaMock.student.findFirst.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({ unitId: SMP });
  });
});
