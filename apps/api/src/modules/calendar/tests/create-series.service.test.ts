import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventScope } from '@prisma/client';

const create = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const findUnique = vi.fn();
const transaction = vi.fn();
const findMany = vi.fn();
const count = vi.fn();
const groupBy = vi.fn();
const classFindFirst = vi.fn();
const classFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarEvent: {
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      count: (...args: unknown[]) => count(...args),
      groupBy: (...args: unknown[]) => groupBy(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
    class: {
      findFirst: (...args: unknown[]) => classFindFirst(...args),
      findMany: (...args: unknown[]) => classFindMany(...args),
    },
  },
}));

import { calendarService } from '../calendar.service';

const superAdmin = {
  sub: 'user-1',
  role: 'SUPER_ADMIN',
  roleCode: 'SUPER_ADMIN',
  unitId: null,
} as Parameters<typeof calendarService.create>[1];

const unitAdmin = {
  sub: 'user-2',
  role: 'UNIT_ADMIN',
  roleCode: 'SDIT_ADMIN',
  unitId: 'unit-sdit',
} as Parameters<typeof calendarService.create>[1];

/** A payload as `createCalendarEventSchema` parses it. */
const payload = (overrides: Record<string, unknown> = {}) =>
  ({
    title: 'Rapat Wali Kelas',
    eventType: 'MEETING',
    startDate: '2026-03-02',
    isAllDay: true,
    isPublic: true,
    recurrence: 'NONE',
    ...overrides,
  }) as Parameters<typeof calendarService.create>[0];

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'event-1',
    ...data,
  }));
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      calendarEvent: {
        create: (...args: unknown[]) => create(...args),
      },
    })
  );
  findUnique.mockResolvedValue({
    id: 'event-1',
    unitId: null,
    createdById: 'user-1',
    isRecurring: false,
    recurrenceParentId: null,
  });
  update.mockResolvedValue({});
  updateMany.mockResolvedValue({ count: 1 });
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  groupBy.mockResolvedValue([]);
  classFindFirst.mockResolvedValue({ unitId: 'unit-sdit' });
  classFindMany.mockResolvedValue([]);
});

/**
 * Creating an event is the write the portal's Tambah form makes, and it was
 * the one that always failed (#1155): the form sent `category` where the model
 * has `eventType`, so Prisma received `undefined`. These assert the data handed
 * to Prisma, so a reverted field name fails here rather than in production.
 */
