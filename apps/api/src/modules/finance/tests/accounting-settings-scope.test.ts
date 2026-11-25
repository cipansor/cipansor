import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../accounting.service', () => ({}));
vi.mock('../reports.service', () => ({}));
vi.mock('../accounting-config.service', () => ({
  getAccountMappingState: vi.fn(async () => ({ settings: {}, invalidKeys: [] })),
  setAccountMappings: vi.fn(async () => undefined),
}));

import * as configService from '../accounting-config.service';
import { getSettings, updateSettings } from '../accounting.controller';

type Handler = (req: Request, res: Response, next: (error?: unknown) => void) => Promise<void>;

const SD = '11111111-1111-4111-8111-111111111111';
const SMP = '22222222-2222-4222-8222-222222222222';

function actor(roleCode: string, unitId: string | null) {
  return { sub: 'u1', roleCode, unitId, permissions: [] };
}

async function call(
  handler: Handler,
  input: { user: ReturnType<typeof actor>; body?: unknown; query?: unknown }
) {
  const req = {
    user: input.user,
    body: input.body ?? {},
    query: input.query ?? {},
  } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn();
  await handler(req, res, next);
  return { res, next };
}

beforeEach(() => vi.clearAllMocks());

describe('accounting settings are scoped to the actor’s unit', () => {
  it('a unit admin reads its own settings even when the query names another unit', async () => {
    const { next } = await call(getSettings as Handler, {
      user: actor('SDIT_ADMIN', SD),
      query: { unitId: SMP },
    });

    expect(next).not.toHaveBeenCalled();
    expect(configService.getAccountMappingState).toHaveBeenCalledWith(SD);
  });

  it('a unit admin writes its own settings even when the body names another unit', async () => {
    const { next } = await call(updateSettings as Handler, {
      user: actor('SDIT_ADMIN', SD),
      body: { unitId: SMP, settings: { ACCOUNT_MAPPING_CASH: 'acc-cash' } },
    });

    expect(next).not.toHaveBeenCalled();
    expect(configService.setAccountMappings).toHaveBeenCalledWith(SD, {
      ACCOUNT_MAPPING_CASH: 'acc-cash',
    });
  });

  it('Super_Admin may name the unit it writes', async () => {
    const { next } = await call(updateSettings as Handler, {
      user: actor('SUPER_ADMIN', null),
      body: { unitId: SMP, settings: { ACCOUNT_MAPPING_CASH: 'acc-cash' } },
    });

    expect(next).not.toHaveBeenCalled();
    expect(configService.setAccountMappings).toHaveBeenCalledWith(SMP, {
      ACCOUNT_MAPPING_CASH: 'acc-cash',
    });
  });

  it('an actor with no unit and no foundation scope is refused', async () => {
    const { next } = await call(updateSettings as Handler, {
      user: actor('SDIT_ADMIN', null),
      body: { unitId: SMP, settings: { ACCOUNT_MAPPING_CASH: 'acc-cash' } },
    });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(configService.setAccountMappings).not.toHaveBeenCalled();
  });

  it('returns the mappings through the ApiResponse envelope', async () => {
    vi.mocked(configService.getAccountMappingState).mockResolvedValueOnce({
      settings: { ACCOUNT_MAPPING_CASH: 'acc-cash' },
      invalidKeys: [],
    });

    const { res } = await call(getSettings as Handler, {
      user: actor('SDIT_ADMIN', SD),
      query: { unitId: SD },
    });

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        mappings: { ACCOUNT_MAPPING_CASH: 'acc-cash' },
        invalidKeys: [],
      },
    });
  });
});
