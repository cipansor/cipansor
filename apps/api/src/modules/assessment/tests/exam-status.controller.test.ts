import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../assessment.service', () => ({
  updateExamStatus: vi.fn().mockResolvedValue({ id: 'exam-1', status: 'SCHEDULED' }),
}));

import * as service from '../assessment.service';
import { updateExamStatus } from '../assessment.controller';

function call(body: unknown) {
  const req = { params: { id: 'exam-1' }, body } as unknown as Request;
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  return { req, res, next, json };
}

describe('PATCH /assessment/exams/:id/status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a known status to the service', async () => {
    const { req, res, next, json } = call({ status: 'SCHEDULED' });
    await updateExamStatus(req, res, next);
    expect(service.updateExamStatus).toHaveBeenCalledWith('exam-1', 'SCHEDULED');
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'exam-1', status: 'SCHEDULED' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses an unknown status before it reaches the database', async () => {
    const { req, res, next } = call({ status: 'PUBLISHED' });
    await updateExamStatus(req, res, next);
    expect(service.updateExamStatus).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });

  it('refuses a missing status', async () => {
    const { req, res, next } = call({});
    await updateExamStatus(req, res, next);
    expect(service.updateExamStatus).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });
});