describe('CalendarService.create', () => {
  it('writes the event type the model stores', async () => {
    await calendarService.create(payload({ eventType: 'EXAM' }), superAdmin);

    const data = create.mock.calls[0][0].data;
    expect(data.eventType).toBe('EXAM');
    expect(data).not.toHaveProperty('category');
  });

  it('stores a day as the stored form, not the string it arrived as', async () => {
    await calendarService.create(payload({ startDate: '2026-03-02' }), superAdmin);

    expect(create.mock.calls[0][0].data.startDate.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('leaves endDate null for a one-day event', async () => {
    await calendarService.create(payload(), superAdmin);
    expect(create.mock.calls[0][0].data.endDate).toBeNull();
  });

  it('derives the scope from the unit and class, ignoring any sent value', async () => {
    await calendarService.create(payload({ unitId: 'unit-sdit', scope: 'ALL_UNITS' }), superAdmin);
    expect(create.mock.calls[0][0].data.scope).toBe(EventScope.SPECIFIC_UNIT);

    create.mockClear();
    await calendarService.create(payload({ unitId: 'unit-sdit', classId: 'class-1' }), superAdmin);
    expect(create.mock.calls[0][0].data.scope).toBe(EventScope.SPECIFIC_CLASS);
  });

  it('refuses a unit admin writing to another unit', async () => {
    await expect(
      calendarService.create(payload({ unitId: 'unit-sma' }), unitAdmin)
    ).rejects.toThrow(/another unit/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('pins a unit admin to their own unit when the body names none', async () => {
    // The form's "Semua Unit" default used to become `unitId: null`, which the
    // model reads as a yayasan-wide event.
    await calendarService.create(payload(), unitAdmin);

    const data = create.mock.calls[0][0].data;
    expect(data.unitId).toBe('unit-sdit');
    expect(data.scope).toBe(EventScope.SPECIFIC_UNIT);
  });

  it('lets a foundation role create a yayasan-wide event', async () => {
    await calendarService.create(payload(), superAdmin);

    const data = create.mock.calls[0][0].data;
    expect(data.unitId).toBeNull();
    expect(data.scope).toBe(EventScope.ALL_UNITS);
  });

  it('writes one row for a non-recurring event', async () => {
    await calendarService.create(payload(), superAdmin);
    expect(create).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.isRecurring).toBe(false);
  });

  it('materialises a weekly series: a parent plus one row per later occurrence', async () => {
    await calendarService.create(
      payload({
        startDate: '2026-03-02',
        recurrence: 'WEEKLY',
        recurrenceEnd: '2026-03-16',
      }),
      superAdmin
    );

    // 2, 9, 16 March: the first is the parent, the other two are children.
    expect(create).toHaveBeenCalledTimes(3);
    const [parent, first, second] = create.mock.calls.map((c) => c[0].data);

    expect(parent.recurrenceParentId).toBeUndefined();
    expect(parent.isRecurring).toBe(true);
    expect(parent.recurrenceRule).toBe('FREQ=WEEKLY;UNTIL=20260316');

    expect(first.recurrenceParentId).toBe('event-1');
    expect(first.startDate.toISOString()).toBe('2026-03-09T00:00:00.000Z');
    expect(second.startDate.toISOString()).toBe('2026-03-16T00:00:00.000Z');
  });

  it('shifts the end date of a multi-day series with each occurrence', async () => {
    await calendarService.create(
      payload({
        startDate: '2026-03-02',
        endDate: '2026-03-03',
        recurrence: 'WEEKLY',
        recurrenceEnd: '2026-03-09',
      }),
      superAdmin
    );

    const child = create.mock.calls[1][0].data;
    // A two-day event that starts a week later still ends the day after it starts.
    expect(child.startDate.toISOString()).toBe('2026-03-09T00:00:00.000Z');
    expect(child.endDate.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});

/**
 * Delete is a soft delete, so a series delete must mark every row: the parent
 * and the children that point at it. Marking the parent alone left the rest of
 * the series on the calendar, and nothing else would ever remove them.
 */
describe('CalendarService.delete', () => {
  it('marks only the named occurrence for a single delete', async () => {
    await calendarService.delete('event-1', superAdmin, 'SINGLE');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('marks the parent and every child for a series delete', async () => {
    findUnique.mockResolvedValue({
      id: 'child-2',
      unitId: null,
      createdById: 'user-1',
      isRecurring: true,
      recurrenceParentId: 'parent-1',
    });

    await calendarService.delete('child-2', superAdmin, 'SERIES');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [{ id: 'parent-1' }, { recurrenceParentId: 'parent-1' }],
      },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('treats a parent as its own series root', async () => {
    findUnique.mockResolvedValue({
      id: 'parent-1',
      unitId: null,
      createdById: 'user-1',
      isRecurring: true,
      recurrenceParentId: null,
    });

    await calendarService.delete('parent-1', superAdmin, 'SERIES');

    expect(updateMany.mock.calls[0][0].where.OR).toEqual([
      { id: 'parent-1' },
      { recurrenceParentId: 'parent-1' },
    ]);
  });

  it('refuses deleting another unit’s event as a unit admin', async () => {
    findUnique.mockResolvedValue({
      id: 'event-1',
      unitId: 'unit-sma',
      createdById: 'someone-else',
      // Public, so the read gate lets the unit admin open it and the refusal
      // that follows is the delete gate's, not the read gate's.
      isPublic: true,
      isRecurring: false,
      recurrenceParentId: null,
    });

    await expect(calendarService.delete('event-1', unitAdmin, 'SINGLE')).rejects.toThrow(
      /Access denied/
    );
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * Two silent filter bugs in the list (#1155): an unreviewed holiday import
 * showed on the live calendar, and a `search` overwrote the unit scope — so a
 * teacher searching "rapat" was handed every unit's private events.
 */
describe('CalendarService.findAll filters', () => {
  const base = { page: 1, limit: 10 } as Parameters<typeof calendarService.findAll>[0];

  it('excludes unreviewed holiday drafts', async () => {
    await calendarService.findAll(base, superAdmin);
    expect(findMany.mock.calls[0][0].where.isDraft).toBe(false);
  });

  it('keeps the unit scope when a search is applied', async () => {
    await calendarService.findAll({ ...base, search: 'rapat' }, unitAdmin);

    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ unitId: 'unit-sdit' }, { unitId: null, isPublic: true }]);
    expect(where.AND).toContainEqual({
      OR: [
        { title: { contains: 'rapat', mode: 'insensitive' } },
        { description: { contains: 'rapat', mode: 'insensitive' } },
        { location: { contains: 'rapat', mode: 'insensitive' } },
      ],
    });
  });

  it('filters on the model’s own eventType column', async () => {
    await calendarService.findAll({ ...base, eventType: 'EXAM' }, superAdmin);
    expect(findMany.mock.calls[0][0].where.eventType).toBe('EXAM');
  });
});

describe('CalendarService.getStatistics', () => {
  it('leaves unreviewed drafts out of the counts', async () => {
    await calendarService.getStatistics('unit-sdit');
    expect(count.mock.calls[0][0].where.isDraft).toBe(false);
    expect(groupBy.mock.calls[0][0].where.isDraft).toBe(false);
  });
});

/**
 * The import route does not run the Zod middleware, so `bulkCreate` parses each
 * row itself. An ISO instant handed straight to `dayDate()` became
 * `2026-03-02T00:00:00.000ZT00:00:00.000Z`, which Prisma rejected.
 */
describe('CalendarService.bulkCreate', () => {
  it('normalises an ISO instant to the stored day before Prisma sees it', async () => {
    const result = await calendarService.bulkCreate(
      [payload({ startDate: '2026-03-02T00:00:00.000Z' })],
      superAdmin
    );

    expect(result).toMatchObject({ success: 1, failed: 0 });
    expect(create.mock.calls[0][0].data.startDate.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('reports a row the contract refuses without failing the import', async () => {
    const result = await calendarService.bulkCreate(
      [{ title: 'Rusak', eventType: 'NOPE', startDate: '2026-03-02', isAllDay: true }],
      superAdmin
    );

    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0]).toContain('Rusak');
    expect(create).not.toHaveBeenCalled();
  });
});
