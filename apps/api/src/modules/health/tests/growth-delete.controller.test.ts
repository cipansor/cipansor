import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../health.service', () => ({
  deleteGrowthRecord: vi.fn(),
}));

import * as service from '../health.service';
import { deleteGrowthRecord } from '../health.controller';

const mocked = service as unknown as {
  deleteGrowthRecord: ReturnType<typeof vi.fn>;
};

/** A unit admin — unit-scoped, holds HEALTH_MANAGE. */
function actor(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    roleCode: 'SDIT_ADMIN',
    unitId: 'unit-1',
    ...overrides,
  };
}

function mockReqRes(req: Partial<Request> = {}) {
  const request = {
    params: { id: 'gr-1' },
    body: {},
    query: {},
    user: actor(),
    ...req,
  } as unknown as Request;
  const response = { json: vi.fn() } as unknown as Response;
  return { req: request, res: response };
}

async function run(req: Request, res: Response) {
  const next = vi.fn() as unknown as NextFunction;
  await deleteGrowthRecord(req, res, next);
  return next as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.deleteGrowthRecord.mockResolvedValue({ id: 'gr-1' });
});

describe('deleteGrowthRecord controller', () => {
  it('answers the success envelope once the service deletes', async () => {
    const { req, res } = mockReqRes();
    const next = await run(req, res);

    expect(mocked.deleteGrowthRecord).toHaveBeenCalledWith(
      'gr-1',
      expect.objectContaining({ unitId: 'unit-1' })
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Growth record deleted',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('scopes the delete to the caller’s unit, not the request', async () => {
    const { req, res } = mockReqRes({
      params: { id: 'gr-9' },
      user: actor({ unitId: 'unit-9' }) as never,
    });
    await run(req, res);

    expect(mocked.deleteGrowthRecord).toHaveBeenCalledWith(
      'gr-9',
      expect.objectContaining({ unitId: 'unit-9' })
    );
  });

  it('forwards a service failure through next and answers nothing', async () => {
    const failure = new Error('not found');
    mocked.deleteGrowthRecord.mockRejectedValue(failure);
    const { req, res } = mockReqRes();

    const next = await run(req, res);

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.json).not.toHaveBeenCalled();
  });
});
