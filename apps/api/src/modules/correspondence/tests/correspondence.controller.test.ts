import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../correspondence.service', () => ({
  CorrespondenceService: {
    updateLetter: vi.fn(),
    exportAgendaCsv: vi.fn(),
    reviewRetention: vi.fn(),
    exportRetentionCsv: vi.fn(),
  },
}));

import { CorrespondenceController } from '../correspondence.controller';
import { CorrespondenceService } from '../correspondence.service';
import { ApiResponse } from '@/utils/response';

const mockResponse = () => {
  const res: any = {};
  res.json = vi.fn((body) => res);
  res.status = vi.fn(() => res);
  return res as Response;
};

const mockRequest = (overrides: Partial<Request> = {}) =>
  ({
    params: { id: 'letter-1' },
    body: { subject: 'Naskah diperbarui', urgency: 'URGENT' },
    user: {
      id: 'user-1',
      role: 'UNIT_ADMIN',
      roleCode: 'UNIT_ADMIN',
      unitId: 'unit-smp-1',
    },
    ...overrides,
  }) as unknown as Request;

describe('CorrespondenceController.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to CorrespondenceService.updateLetter and responds with the letter', async () => {
    const serviceResult = { id: 'letter-1', subject: 'Naskah diperbarui' };
    (CorrespondenceService.updateLetter as any).mockResolvedValue(serviceResult);
    const apiSpy = vi.spyOn(ApiResponse, 'success').mockImplementation((data, message) => ({
      success: true,
      message: message ?? 'OK',
      data,
    }));

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

    // asyncHandler fire-and-forgets the wrapped promise, so await the async
    // effect via waitFor rather than trusting the wrapper's return value.
    CorrespondenceController.update(req, res, next);
    await vi.waitFor(() => {
      expect(res.json).toHaveBeenCalled();
    });

    expect(CorrespondenceService.updateLetter).toHaveBeenCalledWith(
      'letter-1',
      { subject: 'Naskah diperbarui', urgency: 'URGENT' },
      'user-1',
      { id: 'user-1', role: 'UNIT_ADMIN', roleCode: 'UNIT_ADMIN', unitId: 'unit-smp-1' }
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: serviceResult })
    );
    apiSpy.mockRestore();
  });

  it('propagates a service error through the asyncHandler', async () => {
    const serviceError = new Error('Semester harus bernilai 1 (Ganjil) atau 2 (Genap)');
    (CorrespondenceService.updateLetter as any).mockRejectedValue(serviceError);

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    CorrespondenceController.update(req, res, next as unknown as NextFunction);

    // The wrapper forwards to the error middleware rather than re-throwing.
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledWith(serviceError);
    });
  });
});

describe('CorrespondenceController.exportAgenda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockRes = () => {
    const res: any = {};
    res.locals = {};
    res.setHeader = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res as Response;
  };

  it('sends a CSV attachment built from the validated query, not the raw one', async () => {
    vi.mocked(CorrespondenceService.exportAgendaCsv).mockResolvedValue('BOM,data');
    // The route runs `validateQuery`, so the controller must read the parsed
    // value. The raw `req.query` deliberately carries junk to prove it is
    // ignored — reading it would let an invalid filter reach the service.
    const req = {
      user: { id: 'user-1', role: 'UNIT_ADMIN', roleCode: 'UNIT_ADMIN', unitId: 'unit-1' },
      query: { direction: 'NOT_A_DIRECTION', status: 'NOT_A_STATUS' },
    } as unknown as Request;
    const res = mockRes();
    (res.locals as any).validatedQuery = { direction: 'INCOMING', status: 'SIGNED' };
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

    CorrespondenceController.exportAgenda(req, res, next);

    await vi.waitFor(() => {
      expect(CorrespondenceService.exportAgendaCsv).toHaveBeenCalledWith(
        { id: 'user-1', role: 'UNIT_ADMIN', roleCode: 'UNIT_ADMIN', unitId: 'unit-1' },
        { direction: 'INCOMING', status: 'SIGNED', from: undefined, to: undefined }
      );
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('Buku-Agenda-')
    );
    expect(res.send).toHaveBeenCalledWith('BOM,data');
  });
});

describe('CorrespondenceController.reviewRetention', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('answers with the retention summary for a unit correspondent', async () => {
    const summary = { dryRun: true, due: [], consideredCount: 3, missingRetention: 0 };
    (CorrespondenceService.reviewRetention as any).mockResolvedValue(summary);
    vi.spyOn(ApiResponse, 'success').mockImplementation((data) => ({
      success: true,
      message: 'OK',
      data,
    }));

    // A real Tata Usaha role code: the legacy 'UNIT_ADMIN' string is not in
    // LETTER_UNIT_SCOPE_ROLES, so it would be refused.
    const req = mockRequest({
      user: {
        id: 'user-tu',
        role: 'UNIT_ADMIN',
        roleCode: 'SDIT_TATA_USAHA',
        unitId: 'unit-sdit',
      } as any,
    });
    const res = mockResponse();
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

    CorrespondenceController.reviewRetention(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(CorrespondenceService.reviewRetention).toHaveBeenCalledWith({
      id: 'user-tu',
      role: 'UNIT_ADMIN',
      roleCode: 'SDIT_TATA_USAHA',
      unitId: 'unit-sdit',
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: summary })
    );
  });

  it('forbids an account that neither handles correspondence nor chooses a unit', async () => {
    // A santri account: it carries a unitId but no letter duty.
    const req = mockRequest({
      user: {
        id: 'user-santri',
        role: 'STUDENT',
        roleCode: 'SMPIT_SISWA',
        unitId: 'unit-smp-1',
      } as any,
    });
    const res = mockResponse();
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

    CorrespondenceController.reviewRetention(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(CorrespondenceService.reviewRetention).not.toHaveBeenCalled();
    expect((next.mock.calls[0][0] as any).statusCode).toBe(403);
  });
});

describe('CorrespondenceController.exportRetention', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const mockStreamRes = () => {
    const res: any = {};
    res.locals = {};
    res.setHeader = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res as Response;
  };

  it('streams a CSV with the retention filename', async () => {
    (CorrespondenceService.exportRetentionCsv as any).mockResolvedValue('BOM,retensi');

    const req = mockRequest({
      user: {
        id: 'user-tu',
        role: 'UNIT_ADMIN',
        roleCode: 'SDIT_TATA_USAHA',
        unitId: 'unit-sdit',
      } as any,
    });
    const res = mockStreamRes();
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

    CorrespondenceController.exportRetention(req, res, next);
    await vi.waitFor(() => expect(res.send).toHaveBeenCalled());

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('Peninjauan-Retensi-')
    );
    expect(res.send).toHaveBeenCalledWith('BOM,retensi');
  });

  it('refuses a caller without letter duty before touching the service', async () => {
    const req = mockRequest({
      user: {
        id: 'user-santri',
        role: 'STUDENT',
        roleCode: 'SMPIT_SISWA',
        unitId: 'unit-smp-1',
      } as any,
    });
    const res = mockStreamRes();
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

    CorrespondenceController.exportRetention(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(CorrespondenceService.exportRetentionCsv).not.toHaveBeenCalled();
    expect((next.mock.calls[0][0] as any).statusCode).toBe(403);
  });
});
