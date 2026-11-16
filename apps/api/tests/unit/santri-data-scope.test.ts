import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Measured 2026-09-24 on staging with a santri account: these lists returned
// every santri's rows (276 diagnoses, 3,464 grades, 5,089 tahfidz records),
// each with the full Student row — NIK, No. KK, the parents' NIK and income.
// The kurikulum-merdeka results needed no login at all, and the assessment,
// curriculum and tahfidz writes accepted any signed-in account. These tests
// drive the real routers and read what reaches Prisma.

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
import assessmentRoutes from '@/modules/assessment/assessment.routes';
import attendanceRoutes from '@/modules/attendance/attendance.routes';
import curriculumRoutes from '@/modules/curriculum/curriculum.routes';
import healthRoutes from '@/modules/health/health.routes';
import { kurikulumMerdekaRoutes } from '@/modules/kurikulum-merdeka';
import { murojaahRoutes } from '@/modules/murojaah';
import tahfidzRoutes from '@/modules/tahfidz/tahfidz.routes';

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  santri: { sub: 'u-santri', roleCode: 'SMPIT_SISWA', unitId: 'unit-smp' },
  wali: { sub: 'u-wali', roleCode: 'SMPIT_ORANG_TUA', unitId: 'unit-smp' },
  guru: { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' },
  perawat: {
    sub: 'u-perawat',
    roleCode: 'PERAWAT',
    unitId: 'unit-smp',
    permissions: ['HEALTH_VIEW', 'HEALTH_MANAGE'],
  },
  ketua: { sub: 'u-ketua', roleCode: 'YAYASAN_KETUA', unitId: null },
};

const app = express();
app.use(express.json());
app.use('/assessment', assessmentRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/curriculum', curriculumRoutes);
app.use('/health', healthRoutes);
app.use('/kurikulum-merdeka', kurikulumMerdekaRoutes);
app.use('/murojaah', murojaahRoutes);
app.use('/tahfidz', tahfidzRoutes);
app.use(errorHandler);

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
function call(method: Method, path: string, who?: string) {
  const req = request(app)[method](path);
  return who ? req.set('Authorization', `Bearer ${who}`) : req;
}

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
function whereOf(model: string, method = 'findMany') {
  const calls = db[model][method].mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0];
}

beforeEach(() => {
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const account = ACCOUNTS[token];
    if (!account) throw new Error('bad token');
    return { type: 'access', permissions: [], ...account };
  }) as any);
});

describe('writes are teaching work', () => {
  const WRITES: Array<[Method, string]> = [
    ['post', '/assessment/grades'],
    ['patch', '/assessment/grades/g-1'],
    ['delete', '/assessment/grades/g-1'],
    ['post', '/assessment/grades/bulk'],
    ['post', '/assessment/exams'],
    ['delete', '/assessment/exams/e-1'],
    ['post', '/assessment/report-cards'],
    ['patch', '/assessment/report-cards/r-1/publish'],
    ['post', '/assessment/p5-projects/assessments'],
    ['post', '/curriculum/subjects'],
    ['post', '/curriculum/lesson-plans'],
    ['delete', '/curriculum/schedules/s-1'],
    ['post', '/tahfidz'],
    ['put', '/tahfidz/t-1'],
    ['delete', '/tahfidz/t-1'],
    ['post', '/health/records'],
    ['delete', '/health/records/m-1'],
  ];

  it.each(WRITES)('%s %s refuses a santri and a wali', async (method, path) => {
    for (const who of ['santri', 'wali']) {
      const res = await call(method, path, who).send({});
      expect(res.status, `${who} ${method} ${path}`).toBe(403);
    }
  });

  // Subjects are kept by the unit's admin and kepala sekolah, not by every
  // guru (CURRICULUM_MANAGER_ROLE_CODES, since 2026-09-26); the
  // curriculum module's own access test covers who may.
  it.each(WRITES.filter(([, p]) => !p.startsWith('/health') && p !== '/curriculum/subjects'))(
    '%s %s still lets a teacher through the guard',
    async (method, path) => {
      const res = await call(method, path, 'guru').send({});
      expect([401, 403]).not.toContain(res.status);
    }
  );
});

