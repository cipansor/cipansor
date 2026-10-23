import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../muhasabah.service', () => ({
  default: {
    findByStudentAndDate: vi.fn(),
    create: vi.fn(),
    getDailyReport: vi.fn(),
  },
}));

vi.mock('@/middleware/auth', () => ({
  requireStudentId: vi.fn().mockResolvedValue('s1'),
}));

import muhasabahController from '../muhasabah.controller';
import muhasabahService from '../muhasabah.service';
import { requireStudentId } from '@/middleware/auth';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = { query: {}, params: {}, body: {}, ...overrides } as unknown as Request;
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

/**
 * Endpoint `/me` dan `/daily-report` harus memakai kalender WIB. Di kontainer
 * UTC, `new Date().toISOString().split('T')[0]` pada pukul 05:00 WIB
 * menghasilkan hari kemarin. Lihat issue #888.
 */
describe('muhasabahController — kalender WIB', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(() => {
    vi.useRealTimers();
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStudentId).mockResolvedValue('s1');
  });

  // 23 Okt 2026 05:00 WIB.
  const JAKARTA_EARLY_MORNING = '2026-10-22T22:00:00.000Z';
  const WIB_DAY = new Date('2026-10-23T00:00:00.000Z');

  it('getMyToday mencari hari WIB', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    (muhasabahService.findByStudentAndDate as any).mockResolvedValue(null);

    const { req, res } = mockReqRes();
    await run(muhasabahController.getMyToday, req, res);

    expect(muhasabahService.findByStudentAndDate).toHaveBeenCalledWith('s1', WIB_DAY);
  });

  it('createMine tanpa tanggal memakai hari WIB', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    (muhasabahService.create as any).mockResolvedValue({ id: 'm1' });

    const { req, res } = mockReqRes({ body: { mood: 'GOOD' } as any });
    await run(muhasabahController.createMine, req, res);

    expect(muhasabahService.create).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 's1', date: '2026-10-23' })
    );
  });

  it('createMine menghormati tanggal yang dikirim klien', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    (muhasabahService.create as any).mockResolvedValue({ id: 'm1' });

    const { req, res } = mockReqRes({ body: { mood: 'GOOD', date: '2026-10-20' } as any });
    await run(muhasabahController.createMine, req, res);

    expect(muhasabahService.create).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-10-20' })
    );
  });

  it('getDailyReport tanpa ?date memakai hari WIB', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    (muhasabahService.getDailyReport as any).mockResolvedValue({ date: WIB_DAY });

    const { req, res } = mockReqRes();
    await run(muhasabahController.getDailyReport, req, res);

    expect(muhasabahService.getDailyReport).toHaveBeenCalledWith('2026-10-23', undefined);
  });

  it('getDailyReport meneruskan ?date apa adanya', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    (muhasabahService.getDailyReport as any).mockResolvedValue({ date: WIB_DAY });

    const { req, res } = mockReqRes({ query: { date: '2026-10-01' } as any });
    await run(muhasabahController.getDailyReport, req, res);

    expect(muhasabahService.getDailyReport).toHaveBeenCalledWith('2026-10-01', undefined);
  });
});
