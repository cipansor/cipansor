import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    growthRecord: { findFirst: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    medicalRecord: { findFirst: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    medication: { findFirst: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock('@/middleware/auth', async (orig) => {
  const actual = await orig<typeof import('@/middleware/auth')>();
  return {
    ...actual,
    authenticate: (req: Request, _res: Response, next: NextFunction) => {
      req.user = { sub: 'u-1', roleCode: 'SDIT_ADMIN', unitId: 'unit-1' } as never;
      next();
    },
    hasPermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

import { app } from '@/app';
import { prisma } from '@/lib/prisma';

const mocked = prisma as unknown as {
  growthRecord: Record<string, ReturnType<typeof vi.fn>>;
  medicalRecord: Record<string, ReturnType<typeof vi.fn>>;
  medication: Record<string, ReturnType<typeof vi.fn>>;
};

const UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

/**
 * Every `:id` on a health mutation is a UUID column. Without a Zod boundary a
 * non-UUID string flowed straight into a Prisma lookup (CWE-20), so each route
 * must refuse it with 400 and never touch the database.
 */
describe.each([
  ['DELETE', '/api/health/growth', 'growthRecord'],
  ['PUT', '/api/health/records', 'medicalRecord'],
  ['DELETE', '/api/health/records', 'medicalRecord'],
  ['PUT', '/api/health/medications', 'medication'],
  ['DELETE', '/api/health/medications', 'medication'],
] as const)('%s %s/:id', (method, base, model) => {
  it('rejects a non-UUID id at the edge, before any query', async () => {
    const res = await request(app)
      [method === 'PUT' ? 'put' : 'delete'](`${base}/not-a-uuid`)
      .send({});
    expect(res.status).toBe(400);
    expect(mocked[model].findFirst).not.toHaveBeenCalled();
    expect(mocked[model].delete).not.toHaveBeenCalled();
    expect(mocked[model].deleteMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/health/growth/:id', () => {
  it('passes a valid UUID through to the scoped delete', async () => {
    mocked.growthRecord.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app).delete(`/api/health/growth/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mocked.growthRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: UUID, student: { unitId: 'unit-1' } },
    });
  });

  it('answers 404 for a record outside the caller scope', async () => {
    mocked.growthRecord.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete(`/api/health/growth/${UUID}`);
    expect(res.status).toBe(404);
  });
});
