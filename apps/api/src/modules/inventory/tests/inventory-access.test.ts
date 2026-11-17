import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The inventory router never called authenticate, so every authorize() in it
// saw no user and answered 401 — to admins and staff as much as to anyone.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const defaults: Record<string, unknown> = { findMany: [], groupBy: [], count: 0 };
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
import { errorHandler } from '@/middleware/error';
import inventoryRoutes from '../inventory.routes';

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  tu: { sub: 'u-tu', roleCode: 'SMPIT_TATA_USAHA', unitId: 'unit-smp' },
  admin: { sub: 'u-admin', roleCode: 'SMPIT_ADMIN', unitId: 'unit-smp' },
  santri: { sub: 'u-santri', roleCode: 'SMPIT_SISWA', unitId: 'unit-smp' },
};

const app = express();
app.use(express.json());
app.use('/inventory', inventoryRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const account = ACCOUNTS[token];
    if (!account) throw new Error('bad token');
    return { type: 'access', permissions: [], ...account };
  }) as any);
});

const get = (path: string, who?: string) => {
  const req = request(app).get(path);
  return who ? req.set('Authorization', `Bearer ${who}`) : req;
};

describe('inventory access', () => {
  it.each(['/inventory', '/inventory/categories', '/inventory/maintenance'])(
    'staff and the admin unit can read %s',
    async (path) => {
      for (const who of ['tu', 'admin']) {
        const res = await get(path, who);
        expect([401, 403], `${who} GET ${path} → ${res.status}`).not.toContain(res.status);
      }
    }
  );

  it('a santri is refused with 403, not 401', async () => {
    expect((await get('/inventory', 'santri')).status).toBe(403);
  });

  it('no token is 401', async () => {
    expect((await get('/inventory')).status).toBe(401);
  });
});
