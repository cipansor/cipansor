import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { RoleCode } from '@prisma/client';

import * as controller from '../privacy-policy.controller';
import * as service from '../privacy-policy.service';

vi.mock('../privacy-policy.service', () => ({
  getCurrentPolicy: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  createVersion: vi.fn(),
}));

/**
 * The controller is where the request meets the business logic: it parses the
 * body/params/query, reads the author's identity, and shapes the HTTP response.
 * A service test passes its arguments directly and cannot see any of that, so a
 * broken field mapping or a wrong status code would slip through it (AGENTS.md
 * rule 7). These exercise the real handlers.
 */

function mockRequest(over: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ...over,
  } as unknown as Request;
}

function mockResponse() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const dto = (over: Record<string, unknown> = {}) => ({
  version: 5,
  effectiveAt: '2027-01-01T00:00:00.000Z',
  texts: {
    id: { body: 'b-id', summary: 's-id' },
    en: { body: 'b-en', summary: 's-en' },
    ar: { body: 'b-ar', summary: 's-ar' },
  },
  ...over,
});

describe('privacy-policy controller', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getCurrent (public)', () => {
    it('answers 200 with the current policy', async () => {
      vi.mocked(service.getCurrentPolicy).mockResolvedValueOnce(dto() as any);
      const res = mockResponse();

      await controller.getCurrent(mockRequest(), res, vi.fn());

      expect(service.getCurrentPolicy).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ version: 5 }),
      });
    });

    it('answers 200 with null when nothing is published', async () => {
      vi.mocked(service.getCurrentPolicy).mockResolvedValueOnce(null);
      const res = mockResponse();

      await controller.getCurrent(mockRequest(), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
    });
  });

  describe('getVersion', () => {
    it('parses the version param and returns the version', async () => {
      vi.mocked(service.getVersion).mockResolvedValueOnce(dto({ version: 2 }) as any);
      const res = mockResponse();

      await controller.getVersion(mockRequest({ params: { version: '2' } }), res, vi.fn());

      // The param arrives as a string and must reach the service as a number.
      expect(service.getVersion).toHaveBeenCalledWith(2);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ version: 2 }),
      });
    });

    it('answers 404 when the version does not exist', async () => {
      vi.mocked(service.getVersion).mockResolvedValueOnce(null);
      const res = mockResponse();

      await controller.getVersion(mockRequest({ params: { version: '99' } }), res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'NOT_FOUND' }),
        })
      );
    });

    it('rejects a non-numeric version before the service runs', async () => {
      // `asyncHandler` funnels the throw to `next`, where the error middleware
      // turns a ZodError into a 400. The handler must not touch the service.
      const res = mockResponse();
      const next = vi.fn();

      await controller.getVersion(mockRequest({ params: { version: 'abc' } }), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0].name).toBe('ZodError');
      expect(service.getVersion).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('listVersions', () => {
    it('passes pagination through and answers with the pagination envelope', async () => {
      vi.mocked(service.listVersions).mockResolvedValueOnce({
        data: [{ id: 'v1', version: 1 } as any],
        pagination: { page: 2, limit: 5, total: 11, totalPages: 3 },
      });
      const res = mockResponse();

      await controller.listVersions(
        mockRequest({ query: { page: '2', limit: '5' } }),
        res,
        vi.fn()
      );

      expect(service.listVersions).toHaveBeenCalledWith({ page: 2, limit: 5 });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: 'v1', version: 1 }],
        pagination: { page: 2, limit: 5, total: 11, totalPages: 3 },
      });
    });
  });

  describe('createVersion', () => {
    // The shared schema enforces minimum lengths, so the fixtures are realistic.
    const body = {
      bodies: {
        id: 'Isi kebijakan privasi dalam bahasa Indonesia, cukup panjang.',
        en: 'The privacy policy body in English, long enough for the schema.',
        ar: 'نص سياسة الخصوصية باللغة العربية، طويل بما يكفي للمخطط.',
      },
      summaries: {
        id: 'Ringkasan kebijakan privasi.',
        en: 'A short privacy policy summary.',
        ar: 'ملخص قصير لسياسة الخصوصية.',
      },
      effectiveAt: '2027-01-01T00:00:00.000Z',
    };

    it('parses the body, maps the author identity, and answers 201', async () => {
      vi.mocked(service.createVersion).mockResolvedValueOnce(dto() as any);
      const res = mockResponse();

      await controller.createVersion(
        mockRequest({
          body,
          user: { sub: 'user-1', roleCode: RoleCode.SUPER_ADMIN } as any,
        }),
        res,
        vi.fn()
      );

      // The author comes from the session, never from the body.
      expect(service.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          bodies: expect.objectContaining({ id: body.bodies.id }),
          effectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        }),
        { sub: 'user-1' }
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ version: 5 }),
        message: 'Versi kebijakan privasi diterbitkan',
      });
    });

    it('rejects a body missing a language before the service runs', async () => {
      const res = mockResponse();
      const next = vi.fn();

      await controller.createVersion(
        mockRequest({
          body: {
            bodies: { id: body.bodies.id, en: body.bodies.en },
            summaries: body.summaries,
            effectiveAt: body.effectiveAt,
          },
          user: { sub: 'user-1' } as any,
        }),
        res,
        next
      );

      expect(next.mock.calls[0][0].name).toBe('ZodError');
      expect(service.createVersion).not.toHaveBeenCalled();
    });

    it('rejects a caller with no session before the service runs', async () => {
      const res = mockResponse();
      const next = vi.fn();

      await controller.createVersion(mockRequest({ body }), res, next);

      expect(next.mock.calls[0][0].code).toBe('UNAUTHORIZED');
      expect(service.createVersion).not.toHaveBeenCalled();
    });
  });
});
