import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../portfolio.service', () => ({
  PORTFOLIO_TYPES: ['ACADEMIC', 'OTHER'],
  PORTFOLIO_CATEGORIES: ['x'],
  getPortfolios: vi.fn(),
  createPortfolio: vi.fn(),
  getPortfolioById: vi.fn(),
  updatePortfolio: vi.fn(),
  deletePortfolio: vi.fn(),
  addPortfolioFile: vi.fn(),
  updatePortfolioFile: vi.fn(),
  deletePortfolioFile: vi.fn(),
  addPortfolioComment: vi.fn(),
  updatePortfolioComment: vi.fn(),
  deletePortfolioComment: vi.fn(),
  reviewPortfolio: vi.fn(),
  getPortfolioStatistics: vi.fn(),
  getStudentShowcase: vi.fn(),
}));

import * as controller from '../portfolio.controller';
import * as portfolioService from '../portfolio.service';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = {
    query: {},
    params: {},
    body: {},
    user: { sub: 'user-1', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' },
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

describe('portfolio controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getTypes: exposes types + categories from the service constants', () => {
    const { req, res } = mockReqRes();
    controller.getTypes(req, res);
    expect((res as any).jsonPayload.data).toEqual({
      types: ['ACADEMIC', 'OTHER'],
      categories: ['x'],
    });
  });

  it('create: returns 201', async () => {
    (portfolioService.createPortfolio as any).mockResolvedValue({ id: 'p1' });
    const { req, res } = mockReqRes({
      body: { studentId: 's1', title: 'x', type: 'OTHER' } as any,
    });
    await run(controller.create, req, res);
    expect((res as any).statusCode).toBe(201);
    expect((res as any).jsonPayload.data).toEqual({ id: 'p1' });
  });

  it('getById: 404 when missing', async () => {
    (portfolioService.getPortfolioById as any).mockResolvedValue(null);
    const { req, res } = mockReqRes({ params: { id: 'x' } as any });
    await run(controller.getById, req, res);
    expect((res as any).statusCode).toBe(404);
  });

  it('addComment: the author is the verified user, never the body', async () => {
    (portfolioService.addPortfolioComment as any).mockResolvedValue({ id: 'c1' });
    const { req, res } = mockReqRes({
      params: { id: 'p1' } as any,
      body: { content: 'hi', userId: 'someone-else' } as any,
    });
    await run(controller.addComment, req, res);
    expect(portfolioService.addPortfolioComment).toHaveBeenCalledWith(
      { portfolioId: 'p1', content: 'hi' },
      req.user
    );
    expect((res as any).statusCode).toBe(201);
  });
});

describe('portfolio controller hands the verified user to every service call', () => {
  // The service decides which santri the account reaches; a call that drops
  // the user would read or write with no scope at all.
  it.each([
    ['list', controller.list, 'getPortfolios'],
    ['create', controller.create, 'createPortfolio'],
    ['getById', controller.getById, 'getPortfolioById'],
    ['update', controller.update, 'updatePortfolio'],
    ['remove', controller.remove, 'deletePortfolio'],
    ['addFile', controller.addFile, 'addPortfolioFile'],
    ['updateFile', controller.updateFile, 'updatePortfolioFile'],
    ['deleteFile', controller.deleteFile, 'deletePortfolioFile'],
    ['addComment', controller.addComment, 'addPortfolioComment'],
    ['updateComment', controller.updateComment, 'updatePortfolioComment'],
    ['deleteComment', controller.deleteComment, 'deletePortfolioComment'],
    ['review', controller.review, 'reviewPortfolio'],
    ['getStatistics', controller.getStatistics, 'getPortfolioStatistics'],
    ['getShowcase', controller.getShowcase, 'getStudentShowcase'],
  ] as const)('%s', async (_name, handler, method) => {
    const fn = (portfolioService as any)[method];
    fn.mockResolvedValue(method === 'getPortfolios' ? { data: [], pagination: {} } : { id: 'x' });
    const { req, res } = mockReqRes({
      params: { id: 'p1', fileId: 'f1', commentId: 'c1', studentId: 's1' } as any,
      body: { content: 'x' } as any,
    });
    await run(handler as any, req, res);
    // The verified user itself — role and unit included, which studentScope
    // reads — not a copy that keeps only the id.
    expect(fn.mock.calls.at(-1)!.at(-1)).toBe(req.user);
  });
});
