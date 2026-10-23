import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// `date` pada `POST /me` dan `GET /daily-report` adalah hari kalender WIB
// "yyyy-MM-dd". Sebelumnya `z.string()` menerima apa saja dan `new Date(...)`
// di controller/service menggeser harinya; sekarang sebuah datetime atau hari
// yang tidak ada dijawab 400, bukan disimpan pada hari lain. Lihat issue #888.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@prisma/client', () => ({
  UserRole: new Proxy({}, { get: (_t, p) => String(p) }),
  RoleCode: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../muhasabah.service', () => ({
  default: {
    findAll: vi.fn(async () => ({ data: [], pagination: {} })),
    findByStudentAndDate: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'm1' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getDailyReport: vi.fn(async () => ({})),
    getStats: vi.fn(async () => ({})),
    getGroupStats: vi.fn(async () => ({})),
  },
}));
vi.mock('@/middleware/auth', () => ({
  authenticate: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: `u-${req.headers.authorization}`, roleCode: 'SDIT_SISWA', permissions: [] };
    next();
  },
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireStudentId: vi.fn(async () => '22222222-2222-4222-8222-222222222222'),
}));

import { errorHandler } from '@/middleware/error';
import muhasabahRoutes from '../muhasabah.routes';

const app = express();
app.use(express.json());
app.use('/muhasabah', muhasabahRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
});

const STUDENT = 'SDIT_SISWA';
const TEACHER = 'SUPER_ADMIN';
const post = (roleCode: string, path: string, body: object) =>
  request(app).post(path).set('Authorization', `Bearer ${roleCode}`).send(body);
const get = (roleCode: string, path: string) =>
  request(app).get(path).set('Authorization', `Bearer ${roleCode}`);

describe('POST /muhasabah/me — date harus hari kalender WIB', () => {
  it('menerima hari kalender', async () => {
    const res = await post(STUDENT, '/muhasabah/me', { mood: 'GOOD', date: '2026-10-23' });
    expect(res.status).toBe(201);
  });

  it('menerima tanpa date (server memakai hari WIB)', async () => {
    const res = await post(STUDENT, '/muhasabah/me', { mood: 'GOOD' });
    expect(res.status).toBe(201);
  });

  it.each(['2026-02-30', '2026-13-45', '23-10-2026', '2026-10-23T00:00:00Z'])(
    'menjawab 400 untuk %s',
    async (date) => {
      const res = await post(STUDENT, '/muhasabah/me', { mood: 'GOOD', date });
      expect(res.status).toBe(400);
    }
  );
});

describe('GET /muhasabah/daily-report — date harus hari kalender WIB', () => {
  it('menerima hari kalender', async () => {
    const res = await get(TEACHER, '/muhasabah/daily-report?date=2026-10-23');
    expect(res.status).toBe(200);
  });

  it('menerima tanpa date (server memakai hari WIB)', async () => {
    const res = await get(TEACHER, '/muhasabah/daily-report');
    expect(res.status).toBe(200);
  });

  it.each(['2026-02-30', '23-10-2026'])('menjawab 400 untuk %s', async (date) => {
    const res = await get(TEACHER, `/muhasabah/daily-report?date=${date}`);
    expect(res.status).toBe(400);
  });
});
