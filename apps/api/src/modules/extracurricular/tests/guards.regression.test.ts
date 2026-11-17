import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// #989 (PR-03) review: the route guards were converted from the legacy
// `UserRole` buckets to explicit RoleCode sets. This pins each category, so the
// conversion cannot quietly widen or narrow who reaches a route.
//
// Faithful to the buckets the routes carried before: the admin bucket is
// `UNIT_ADMIN` (unit admins AND the yayasan organs), the writer bucket is
// `TEACHER` (educators and principals), and the reader bucket adds `STAFF`
// (tata usaha, bendahara, support, business).

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../extracurricular.service', () => ({
  extracurricularService: {
    publicList: vi.fn(),
    findAll: vi.fn(async () => ({ data: [], meta: { pagination: {} } })),
    findById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    listEnrollments: vi.fn(async () => ({ data: [] })),
    enrollStudent: vi.fn(async () => ({})),
    bulkEnroll: vi.fn(async () => ({})),
    updateEnrollment: vi.fn(async () => ({})),
    listAttendance: vi.fn(async () => ({ data: [] })),
    recordAttendance: vi.fn(async () => ({})),
    getAttendanceSummary: vi.fn(async () => ({})),
    listAchievements: vi.fn(async () => ({ data: [] })),
    createAchievement: vi.fn(async () => ({})),
    deleteAchievement: vi.fn(async () => undefined),
    getStudentExtracurriculars: vi.fn(async () => ({})),
    getStatistics: vi.fn(async () => ({})),
  },
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import routes from '../extracurricular.routes';

const SMP = '11111111-1111-4111-8111-111111111111';
const SANTRI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const TOKENS = {
  superAdmin: { roleCode: 'SUPER_ADMIN', unitId: null },
  unitAdmin: { roleCode: 'SMPIT_ADMIN', unitId: SMP },
  pengawas: { roleCode: 'YAYASAN_PENGAWAS', unitId: null },
  guru: { roleCode: 'SMPIT_GURU', unitId: SMP },
  kepalaSekolah: { roleCode: 'SMPIT_KEPALA_SEKOLAH', unitId: SMP },
  musyrif: { roleCode: 'MUSYRIF', unitId: null },
  tataUsaha: { roleCode: 'SMPIT_TATA_USAHA', unitId: SMP },
  businessStaff: { roleCode: 'BUSINESS_STAFF', unitId: SMP },
  santri: { roleCode: 'SMPIT_SISWA', unitId: SMP },
  wali: { roleCode: 'SMPIT_ORANG_TUA', unitId: SMP },
} as const;
type Who = keyof typeof TOKENS;

const app = express();
app.use(express.json());
app.use('/extracurricular', routes);
app.use(errorHandler);

const call = (who: Who, method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  request(app)[method](`/extracurricular${path}`).set('Authorization', `Bearer ${who}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const t = TOKENS[token as Who];
    if (!t) throw new Error('bad token');
    return { type: 'access', permissions: [], sub: `u-${token}`, ...t };
  }) as unknown as typeof verifyToken);
});

/** Assert each listed role is admitted (not 401/403) and each other is refused. */
async function expectAdmits(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  admitted: Who[],
  refused: Who[]
) {
  for (const who of admitted) {
    const res = await call(who, method, path);
    expect(res.status, `${who} ${method} ${path} should be admitted`).not.toBe(403);
    expect(res.status, `${who} ${method} ${path} should be admitted`).not.toBe(401);
  }
  for (const who of refused) {
    expect((await call(who, method, path)).status, `${who} ${method} ${path}`).toBe(403);
  }
}

describe('#989 — extracurricular guards admit the right role categories', () => {
  const all: Who[] = Object.keys(TOKENS) as Who[];

  it('reads (list, getById, achievements list) admit every staff role but not santri or wali', async () => {
    const readers: Who[] = [
      'superAdmin',
      'unitAdmin',
      'pengawas',
      'guru',
      'kepalaSekolah',
      'musyrif',
      'tataUsaha',
      'businessStaff',
    ];
    const refused: Who[] = ['santri', 'wali'];
    expect([...readers, ...refused].sort()).toEqual([...all].sort());

    await expectAdmits('get', '/', readers, refused);
    await expectAdmits('get', '/e1', readers, refused);
    await expectAdmits('get', '/achievements/list', readers, refused);
  });

  it('create/delete/statistics are admin-only (unit admin and the yayasan organs)', async () => {
    const admins: Who[] = ['superAdmin', 'unitAdmin', 'pengawas'];
    const refused = all.filter((w) => !admins.includes(w));

    await expectAdmits('post', '/', admins, refused);
    await expectAdmits('delete', '/e1', admins, refused);
    await expectAdmits('get', `/statistics/${SMP}`, admins, refused);
  });

  it('update and the enrolment/attendance writes admit educators but not plain staff', async () => {
    const writers: Who[] = [
      'superAdmin',
      'unitAdmin',
      'pengawas',
      'guru',
      'kepalaSekolah',
      'musyrif',
    ];
    const refused = all.filter((w) => !writers.includes(w));

    await expectAdmits('put', '/e1', writers, refused);
    await expectAdmits('post', '/enrollments', writers, refused);
    await expectAdmits('post', '/attendance', writers, refused);
  });

  it('one santri’s enrolments reach staff, the santri and their wali', async () => {
    // SANTRI_READERS is the reader set plus the santri and wali roles, so every
    // named role is admitted; the service still 404s an out-of-scope santri
    // (covered by students-scope.regression.test.ts).
    await expectAdmits('get', `/students/${SANTRI}`, all, []);
  });
});
