import { describe, it, expect } from 'vitest';
import { createCalendarEventSchema, listCalendarEventsQuerySchema } from '@cipansor/shared';

/**
 * The calendar's write contract (#1155).
 *
 * The Tambah form used to post `category` and a `recurrenceEnd` with no
 * `eventType`, and the route validated nothing — so the bad payload reached
 * Prisma and every save answered 500. These pin the contract the form now
 * follows: what it accepts, what it refuses, and the shape it hands the
 * service.
 */
const valid = {
  title: 'Ujian Tengah Semester',
  eventType: 'EXAM',
  startDate: '2026-03-02',
  isAllDay: true,
};

describe('createCalendarEventSchema', () => {
  it('accepts the payload the Tambah form sends', () => {
    const parsed = createCalendarEventSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      eventType: 'EXAM',
      startDate: '2026-03-02',
      recurrence: 'NONE',
      isPublic: true,
      isAllDay: true,
    });
  });

  it('refuses the old payload that sent `category` instead of `eventType`', () => {
    const { eventType: _dropped, ...old } = valid;
    const parsed = createCalendarEventSchema.safeParse({ ...old, category: 'EXAM' });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].path).toEqual(['eventType']);
  });

  it('refuses a category the model cannot store', () => {
    expect(
      createCalendarEventSchema.safeParse({ ...valid, eventType: 'COMPETITION' }).success
    ).toBe(false);
  });

  it('normalises a midnight-UTC instant to its calendar day', () => {
    const parsed = createCalendarEventSchema.parse({
      ...valid,
      startDate: '2026-03-02T00:00:00.000Z',
    });
    expect(parsed.startDate).toBe('2026-03-02');
  });

  it('refuses a datetime that carries a time of day', () => {
    // It would name one day in WIB and another in UTC, and the column stores a day.
    expect(
      createCalendarEventSchema.safeParse({
        ...valid,
        startDate: '2026-03-02T13:00:00.000Z',
      }).success
    ).toBe(false);
  });

  it('requires a start time when the event is not all-day', () => {
    const parsed = createCalendarEventSchema.safeParse({
      ...valid,
      isAllDay: false,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join('.'))).toContain('startTime');
  });

  it('refuses an end date before the start', () => {
    expect(
      createCalendarEventSchema.safeParse({
        ...valid,
        endDate: '2026-03-01',
      }).success
    ).toBe(false);
  });

  it('refuses an end time before the start time', () => {
    expect(
      createCalendarEventSchema.safeParse({
        ...valid,
        isAllDay: false,
        startTime: '10:00',
        endTime: '09:00',
      }).success
    ).toBe(false);
  });

  it('requires an end date for a recurring event', () => {
    const parsed = createCalendarEventSchema.safeParse({
      ...valid,
      recurrence: 'WEEKLY',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].path).toEqual(['recurrenceEnd']);
  });

  it('caps a series at one year', () => {
    expect(
      createCalendarEventSchema.safeParse({
        ...valid,
        recurrence: 'DAILY',
        recurrenceEnd: '2028-03-02',
      }).success
    ).toBe(false);
  });

  it('accepts a recurrence inside the cap', () => {
    const parsed = createCalendarEventSchema.safeParse({
      ...valid,
      recurrence: 'WEEKLY',
      recurrenceEnd: '2026-06-29',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a malformed colour rather than storing it', () => {
    expect(createCalendarEventSchema.safeParse({ ...valid, color: 'red' }).success).toBe(false);
    expect(createCalendarEventSchema.safeParse({ ...valid, color: '#1a2b3c' }).success).toBe(true);
  });
});

describe('listCalendarEventsQuerySchema', () => {
  it('reads the filter the API actually applies', () => {
    const parsed = listCalendarEventsQuerySchema.parse({ eventType: 'EXAM' });
    expect(parsed.eventType).toBe('EXAM');
  });

  it('drops an unknown `category` instead of filtering on nothing', () => {
    const parsed = listCalendarEventsQuerySchema.parse({ category: 'EXAM' });
    expect(parsed.eventType).toBeUndefined();
  });

  it('coerces the paging strings a query string carries', () => {
    const parsed = listCalendarEventsQuerySchema.parse({ page: '2', limit: '10' });
    expect(parsed.page).toBe(2);
    expect(parsed.limit).toBe(10);
  });

  it('refuses a limit above the ceiling', () => {
    expect(listCalendarEventsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
