import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../hr.service', () => ({
  selfCheckIn: vi.fn(),
  selfCheckOut: vi.fn(),
  getMyAttendance: vi.fn(),
  resolveStaffIdForUser: vi.fn(),
  findStaffIdForUser: vi.fn(),
  noStaffProfileToday: vi.fn((date: string) => ({ hasProfile: false, date, canCheckIn: false })),
  storePunchPhoto: vi.fn(),
  readPunchPhoto: vi.fn(),
  resolveDelegatedStaffId: vi.fn(),
  scopedUnitId: vi.fn((_user: unknown, requested?: string | null) => requested ?? null),
}));

import * as service from '../hr.service';
import {
  selfCheckIn,
  selfCheckOut,
  getMyAttendanceToday,
  uploadPunchPhoto,
  getPunchPhoto,
} from '../attendance-settings.controller';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = {
    query: {},
    params: {},
    body: {},
    user: { sub: 'user-1', role: 'STAFF', roleCode: 'SDIT_TATA_USAHA', unitId: null },
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
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      (this as any).headers[name] = value;
    },
    send(body: unknown) {
      (this as any).sent = body;
      return this;
    },
  } as unknown as Response & { statusCode: number; jsonPayload: any };

  return { req, res };
}

async function run(handler: any, req: Request, res: Response) {
  const next = vi.fn();
  await handler(req, res, next);
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  (service.resolveStaffIdForUser as any).mockResolvedValue('staff-self');
  (service.findStaffIdForUser as any).mockResolvedValue('staff-self');
  (service.resolveDelegatedStaffId as any).mockResolvedValue('staff-other');
  (service.selfCheckIn as any).mockResolvedValue({ lateMinutes: 0, withinRadius: true });
  (service.selfCheckOut as any).mockResolvedValue({ withinRadius: true });
  (service.getMyAttendance as any).mockResolvedValue({ date: '2026-03-02', canCheckIn: true });
});

describe('self attendance — whose row may be written', () => {
  it('a caller with no staffId is pinned to their own Staff row', async () => {
    const { req, res } = mockReqRes({ body: { latitude: -6.5, longitude: 106.8 } });
    await run(selfCheckIn, req, res);

    expect(service.resolveStaffIdForUser).toHaveBeenCalledWith('user-1');
    expect(service.selfCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-self', actorUserId: 'user-1' })
    );
  });

  it('a caller naming another staff member is delegated to the service guard', async () => {
    const { req, res } = mockReqRes({
      body: { staffId: '11111111-1111-4111-8111-111111111111' },
    });
    await run(selfCheckIn, req, res);

    expect(service.resolveDelegatedStaffId).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1' }),
      '11111111-1111-4111-8111-111111111111'
    );
    expect(service.selfCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-other' })
    );
  });

  it('a refused delegation never reaches the write', async () => {
    (service.resolveDelegatedStaffId as any).mockRejectedValue(
      Object.assign(new Error('Hanya admin unit'), { code: 'FORBIDDEN' })
    );
    const { req, res } = mockReqRes({
      body: { staffId: '11111111-1111-4111-8111-111111111111' },
    });
    const next = await run(selfCheckIn, req, res);

    expect(service.selfCheckIn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('check-out applies the same rule as check-in', async () => {
    const { req, res } = mockReqRes({
      body: { staffId: '11111111-1111-4111-8111-111111111111' },
    });
    await run(selfCheckOut, req, res);

    expect(service.resolveDelegatedStaffId).toHaveBeenCalled();
    expect(service.selfCheckOut).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-other' })
    );
  });

  it('a caller with no Staff profile surfaces the not-found', async () => {
    (service.resolveStaffIdForUser as any).mockRejectedValue(
      Object.assign(new Error('Profil pegawai'), { code: 'NOT_FOUND' })
    );
    const { req, res } = mockReqRes();
    const next = await run(selfCheckIn, req, res);

    expect(service.selfCheckIn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('getMyAttendanceToday', () => {
  it('asks for the WIB day, not the container day', async () => {
    const { req, res } = mockReqRes();
    await run(getMyAttendanceToday, req, res);

    const day = (service.getMyAttendance as any).mock.calls[0][1];
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day).toBe(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }));
  });
});

describe('getMyAttendanceToday — an account with no staff record', () => {
  it('answers with hasProfile false instead of a 404', async () => {
    (service.findStaffIdForUser as any).mockResolvedValue(null);
    const { req, res } = mockReqRes();
    const next = await run(getMyAttendanceToday, req, res);

    expect(next).not.toHaveBeenCalled();
    expect(service.getMyAttendance).not.toHaveBeenCalled();
    expect((res as any).jsonPayload.data.hasProfile).toBe(false);
  });
});

describe('punch photos', () => {
  it('refuses an upload with no file', async () => {
    const { req, res } = mockReqRes();
    const next = await run(uploadPunchPhoto, req, res);

    expect(service.storePunchPhoto).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('stores the photo under the caller', async () => {
    (service.storePunchPhoto as any).mockResolvedValue({ photoRef: 'ref.jpg' });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg', size: 3 };
    const { req, res } = mockReqRes({ file } as never);
    await run(uploadPunchPhoto, req, res);

    expect(service.storePunchPhoto).toHaveBeenCalledWith('user-1', file);
    expect((res as any).statusCode).toBe(201);
  });

  it('serves a photo uncached, with the reader checked by the service', async () => {
    (service.readPunchPhoto as any).mockResolvedValue({
      buffer: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });
    const { req, res } = mockReqRes({ params: { id: 'rec-1' } } as never);
    await run(getPunchPhoto, req, res);

    expect(service.readPunchPhoto).toHaveBeenCalledWith(
      'rec-1',
      expect.objectContaining({ sub: 'user-1' })
    );
    expect((res as any).headers['Cache-Control']).toBe('private, no-store');
    expect((res as any).headers['Content-Type']).toBe('image/jpeg');
  });
});
