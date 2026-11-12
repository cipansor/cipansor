import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * The controller must pass `unitId` from `req.query` to the service. The
 * service test pins the query shape, but nothing else would notice the
 * controller dropping the parameter — the HTTP request for `?unitId=unit-1`
 * would silently return the unscoped list.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../finance-enhancement.service', () => ({
  financeEnhancementService: {
    getAccountCodes: vi.fn(async () => ({
      success: true,
      data: [],
      meta: { pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    })),
  },
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import { financeEnhancementRoutes } from '../index';
import { financeEnhancementService } from '../finance-enhancement.service';

const app = express();
app.use(express.json());
app.use('/finance-enhancement', financeEnhancementRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'user-1',
    id: 'user-1',
    roleCode: 'SMPIT_ADMIN',
    unitId: 'unit-smp',
  })) as unknown as typeof verifyToken);
});

const authed = (r: request.Test) => r.set({ Authorization: 'Bearer t' });

describe('GET /finance-enhancement/account-codes forwards the unit filter', () => {
  it('passes ?unitId to the service', async () => {
    const res = await authed(
      request(app).get('/finance-enhancement/account-codes?type=EXPENSE&unitId=unit-1')
    );
    expect(res.status).toBe(200);
    expect(financeEnhancementService.getAccountCodes).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXPENSE', unitId: 'unit-1' })
    );
  });

  it('leaves unitId undefined when the query omits it', async () => {
    const res = await authed(request(app).get('/finance-enhancement/account-codes?type=EXPENSE'));
    expect(res.status).toBe(200);
    expect(financeEnhancementService.getAccountCodes).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXPENSE', unitId: undefined })
    );
  });
});
