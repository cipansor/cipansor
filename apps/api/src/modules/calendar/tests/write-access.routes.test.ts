import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Who may write the calendar. The legacy `authorize(SUPER_ADMIN, UNIT_ADMIN)`
// buckets every yayasan code into UNIT_ADMIN, so Pengawas — the auditor whose
// permission set is read-only — could publish a unit holiday. These pin the
// permission gate that replaced it.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../calendar.controller', () => {
  const handler = (
    _req: unknown,
    res: { status: (n: number) => { json: (body: unknown) => void } }
  ) => res.status(200).json({ ok: true });
  return {
    calendarController: {
      listEvents: handler,
      getStatistics: handler,
      getUpcomingEvents: handler,
      getTodayEvents: handler,
      getHolidays: handler,
      createEvent: handler,
      bulkCreateEvents: handler,
      importAcademicCalendar: handler,
      getHolidaySyncConfig: handler,
      updateHolidaySyncConfig: handler,
      syncHolidays: handler,
      listHolidayDrafts: handler,
      approveHolidayDraft: handler,
      rejectHolidayDraft: handler,
      getEventById: handler,
      updateEvent: handler,
      deleteEvent: handler,
    },
  };
});

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import { PERMISSIONS, permissionsForRoleCode } from '@/modules/roles/permissions';
import calendarRoutes from '../calendar.routes';

const app = express();
app.use(express.json());
app.use('/calendar', calendarRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((roleCode: string) => ({
    type: 'access',
    sub: `u-${roleCode}`,
    roleCode,
    unitId: 'unit-sd',
    permissions: permissionsForRoleCode(roleCode),
  })) as unknown as typeof verifyToken);
});

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

const validEvent = {
  title: 'Rapat e2e',
  eventType: 'MEETING',
  startDate: '2026-12-01',
  isAllDay: true,
};

type Method = 'get' | 'post' | 'put' | 'delete';
type Write = [string, Method, string, object?];

const WRITES: Write[] = [
  ['an event', 'post', '/calendar', validEvent],
  ['a bulk import', 'post', '/calendar/bulk', { events: [validEvent] }],
  ['an academic-calendar import', 'post', '/calendar/import', { events: [] }],
  ['a holiday sync', 'post', '/calendar/holidays/sync', {}],
  ['an edit', 'put', `/calendar/${EVENT_ID}`, { title: 'Revisi' }],
  ['a delete', 'delete', `/calendar/${EVENT_ID}`],
];

// Approving or rejecting an imported holiday changes work days, so it is
// narrower than the rest of the calendar writes: only SUPER_ADMIN and the
// per-unit admins may do it. A kepala sekolah may write ordinary agenda but
// must not adopt a holiday.
const HOLIDAY_REVIEW_WRITES: Write[] = [
  ['a holiday draft approval', 'post', `/calendar/holidays/drafts/${EVENT_ID}/approve`, {}],
  ['a holiday draft rejection', 'post', `/calendar/holidays/drafts/${EVENT_ID}/reject`, {}],
];

const send = (roleCode: string, method: Method, path: string, body?: object) =>
  request(app)[method](path).set('Authorization', `Bearer ${roleCode}`).send(body);

describe.each([
  'SUPER_ADMIN',
  'SDIT_ADMIN',
  'SDIT_KEPALA_SEKOLAH',
  'YAYASAN_KETUA',
  'YAYASAN_SEKRETARIS',
  'YAYASAN_BENDAHARA',
  'YAYASAN_ANGGOTA',
])('%s', (roleCode) => {
  it.each(WRITES)('may write %s', async (_label, method, path, body) => {
    const res = await send(roleCode, method, path, body);
    expect(res.status).not.toBe(403);
  });
});

describe.each(['SUPER_ADMIN', 'SDIT_ADMIN'])('%s', (roleCode) => {
  it.each(HOLIDAY_REVIEW_WRITES)('may review %s', async (_label, method, path, body) => {
    const res = await send(roleCode, method, path, body);
    expect(res.status).not.toBe(403);
  });
});

describe('SDIT_KEPALA_SEKOLAH', () => {
  it.each(HOLIDAY_REVIEW_WRITES)('is refused %s: 403', async (_label, method, path, body) => {
    const res = await send('SDIT_KEPALA_SEKOLAH', method, path, body);
    expect(res.status).toBe(403);
  });
});

it('refuses a governance role that somehow holds ACADEMIC_MANAGE', async () => {
  // The permission check alone would admit it; the RoleCode gate must not.
  vi.mocked(verifyToken).mockImplementation(((roleCode: string) => ({
    type: 'access',
    sub: `u-${roleCode}`,
    roleCode,
    unitId: 'unit-sd',
    permissions: [PERMISSIONS.ACADEMIC_MANAGE],
  })) as unknown as typeof verifyToken);

  for (const [, method, path, body] of HOLIDAY_REVIEW_WRITES) {
    const res = await send('YAYASAN_PENGAWAS', method, path, body);
    expect(res.status).toBe(403);
  }
});

describe.each([
  'SUPER_ADMIN',
  'SDIT_ADMIN',
  'SDIT_KEPALA_SEKOLAH',
  'YAYASAN_KETUA',
  'YAYASAN_ANGGOTA',
])('%s may read holiday drafts', (roleCode) => {
  it('reaches the draft list', async () => {
    const res = await send(roleCode, 'get', '/calendar/holidays/drafts');
    expect(res.status).toBe(200);
  });
});

describe.each(['YAYASAN_PENGAWAS', 'SDIT_GURU', 'SDIT_TATA_USAHA'])(
  '%s may not read holiday drafts',
  (roleCode) => {
    it('is refused the draft list: 403', async () => {
      const res = await send(roleCode, 'get', '/calendar/holidays/drafts');
      expect(res.status).toBe(403);
    });
  }
);

describe.each(['SUPER_ADMIN', 'SDIT_ADMIN', 'YAYASAN_PENGAWAS'])(
  '%s may read the holiday-sync config',
  (roleCode) => {
    it('reaches the config', async () => {
      const res = await send(roleCode, 'get', '/calendar/holidays/config');
      expect(res.status).toBe(200);
    });
  }
);

describe.each(['SDIT_KEPALA_SEKOLAH', 'SDIT_GURU'])(
  '%s may not read the holiday-sync config',
  (roleCode) => {
    it('is refused the config: 403', async () => {
      const res = await send(roleCode, 'get', '/calendar/holidays/config');
      expect(res.status).toBe(403);
    });
  }
);

describe('the holiday-sync config is super-admin only', () => {
  it('lets SUPER_ADMIN change it', async () => {
    const res = await send('SUPER_ADMIN', 'put', '/calendar/holidays/config', {});
    expect(res.status).not.toBe(403);
  });

  it.each(['SDIT_ADMIN', 'SDIT_KEPALA_SEKOLAH', 'YAYASAN_KETUA'])(
    'refuses %s: 403',
    async (roleCode) => {
      const res = await send(roleCode, 'put', '/calendar/holidays/config', {});
      expect(res.status).toBe(403);
    }
  );
});

describe.each([
  'YAYASAN_PENGAWAS',
  'YAYASAN_PEMBINA',
  'SDIT_GURU',
  'SDIT_TATA_USAHA',
  'SDIT_SISWA',
  'SDIT_ORANG_TUA',
])('%s', (roleCode) => {
  it.each([...WRITES, ...HOLIDAY_REVIEW_WRITES])(
    'is refused %s: 403',
    async (_label, method, path, body) => {
      const res = await send(roleCode, method, path, body);
      expect(res.status).toBe(403);
    }
  );
});
