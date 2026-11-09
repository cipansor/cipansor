import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /canteen/transactions/stats takes its range as two WIB calendar days.
// The service bounds them with wibDayStart/wibDayEnd, which turn a full ISO
// instant into `Invalid Date`; the route rejects anything but YYYY-MM-DD with a
// 400 before the service (and Prisma) ever sees it.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../canteen.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canteen.service')>();
  return {
    ...actual,
    transactionService: { ...actual.transactionService, getStats: vi.fn(async () => ({})) },
  };
});

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import canteenRoutes from '../canteen.routes';
import { transactionService } from '../canteen.service';

const app = express();
app.use(express.json());
app.use('/canteen', canteenRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'u-admin',
    roleCode: 'SMPIT_ADMIN',
    unitId: 'unit-smp',
  })) as unknown as typeof verifyToken);
});

const stats = (query: string) =>
  request(app).get(`/canteen/transactions/stats${query}`).set({ Authorization: 'Bearer t' });

describe('GET /canteen/transactions/stats', () => {
  it('answers today when no range is given', async () => {
    const res = await stats('');
    expect(res.status).toBe(200);
    expect(transactionService.getStats).toHaveBeenCalledWith('unit-smp', undefined, undefined);
  });

  it('passes a YYYY-MM-DD range through to the service', async () => {
    const res = await stats('?startDate=2026-11-01&endDate=2026-11-30');
    expect(res.status).toBe(200);
    expect(transactionService.getStats).toHaveBeenCalledWith(
      'unit-smp',
      '2026-11-01',
      '2026-11-30'
    );
  });

  it.each([
    ['a full ISO instant', '?startDate=2026-11-01T00:00:00Z&endDate=2026-11-30'],
    ['a non-date', '?startDate=kemarin&endDate=2026-11-30'],
    ['an impossible day', '?startDate=2026-02-30&endDate=2026-03-01'],
  ])('rejects %s with 400, before the service runs', async (_label, query) => {
    const res = await stats(query);
    expect(res.status).toBe(400);
    expect(transactionService.getStats).not.toHaveBeenCalled();
  });
});
