import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * #749 for the Anggaran module: the budget and financial-period write routes
 * must accept the flat body the web form sends. The schemas used to be declared
 * inline in the routes wrapped in `{ body: z.object({ … }) }`, so `validate()`
 * looked for `req.body.body` and answered 400 on every Simpan.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../budget.service', () => ({
  createBudget: vi.fn(async () => ({ id: 'b-1' })),
  updateBudget: vi.fn(async () => ({ id: 'b-1' })),
  getBudgets: vi.fn(async () => ({ data: [], pagination: {} })),
  deleteBudget: vi.fn(async () => ({ success: true })),
  recalculateBudgetUsage: vi.fn(async () => ({ updated: 0 })),
  getBudgetUtilizationAlerts: vi.fn(async () => []),
}));
vi.mock('../period.service', () => ({
  createFinancialPeriod: vi.fn(async () => ({ id: 'fp-1' })),
  closePeriod: vi.fn(async () => ({ id: 'fp-1' })),
  getFinancialPeriods: vi.fn(async () => []),
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import { financeEnhancementRoutes } from '../index';
import * as budgetService from '../budget.service';
import * as periodService from '../period.service';

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

describe('Anggaran write routes accept the web form body (#749)', () => {
  it('POST /budgets reaches the service with a flat body', async () => {
    const res = await authed(request(app).post('/finance-enhancement/budgets')).send({
      unitId: '00000000-0000-4000-8000-0000000000aa',
      academicYearId: '00000000-0000-4000-8000-000000000001',
      accountId: '00000000-0000-4000-8000-000000000002',
      amount: 5000000,
      notes: 'ATK',
    });
    expect(res.status).toBe(201);
    expect(budgetService.createBudget).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000000, notes: 'ATK' }),
      expect.objectContaining({ sub: 'user-1' })
    );
  });

  it('PUT /budgets/:id reaches the service with a flat body', async () => {
    const res = await authed(request(app).put('/finance-enhancement/budgets/b-1')).send({
      amount: 6000000,
      notes: 'revisi',
    });
    expect(res.status).toBe(200);
    expect(budgetService.updateBudget).toHaveBeenCalledWith(
      'b-1',
      expect.objectContaining({ amount: 6000000 }),
      expect.objectContaining({ sub: 'user-1' })
    );
  });

  it('POST /financial-periods reaches the service with a flat body', async () => {
    const res = await authed(request(app).post('/finance-enhancement/financial-periods')).send({
      unitId: '00000000-0000-4000-8000-0000000000aa',
      name: 'Semester 1',
      startDate: '2026-07-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(periodService.createFinancialPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Semester 1' }),
      expect.objectContaining({ sub: 'user-1' })
    );
  });

  it('a body missing a required field is still 400 (validation still bites)', async () => {
    const res = await authed(request(app).post('/finance-enhancement/budgets')).send({
      notes: 'tanpa unit',
    });
    expect(res.status).toBe(400);
    expect(budgetService.createBudget).not.toHaveBeenCalled();
  });
});
