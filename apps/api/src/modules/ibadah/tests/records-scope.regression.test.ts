import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// R27.1–R27.3 (#989, PR-03): the three ibadah record writes. The route guard
// `isTeacherOrAbove` answers 403 before any id lookup; the service then narrows
// to the santri the caller may write (Super_Admin, an Admin_Unit/Kepala_Unit of
// the santri's unit, or a Relasi_Pengajaran including (d) wali kelas), answering
// 404 — the same body as a missing santri or record — for anyone else, and 400
// when the target is missing, inactive or of another unit. This test fails on
// the pre-fix code (which answered 201/200 for every caller and never checked
// the target) and passes after.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  student: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  teacher: { findFirst: vi.fn() },
  teacherSubject: { findMany: vi.fn() },
  takhosusEnrollment: { findMany: vi.fn() },
  musyrif: { findFirst: vi.fn() },
  class: { findMany: vi.fn() },
  roomAssignment: { findMany: vi.fn() },
  musyrifAssignment: { findMany: vi.fn() },
  dailyIbadahTarget: { findMany: vi.fn(), findUnique: vi.fn() },
  dailyIbadahRecord: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import ibadahRoutes from '../ibadah.routes';

const SMP = '11111111-1111-4111-8111-111111111111';
const SMA = '22222222-2222-4222-8222-222222222222';
const SANTRI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TARGET = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DATE = '2026-11-01T00:00:00.000Z';

const TOKENS = {
  // Guards: fails `isTeacherOrAbove` (403 before any lookup).
  student: { roleCode: 'SMPIT_SISWA', unitId: SMP },
  parent: { roleCode: 'SMPIT_ORANG_TUA', unitId: SMP },
  tuUnit: { roleCode: 'SMPIT_TATA_USAHA', unitId: SMP },
  yayasan: { roleCode: 'YAYASAN_KETUA', unitId: null },
  // Passes the guard; reach depends on relation/unit.
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  adminSmp: { roleCode: 'SMPIT_ADMIN', unitId: SMP },
  adminSma: { roleCode: 'SMAQ_ADMIN', unitId: SMA },
  guruSmp: { roleCode: 'SMPIT_GURU', unitId: SMP },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/ibadah', ibadahRoutes);
app.use(errorHandler);

const send = (who: Who, method: 'post' | 'put' | 'delete', path: string, body: object = {}) => {
  const req = request(app)[method](path).set('Authorization', `Bearer ${who}`);
  return req.send(body);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);

  // The santri is an SMP IT santri; the target belongs to their unit and is
  // active. No teaching relation exists unless a case sets one.
  prismaMock.student.findFirst.mockResolvedValue({ id: SANTRI, unitId: SMP });
  prismaMock.student.findUnique.mockResolvedValue({ id: SANTRI, unitId: SMP });
  prismaMock.student.findMany.mockResolvedValue([{ id: SANTRI, unitId: SMP, enrollments: [] }]);
  prismaMock.teacher.findFirst.mockResolvedValue({ id: 't-1', unitId: SMP });
  prismaMock.teacherSubject.findMany.mockResolvedValue([]);
  prismaMock.takhosusEnrollment.findMany.mockResolvedValue([]);
  prismaMock.musyrif.findFirst.mockResolvedValue(null);
  prismaMock.class.findMany.mockResolvedValue([]);
  prismaMock.dailyIbadahTarget.findMany.mockResolvedValue([
    { id: TARGET, points: 10, name: 'Tilawah Harian', category: 'TILAWAH' },
  ]);
  prismaMock.dailyIbadahRecord.create.mockResolvedValue({ id: RECORD });
  prismaMock.dailyIbadahRecord.upsert.mockResolvedValue({ id: RECORD });
  prismaMock.dailyIbadahRecord.findUnique.mockResolvedValue({
    id: RECORD,
    studentId: SANTRI,
    isCompleted: false,
    pointsEarned: 0,
    target: { id: TARGET, points: 10 },
  });
  prismaMock.dailyIbadahRecord.update.mockResolvedValue({ id: RECORD });
  prismaMock.dailyIbadahRecord.delete.mockResolvedValue({ id: RECORD });
  prismaMock.dailyIbadahRecord.updateMany.mockResolvedValue({ count: 1 });
  // `verifyRecords` loads the target rows to scope them; one record unless a
  // case says otherwise.
  prismaMock.dailyIbadahRecord.findMany.mockResolvedValue([{ studentId: SANTRI }]);
});

