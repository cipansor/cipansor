import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Who reaches the attendance write routes at all: teachers, pesantren
// educators, the Kiai, kepala sekolah and admin units — which classes each
// records is the service's question (attendance-recording.test.ts). The
// yayasan organs, tata usaha, treasurers, pupils and wali do not. Until
// 2026-09-27 the routes let admins only, so no teacher could save a register.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../attendance.service', () => ({
  attendanceService: {
    myClasses: vi.fn(async () => ({ scope: 'ASSIGNED', unitId: null, classes: [] })),
    create: vi.fn(async () => ({})),
    bulkCreate: vi.fn(async () => ({ created: 1, updated: 0 })),
    update: vi.fn(async () => ({})),
  },
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import attendanceRoutes from '../attendance.routes';
import { attendanceService } from '../attendance.service';

const app = express();
app.use(express.json());
app.use('/attendance', attendanceRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((roleCode: string) => ({
    type: 'access',
    permissions: [],
    sub: `u-${roleCode}`,
    roleCode,
    unitId: 'unit-sd',
  })) as unknown as typeof verifyToken);
});

const CLASS = '11111111-1111-4111-8111-111111111111';
const PUPIL = '22222222-2222-4222-8222-222222222222';
const RECORD = '33333333-3333-4333-8333-333333333333';

type Call = [method: 'post' | 'patch', path: string, body: object];
const WRITES: Array<[string, Call]> = [
  [
    "a class's day",
    [
      'post',
      '/attendance/bulk',
      { classId: CLASS, date: '2026-09-25', records: [{ studentId: PUPIL, status: 'PRESENT' }] },
    ],
  ],
  [
    "one pupil's day",
    [
      'post',
      '/attendance',
      { classId: CLASS, studentId: PUPIL, date: '2026-09-25', status: 'SICK' },
    ],
  ],
  ['a correction', ['patch', `/attendance/${RECORD}`, { status: 'LATE' }]],
];
const send = (roleCode: string, [method, path, body]: Call) =>
  request(app)[method](path).set('Authorization', `Bearer ${roleCode}`).send(body);

describe.each([
  'SDIT_GURU',
  'SMPIT_GURU_BK',
  'MUSYRIF',
  'PESANTREN_PENGASUH',
  'SDIT_KEPALA_SEKOLAH',
  'SDIT_ADMIN',
  'SUPER_ADMIN',
])('%s', (roleCode) => {
  it.each(WRITES)('reaches %s (the service decides the class)', async (_what, call) => {
    const res = await send(roleCode, call);
    expect([200, 201]).toContain(res.status);
  });
});

describe.each([
  'YAYASAN_KETUA',
  'SDIT_TATA_USAHA',
  'SDIT_BENDAHARA',
  'SDIT_ORANG_TUA',
  'SDIT_SISWA',
])('%s', (roleCode) => {
  it.each(WRITES)('is refused %s: 403', async (_what, call) => {
    const res = await send(roleCode, call);
    expect(res.status).toBe(403);
    expect(attendanceService.bulkCreate).not.toHaveBeenCalled();
    expect(attendanceService.create).not.toHaveBeenCalled();
    expect(attendanceService.update).not.toHaveBeenCalled();
  });
});

describe('the body', () => {
  it('takes a calendar day, not a datetime', async () => {
    const [, [, path, body]] = WRITES[0];
    const res = await request(app)
      .post(path)
      .set('Authorization', 'Bearer SDIT_GURU')
      .send({ ...body, date: '2026-09-25T17:00:00.000Z' });
    expect(res.status).toBe(400);
    expect(attendanceService.bulkCreate).not.toHaveBeenCalled();
  });
});

describe('GET /attendance/me/classes', () => {
  it('answers anyone signed in — a register-less account gets an empty list', async () => {
    const res = await request(app)
      .get('/attendance/me/classes')
      .set('Authorization', 'Bearer SDIT_ORANG_TUA');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ scope: 'ASSIGNED', unitId: null, classes: [] });
  });
});
