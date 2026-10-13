import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    setting: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    calendarEvent: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    unit: { findFirst: vi.fn() },
  },
}));

import { prisma } from '../../../lib/prisma';
import {
  DEFAULT_HOLIDAY_SOURCE_URL,
  approveHolidayDraft,
  fetchHolidaysForYear,
  getHolidaySyncConfig,
  listHolidayDrafts,
  parseHolidayResponse,
  rejectHolidayDraft,
  syncHolidaysForYear,
} from '../holiday-sync.service';

const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const SAMPLE = {
  status: 'success',
  code: 200,
  data: [
    { date: '2026-01-01', description: 'Tahun Baru 2026 Masehi' },
    { date: '2026-03-19', description: 'Hari Suci Nyepi Tahun Baru Saka 1948' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.setting.findFirst.mockResolvedValue(null);
  m.calendarEvent.findFirst.mockResolvedValue(null);
  m.calendarEvent.create.mockResolvedValue({ id: 'evt-1' });
  m.unit.findFirst.mockResolvedValue({ id: 'unit-1' });
});

describe('parseHolidayResponse', () => {
  it('reads the api-hari-libur shape', () => {
    expect(parseHolidayResponse(SAMPLE)).toEqual([
      { date: '2026-01-01', description: 'Tahun Baru 2026 Masehi' },
      { date: '2026-03-19', description: 'Hari Suci Nyepi Tahun Baru Saka 1948' },
    ]);
  });

  it('rejects a body without a data array', () => {
    expect(() => parseHolidayResponse({ status: 'success' })).toThrow(/daftar libur/i);
    expect(() => parseHolidayResponse('<html>not json</html>')).toThrow(/objek/i);
  });

  it('skips rows whose date or description is unusable', () => {
    const parsed = parseHolidayResponse({
      data: [
        { date: 'not-a-date', description: 'X' },
        { date: '2026-01-01', description: '   ' },
        { date: '2026-01-02', description: 'Cuti Bersama' },
      ],
    });
    expect(parsed).toEqual([{ date: '2026-01-02', description: 'Cuti Bersama' }]);
  });
});

describe('fetchHolidaysForYear', () => {
  it('rejects when the source cannot be reached', async () => {
    const original = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as never;
    await expect(fetchHolidaysForYear(2026)).rejects.toThrow(/Tidak dapat menghubungi/i);
    global.fetch = original;
  });

  it('rejects a non-OK answer rather than treating it as no holidays', async () => {
    const original = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 } as never);
    await expect(fetchHolidaysForYear(2026)).rejects.toThrow(/502/);
    global.fetch = original;
  });
});

describe('getHolidaySyncConfig', () => {
  it('falls back to the default source and enabled', async () => {
    const config = await getHolidaySyncConfig();
    expect(config.sourceUrl).toBe(DEFAULT_HOLIDAY_SOURCE_URL);
    expect(config.enabled).toBe(true);
  });

  it('reads an admin-set source', async () => {
    m.setting.findFirst.mockResolvedValue({
      value: { sourceUrl: 'https://example.test/holidays', years: [2027], enabled: false },
    });
    const config = await getHolidaySyncConfig();
    expect(config.sourceUrl).toBe('https://example.test/holidays');
    expect(config.years).toEqual([2027]);
    expect(config.enabled).toBe(false);
  });
});

describe('syncHolidaysForYear', () => {
  beforeEach(() => {
    const original = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SAMPLE,
    }) as never;
    void original;
  });

  it('creates a calendar event per holiday', async () => {
    const result = await syncHolidaysForYear(2026, { createdById: 'user-1' });
    expect(result.created).toBe(2);
    expect(result.entries).toBe(2);
    expect(m.calendarEvent.create).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate a holiday already on the calendar', async () => {
    m.calendarEvent.findFirst.mockResolvedValue({ id: 'evt-existing' });
    const result = await syncHolidaysForYear(2026, { createdById: 'user-1' });
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(2);
    expect(m.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('imports every holiday as a draft, not a live event', async () => {
    await syncHolidaysForYear(2026, { createdById: 'user-1' });
    expect(m.calendarEvent.create).toHaveBeenCalledTimes(2);
    for (const call of m.calendarEvent.create.mock.calls) {
      expect(call[0].data.isDraft).toBe(true);
    }
  });
});

describe('holiday drafts', () => {
  it('lists only undecided, un-deleted drafts', async () => {
    m.calendarEvent.findMany.mockResolvedValue([]);
    await listHolidayDrafts('unit-1');
    const where = m.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.isDraft).toBe(true);
    expect(where.deletedAt).toBeNull();
    expect(where.eventType).toBe('HOLIDAY');
  });

  it('approves a draft by clearing the draft flag', async () => {
    m.calendarEvent.findFirst.mockResolvedValue({ id: 'draft-1' });
    m.calendarEvent.update.mockResolvedValue({ id: 'draft-1', isDraft: false });
    await approveHolidayDraft('draft-1');
    expect(m.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { isDraft: false },
    });
  });

  it('rejects a draft by soft-deleting it', async () => {
    m.calendarEvent.findFirst.mockResolvedValue({ id: 'draft-1' });
    m.calendarEvent.update.mockResolvedValue({ id: 'draft-1' });
    await rejectHolidayDraft('draft-1');
    expect(m.calendarEvent.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('refuses to approve something that is not a draft', async () => {
    m.calendarEvent.findFirst.mockResolvedValue(null);
    await expect(approveHolidayDraft('live-1')).rejects.toThrow(/draf libur/i);
    expect(m.calendarEvent.update).not.toHaveBeenCalled();
  });
});
