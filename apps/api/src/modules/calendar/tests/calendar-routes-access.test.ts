import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Who reaches the calendar write routes at all. The service decides which unit
// or class an event may touch (calendar-access.test.ts); this pins the route
// gate so a governance role cannot inherit a write from the legacy
// `UNIT_ADMIN` bucket again.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('../calendar.controller', () => {
  const handler = (_req: unknown, res: { json: (body: unknown) => void }) => res.json({ ok: true });
  const calendarController = new Proxy({}, { get: () => handler }) as Record<
    string,
    typeof handler
  >;
  return { calendarController };
});

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import calendarRoutes from '../calendar.routes';

const app = express();
app.use(express.json());
app.use('/calendar', calendarRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((roleCode: string) => ({
    type: 'access',
    permissions: [],
    sub: `u-${roleCode}`,
    roleCode,
    unitId: roleCode.endsWith('_ADMIN') ? 'unit-sd' : null,
  })) as unknown as typeof verifyToken);
});

const validEvent = {
  title: 'Rapat',
  eventType: 'MEETING',
  startDate: '2026-12-01',
  isAllDay: true,
};

const send = (roleCode: string, method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(app)
    [method](path)
    .set('Authorization', `Bearer ${roleCode}`)
    .send(method === 'post' && path === '/calendar' ? validEvent : {});

describe.each(['SUPER_ADMIN', 'SDIT_ADMIN', 'YAYASAN_KETUA', 'YAYASAN_ANGGOTA'])(
  '%s may write the calendar',
  (roleCode) => {
    it.each([
      ['create', 'post', '/calendar'],
      ['update', 'put', '/calendar/event-1'],
      ['delete', 'delete', '/calendar/event-1'],
    ] as const)('reaches %s', async (_what, method, path) => {
      const res = await send(roleCode, method, path);
      expect([200, 201]).toContain(res.status);
    });
  }
);

describe.each(['YAYASAN_PENGAWAS', 'YAYASAN_PEMBINA', 'SDIT_GURU', 'SDIT_TATA_USAHA'])(
  '%s may not write the calendar',
  (roleCode) => {
    it.each([
      ['create', 'post', '/calendar'],
      ['update', 'put', '/calendar/event-1'],
      ['delete', 'delete', '/calendar/event-1'],
    ] as const)('is refused %s', async (_what, method, path) => {
      const res = await send(roleCode, method, path);
      expect(res.status).toBe(403);
    });
  }
);

describe.each(['SDIT_GURU', 'SDIT_SISWA', 'SDIT_ORANG_TUA', 'YAYASAN_PENGAWAS'])(
  '%s may read the calendar',
  (roleCode) => {
    it('reaches the list', async () => {
      const res = await send(roleCode, 'get', '/calendar');
      expect(res.status).toBe(200);
    });
  }
);
