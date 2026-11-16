import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleCode } from '@prisma/client';

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return { ...actual };
});

vi.mock('../../../../src/lib/prisma', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import { calendarService } from '../../../../src/modules/calendar/calendar.service';
import { prisma } from '../../../../src/lib/prisma';

const findMany = prisma.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;

/** The `where` the service actually handed Prisma on the last findAll call. */
function lastWhere(): Record<string, unknown> {
  return findMany.mock.calls.at(-1)![0].where as Record<string, unknown>;
}

const board = {
  sub: 'ketua',
  role: 'UNIT_ADMIN',
  roleCode: RoleCode.YAYASAN_KETUA,
  unitId: null,
};

/**
 * A month window must return an event that merely *overlaps* it, not only one
 * that starts inside it. `findAll` filtered on `startDate` alone, so an agenda
 * running 31 Dec–4 Jan — the classic "libur semester" — vanished from the
 * January view even though it is happening (ticket #911). These assert the
 * emitted `where`, so they fail if the overlap is reverted.
 */
describe('CalendarService.findAll date window', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns events that overlap the window, not only those starting in it', async () => {
    await calendarService.findAll(
      { page: 1, limit: 50, startDate: '2026-01-01', endDate: '2026-01-31' },
      board
    );
    const where = lastWhere();
    // The window's end bounds the event's start…
    expect(where.AND).toContainEqual({ startDate: { lte: new Date('2026-01-31') } });
    // …and the window's start must fall at or before the event's end (an event
    // with no end is a single day, so it is its own start).
    expect(where.AND).toContainEqual({
      OR: [
        { endDate: { gte: new Date('2026-01-01') } },
        { endDate: null, startDate: { gte: new Date('2026-01-01') } },
      ],
    });
    // The old, start-only filter is gone: `startDate` no longer carries the
    // range directly.
    expect(where.startDate).toBeUndefined();
  });

  it('gives the month/year filter the same overlap treatment', async () => {
    await calendarService.findAll({ page: 1, limit: 50, month: 1, year: 2026 }, board);
    const where = lastWhere();
    expect(where.AND).toContainEqual({ startDate: { lte: new Date(2026, 0, 31) } });
    expect(where.AND).toContainEqual({
      OR: [
        { endDate: { gte: new Date(2026, 0, 1) } },
        { endDate: null, startDate: { gte: new Date(2026, 0, 1) } },
      ],
    });
  });

  it('leaves the range unconstrained when no dates are given', async () => {
    await calendarService.findAll({ page: 1, limit: 50 }, board);
    const where = lastWhere();
    expect(where.AND).toBeUndefined();
    expect(where.startDate).toBeUndefined();
  });
});
