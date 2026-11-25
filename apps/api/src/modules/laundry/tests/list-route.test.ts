import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// `GET /laundry/transactions` (#1010, R22.4, R22.11, R22.12): the query is the
// shared `listLaundryTransactionsQuerySchema`, validated at the route, so the
// service only ever sees a page ≥ 1, a limit of 1–100 and a trimmed search.
// The Portal's search box and status filter send exactly these parameters.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../laundry.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../laundry.service')>();
  return {
    ...actual,
    transactionService: {
      ...actual.transactionService,
      getAll: vi.fn(async () => ({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      })),
    },
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

const list = (query = '') =>
  request(app).get(`/laundry/transactions${query}`).set({ Authorization: 'Bearer t' });

/** The query the controller handed the service on the last call. */
const passedQuery = () =>
  vi.mocked(transactionService.getAll).mock.calls.at(-1)![1] as Record<string, unknown>;

describe('GET /laundry/transactions — pagination (R22.4)', () => {
  it('defaults to page 1 and 20 rows', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(passedQuery()).toMatchObject({ page: 1, limit: 20 });
  });

  it('passes an explicit page and limit through, as numbers', async () => {
    const res = await list('?page=3&limit=50');
    expect(res.status).toBe(200);
    expect(passedQuery()).toMatchObject({ page: 3, limit: 50 });
  });

  it.each([
    ['limit 0', '?limit=0'],
    ['limit above 100', '?limit=101'],
    ['page 0', '?page=0'],
    ['a fractional limit', '?limit=2.5'],
  ])('rejects %s with 400, before the service runs', async (_label, query) => {
    const res = await list(query);
    expect(res.status).toBe(400);
    expect(transactionService.getAll).not.toHaveBeenCalled();
  });
});

describe('GET /laundry/transactions — search and status (R22.11, R22.12)', () => {
  it('passes the search text through', async () => {
    const res = await list('?search=Fauzi');
    expect(res.status).toBe(200);
    expect(passedQuery()).toMatchObject({ search: 'Fauzi' });
  });

  it('trims the search text', async () => {
    await list('?search=%20Fauzi%20');
    expect(passedQuery()).toMatchObject({ search: 'Fauzi' });
  });

  it('rejects a search longer than 100 characters', async () => {
    const res = await list(`?search=${'a'.repeat(101)}`);
    expect(res.status).toBe(400);
  });

  it('accepts every status the shared flow names and rejects one it does not', async () => {
    for (const status of ['RECEIVED', 'WASHING', 'DRYING', 'IRONING', 'READY', 'DELIVERED']) {
      const res = await list(`?status=${status}`);
      expect(res.status, status).toBe(200);
    }
    expect((await list('?status=PENDING')).status).toBe(400);
    expect((await list('?status=PROCESSING')).status).toBe(400);
  });
});