describe('school-wide documents and dashboards are for staff', () => {
  const STAFF_READS = [
    '/assessment/reports/skhun/bulk',
    '/assessment/reports/transcripts/bulk',
    '/assessment/exams/e-1/analytics',
    '/tahfidz/stats',
    '/murojaah/analytics/top-performers',
  ];

  it.each(STAFF_READS)('GET %s refuses a santri', async (path) => {
    expect((await call('get', path, 'santri')).status).toBe(403);
  });

  it('the tahfidz leaderboard of a unit teacher is their own unit, whatever ?unitId says', async () => {
    await call('get', '/tahfidz/stats?unitId=unit-other', 'guru');
    expect(whereOf('tahfidzRecord', 'count').where).toMatchObject({
      student: { unitId: 'unit-smp' },
    });
  });
});

describe('kurikulum-merdeka needs a login', () => {
  it.each(['/assessment-results', '/p5-assessments', '/p5-projects', '/phases'])(
    'GET %s without a token is 401',
    async (path) => {
      expect((await call('get', `/kurikulum-merdeka${path}`)).status).toBe(401);
    }
  );
});

describe('lists hold only the santri the account may see', () => {
  const LISTS: Array<[string, string]> = [
    ['/assessment/grades', 'grade'],
    ['/assessment/report-cards', 'reportCard'],
    ['/attendance', 'attendance'],
    ['/tahfidz', 'tahfidzRecord'],
    ['/murojaah', 'murojaahRecord'],
    ['/kurikulum-merdeka/assessment-results', 'merdekaAssessmentResult'],
    ['/kurikulum-merdeka/p5-assessments', 'p5Assessment'],
  ];

  const EXPECTED: Record<string, unknown> = {
    santri: { userId: 'u-santri' },
    wali: { parents: { some: { parentId: 'u-wali' } } },
    guru: { unitId: 'unit-smp' },
  };

  for (const [who, scope] of Object.entries(EXPECTED)) {
    it.each(LISTS)(`${who}: GET %s asks for their santri only`, async (path, model) => {
      const res = await call('get', path, who);
      expect(res.status).toBe(200);
      expect(whereOf(model).where.student).toEqual(scope);
    });
  }

  it.each(LISTS)('the yayasan board reads every unit on GET %s', async (path, model) => {
    await call('get', path, 'ketua');
    const student = whereOf(model).where.student;
    expect(student === undefined || Object.keys(student).length === 0).toBe(true);
  });

  it('murojaah ?unitId= narrows the scope instead of replacing it', async () => {
    const other = '11111111-1111-4111-8111-111111111111';
    const res = await call('get', `/murojaah?unitId=${other}`, 'santri');
    expect(res.status).toBe(200);
    expect(whereOf('murojaahRecord').where.student).toEqual({
      AND: [{ userId: 'u-santri' }, { unitId: other }],
    });
  });

  it.each(LISTS)(
    'GET %s selects santri columns instead of including the row',
    async (path, model) => {
      await call('get', path, 'guru');
      const student = whereOf(model).include?.student;
      expect(student).toHaveProperty('select');
      expect(student).not.toHaveProperty('include');
      expect(Object.keys(student.select)).not.toContain('nik');
    }
  );
});

describe('health records', () => {
  it('a santri cannot read the clinic register', async () => {
    expect((await call('get', '/health/records', 'santri')).status).toBe(403);
  });

  it('the perawat reads it, across units', async () => {
    const res = await call('get', '/health/records', 'perawat');
    expect(res.status).toBe(200);
    expect(whereOf('medicalRecord').where.student).toBeUndefined();
  });
});

describe('a santri opening an exam', () => {
  it('receives only their own grade with it', async () => {
    db.exam.findFirst.mockResolvedValueOnce({ id: 'e-1', grades: [] });
    await call('get', '/assessment/exams/e-1', 'santri');
    const where = whereOf('exam', 'findFirst').where as {
      AND: [object, { class: { enrollments: { some: object } } }];
    };
    // The exam itself is narrowed to the classes the santri is actively in…
    expect(where.AND[1]).toEqual({
      class: { enrollments: { some: { status: 'active', student: { userId: 'u-santri' } } } },
    });
    // …and its grades to the santri's own row.
    expect(whereOf('exam', 'findFirst').include.grades.where).toEqual({
      student: { userId: 'u-santri' },
    });
  });
});
