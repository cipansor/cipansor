import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// #849: the "Menu Hari Ini" tab was always empty. The web called
// `GET /meals/menus/today?unitId=`, which no route answers — `/menus/:id`
// matched it with `id = "today"` and returned 404. The canonical route carries
// the unit in the path (`/menus/today/:unitId`, like `calendar` and
// `duty-roster`); this locks it and the array shape the web folds into
// `{ breakfast, lunch, dinner, snack }`.

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { mealMenu: { findUnique: vi.fn(async () => null) } },
}));
vi.mock('@/middleware/auth', () => ({
  authenticate: (req: any, _res: unknown, next: () => void) => {
    req.user = {
      sub: 'u-1',
      role: 'SUPER_ADMIN',
      roleCode: 'SUPER_ADMIN',
      unitId: null,
      permissions: [],
    };
    next();
  },
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { mealsService } from '../meals.service';
import { errorHandler } from '@/middleware/error';
import mealsRoutes from '../meals.routes';

const app = express();
app.use(express.json());
app.use('/meals', mealsRoutes);
app.use(errorHandler);

const UNIT = '11111111-1111-4111-8111-111111111111';
const MENU = {
  id: 'm-1',
  unitId: UNIT,
  mealType: 'BREAKFAST',
  mainDish: 'Nasi Kuning',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /meals/menus/today/:unitId', () => {
  it('menjawab handler hari ini dan mengembalikan daftar menu', async () => {
    const spy = vi.spyOn(mealsService, 'getTodayMenu').mockResolvedValue([MENU] as never);

    const res = await request(app)
      .get(`/meals/menus/today/${UNIT}`)
      .set('Authorization', 'Bearer SUPER_ADMIN');

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(UNIT, expect.objectContaining({ sub: 'u-1' }));
    expect(res.body.data).toEqual([MENU]);
    // The web folds this array into an object; an array left as-is is what the
    // page read as every card empty.
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('path /menus/today tanpa unit tidak menumbuk handler hari ini', async () => {
    // The path the web used to call: no route serves it, so `/menus/:id` answers
    // it with id = "today" (404). This documents that the path stays wrong, which
    // is why the fix moved the unit into the path.
    const res = await request(app)
      .get('/meals/menus/today')
      .set('Authorization', 'Bearer SUPER_ADMIN');

    expect(res.status).toBe(404);
  });
});
