import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// R27.9–R27.11 (#989, PR-03): PATCH /laundry/transactions/:id/status. A
// transaction that does not exist, is outside the caller's laundryReadScope, or
// (for a non-Super_Admin) belongs to another unit is answered 404 — the same
// body for every case, replacing the 500 the endpoint used to give. A move
// outside the status flow is 409 naming the current and the requested status. A
// Super_Admin reaches any unit, including with no unit on the token, replacing
// the old 400 "Unit ID atau User ID tidak ditemukan". Fails on the pre-fix code
// and passes after.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  laundryTransaction: { findFirst: vi.fn(), update: vi.fn() },
  laundryStatusLog: { create: vi.fn() },
  journalEntry: { findMany: vi.fn(), create: vi.fn() },
  santriWallet: { findUnique: vi.fn(), update: vi.fn() },
  walletTransaction: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/modules/finance-enhancement/period.service', () => ({
  isPeriodOpen: vi.fn().mockResolvedValue(true),
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import laundryRoutes from '../laundry.routes';

const UNIT = 'unit-a';
const OTHER = 'unit-b';
const TX = 'tx-1';

const TOKENS = {
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  staffA: { roleCode: 'SMPIT_TATA_USAHA', unitId: UNIT },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/laundry', laundryRoutes);
app.use(errorHandler);

const patch = (who: Who, status: string, id = TX) =>
  request(app)
    .patch(`/laundry/transactions/${id}/status`)
    .set('Authorization', `Bearer ${who}`)
    .send({ status });

const transaction = (status: string, unitId = UNIT) => ({
  id: TX,
  unitId,
  status,
  paymentStatus: 'UNPAID',
  walletId: null,
  total: 0,
  transactionNo: 'LDR-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);

  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.laundryTransaction.update.mockImplementation(
    async ({ data }: any) => ({ id: TX, status: data.status }) as any
  );
  prismaMock.laundryStatusLog.create.mockResolvedValue({} as any);
});

describe('R27.9 — a missing, out-of-scope or other-unit transaction is 404', () => {
  it('a transaction that does not exist is 404 (not 500)', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(null);
    const res = await patch('staffA', 'WASHING');
    expect(res.status).toBe(404);
    expect(prismaMock.laundryTransaction.update).not.toHaveBeenCalled();
  });

  it('a transaction of another unit is 404 and is left unchanged', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(transaction('RECEIVED', OTHER));
    const res = await patch('staffA', 'WASHING');
    expect(res.status).toBe(404);
    expect(prismaMock.laundryTransaction.update).not.toHaveBeenCalled();
  });

  it('the three 404s read the same', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(null);
    const missing = await patch('staffA', 'WASHING');
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(transaction('RECEIVED', OTHER));
    const otherUnit = await patch('staffA', 'WASHING');
    expect(missing.status).toBe(404);
    expect(otherUnit.status).toBe(404);
    expect(otherUnit.body).toEqual(missing.body);
  });
});

describe('R27.10 — a move outside the flow is 409 naming both statuses', () => {
  it('RECEIVED → DELIVERED is 409 with the current and requested status', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(transaction('RECEIVED'));
    const res = await patch('staffA', 'DELIVERED');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('RECEIVED');
    expect(res.body.error.message).toContain('DELIVERED');
    expect(prismaMock.laundryTransaction.update).not.toHaveBeenCalled();
  });

  it('DELIVERED → anything is 409', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(transaction('DELIVERED'));
    const res = await patch('staffA', 'READY');
    expect(res.status).toBe(409);
  });

  it('a move the flow allows is 200', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(transaction('RECEIVED'));
    const res = await patch('staffA', 'WASHING');
    expect(res.status).toBe(200);
    expect(prismaMock.laundryTransaction.update).toHaveBeenCalled();
  });
});

describe('R27.11 — a Super_Admin reaches any unit, even with no unit on the token', () => {
  it('changes a transaction of another unit following the flow (200)', async () => {
    prismaMock.laundryTransaction.findFirst.mockResolvedValue(transaction('RECEIVED', OTHER));
    const res = await patch('superAdmin', 'WASHING');
    expect(res.status).toBe(200);
    expect(prismaMock.laundryTransaction.update).toHaveBeenCalled();
  });
});
