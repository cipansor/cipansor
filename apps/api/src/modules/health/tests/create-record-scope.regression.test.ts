import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// R27.8 and R27.13 (#989, PR-03): POST /health/records. Every caller that
// passes the route guard — the nurse holding HEALTH_MANAGE included — records a
// visit only for a santri inside its own Cakupan_Santri; a santri outside it is
// answered 404, the same body as one that does not exist, and nothing is saved.
// The scope *is* the write range here, so a PERAWAT records a clinic visit for
// a santri of any unit (R27.13). Fails on the pre-fix code (no scope check at
// all, so a unit-B nurse saved a unit-A santri's record) and passes after.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('@/modules/attendance/attendance.service', () => ({
  attendanceService: { recordFromIntegration: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  student: { findFirst: vi.fn(), findMany: vi.fn() },
  medicalRecord: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import healthRoutes from '../health.routes';

const SMP = '11111111-1111-4111-8111-111111111111';
const SMA = '22222222-2222-4222-8222-222222222222';
const SANTRI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const PERM = (p: string) => [p];
const TOKENS = {
  // The nurse: HEALTH_MANAGE, and a cross-unit reader (PERAWAT seesAllUnits).
  perawat: { roleCode: 'PERAWAT', unitId: SMP, permissions: PERM('HEALTH_VIEW,HEALTH_MANAGE') },
  // A unit admin of the santri's unit — manages health for their own unit only.
  adminSmp: {
    roleCode: 'SMPIT_ADMIN',
    unitId: SMP,
    permissions: PERM('HEALTH_VIEW,HEALTH_MANAGE'),
  },
  // A unit admin of another unit.
  adminSma: { roleCode: 'SMAQ_ADMIN', unitId: SMA, permissions: PERM('HEALTH_VIEW,HEALTH_MANAGE') },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/health', healthRoutes);
app.use(errorHandler);

const BODY = {
  studentId: SANTRI,
  type: 'CHECKUP',
  visitDate: new Date().toISOString(),
  complaint: 'Pusing',
};

const post = (who: Who, body = BODY) =>
  request(app).post('/health/records').set('Authorization', `Bearer ${who}`).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return {
      type: 'access',
      sub: `u-${token}`,
      roleCode: t.roleCode,
      unitId: t.unitId,
      permissions: ['HEALTH_VIEW', 'HEALTH_MANAGE'],
    };
  }) as unknown as typeof verifyToken);

  // assertStudentInScope finds the santri.
  prismaMock.student.findFirst.mockResolvedValue({ id: SANTRI });
  prismaMock.medicalRecord.create.mockResolvedValue({ id: 'med-1', studentId: SANTRI });
});

describe('R27.13 — a HEALTH_MANAGE holder records a visit for an in-scope santri (201)', () => {
  it('a unit admin of the santri’s unit is accepted', async () => {
    const res = await post('adminSmp');
    expect(res.status).toBe(201);
    expect(prismaMock.medicalRecord.create).toHaveBeenCalled();
  });

  it('the nurse reaches a santri of any unit, so the scope is their write range', async () => {
    // The PERAWAT's scope widens across units (seesAllUnits) — so the santri of
    // another unit is inside it, and the record is saved.
    prismaMock.student.findFirst.mockResolvedValue({ id: SANTRI });
    const res = await post('perawat');
    expect(res.status).toBe(201);
    expect(prismaMock.medicalRecord.create).toHaveBeenCalled();
  });

  it('the nurse’s scope carries no unit clause — that is what widens it across units', async () => {
    // Pins the widening itself, not just its 201: `studentScope(PERAWAT)` is
    // `{}` (seesAllUnits), so the controller builds `AND: [{ id }, {}]` and the
    // santri's unit never narrows it. A unit admin, by contrast, gets its own
    // unit as the second clause.
    await post('perawat');
    expect(prismaMock.student.findFirst.mock.calls[0][0].where.AND[1]).toEqual({});

    prismaMock.student.findFirst.mockClear();
    await post('adminSmp');
    expect(prismaMock.student.findFirst.mock.calls[0][0].where.AND[1]).toEqual({ unitId: SMP });
  });
});

describe('R27.8 — a santri outside the caller’s Cakupan_Santri is 404 and nothing is saved', () => {
  it('a unit admin of another unit is 404', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    const res = await post('adminSma');
    expect(res.status).toBe(404);
    expect(prismaMock.medicalRecord.create).not.toHaveBeenCalled();
  });

  it('the check is scoped by studentScope, not the santri’s unit alone', async () => {
    await post('adminSma');
    const where = prismaMock.student.findFirst.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({ unitId: SMA });
  });

  it('the out-of-scope 404 reads like a missing santri', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);
    const outOfScope = await post('adminSma');
    const absent = await post('adminSma', {
      ...BODY,
      studentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });
});
