import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Measured 2026-09-24 on staging with a santri account: /analytics/export/*
// returned 164 santri and 1,271 invoices, /payroll/salaries and /slips the
// staff's salaries and bank accounts, /suppliers their addresses and bank
// details, /reception/guests the visitors' phone numbers. These drive the real
// routers with a mocked Prisma.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const defaults: Record<string, unknown> = {
    findMany: [],
    groupBy: [],
    count: 0,
    aggregate: { _count: { _all: 0 }, _sum: {}, _avg: {} },
  };
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      const fns: Record<string, ReturnType<typeof vi.fn>> = {};
      models.set(
        name,
        new Proxy(fns, {
          get: (t, k: string) => (t[k] ??= vi.fn(async () => defaults[k] ?? null)),
        })
      );
    }
    return models.get(name)!;
  };
  const raw = vi.fn(async () => []);
  return {
    prisma: new Proxy({}, { get: (_t, k: string) => (k.startsWith('$') ? raw : model(k)) }),
  };
});

import { verifyToken } from '@/lib/jwt';
import { prisma } from '@/lib/prisma';
import { errorHandler } from '@/middleware/error';
import analyticsRoutes from '@/modules/analytics/analytics.routes';
import payrollRoutes from '@/modules/payroll/payroll.routes';
import receptionRoutes from '@/modules/reception/reception.routes';
import { supplierRoutes as suppliersRoutes } from '@/modules/suppliers/suppliers.routes';

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  santri: { sub: 'u-santri', roleCode: 'SMPIT_SISWA', unitId: 'unit-smp' },
  wali: { sub: 'u-wali', roleCode: 'SMPIT_ORANG_TUA', unitId: 'unit-smp' },
  alumni: { sub: 'u-alumni', roleCode: 'SMAQ_ALUMNI', unitId: 'unit-sma' },
  komite: { sub: 'u-komite', roleCode: 'SMPIT_KOMITE', unitId: 'unit-smp' },
  guru: { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' },
  tu: { sub: 'u-tu', roleCode: 'SMPIT_TATA_USAHA', unitId: 'unit-smp' },
  bendahara: { sub: 'u-bend', roleCode: 'SMPIT_BENDAHARA', unitId: 'unit-smp' },
  kepala: { sub: 'u-kepala', roleCode: 'SMPIT_KEPALA_SEKOLAH', unitId: 'unit-smp' },
  admin: { sub: 'u-admin', roleCode: 'SMPIT_ADMIN', unitId: 'unit-smp' },
  ketua: { sub: 'u-ketua', roleCode: 'YAYASAN_KETUA', unitId: null },
};

const app = express();
app.use(express.json());
app.use('/analytics', analyticsRoutes);
app.use('/payroll', payrollRoutes);
app.use('/reception', receptionRoutes);
app.use('/suppliers', suppliersRoutes);
app.use(errorHandler);

const get = (path: string, who: string) =>
  request(app).get(path).set('Authorization', `Bearer ${who}`);
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const account = ACCOUNTS[token];
    if (!account) throw new Error('bad token');
    return { type: 'access', permissions: [], ...account };
  }) as any);
});

const EXTERNAL = ['santri', 'wali', 'alumni', 'komite'];

describe('staff-only reads refuse santri, wali, alumni and komite', () => {
  it.each([
    '/analytics/dashboard',
    '/analytics/finance',
    '/analytics/export/students',
    '/analytics/export/finance',
    '/payroll/salaries',
    '/payroll/slips',
    '/suppliers',
    '/reception/guests',
    '/reception/visits',
  ])('GET %s', async (path) => {
    for (const who of EXTERNAL) {
      expect((await get(path, who)).status, `${who} GET ${path}`).toBe(403);
    }
  });

  it('reception writes too', async () => {
    const res = await request(app)
      .post('/reception/guests')
      .set('Authorization', 'Bearer santri')
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('staff keep what their work needs', () => {
  it.each([
    ['guru', '/analytics/dashboard'],
    ['tu', '/suppliers'],
    ['tu', '/reception/guests'],
    ['bendahara', '/payroll/slips'],
    ['ketua', '/payroll/salaries'],
    ['ketua', '/payroll/periods'],
    ['kepala', '/analytics/export/students'],
  ])('%s GET %s passes the guard', async (who, path) => {
    expect([401, 403]).not.toContain((await get(path, who)).status);
  });
});

describe('payroll is for payroll', () => {
  // Admin_Unit joins the teachers and the office here: salary is an employee's
  // personal data and a unit administrator has no part in paying it (#990,
  // R1.14 — this line read `admin` → 200 before).
  it.each(['guru', 'tu', 'kepala', 'admin'])('%s cannot read salaries or slips', async (who) => {
    expect((await get('/payroll/salaries', who)).status).toBe(403);
    expect((await get('/payroll/slips', who)).status).toBe(403);
    expect((await get('/payroll/periods', who)).status).toBe(403);
  });
});

describe('exports', () => {
  it.each(['guru', 'tu', 'bendahara'])('%s cannot export', async (who) => {
    expect((await get('/analytics/export/students', who)).status).toBe(403);
  });

  it('a kepala sekolah exports their own unit, whatever ?unitId= says', async () => {
    await get('/analytics/export/students?unitId=unit-other', 'kepala');
    const arg = db.student.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ unitId: 'unit-smp' });
  });

  it('the yayasan board may pick a unit', async () => {
    await get('/analytics/export/students?unitId=unit-other', 'ketua');
    const arg = db.student.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ unitId: 'unit-other' });
  });
});
