import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../laundry.service', () => ({
  laundryReadScope: vi.fn(() => ({ unitId: 'scoped-unit' })),
  pricingService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  transactionService: {
    getAll: vi.fn(),
    getStats: vi.fn(),
    getReadyForPickup: vi.fn(),
    getByStudent: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    processPayment: vi.fn(),
  },
}));

import * as controller from '../laundry.controller';
import { laundryReadScope, pricingService, transactionService } from '../laundry.service';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = {
    query: {},
    params: {},
    body: {},
    user: { unitId: 'unit-1', sub: 'user-1' },
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

describe('laundry controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listPricing: 400 when the caller has no unit', async () => {
    const { req, res } = mockReqRes({ user: {} as any });
    await run(controller.listPricing, req, res);
    expect((res as any).statusCode).toBe(400);
    expect(pricingService.getAll).not.toHaveBeenCalled();
  });

  it('listPricing: returns pricing scoped to the caller unit', async () => {
    (pricingService.getAll as any).mockResolvedValue([{ id: 'p1' }]);
    const { req, res } = mockReqRes();
    await run(controller.listPricing, req, res);
    expect(pricingService.getAll).toHaveBeenCalledWith('unit-1');
    expect((res as any).jsonPayload.data).toEqual([{ id: 'p1' }]);
  });

  it('listTransactions: reads through laundryReadScope, not the caller unit alone', async () => {
    (transactionService.getAll as any).mockResolvedValue({ data: [], pagination: {} });
    const { req, res } = mockReqRes({
      user: { sub: 'u', roleCode: 'MUSYRIF', unitId: 'p' } as any,
    });
    await run(controller.listTransactions, req, res);
    expect(laundryReadScope).toHaveBeenCalledWith(req.user);
    expect((transactionService.getAll as any).mock.calls[0][0]).toEqual({ unitId: 'scoped-unit' });
  });

  it('getStats: reads through laundryReadScope, not the caller unit alone', async () => {
    (transactionService.getStats as any).mockResolvedValue({ summary: {} });
    const { req, res } = mockReqRes({
      user: { sub: 'u', roleCode: 'MUSYRIF', unitId: 'p' } as any,
    });
    await run(controller.getStats, req, res);
    expect(laundryReadScope).toHaveBeenCalledWith(req.user);
    expect((transactionService.getStats as any).mock.calls[0][0]).toEqual({
      unitId: 'scoped-unit',
    });
  });

  it('getReadyForPickup: reads through laundryReadScope, not the caller unit alone', async () => {
    (transactionService.getReadyForPickup as any).mockResolvedValue([]);
    const { req, res } = mockReqRes({
      user: { sub: 'u', roleCode: 'MUSYRIF', unitId: 'p' } as any,
    });
    await run(controller.getReadyForPickup, req, res);
    expect(laundryReadScope).toHaveBeenCalledWith(req.user);
    expect((transactionService.getReadyForPickup as any).mock.calls[0][0]).toEqual({
      unitId: 'scoped-unit',
    });
  });

  it('createTransaction: needs both unit and user id', async () => {
    const { req, res } = mockReqRes({ user: { unitId: 'unit-1' } as any });
    await run(controller.createTransaction, req, res);
    expect((res as any).statusCode).toBe(400);
    expect(transactionService.create).not.toHaveBeenCalled();
  });

  it('createTransaction: creates with unit + user and returns 201', async () => {
    (transactionService.create as any).mockResolvedValue({ id: 't1' });
    const { req, res } = mockReqRes({ body: { items: [] } as any });
    await run(controller.createTransaction, req, res);
    expect(transactionService.create).toHaveBeenCalledWith('unit-1', 'user-1', { items: [] });
    expect((res as any).statusCode).toBe(201);
  });
});
