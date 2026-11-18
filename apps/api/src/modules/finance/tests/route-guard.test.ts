import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Route guards for the finance writes (#988, R26.2–R26.4, R26.10). A role that
 * is not Peran_Keuangan_Unit is refused at the route with 403 before any service
 * runs; a `status` on the invoice update is refused with 400 by the schema.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../finance.service', () => ({
  updateInvoice: vi.fn(async () => ({ id: 'inv-1' })),
  createPayment: vi.fn(async () => ({ id: 'pay-1' })),
  getInvoices: vi.fn(async () => ({ data: [], meta: {} })),
}));
vi.mock('../accounting.service', () => ({
  createManualJournal: vi.fn(async () => []),
  getJournals: vi.fn(async () => ({ data: [] })),
}));
vi.mock('../reports.service', () => ({}));
vi.mock('../accounting-config.service', () => ({}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import financeRoutes from '../finance.routes';
import * as financeService from '../finance.service';
import * as accountingService from '../accounting.service';

const app = express();
app.use(express.json());
app.use('/finance', financeRoutes);
app.use(errorHandler);

/** Authenticate as `roleCode` in `unitId`. */
function as(roleCode: string, unitId: string | null = 'unit-sd') {
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'u1',
    id: 'u1',
    roleCode,
    unitId,
  })) as unknown as typeof verifyToken);
}

const authed = (r: request.Test) => r.set({ Authorization: 'Bearer t' });

beforeEach(() => vi.clearAllMocks());

describe('PUT /finance/invoices/:id', () => {
  it('refuses Organ_Yayasan (YAYASAN_KETUA) with 403 and writes nothing (R26.3)', async () => {
    as('YAYASAN_KETUA', null);

    const res = await authed(request(app).put('/finance/invoices/inv-1').send({ amount: 1000 }));

    expect(res.status).toBe(403);
    expect(financeService.updateInvoice).not.toHaveBeenCalled();
  });

  it('refuses a Guru with 403', async () => {
    as('SDIT_GURU');

    const res = await authed(request(app).put('/finance/invoices/inv-1').send({ amount: 1000 }));

    expect(res.status).toBe(403);
    expect(financeService.updateInvoice).not.toHaveBeenCalled();
  });

  it('refuses a status column with 400 and leaves the bill unchanged (R26.2)', async () => {
    as('SDIT_ADMIN');

    const res = await authed(request(app).put('/finance/invoices/inv-1').send({ status: 'PAID' }));

    expect(res.status).toBe(400);
    expect(financeService.updateInvoice).not.toHaveBeenCalled();
  });

  it('lets a Bendahara_Unit through', async () => {
    as('SDIT_BENDAHARA');

    const res = await authed(request(app).put('/finance/invoices/inv-1').send({ amount: 1000 }));

    expect(res.status).toBe(200);
    expect(financeService.updateInvoice).toHaveBeenCalledTimes(1);
  });
});

describe('POST /finance/payments', () => {
  const body = {
    invoiceId: '44444444-4444-4444-8444-444444444444',
    amount: 1000,
    method: 'CASH',
  };

  it('refuses Organ_Yayasan with 403 and writes nothing (R26.4)', async () => {
    as('YAYASAN_KETUA', null);

    const res = await authed(request(app).post('/finance/payments').send(body));

    expect(res.status).toBe(403);
    expect(financeService.createPayment).not.toHaveBeenCalled();
  });

  it('lets STAFF (TU_Unit) through', async () => {
    as('SDIT_TATA_USAHA');

    const res = await authed(request(app).post('/finance/payments').send(body));

    expect(res.status).toBe(201);
    expect(financeService.createPayment).toHaveBeenCalledTimes(1);
  });
});

describe('POST /finance/accounting/journals', () => {
  const body = {
    unitId: '11111111-1111-4111-8111-111111111111',
    date: '2026-03-01T00:00:00.000Z',
    description: 'Jurnal',
    entries: [
      { accountId: '22222222-2222-4222-8222-222222222222', debit: 1000, credit: 0 },
      { accountId: '33333333-3333-4333-8333-333333333333', debit: 0, credit: 1000 },
    ],
  };

  it('refuses Organ_Yayasan with 403 and posts nothing (R26.4)', async () => {
    as('YAYASAN_KETUA', null);

    const res = await authed(request(app).post('/finance/accounting/journals').send(body));

    expect(res.status).toBe(403);
    expect(accountingService.createManualJournal).not.toHaveBeenCalled();
  });

  it('lets a unit admin through', async () => {
    as('SDIT_ADMIN');

    const res = await authed(request(app).post('/finance/accounting/journals').send(body));

    expect(res.status).toBe(201);
    expect(accountingService.createManualJournal).toHaveBeenCalledTimes(1);
  });
});