const CREATE_BODY = { targetId: TARGET, studentId: SANTRI, date: DATE, isCompleted: true };
const BULK_BODY = {
  studentId: SANTRI,
  date: DATE,
  records: [{ targetId: TARGET, isCompleted: true }],
};
const UPDATE_BODY = { isCompleted: true };

const WRITES: Array<[string, 'post' | 'put', string, object]> = [
  ['create record', 'post', '/ibadah/records', CREATE_BODY],
  ['bulk create records', 'post', '/ibadah/records/bulk', BULK_BODY],
  ['update record', 'put', `/ibadah/records/${RECORD}`, UPDATE_BODY],
];

function expectNoWrite() {
  expect(prismaMock.dailyIbadahRecord.create).not.toHaveBeenCalled();
  expect(prismaMock.dailyIbadahRecord.upsert).not.toHaveBeenCalled();
  expect(prismaMock.dailyIbadahRecord.update).not.toHaveBeenCalled();
  expect(prismaMock.dailyIbadahRecord.delete).not.toHaveBeenCalled();
  expect(prismaMock.dailyIbadahRecord.updateMany).not.toHaveBeenCalled();
}

describe('R27.1 — the three writes refuse a caller below isTeacherOrAbove with 403', () => {
  it.each(WRITES)('%s — a santri is 403 before any lookup', async (_name, method, path, body) => {
    const res = await send('student', method, path, body);
    expect(res.status).toBe(403);
    expect(prismaMock.dailyIbadahRecord.findUnique).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it.each(WRITES)('%s — a wali is 403', async (_name, method, path, body) => {
    expect((await send('parent', method, path, body)).status).toBe(403);
    expectNoWrite();
  });

  it.each(WRITES)('%s — a TU_Unit is 403', async (_name, method, path, body) => {
    expect((await send('tuUnit', method, path, body)).status).toBe(403);
    expectNoWrite();
  });

  it.each(WRITES)('%s — an Organ_Yayasan is 403', async (_name, method, path, body) => {
    expect((await send('yayasan', method, path, body)).status).toBe(403);
    expectNoWrite();
  });

  it('update record — 403 even when the id does not exist (guard first)', async () => {
    prismaMock.dailyIbadahRecord.findUnique.mockResolvedValue(null);
    const res = await send('student', 'put', `/ibadah/records/${RECORD}`, UPDATE_BODY);
    expect(res.status).toBe(403);
    expect(prismaMock.dailyIbadahRecord.findUnique).not.toHaveBeenCalled();
  });
});

describe('R27.2 — the three writes refuse a santri outside the caller’s reach with 404', () => {
  it.each(WRITES)('%s — another unit’s Admin_Unit is 404', async (_name, method, path, body) => {
    const res = await send('adminSma', method, path, body);
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  it.each(WRITES)(
    '%s — a Guru of the santri’s unit with no relation is 404',
    async (_name, method, path, body) => {
      const res = await send('guruSmp', method, path, body);
      expect(res.status).toBe(404);
      expectNoWrite();
    }
  );

  it('create record — an Admin_Unit of the santri’s unit is allowed (201, R27.2)', async () => {
    const res = await send('adminSmp', 'post', '/ibadah/records', CREATE_BODY);
    expect(res.status).toBe(201);
    expect(prismaMock.dailyIbadahRecord.create).toHaveBeenCalled();
  });

  it('create record — a Wali_Kelas with relation (d) only is allowed (201, R27.2)', async () => {
    // The teacher leads the santri's active class as homeroom teacher.
    prismaMock.class.findMany.mockResolvedValue([{ id: 'cls-1' }]);
    prismaMock.student.findMany.mockImplementation(async ({ select }: any) =>
      select?.enrollments
        ? [{ id: SANTRI, unitId: SMP, enrollments: [{ classId: 'cls-1' }] }]
        : [{ id: SANTRI, unitId: SMP }]
    );
    const res = await send('guruSmp', 'post', '/ibadah/records', CREATE_BODY);
    expect(res.status).toBe(201);
  });

  it('update record — the out-of-scope 404 reads like a missing record', async () => {
    const outOfScope = await send('guruSmp', 'put', `/ibadah/records/${RECORD}`, UPDATE_BODY);
    prismaMock.dailyIbadahRecord.findUnique.mockResolvedValue(null);
    const absent = await send('guruSmp', 'put', `/ibadah/records/${RECORD}`, UPDATE_BODY);
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });
});

describe('R27.3 — a target that is missing, inactive or of another unit is 400', () => {
  it.each([
    ['create record', 'post', '/ibadah/records', CREATE_BODY] as const,
    ['bulk create records', 'post', '/ibadah/records/bulk', BULK_BODY] as const,
  ])('%s — an unknown/inactive/other-unit target is 400', async (_name, method, path, body) => {
    prismaMock.dailyIbadahTarget.findMany.mockResolvedValue([]);
    const res = await send('adminSmp', method, path, body);
    expect(res.status).toBe(400);
    expectNoWrite();
  });

  it('create record — a valid target of the santri’s unit is accepted (201)', async () => {
    const res = await send('adminSmp', 'post', '/ibadah/records', CREATE_BODY);
    expect(res.status).toBe(201);
  });
});

describe('R27.2 — a Super_Admin writes any unit (201)', () => {
  it('create record for another unit’s santri', async () => {
    prismaMock.student.findFirst.mockResolvedValue({ id: SANTRI, unitId: SMA });
    prismaMock.student.findMany.mockResolvedValue([{ id: SANTRI, unitId: SMA, enrollments: [] }]);
    prismaMock.dailyIbadahTarget.findMany.mockResolvedValue([{ id: TARGET, points: 10 }]);
    const res = await send('superAdmin', 'post', '/ibadah/records', CREATE_BODY);
    expect(res.status).toBe(201);
  });
});

// The fourth ibadah write, `POST /ibadah/check-in`, was left unguarded: it took
// `studentId` from the body and upserted for that santri with no role, unit or
// relation check, so any authenticated account could write any unit's santri.
// It is now gated and scoped like the three above.
const CHECKIN_BODY = { studentId: SANTRI, date: DATE, sholatSubuh: 'JAMAAH' };
const CHECKIN = ['daily check-in', 'post', '/ibadah/check-in', CHECKIN_BODY] as const;

describe('R27.1 — the daily check-in refuses a caller below isTeacherOrAbove with 403', () => {
  it.each([
    ['a santri', 'student'],
    ['a wali', 'parent'],
    ['a TU_Unit', 'tuUnit'],
    ['an Organ_Yayasan', 'yayasan'],
  ] as const)('%s is 403 before any lookup', async (_label, who) => {
    const res = await send(who, CHECKIN[1], CHECKIN[2], CHECKIN[3]);
    expect(res.status).toBe(403);
    expect(prismaMock.student.findUnique).not.toHaveBeenCalled();
    expectNoWrite();
  });
});

describe('R27.2 — the daily check-in refuses a santri outside the caller’s reach with 404', () => {
  it.each([
    ['another unit’s Admin_Unit', 'adminSma'],
    ['a Guru of the santri’s unit with no relation', 'guruSmp'],
  ] as const)('%s is 404, and nothing is written', async (_label, who) => {
    const res = await send(who, CHECKIN[1], CHECKIN[2], CHECKIN[3]);
    expect(res.status).toBe(404);
    expectNoWrite();
  });

  it('a missing santri is 404 with the same body as one out of reach', async () => {
    const outOfScope = await send('adminSma', CHECKIN[1], CHECKIN[2], CHECKIN[3]);
    prismaMock.student.findUnique.mockResolvedValue(null);
    const absent = await send('adminSma', CHECKIN[1], CHECKIN[2], CHECKIN[3]);
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });

  it('an Admin_Unit of the santri’s unit is allowed, and writes (200)', async () => {
    const res = await send('adminSmp', CHECKIN[1], CHECKIN[2], CHECKIN[3]);
    expect(res.status).toBe(200);
    expect(prismaMock.dailyIbadahRecord.upsert).toHaveBeenCalled();
  });

  it('a Super_Admin writes another unit’s santri (200)', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: SANTRI, unitId: SMA });
    prismaMock.student.findMany.mockResolvedValue([{ id: SANTRI, unitId: SMA, enrollments: [] }]);
    const res = await send('superAdmin', CHECKIN[1], CHECKIN[2], CHECKIN[3]);
    expect(res.status).toBe(200);
    expect(prismaMock.dailyIbadahRecord.upsert).toHaveBeenCalled();
  });
});

// Two more sibling writes were left scoped only by the route guard:
// `DELETE /ibadah/records/:id` deleted any record by id, and
// `POST /ibadah/records/verify` verified any record ids — so a guru could
// delete or verify another unit's notes. Both now run `assertIbadahWriter`.
const DELETE = ['delete record', 'delete', `/ibadah/records/${RECORD}`, {}] as const;
const VERIFY_BODY = { recordIds: [RECORD] };
const VERIFY = ['verify records', 'post', '/ibadah/records/verify', VERIFY_BODY] as const;

describe('R27.1 — delete and verify refuse a caller below isTeacherOrAbove with 403', () => {
  it.each([
    ['a santri', 'student'],
    ['a wali', 'parent'],
    ['a TU_Unit', 'tuUnit'],
    ['an Organ_Yayasan', 'yayasan'],
  ] as const)('%s is 403 on delete and verify, before any lookup', async (_label, who) => {
    expect((await send(who, DELETE[1], DELETE[2])).status).toBe(403);
    expect((await send(who, VERIFY[1], VERIFY[2], VERIFY[3])).status).toBe(403);
    expect(prismaMock.dailyIbadahRecord.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.dailyIbadahRecord.findMany).not.toHaveBeenCalled();
    expectNoWrite();
  });
});

describe('R27.2 — delete and verify refuse a santri outside the caller’s reach with 404', () => {
  it.each([
    ['another unit’s Admin_Unit', 'adminSma'],
    ['a Guru of the santri’s unit with no relation', 'guruSmp'],
  ] as const)('%s is 404 on delete and verify, and nothing is written', async (_label, who) => {
    expect((await send(who, DELETE[1], DELETE[2])).status).toBe(404);
    expect((await send(who, VERIFY[1], VERIFY[2], VERIFY[3])).status).toBe(404);
    expectNoWrite();
  });

  it('delete — a missing record is 404 with the same body as one out of reach', async () => {
    const outOfScope = await send('adminSma', DELETE[1], DELETE[2]);
    prismaMock.dailyIbadahRecord.findUnique.mockResolvedValue(null);
    const absent = await send('adminSma', DELETE[1], DELETE[2]);
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });

  it('verify — a missing record id is 404 with the same body as one out of reach', async () => {
    const outOfScope = await send('adminSma', VERIFY[1], VERIFY[2], VERIFY[3]);
    prismaMock.dailyIbadahRecord.findMany.mockResolvedValue([]);
    const absent = await send('adminSma', VERIFY[1], VERIFY[2], VERIFY[3]);
    expect(outOfScope.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(outOfScope.body);
  });

  it('delete — an Admin_Unit of the santri’s unit is allowed (200)', async () => {
    const res = await send('adminSmp', DELETE[1], DELETE[2]);
    expect(res.status).toBe(200);
    expect(prismaMock.dailyIbadahRecord.delete).toHaveBeenCalled();
  });

  it('verify — an Admin_Unit of the santri’s unit is allowed (200)', async () => {
    const res = await send('adminSmp', VERIFY[1], VERIFY[2], VERIFY[3]);
    expect(res.status).toBe(200);
    expect(prismaMock.dailyIbadahRecord.updateMany).toHaveBeenCalled();
  });

  it('delete — a Super_Admin deletes another unit’s record (200)', async () => {
    prismaMock.student.findMany.mockResolvedValue([{ id: SANTRI, unitId: SMA, enrollments: [] }]);
    const res = await send('superAdmin', DELETE[1], DELETE[2]);
    expect(res.status).toBe(200);
  });
});
