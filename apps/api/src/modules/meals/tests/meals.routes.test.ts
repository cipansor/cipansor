import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * The HTTP edge of the meals module: the write routes' gate and the statistics
 * controller's actor/query passthrough. The service tests call the service
 * directly, so neither the `authorize(...)` gate nor the way the controller
 * builds the actor from `req.user` and forwards `req.query` is exercised there.
 *
 * Two findings prompted this file:
 *  - the write routes admitted the legacy `UserRole.UNIT_ADMIN` bucket, which
 *    expands to the yayasan organs: the read-only Pengawas could create a menu
 *    for any unit and edit or delete another unit's (CWE-863);
 *  - `GET /meals/statistics` builds the actor and forwards `?unitId=`, and only
 *    the service half was covered.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import mealsRoutes from '../meals.routes';
import { mealsService } from '../meals.service';

const app = express();
app.use(express.json());
app.use('/meals', mealsRoutes);
app.use(errorHandler);

/** A signed-in session, as the JWT carries it — before `buildReqUser`. */
const session = (over: Record<string, unknown> = {}) => ({
  type: 'access',
  permissions: [],
  sub: 'u-1',
  id: 'u-1',
  roleCode: 'SDIT_ADMIN',
  unitId: 'unit-a',
  ...over,
});

const asRole = (over: Record<string, unknown> = {}) => {
  vi.mocked(verifyToken).mockReturnValue(session(over) as never);
  return { Authorization: 'Bearer t' };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GET /meals/statistics — the controller builds the actor and forwards the query', () => {
  it('meneruskan aktor dari token dan unitId dari kueri ke layanan', async () => {
    const spy = vi
      .spyOn(mealsService, 'getStatistics')
      .mockResolvedValue({ totalMenus: 0, attendanceByStatus: [] } as never);

    const res = await request(app)
      .get(
        '/meals/statistics?unitId=unit-b&startDate=2026-11-01T00:00:00.000Z&endDate=2026-11-30T00:00:00.000Z'
      )
      .set(asRole());

    expect(res.status).toBe(200);
    // The actor is the verified token's identity — never a value from the body
    // or query. A unit admin's unitId stays unit-a even though the query asked
    // for unit-b; the service pins it (K10).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-1',
        roleCode: 'SDIT_ADMIN',
        unitId: 'unit-a',
      }),
      'unit-b',
      '2026-11-01T00:00:00.000Z',
      '2026-11-30T00:00:00.000Z'
    );
  });

  it('mengirim unitId undefined saat kueri tidak menyebutkannya', async () => {
    const spy = vi
      .spyOn(mealsService, 'getStatistics')
      .mockResolvedValue({ totalMenus: 0, attendanceByStatus: [] } as never);

    await request(app).get('/meals/statistics').set(asRole());

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ roleCode: 'SDIT_ADMIN', unitId: 'unit-a' }),
      undefined,
      undefined,
      undefined
    );
  });
});

describe('write routes — only a writer reaches them (CWE-863)', () => {
  it('menolak Pengawas (hanya baca) pada POST /meals/menus dengan 403', async () => {
    const spy = vi.spyOn(mealsService, 'createMenu');

    const res = await request(app)
      .post('/meals/menus')
      .set(asRole({ roleCode: 'YAYASAN_PENGAWAS', unitId: null }))
      .send({ unitId: 'unit-b', date: '2026-11-01', mealType: 'LUNCH', mainDish: 'Nasi' });

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('menolak Pengawas pada PUT /meals/menus/:id dan DELETE /meals/menus/:id', async () => {
    const update = vi.spyOn(mealsService, 'updateMenu');
    const remove = vi.spyOn(mealsService, 'deleteMenu');
    const headers = asRole({ roleCode: 'YAYASAN_PENGAWAS', unitId: null });

    const put = await request(app).put('/meals/menus/m-1').set(headers).send({ mainDish: 'Soto' });
    const del = await request(app).delete('/meals/menus/m-1').set(headers);

    expect(put.status).toBe(403);
    expect(del.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('menolak Pengawas menulis absensi makan', async () => {
    const spy = vi.spyOn(mealsService, 'recordAttendance');

    const res = await request(app)
      .post('/meals/attendance')
      .set(asRole({ roleCode: 'YAYASAN_PENGAWAS', unitId: null }))
      .send({ menuId: 'm-1', studentId: 's-1', status: 'PRESENT' });

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('menerima admin unit pada POST /meals/menus', async () => {
    const spy = vi.spyOn(mealsService, 'createMenu').mockResolvedValue({ id: 'm-1' } as never);

    const res = await request(app)
      .post('/meals/menus')
      .set(asRole())
      .send({ unitId: 'unit-b', date: '2026-11-01', mealType: 'LUNCH', mainDish: 'Nasi' });

    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalled();
  });

  it('menerima guru mencatat absensi makan', async () => {
    const spy = vi
      .spyOn(mealsService, 'recordAttendance')
      .mockResolvedValue({ id: 'a-1' } as never);

    const res = await request(app)
      .post('/meals/attendance')
      .set(asRole({ roleCode: 'SDIT_GURU' }))
      .send({ menuId: 'm-1', studentId: 's-1', status: 'PRESENT' });

    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalled();
  });

  it('menolak siswa menulis apa pun (baca saja)', async () => {
    const spy = vi.spyOn(mealsService, 'createMenu');

    const res = await request(app)
      .post('/meals/menus')
      .set(asRole({ roleCode: 'SDIT_SISWA', unitId: 'unit-a' }))
      .send({ unitId: 'unit-a', date: '2026-11-01', mealType: 'LUNCH', mainDish: 'Nasi' });

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});
