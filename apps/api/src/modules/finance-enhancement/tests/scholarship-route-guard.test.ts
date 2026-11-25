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
    assignScholarship: vi.fn(async () => ({
      id: 'rec-new',
      scholarship: { id: 'sch-1', name: 'Beasiswa Prestasi' },
      student: { nis: '0099', name: 'Fulan', class: 'Kelas 1' },
    })),
  },
}));
vi.mock('../scholarship-scoring.service', () => ({
  scholarshipScoringService: {
    assessRecipient: vi.fn(async () => ({ criteria: [], totalScore: null, complete: false })),
    createCriterion: vi.fn(async () => ({ id: 'crit-1' })),
  },
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import { financeEnhancementRoutes } from '../index';
import { financeEnhancementService } from '../finance-enhancement.service';
import { scholarshipScoringService } from '../scholarship-scoring.service';

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

/**
 * R11.15: computing a score and writing a criterion are the unit finance
 * admin's acts alone. The yayasan board reads a score but never produces one,
 * and TU_Unit is not a finance role at all — both are refused before the
 * service runs, so nothing is written.
 */
describe.each([
  ['post', '/scholarships/sch-1/criteria', { name: 'Hafalan', weight: 2, type: 'NUMERIC' }],
  ['post', '/scholarship-recipients/rec-1/assess', undefined],
] as const)('%s %s', (method, path, body) => {
  it.each(['YAYASAN_KETUA', 'YAYASAN_BENDAHARA', 'SDIT_TATA_USAHA', 'SDIT_GURU', 'SDIT_SISWA'])(
    'refuses %s with 403 and writes nothing',
    async (roleCode) => {
      as(roleCode, roleCode.startsWith('YAYASAN_') ? null : 'unit-sd');

      const res = await authed(request(app)[method](`/finance-enhancement${path}`).send(body));

      expect(res.status).toBe(403);
      expect(scholarshipScoringService.assessRecipient).not.toHaveBeenCalled();
      expect(scholarshipScoringService.createCriterion).not.toHaveBeenCalled();
    }
  );

  it.each(['SDIT_ADMIN', 'SDIT_BENDAHARA', 'SUPER_ADMIN'])('lets %s through', async (roleCode) => {
    as(roleCode, roleCode === 'SUPER_ADMIN' ? null : 'unit-sd');

    const res = await authed(request(app)[method](`/finance-enhancement${path}`).send(body));

    expect(res.status).toBeLessThan(400);
  });
});

describe('POST /scholarships/:id/criteria target validation', () => {
  const create = (body: Record<string, unknown>) =>
    authed(
      request(app)
        .post('/finance-enhancement/scholarships/sch-1/criteria')
        .send({
          weight: 1,
          type: 'NUMERIC',
          ...body,
        })
    );

  it('refuses a percentage target on a hafalan criterion before the service runs', async () => {
    as('SDIT_ADMIN', 'unit-sd');

    const res = await create({ name: 'Hafalan Al-Quran', targetValue: '85%' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('jumlah juz');
    expect(scholarshipScoringService.createCriterion).not.toHaveBeenCalled();
  });

  it('accepts juz for hafalan and a percentage for academic', async () => {
    as('SDIT_ADMIN', 'unit-sd');

    expect((await create({ name: 'Hafalan Al-Quran', targetValue: '10 juz' })).status).toBeLessThan(
      400
    );
    expect((await create({ name: 'Nilai Akademik', targetValue: '85%' })).status).toBeLessThan(400);
    expect(scholarshipScoringService.createCriterion).toHaveBeenCalledTimes(2);
  });
});

describe('POST /scholarship-recipients', () => {
  const input = {
    scholarshipId: '11111111-1111-4111-8111-111111111111',
    studentId: '22222222-2222-4222-8222-222222222222',
    academicYearId: '33333333-3333-4333-8333-333333333333',
    startDate: '2026-07-01T00:00:00.000Z',
  };

  it('answers 201 with the ApiResponse envelope and the token actor', async () => {
    as('SDIT_ADMIN', 'unit-sd');

    const res = await authed(
      request(app).post('/finance-enhancement/scholarship-recipients').send(input)
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        id: 'rec-new',
        scholarship: { id: 'sch-1', name: 'Beasiswa Prestasi' },
      },
    });
    expect(financeEnhancementService.assignScholarship).toHaveBeenCalledWith(input, {
      sub: 'u1',
      roleCode: 'SDIT_ADMIN',
      unitId: 'unit-sd',
    });
  });
});
