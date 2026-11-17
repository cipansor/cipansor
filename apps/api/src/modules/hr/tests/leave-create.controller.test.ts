import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../hr.service', () => ({
  resolveNamedStaffId: vi.fn(),
  resolveStaffIdForUser: vi.fn(),
  assertMayManageLeave: vi.fn(),
  createLeave: vi.fn(),
}));

import * as service from '../hr.service';
import { createLeave } from '../hr.controller';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = {
    params: {},
    body: {
      type: 'ANNUAL',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-06T00:00:00.000Z',
      reason: 'acara keluarga',
    },
    user: { sub: USER_ID, role: 'STAFF', roleCode: 'SDIT_ADMIN', unitId: 'unit-1' },
    ...overrides,
  } as unknown as Request;

  const res = {
    statusCode: 200,
    jsonPayload: undefined as unknown,
    status(code: number) {
      (this as any).statusCode = code;
      return this;
    },
    json(payload: unknown) {
      (this as any).jsonPayload = payload;
      return this;
    },
  } as unknown as Response & { statusCode: number; jsonPayload: any };

  return { req, res };
}

async function run(req: Request, res: Response) {
  const next = vi.fn();
  await createLeave(req, res, next);
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  (service.resolveNamedStaffId as any).mockImplementation(async (id: string) => id);
  (service.resolveStaffIdForUser as any).mockResolvedValue('staff-self');
  (service.assertMayManageLeave as any).mockResolvedValue(undefined);
  (service.createLeave as any).mockImplementation(async (data: unknown) => ({
    id: 'leave-1',
    ...(data as object),
  }));
});

describe('createLeave controller — which id reaches the API', () => {
  it('passes a named staffId through resolveNamedStaffId before the guard', async () => {
    const { req, res } = mockReqRes({ body: { ...mockReqRes().req.body, staffId: STAFF_ID } });
    await run(req, res);

    expect(service.resolveNamedStaffId).toHaveBeenCalledWith(STAFF_ID);
    expect(service.assertMayManageLeave).toHaveBeenCalledWith(
      expect.objectContaining({ sub: USER_ID }),
      { staffId: STAFF_ID, teacherId: null }
    );
    expect(service.createLeave).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: STAFF_ID })
    );
    expect(res.statusCode).toBe(201);
  });

  it('turns a user id sent as staffId into a clear 400, never reaching the write', async () => {
    (service.resolveNamedStaffId as any).mockRejectedValue(
      Object.assign(new Error('id pengguna, bukan id profil pegawai'), { code: 'BAD_REQUEST' })
    );
    const { req, res } = mockReqRes({ body: { ...mockReqRes().req.body, staffId: USER_ID } });
    const next = await run(req, res);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(service.assertMayManageLeave).not.toHaveBeenCalled();
    expect(service.createLeave).not.toHaveBeenCalled();
  });

  it('auto-fills the caller’s own staff row when no id is named', async () => {
    const { req, res } = mockReqRes();
    await run(req, res);

    expect(service.resolveStaffIdForUser).toHaveBeenCalledWith(USER_ID);
    expect(service.resolveNamedStaffId).not.toHaveBeenCalled();
    expect(service.createLeave).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-self' })
    );
    expect(res.statusCode).toBe(201);
  });

  it('keeps a named teacherId as a teacherId', async () => {
    const { req, res } = mockReqRes({
      body: { ...mockReqRes().req.body, teacherId: TEACHER_ID },
    });
    await run(req, res);

    expect(service.resolveNamedStaffId).not.toHaveBeenCalled();
    expect(service.resolveStaffIdForUser).not.toHaveBeenCalled();
    expect(service.assertMayManageLeave).toHaveBeenCalledWith(
      expect.objectContaining({ sub: USER_ID }),
      { staffId: null, teacherId: TEACHER_ID }
    );
  });
});
