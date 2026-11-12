import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * #749 for the Portofolio module: the write routes must accept the flat body the
 * web form sends. `createPortfolioSchema` (and its siblings) wrapped their
 * fields in `{ body: z.object({ … }) }`, so `validate()` looked for
 * `req.body.body` and answered 400 on every Simpan.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../portfolio.service', () => ({
  PORTFOLIO_TYPES: ['ACADEMIC'],
  PORTFOLIO_CATEGORIES: ['x'],
  createPortfolio: vi.fn(async () => ({ id: 'pf-1' })),
  updatePortfolio: vi.fn(async () => ({ id: 'pf-1' })),
  getPortfolios: vi.fn(async () => ({ data: [], pagination: {} })),
  getPortfolioById: vi.fn(),
  deletePortfolio: vi.fn(),
  addPortfolioFile: vi.fn(),
  addPortfolioComment: vi.fn(),
  reviewPortfolio: vi.fn(),
  getPortfolioStatistics: vi.fn(),
  getStudentShowcase: vi.fn(),
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import portfolioRoutes from '../portfolio.routes';
import * as portfolioService from '../portfolio.service';

const app = express();
app.use(express.json());
app.use('/portfolio', portfolioRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'user-1',
    roleCode: 'SMPIT_GURU',
    unitId: 'unit-smp',
  })) as unknown as typeof verifyToken);
});

describe('Portofolio write routes accept the web form body (#749)', () => {
  it('POST / reaches the service with a flat body', async () => {
    const res = await request(app).post('/portfolio').set({ Authorization: 'Bearer t' }).send({
      studentId: '00000000-0000-4000-8000-000000000000',
      title: 'Proyek P5',
      type: 'ACADEMIC',
      description: 'Deskripsi',
    });

    expect(res.status).toBe(201);
    expect(portfolioService.createPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Proyek P5', type: 'ACADEMIC' }),
      expect.objectContaining({ sub: 'user-1' })
    );
  });

  it('a body missing a required field is still 400 (validation still bites)', async () => {
    const res = await request(app)
      .post('/portfolio')
      .set({ Authorization: 'Bearer t' })
      .send({ title: 'tanpa studentId' });

    expect(res.status).toBe(400);
    expect(portfolioService.createPortfolio).not.toHaveBeenCalled();
  });
});
