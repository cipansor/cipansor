import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /laundry/transactions/stats takes its range as two WIB calendar days.
// The service bounds them with wibDayStart/wibDayEnd, which turn a full ISO
// instant into `Invalid Date`; the route rejects anything but YYYY-MM-DD with a
// 400 before the service (and Prisma) ever sees it.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../laundry.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../laundry.service')>();
  return {
    ...actual,
    transactionService: { ...actual.transactionService, getStats: vi.fn(async () => ({})) },
  };
});

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import laundryRoutes from '../laundry.routes';
import { transactionService } from '../laundry.service';

const app = express();
app.use(express.json());
app.use('/laundry', laundryRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'u-admin',
    role: 'UNIT_ADMIN',
    roleCode: 'SMPIT_ADMIN',
    unitId: 'unit-smp',
  })) as unknown as typeof verifyToken);
});

const stats = (query: string) =>
  request(app).get(`/laundry/transactions/stats${query}`).set({ Authorization: 'Bearer t' });

describe('GET /laundry/transactions/stats', () => {
  it('passes a YYYY-MM-DD range through to the service', async () => {
    const res = await stats('?startDate=2026-11-01&endDate=2026-11-30');
    expect(res.status).toBe(200);
    expect(vi.mocked(transactionService.getStats).mock.calls[0].slice(1)).toEqual([
      '2026-11-01',
      '2026-11-30',
    ]);
  });

  it.each([
    ['a full ISO instant', '?startDate=2026-11-01T00:00:00Z&endDate=2026-11-30'],
    ['a non-date', '?startDate=kemarin&endDate=2026-11-30'],
  ])('rejects %s with 400, before the service runs', async (_label, query) => {
    const res = await stats(query);
    expect(res.status).toBe(400);
    expect(transactionService.getStats).not.toHaveBeenCalled();
  });
});
