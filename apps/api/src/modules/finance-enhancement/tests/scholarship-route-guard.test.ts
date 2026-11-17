import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Route guards for the scholarship reads (#988, R26.10). Only Peran_Keuangan_Unit
 * and Organ_Yayasan may read a program's recipients and criteria; a santri, a
 * wali, a Guru or a TU_Unit is refused with 403 before the service runs.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../finance-enhancement.service', () => ({
  financeEnhancementService: {
    getScholarshipRecipients: vi.fn(async () => ({
      success: true,
      data: [],
      meta: { pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    })),
    getScholarshipCriteria: vi.fn(async () => []),
  },
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import { financeEnhancementRoutes } from '../index';

const app = express();
app.use(express.json());
app.use('/finance-enhancement', financeEnhancementRoutes);
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

beforeEach(() => vi.clearAllMocks());

describe.each(['/scholarships/sch-1/recipients', '/scholarships/sch-1/criteria'])(
  'GET %s',
  (path) => {
    it.each(['SDIT_SISWA', 'SDIT_ORANG_TUA', 'SDIT_GURU', 'SDIT_TATA_USAHA'])(
      'refuses %s with 403',
      async (roleCode) => {
        as(roleCode);

        const res = await authed(request(app).get(`/finance-enhancement${path}`));

        expect(res.status).toBe(403);
      }
    );

    it.each(['SDIT_ADMIN', 'SDIT_BENDAHARA', 'YAYASAN_KETUA'])(
      'lets %s through',
      async (roleCode) => {
        as(roleCode, roleCode === 'YAYASAN_KETUA' ? null : 'unit-sd');

        const res = await authed(request(app).get(`/finance-enhancement${path}`));

        expect(res.status).toBe(200);
      }
    );
  }
);
