import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * The bug of #749 at the layer the user meets it: the form posts a body, the
 * route's `validate()` runs it, and the answer is 400 ("body: expected object,
 * received undefined") because the schema wrapped its fields in
 * `{ body: z.object({ … }) }`. This mounts the real router and posts what the
 * web form sends; the service is mocked so the test is about the middleware and
 * the wiring, not Prisma.
 */

vi.mock('@/lib/jwt', () => ({ verifyToken: vi.fn() }));
vi.mock('@/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../reception.service', () => ({
  getStats: vi.fn(),
  getGuestBooks: vi.fn(),
  createGuestBook: vi.fn(async () => ({ id: 'g-1' })),
  updateGuestBook: vi.fn(async () => ({ id: 'g-1' })),
  getStudentVisits: vi.fn(),
  createStudentVisit: vi.fn(async () => ({ id: 'v-1' })),
  updateStudentVisit: vi.fn(async () => ({ id: 'v-1' })),
  getPackages: vi.fn(),
  createPackage: vi.fn(async () => ({ id: 'p-1' })),
  updatePackage: vi.fn(async () => ({ id: 'p-1' })),
}));

import { verifyToken } from '@/lib/jwt';
import { errorHandler } from '@/middleware/error';
import receptionRoutes from '../reception.routes';
import * as ReceptionService from '../reception.service';

const app = express();
app.use(express.json());
app.use('/reception', receptionRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyToken).mockImplementation((() => ({
    type: 'access',
    permissions: [],
    sub: 'user-1',
    roleCode: 'SDIT_STAFF',
    unitId: 'unit-1',
  })) as unknown as typeof verifyToken);
});

const post = (path: string, body: object) =>
  request(app).post(`/reception${path}`).set({ Authorization: 'Bearer t' }).send(body);

describe('Reception write routes accept the web form body (#749)', () => {
  it('POST /guests reaches the service with a flat body', async () => {
    const res = await post('/guests', { name: 'Tamu', purpose: 'Dinas', visitorCount: 1 });
    expect(res.status).toBe(201);
    expect(ReceptionService.createGuestBook).toHaveBeenCalledWith(
      'unit-1',
      'user-1',
      expect.objectContaining({ name: 'Tamu', purpose: 'Dinas' })
    );
  });

  it('POST /visits accepts the shared DTO field names', async () => {
    const res = await post('/visits', {
      studentId: '00000000-0000-4000-8000-000000000000',
      visitorName: 'Budi',
      relationship: 'Ayah',
      needs: 'Jenguk',
    });
    expect(res.status).toBe(201);
    expect(ReceptionService.createStudentVisit).toHaveBeenCalledWith(
      'unit-1',
      expect.objectContaining({ relationship: 'Ayah', needs: 'Jenguk' }),
      expect.objectContaining({ sub: 'user-1' })
    );
  });

  it('POST /packages accepts expedition/content', async () => {
    const res = await post('/packages', {
      studentId: '00000000-0000-4000-8000-000000000000',
      senderName: 'JNE',
      expedition: 'JNE',
      content: 'Buku',
    });
    expect(res.status).toBe(201);
    expect(ReceptionService.createPackage).toHaveBeenCalledWith(
      'unit-1',
      'user-1',
      expect.objectContaining({ expedition: 'JNE', content: 'Buku' }),
      expect.objectContaining({ sub: 'user-1' })
    );
  });

  it('a body missing a required field is still 400 (validation still bites)', async () => {
    const res = await post('/visits', { visitorName: 'Budi' });
    expect(res.status).toBe(400);
    expect(ReceptionService.createStudentVisit).not.toHaveBeenCalled();
  });
});
