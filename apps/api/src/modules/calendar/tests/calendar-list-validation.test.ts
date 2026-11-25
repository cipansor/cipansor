import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Exercise the real controller and route, not the controller stub used by
// calendar-routes-access.test.ts: a malformed list query must reach the Zod
// validator and come back as 400 before the service is called.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('../calendar.service', () => ({
  calendarService: { findAll: vi.fn(), update: vi.fn() },
}));
vi.mock('../holiday-sync.service', () => ({
  approveHolidayDraft: vi.fn(),
  getHolidaySyncConfig: vi.fn(),
  listHolidayDrafts: vi.fn(),
  rejectHolidayDraft: vi.fn(),
  syncHolidaysForYear: vi.fn(),
  updateHolidaySyncConfig: vi.fn(),
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import calendarRoutes from '../calendar.routes';
import { calendarService } from '../calendar.service';

const app = express();
app.use(express.json());
app.use('/calendar', calendarRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'u-SDIT_ADMIN',
    roleCode: 'SDIT_ADMIN',
    unitId: 'unit-sd',
  })) as unknown as typeof verifyToken);
  vi.mocked(calendarService.findAll).mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
  } as never);
  vi.mocked(calendarService.update).mockResolvedValue({ id: 'event-1' } as never);
});

const list = (query: string) =>
  request(app).get(`/calendar?${query}`).set('Authorization', 'Bearer SDIT_ADMIN');

describe('GET /calendar — list query validation', () => {
  it('returns 400 for an invalid manage value and never calls the service', async () => {
    const res = await list('manage=yes');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(calendarService.findAll).not.toHaveBeenCalled();
  });

  it('accepts a page size above the portal’s 100-row month request', async () => {
    const res = await list('limit=101');

    expect(res.status).toBe(200);
    expect(calendarService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 101, manage: false }),
      expect.anything()
    );
  });
});

describe('PUT /calendar/:id — update body validation', () => {
  const update = (body: Record<string, unknown>) =>
    request(app).put('/calendar/event-1').set('Authorization', 'Bearer SDIT_ADMIN').send(body);

  it('returns 400 for a title longer than the create contract allows', async () => {
    const res = await update({ title: 'x'.repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(calendarService.update).not.toHaveBeenCalled();
  });

  it('passes an explicit null through to the service', async () => {
    const res = await update({ title: 'Revisi', endDate: null });

    expect(res.status).toBe(200);
    expect(calendarService.update).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ title: 'Revisi', endDate: null }),
      expect.anything()
    );
  });
});
