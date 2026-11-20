import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Who may reach the payroll API at all (#990, R1.14, R1.32, R1.33).
 *
 * The route guards keep a role out *before* a record is read, so a refused
 * caller never learns whether an id exists and no service runs. The rules that
 * need a period — scope, creator, status — are `decidePayroll`'s and are
 * exercised in `payroll-period-pay.test.ts` and `payroll-policy.property.test.ts`.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../payroll.service', () => ({
  salaryComponentService: {
    list: vi.fn(async () => []),
    getById: vi.fn(),
    create: vi.fn(async () => ({ id: 'c1' })),
    update: vi.fn(),
    delete: vi.fn(),
    seedDefaults: vi.fn(),
  },
  employeeSalaryService: {
    list: vi.fn(async () => ({ data: [], meta: {} })),
    getByStaffId: vi.fn(),
    create: vi.fn(async () => ({ id: 's1' })),
    update: vi.fn(),
    delete: vi.fn(),
  },
  payrollPeriodService: {
    list: vi.fn(async () => ({ data: [], meta: {} })),
    getById: vi.fn(),
    create: vi.fn(async () => ({ id: 'p1' })),
    update: vi.fn(),
    approve: vi.fn(async () => ({ id: 'p1', status: 'APPROVED' })),
    markAsPaid: vi.fn(async () => ({ id: 'p1', status: 'PAID' })),
    cancel: vi.fn(),
    delete: vi.fn(),
    assertReadable: vi.fn(async () => ({ id: 'p1', unitId: 'unit-sd' })),
  },
  payrollService: {
    list: vi.fn(async () => ({ data: [], meta: {} })),
    getById: vi.fn(),
    generate: vi.fn(),
    adjustItem: vi.fn(),
    getSummary: vi.fn(),
  },
}));
vi.mock('../attendance-deduction.service', () => ({
  attendanceDeductionService: { computeForPeriod: vi.fn(async () => []) },
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import payrollRoutes from '../payroll.routes';
import * as payroll from '../payroll.service';

const app = express();
app.use(express.json());
app.use('/payroll', payrollRoutes);
app.use(errorHandler);

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

/** Roles R1.14 keeps out entirely, on a read and on a write. */
const OUTSIDE = ['SDIT_ADMIN', 'SDIT_KEPALA', 'SDIT_TATA_USAHA', 'SDIT_GURU', 'PESANTREN_ADMIN'];

beforeEach(() => vi.clearAllMocks());

describe('R1.14 — a role with no part in payroll is refused on every route', () => {
  it.each(OUTSIDE)('%s is refused on GET /payroll/periods with 403', async (roleCode) => {
    as(roleCode);
    const res = await authed(request(app).get('/payroll/periods'));
    expect(res.status).toBe(403);
    expect(payroll.payrollPeriodService.list).not.toHaveBeenCalled();
  });

  it.each(OUTSIDE)('%s is refused on POST /payroll/components with 403', async (roleCode) => {
    as(roleCode);
    const res = await authed(
      request(app).post('/payroll/components').send({ code: 'X', name: 'X' })
    );
    expect(res.status).toBe(403);
    expect(payroll.salaryComponentService.create).not.toHaveBeenCalled();
  });

  it('answers without any payroll data in the body', async () => {
    as('SDIT_GURU');
    const res = await authed(request(app).get('/payroll/slips'));
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });
});

describe('R1.32 — Super_Admin reads but never writes payroll', () => {
  it('may read', async () => {
    as('SUPER_ADMIN', null);
    const res = await authed(request(app).get('/payroll/periods'));
    expect(res.status).toBe(200);
  });

  it.each([
    ['post', '/payroll/components', { code: 'X', name: 'X' }],
    ['post', '/payroll/periods', { name: 'x', month: 1, year: 2026 }],
    ['post', '/payroll/periods/p1/approve', {}],
    ['post', '/payroll/periods/p1/pay', { payDate: '2026-06-25T00:00:00.000Z' }],
    ['post', '/payroll/periods/p1/cancel', {}],
    ['delete', '/payroll/periods/p1', undefined],
    ['post', '/payroll/generate', { periodId: 'p1' }],
    ['put', '/payroll/slips/s1/adjust', { componentId: 'c1', amount: 1 }],
  ] as const)('is refused on %s %s with 403', async (method, path, body) => {
    as('SUPER_ADMIN', null);
    const res = await authed(
      (request(app) as unknown as Record<string, (p: string) => request.Test>)
        [method](path)
        .send(body)
    );
    expect(res.status).toBe(403);
    expect(payroll.payrollPeriodService.markAsPaid).not.toHaveBeenCalled();
    expect(payroll.payrollPeriodService.approve).not.toHaveBeenCalled();
    expect(payroll.payrollService.generate).not.toHaveBeenCalled();
    expect(payroll.payrollService.adjustItem).not.toHaveBeenCalled();
  });
});

describe('R1.33 — an organ that is neither treasurer nor approver is refused writes', () => {
  it.each(['YAYASAN_PEMBINA', 'YAYASAN_SEKRETARIS', 'YAYASAN_ANGGOTA', 'YAYASAN_PENGAWAS'])(
    '%s is refused POST /payroll/periods with 403',
    async (roleCode) => {
      as(roleCode, null);
      const res = await authed(
        request(app).post('/payroll/periods').send({ name: 'x', month: 1, year: 2026 })
      );
      expect(res.status).toBe(403);
      expect(payroll.payrollPeriodService.create).not.toHaveBeenCalled();
    }
  );

  it('YAYASAN_KETUA is refused a component write (R1.23)', async () => {
    as('YAYASAN_KETUA', null);
    const res = await authed(
      request(app).post('/payroll/components').send({ code: 'X', name: 'X' })
    );
    expect(res.status).toBe(403);
    expect(payroll.salaryComponentService.create).not.toHaveBeenCalled();
  });

  it('YAYASAN_KETUA is refused a period write — approving is not drafting', async () => {
    as('YAYASAN_KETUA', null);
    const res = await authed(
      request(app).post('/payroll/periods').send({ name: 'x', month: 1, year: 2026 })
    );
    expect(res.status).toBe(403);
  });
});

describe('R1.26 / R1.28 — the approver is not the payer', () => {
  it.each(['YAYASAN_BENDAHARA', 'YAYASAN_KETUA'])(
    '%s is refused POST /payroll/periods/:id/pay with 403',
    async (roleCode) => {
      as(roleCode, null);
      const res = await authed(
        request(app).post('/payroll/periods/p1/pay').send({ payDate: '2026-06-25T00:00:00.000Z' })
      );
      expect(res.status).toBe(403);
      expect(payroll.payrollPeriodService.markAsPaid).not.toHaveBeenCalled();
    }
  );

  it.each(['SDIT_BENDAHARA', 'SMPIT_BENDAHARA'])(
    '%s is refused POST /payroll/periods/:id/approve with 403',
    async (roleCode) => {
      as(roleCode, 'unit-sd');
      const res = await authed(request(app).post('/payroll/periods/p1/approve').send({}));
      expect(res.status).toBe(403);
      expect(payroll.payrollPeriodService.approve).not.toHaveBeenCalled();
    }
  );
});

describe('the accepted paths still reach their service', () => {
  it('Bendahara_Unit pays its own unit period', async () => {
    as('SDIT_BENDAHARA', 'unit-sd');
    const res = await authed(
      request(app).post('/payroll/periods/p1/pay').send({ payDate: '2026-06-25T00:00:00.000Z' })
    );
    expect(res.status).toBe(200);
    expect(payroll.payrollPeriodService.markAsPaid).toHaveBeenCalledWith(
      { sub: 'u1', roleCode: 'SDIT_BENDAHARA', unitId: 'unit-sd' },
      'p1',
      new Date('2026-06-25T00:00:00.000Z'),
      undefined
    );
  });

  it('YAYASAN_BENDAHARA approves', async () => {
    as('YAYASAN_BENDAHARA', null);
    const res = await authed(request(app).post('/payroll/periods/p1/approve').send({}));
    expect(res.status).toBe(200);
    expect(payroll.payrollPeriodService.approve).toHaveBeenCalled();
  });

  it('YAYASAN_BENDAHARA writes a component', async () => {
    as('YAYASAN_BENDAHARA', null);
    const res = await authed(
      request(app)
        .post('/payroll/components')
        .send({ code: 'TUNJ_X', name: 'Tunjangan X', type: 'EARNING' })
    );
    expect(res.status).toBe(201);
    expect(payroll.salaryComponentService.create).toHaveBeenCalled();
  });

  it('the attendance-deductions preview is scoped before it computes (R1.17)', async () => {
    as('SDIT_BENDAHARA', 'unit-sd');
    const res = await authed(request(app).get('/payroll/periods/p1/attendance-deductions'));
    expect(res.status).toBe(200);
    expect(payroll.payrollPeriodService.assertReadable).toHaveBeenCalledWith(
      { sub: 'u1', roleCode: 'SDIT_BENDAHARA', unitId: 'unit-sd' },
      'p1'
    );
  });

  it('refuses a payDate that is not ISO-8601 with 400', async () => {
    as('SDIT_BENDAHARA', 'unit-sd');
    const res = await authed(
      request(app).post('/payroll/periods/p1/pay').send({ payDate: '25-06-2026' })
    );
    expect(res.status).toBe(400);
    expect(payroll.payrollPeriodService.markAsPaid).not.toHaveBeenCalled();
  });
});
