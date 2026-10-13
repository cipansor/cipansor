import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../holiday-sync.service', () => ({
  getHolidaySyncConfig: vi.fn(),
  updateHolidaySyncConfig: vi.fn(),
  syncHolidaysForYear: vi.fn(),
  listHolidayDrafts: vi.fn(),
  approveHolidayDraft: vi.fn(),
  rejectHolidayDraft: vi.fn(),
}));

import * as holiday from '../holiday-sync.service';
import { calendarController } from '../calendar.controller';

function mockReqRes(overrides: Partial<Request> = {}) {
  const req = {
    query: {},
    params: {},
    body: {},
    user: { sub: 'user-1', roleCode: 'SDIT_ADMIN', unitId: 'unit-sdit' },
    ...overrides,
  } as unknown as Request;
  const res = {
    jsonPayload: undefined as unknown,
    json(payload: unknown) {
      (this as any).jsonPayload = payload;
      return this;
    },
  } as unknown as Response & { jsonPayload: any };
  return { req, res };
}

async function run(handler: any, req: Request, res: Response) {
  const next = vi.fn();
  await handler(req, res, next);
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  (holiday.syncHolidaysForYear as any).mockResolvedValue({ year: 2026, created: 1 });
  (holiday.listHolidayDrafts as any).mockResolvedValue([]);
  (holiday.approveHolidayDraft as any).mockResolvedValue({ id: 'draft-1' });
  (holiday.rejectHolidayDraft as any).mockResolvedValue({ id: 'draft-1' });
});

describe('holiday import unit scope', () => {
  it('pins a unit admin’s import to their own unit, ignoring a named one', async () => {
    const { req, res } = mockReqRes({ body: { year: 2026, unitId: 'unit-sma' } });
    const next = await run(calendarController.syncHolidays.bind(calendarController), req, res);
    // Naming another unit is refused rather than silently retargeted.
    expect(next).toHaveBeenCalled();
    expect(holiday.syncHolidaysForYear).not.toHaveBeenCalled();
  });

  it('lets a foundation role import yayasan-wide (unitId null)', async () => {
    const { req, res } = mockReqRes({
      body: { year: 2026 },
      user: { sub: 'u', roleCode: 'SUPER_ADMIN', unitId: null } as never,
    });
    await run(calendarController.syncHolidays.bind(calendarController), req, res);
    expect(holiday.syncHolidaysForYear).toHaveBeenCalledWith(
      2026,
      expect.objectContaining({ unitId: null })
    );
  });

  it('scopes the draft queue to the caller’s unit', async () => {
    const { req, res } = mockReqRes();
    await run(calendarController.listHolidayDrafts.bind(calendarController), req, res);
    expect(holiday.listHolidayDrafts).toHaveBeenCalledWith('unit-sdit');
  });

  it('refuses a unit admin reviewing another unit’s draft', async () => {
    const { req, res } = mockReqRes({
      params: { id: 'draft-1' },
      body: { unitId: 'unit-sma' },
    });
    const next = await run(
      calendarController.approveHolidayDraft.bind(calendarController),
      req,
      res
    );
    expect(next).toHaveBeenCalled();
    expect(holiday.approveHolidayDraft).not.toHaveBeenCalled();
  });

  it('passes the scoped unit through on approval', async () => {
    const { req, res } = mockReqRes({ params: { id: 'draft-1' } });
    await run(calendarController.approveHolidayDraft.bind(calendarController), req, res);
    expect(holiday.approveHolidayDraft).toHaveBeenCalledWith('draft-1', 'unit-sdit');
  });
});
