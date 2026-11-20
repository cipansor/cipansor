/**
 * `getToday()` reads the WIB calendar day, not the server's (#1152).
 *
 * It built its window with `today.setHours(0, 0, 0, 0)`, which on the UTC
 * container is midnight UTC — still the previous day between 00:00 and 06:59
 * WIB. The window was therefore WIB [yesterday 07:00, today 07:00): the whole
 * of today from 07:00 onwards was missing, and yesterday's tail crept in.
 *
 * The clock is frozen at 2026-10-26T23:00:00Z = 27 Oct 2026 06:00 WIB, and the
 * mocked `findMany` applies the `where` the service builds to a set of real
 * event instants, so the test proves which events land in "today".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { calendarEvent: { findMany: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { calendarService } from '../calendar.service';

/** 27 Oct 2026 06:00 WIB — the server clock still reads 26 Oct. */
const NOW = new Date('2026-10-26T23:00:00.000Z');
const UNIT = 'unit-sdit';

const EVENTS = [
  { id: 'yesterday-evening', startDate: new Date('2026-10-26T13:00:00.000Z') }, // 26 Oct 20:00 WIB
  { id: 'today-early', startDate: new Date('2026-10-26T22:00:00.000Z') }, // 27 Oct 05:00 WIB
  { id: 'today-morning', startDate: new Date('2026-10-27T01:00:00.000Z') }, // 27 Oct 08:00 WIB
  { id: 'tomorrow-early', startDate: new Date('2026-10-27T19:00:00.000Z') }, // 28 Oct 02:00 WIB
];

/** The window the service asked for. */
const requestedWindow = () => {
  const where = vi.mocked(prismaMock.calendarEvent.findMany).mock.calls[0][0]!.where as {
    startDate: { gte: Date; lt: Date };
  };
  return where.startDate;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  // Apply the `where` the service built to the fixture, the way Postgres would.
  vi.mocked(prismaMock.calendarEvent.findMany).mockImplementation(async (args: never) => {
    const { startDate } = (args as unknown as { where: { startDate: { gte: Date; lt: Date } } })
      .where;
    return EVENTS.filter(
      (event) => event.startDate >= startDate.gte && event.startDate < startDate.lt
    ) as never;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('calendarService.getToday — the WIB calendar day', () => {
  it('asks for 27 Oct 2026 (00:00–24:00 WIB), not 26 Oct', async () => {
    await calendarService.getToday(UNIT);

    expect(requestedWindow().gte.toISOString()).toBe('2026-10-26T17:00:00.000Z');
    expect(requestedWindow().lt.toISOString()).toBe('2026-10-27T17:00:00.000Z');
  });

  it('keeps today’s events and drops yesterday’s tail and tomorrow’s early hours', async () => {
    const events = (await calendarService.getToday(UNIT)) as unknown as { id: string }[];

    expect(events.map((event) => event.id)).toEqual(['today-early', 'today-morning']);
  });
});
