import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Sekretaris Pengurus holds no write permission (Model A, #1020).
 *
 * The yayasan organs are oversight: they read broadly and change nothing
 * (`permissions.ts`, the `YAYASAN_OVERSIGHT` comment). Until 2026-11-16
 * `YAYASAN_SEKRETARIS` was the one exception — it carried `STUDENT_UPDATE`,
 * and because `seesAllUnits()` waves a foundation role past the unit filter,
 * the write reached santri data in *every* unit. The owner's decision on #1020
 * (option A) removed it, following the 2026-11-10 principle (#991) that an
 * organ writes only through its own lanes — and editing santri data is not one.
 *
 * Two halves, because the permission is enforced in two places:
 *   * the matrix, pinned directly so a future edit that re-adds any writer
 *     reddens this file; and
 *   * the door — `PUT /students/:id` through the real router and middleware —
 *     with the token's permission list derived from the matrix, so the two
 *     cannot drift here either.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../../students/student.service', () => ({
  studentService: {
    update: vi.fn(async () => ({ id: 's1' })),
    findAll: vi.fn(async () => ({ students: [], pagination: {} })),
  },
}));
vi.mock('../../students/id-card.service', () => ({
  StudentIdCardService: {},
  default: {},
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import studentRoutes from '../../students/student.routes';
import { studentService } from '../../students/student.service';
import { PERMISSIONS, permissionsForRoleCode } from '../permissions';

const TOKEN_ROLE: Record<string, string> = {
  superAdmin: 'SUPER_ADMIN',
  smpAdmin: 'SMPIT_ADMIN',
  kepalaSmp: 'SMPIT_KEPALA_SEKOLAH',
  guru: 'SMPIT_GURU',
  ketua: 'YAYASAN_KETUA',
  sekretaris: 'YAYASAN_SEKRETARIS',
  pengawas: 'YAYASAN_PENGAWAS',
  wali: 'SMPIT_ORANG_TUA',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation(((token: string) => {
    const roleCode = TOKEN_ROLE[token];
    if (!roleCode) throw new Error('bad token');
    return {
      type: 'access',
      sub: `u-${token}`,
      id: `u-${token}`,
      email: `${token}@cipansor.or.id`,
      roleId: 'role-1',
      roleCode,
      unitId: null,
      // What a live token carries: the DB copy of the matrix, which the seed
      // fills from `permissionsForRoleCode`. Deriving it here keeps this test
      // honest about the door — re-adding STUDENT_UPDATE to the matrix makes
      // the Sekretaris request below succeed, and the assertion goes red.
      permissions: permissionsForRoleCode(roleCode),
      role: roleCode,
    } as unknown as ReturnType<typeof verifyToken>;
  }) as unknown as typeof verifyToken);
});

describe('YAYASAN_SEKRETARIS — the matrix', () => {
  it('holds no write permission: every entry is a read (…_VIEW)', () => {
    const held = permissionsForRoleCode('YAYASAN_SEKRETARIS');
    expect(held.filter((p) => !p.endsWith('_VIEW'))).toEqual([]);
    expect(held).not.toContain(PERMISSIONS.STUDENT_UPDATE);
  });

  it('still reads the roster — the Sekretaris keeps STUDENT_VIEW', () => {
    expect(permissionsForRoleCode('YAYASAN_SEKRETARIS')).toContain(PERMISSIONS.STUDENT_VIEW);
  });

  it('is the oversight baseline, with no private extra', () => {
    // Pengawas is the plain `YAYASAN_OVERSIGHT`; the Sekretaris must now match
    // it exactly, so an added permission here is caught even without naming it.
    expect([...permissionsForRoleCode('YAYASAN_SEKRETARIS')].sort()).toEqual(
      [...permissionsForRoleCode('YAYASAN_PENGAWAS')].sort()
    );
  });
});

const app = express();
app.use(express.json());
app.use('/students', studentRoutes);
app.use(errorHandler);

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

const editSantri = (token: string) =>
  request(app)
    .put(`/students/${STUDENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Nama Baru' });

describe('PUT /students/:id — the door, through the real router', () => {
  it('refuses the Sekretaris with 403, and nothing reaches the service', async () => {
    const res = await editSantri('sekretaris');
    expect(res.status).toBe(403);
    expect(vi.mocked(studentService.update)).not.toHaveBeenCalled();
  });

  it('admits the roles that legitimately edit santri', async () => {
    for (const who of ['superAdmin', 'smpAdmin', 'kepalaSmp']) {
      const res = await editSantri(who);
      expect(res.status, `${who} → ${res.status}`).toBeLessThan(300);
    }
  });

  it('still refuses a read-only teacher and a wali', async () => {
    for (const who of ['guru', 'wali']) {
      const res = await editSantri(who);
      expect(res.status, who).toBe(403);
    }
  });

  it('the other oversight organs are refused too, not just the Sekretaris', async () => {
    for (const who of ['ketua', 'pengawas']) {
      const res = await editSantri(who);
      expect(res.status, who).toBe(403);
    }
  });
});
