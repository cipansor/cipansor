import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../ibadah.service', () => ({
  listTargets: vi.fn(),
  getTargetById: vi.fn(),
  createTarget: vi.fn(),
  updateTarget: vi.fn(),
  deleteTarget: vi.fn(),
  seedDefaultTargets: vi.fn(),
  listRecords: vi.fn(),
  getRecordById: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  bulkCreateRecords: vi.fn(),
  verifyRecords: vi.fn(),
  dailyCheckIn: vi.fn(),
  getLeaderboard: vi.fn(),
  getMyAchievements: vi.fn(),
  getStudentAchievements: vi.fn(),
  getStudentAchievementsFor: vi.fn(),
  getStudentIbadahStats: vi.fn(),
  getStudentIbadahStatsFor: vi.fn(),
  getUnitIbadahStats: vi.fn(),
  getClassIbadahStats: vi.fn(),
  listIslamicEvents: vi.fn(),
  getIslamicEventById: vi.fn(),
  createIslamicEvent: vi.fn(),
  updateIslamicEvent: vi.fn(),
  deleteIslamicEvent: vi.fn(),
}));

import * as controller from '../ibadah.controller';
import * as service from '../ibadah.service';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = {
    query: {},
    params: {},
    body: {},
    user: { sub: 'user-1' },
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

async function run(handler: any, req: Request, res: Response) {
  await handler(req, res, vi.fn());
}

describe('ibadah controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listTargets: flattens to data + meta.pagination (array at .data)', async () => {
    (service.listTargets as any).mockResolvedValue({
      data: [{ id: 't1' }],
      pagination: { page: 1, total: 1 },
    });
    const { req, res } = mockReqRes();
    await run(controller.listTargets, req, res);
    expect((res as any).jsonPayload).toEqual({
      success: true,
      data: [{ id: 't1' }],
      meta: { pagination: { page: 1, total: 1 } },
    });
  });

  it('getTarget: 404 when the target is missing', async () => {
    (service.getTargetById as any).mockResolvedValue(null);
    const { req, res } = mockReqRes({ params: { id: 'x' } as any });
    await run(controller.getTarget, req, res);
    expect((res as any).statusCode).toBe(404);
  });

  it('verifyRecords: verifies as the authenticated user', async () => {
    (service.verifyRecords as any).mockResolvedValue({ verified: 3 });
    const { req, res } = mockReqRes({ body: { recordIds: ['r1'] } as any });
    await run(controller.verifyRecords, req, res);
    expect(service.verifyRecords).toHaveBeenCalledWith('user-1', { recordIds: ['r1'] });
  });

  it('the santri reads go through the reader, never the query alone', async () => {
    (service.getLeaderboard as any).mockResolvedValue({ data: [] });
    (service.listRecords as any).mockResolvedValue({ data: [], pagination: {} });
    const { req, res } = mockReqRes({ query: { periodType: 'WEEKLY' } as any });
    await run(controller.getLeaderboard, req, res);
    // No unit asked for, and none needed: the reader decides which santri.
    expect(service.getLeaderboard).toHaveBeenCalledWith(
      { periodType: 'WEEKLY', limit: 20 },
      req.user
    );
    await run(controller.listRecords, req, res);
    expect(service.listRecords).toHaveBeenCalledWith(expect.anything(), req.user);
  });

  it('getMyAchievements: 404 when no student profile is linked', async () => {
    (service.getMyAchievements as any).mockResolvedValue(null);
    const { req, res } = mockReqRes();
    await run(controller.getMyAchievements, req, res);
    expect((res as any).statusCode).toBe(404);
  });
});
