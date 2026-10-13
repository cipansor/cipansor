import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    workWeekConfig: { findFirst: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma';
import {
  holidaysInRange,
  isHolidayDay,
  isNonWorkingDay,
  isWorkDay,
  workDatesInRange,
  workWeekFor,
} from './work-calendar';

const m = prisma as unknown as {
  workWeekConfig: { findFirst: ReturnType<typeof vi.fn> };
  calendarEvent: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('workWeekFor', () => {
  it('prefers the unit config over the yayasan default', async () => {
    m.workWeekConfig.findFirst
      .mockResolvedValueOnce({ workDays: [1, 2, 3], hoursPerDay: 6 })
      .mockResolvedValueOnce({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });

    await expect(workWeekFor('unit-1')).resolves.toEqual({
      workDays: [1, 2, 3],
      hoursPerDay: 6,
    });
  });

  it('falls back to the yayasan default when the unit has none', async () => {
    m.workWeekConfig.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });

    await expect(workWeekFor('unit-1')).resolves.toEqual({
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
    });
  });

  it('falls back to Mon–Sat when nothing is configured', async () => {
    m.workWeekConfig.findFirst.mockResolvedValue(null);
    await expect(workWeekFor(null)).resolves.toEqual({
      workDays: [1, 2, 3, 4, 5, 6],
      hoursPerDay: 7,
    });
  });
});

describe('holidaysInRange', () => {
  it('returns inclusive WIB ranges and treats a null end as a single day', async () => {
    m.calendarEvent.findMany.mockResolvedValue([
      { title: 'Kemerdekaan', startDate: new Date('2026-08-17T00:00:00Z'), endDate: null },
      {
        title: 'Idul Fitri',
        startDate: new Date('2026-03-19T00:00:00Z'),
        endDate: new Date('2026-03-21T00:00:00Z'),
      },
    ]);

    const holidays = await holidaysInRange(
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-08-31T00:00:00Z'),
      'unit-1'
    );

    expect(holidays).toEqual([
      { from: '2026-08-17', to: '2026-08-17', title: 'Kemerdekaan' },
      { from: '2026-03-19', to: '2026-03-21', title: 'Idul Fitri' },
    ]);
  });
});

describe('isHolidayDay / isWorkDay', () => {
  it('matches a day inside a holiday range', () => {
    const holidays = [{ from: '2026-03-19', to: '2026-03-21', title: 'Idul Fitri' }];
    expect(isHolidayDay('2026-03-20', holidays)).toBe(true);
    expect(isHolidayDay('2026-03-22', holidays)).toBe(false);
  });

  it('is not a work day when outside the week or on a holiday', () => {
    // 2026-03-22 is a Sunday; 2026-03-20 is a Friday.
    expect(isWorkDay('2026-03-22', [1, 2, 3, 4, 5], [])).toBe(false);
    expect(
      isWorkDay(
        '2026-03-20',
        [1, 2, 3, 4, 5],
        [{ from: '2026-03-19', to: '2026-03-21', title: 'Idul Fitri' }]
      )
    ).toBe(false);
    expect(isWorkDay('2026-03-20', [1, 2, 3, 4, 5], [])).toBe(true);
  });
});

describe('isNonWorkingDay', () => {
  it('is true on a configured holiday', async () => {
    m.workWeekConfig.findFirst.mockResolvedValue({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    m.calendarEvent.findMany.mockResolvedValue([
      { title: 'Kemerdekaan', startDate: new Date('2026-08-17T00:00:00Z'), endDate: null },
    ]);
    await expect(isNonWorkingDay('2026-08-17', 'unit-1')).resolves.toBe(true);
  });

  it('is true on a day outside the work week', async () => {
    m.workWeekConfig.findFirst.mockResolvedValue({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    m.calendarEvent.findMany.mockResolvedValue([]);
    // 2026-03-22 is a Sunday.
    await expect(isNonWorkingDay('2026-03-22', 'unit-1')).resolves.toBe(true);
  });

  it('is false on an ordinary working day', async () => {
    m.workWeekConfig.findFirst.mockResolvedValue({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    m.calendarEvent.findMany.mockResolvedValue([]);
    await expect(isNonWorkingDay('2026-03-20', 'unit-1')).resolves.toBe(false);
  });
});

describe('workDatesInRange', () => {
  it('returns the work week minus whole-unit holidays', async () => {
    m.workWeekConfig.findFirst.mockResolvedValue({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 });
    m.calendarEvent.findMany.mockResolvedValue([
      { title: 'Cuti bersama', startDate: new Date('2026-03-19T00:00:00Z'), endDate: null },
    ]);

    // 2026-03-16 (Mon) .. 2026-03-22 (Sun): 5 weekdays, minus Thu 03-19.
    const days = await workDatesInRange(
      new Date('2026-03-16T00:00:00Z'),
      new Date('2026-03-22T00:00:00Z'),
      'unit-1'
    );

    expect(days).toEqual(['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-20']);
  });
});
