import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventScope } from '@prisma/client';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    calendarEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    class: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { calendarService } from '../calendar.service';

const UNIT = 'unit-sdit';
const OTHER = 'unit-smp';

const UNIT_ADMIN = {
  sub: 'admin-sdit',
  role: 'UNIT_ADMIN',
  roleCode: 'SDIT_ADMIN',
  unitId: UNIT,
};
const FOUNDATION = {
  sub: 'ketua',
  role: 'UNIT_ADMIN',
  roleCode: 'YAYASAN_KETUA',
  unitId: null,
};
const PENGAWAS = {
  sub: 'pengawas',
  role: 'UNIT_ADMIN',
  roleCode: 'YAYASAN_PENGAWAS',
  unitId: null,
};
const TEACHER = {
  sub: 'guru',
  role: 'TEACHER',
  roleCode: 'SDIT_GURU',
  unitId: UNIT,
};
const OTHER_ADMIN = {
  sub: 'admin-smp',
  role: 'UNIT_ADMIN',
  roleCode: 'SMPIT_ADMIN',
  unitId: OTHER,
};

const baseInput = {
  title: 'Rapat',
  eventType: 'MEETING',
  startDate: '2026-11-25',
  endDate: '2026-11-25',
  isAllDay: true,
} as Parameters<typeof calendarService.create>[0];

const baseQuery = { page: 1, limit: 10 } as Parameters<typeof calendarService.findAll>[0];

const lastCreateData = () =>
  (prismaMock.calendarEvent.create.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;

const lastWhere = (mock: typeof prismaMock.calendarEvent.findMany) =>
  (mock.mock.calls.at(-1)![0] as { where: Record<string, unknown> }).where;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.calendarEvent.create.mockResolvedValue({ id: 'event-1' });
  prismaMock.calendarEvent.findMany.mockResolvedValue([]);
  prismaMock.calendarEvent.count.mockResolvedValue(0);
  prismaMock.class.findMany.mockResolvedValue([]);
  prismaMock.class.findFirst.mockResolvedValue(null);
});

describe('calendarService.create — who may publish where', () => {
  it('pins a unit admin to their own unit even when they leave unit empty', async () => {
    await calendarService.create(baseInput, UNIT_ADMIN);

    expect(lastCreateData()).toMatchObject({
      unitId: UNIT,
      scope: EventScope.SPECIFIC_UNIT,
    });
  });

  it('refuses a unit admin naming another unit', async () => {
    await expect(
      calendarService.create({ ...baseInput, unitId: OTHER }, UNIT_ADMIN)
    ).rejects.toThrow(/another unit/);
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a unit admin asking for the whole foundation', async () => {
    await expect(
      calendarService.create({ ...baseInput, scope: EventScope.ALL_UNITS }, UNIT_ADMIN)
    ).rejects.toThrow(/pengurus yayasan/);
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('lets a Pengurus publish a foundation-wide event', async () => {
    await calendarService.create(baseInput, FOUNDATION);

    expect(lastCreateData()).toMatchObject({
      unitId: null,
      scope: EventScope.ALL_UNITS,
    });
  });

  it('refuses a Pengawas publishing the foundation agenda it only supervises', async () => {
    await expect(calendarService.create(baseInput, PENGAWAS)).rejects.toThrow(
      /tidak dapat menulis/
    );
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('derives the unit from a class and marks the event SPECIFIC_CLASS', async () => {
    prismaMock.class.findFirst.mockResolvedValue({ unitId: UNIT });

    await calendarService.create({ ...baseInput, classId: 'class-1' }, UNIT_ADMIN);

    expect(lastCreateData()).toMatchObject({
      unitId: UNIT,
      classId: 'class-1',
      scope: EventScope.SPECIFIC_CLASS,
    });
  });

  it('refuses a class that belongs to another unit', async () => {
    prismaMock.class.findFirst.mockResolvedValue({ unitId: OTHER });

    await expect(
      calendarService.create({ ...baseInput, classId: 'class-other' }, UNIT_ADMIN)
    ).rejects.toThrow(/bukan milik unit/);
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a class that does not exist', async () => {
    await expect(
      calendarService.create({ ...baseInput, classId: 'missing' }, UNIT_ADMIN)
    ).rejects.toThrow(/Kelas tidak ditemukan/);
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });
});

describe('calendarService reads — class-private events stay in the class', () => {
  const classScope = (classIds: string[]) => ({
    OR: [
      { scope: { not: EventScope.SPECIFIC_CLASS } },
      { scope: EventScope.SPECIFIC_CLASS, createdById: UNIT_ADMIN.sub },
      ...(classIds.length ? [{ scope: EventScope.SPECIFIC_CLASS, classId: { in: classIds } }] : []),
    ],
  });

  it('narrows the today agenda to the creator and the classes the user belongs to', async () => {
    prismaMock.class.findMany.mockResolvedValue([{ id: 'class-1' }]);

    await calendarService.getToday(UNIT, UNIT_ADMIN);

    expect(lastWhere(prismaMock.calendarEvent.findMany).AND).toEqual([classScope(['class-1'])]);
  });

  it('does not narrow the agenda for a foundation role', async () => {
    await calendarService.getToday(UNIT, FOUNDATION);

    expect(lastWhere(prismaMock.calendarEvent.findMany).AND).toBeUndefined();
    expect(prismaMock.class.findMany).not.toHaveBeenCalled();
  });

  it('applies the same class scope to the upcoming list', async () => {
    await calendarService.getUpcoming(UNIT, 10, UNIT_ADMIN);

    expect(lastWhere(prismaMock.calendarEvent.findMany).AND).toEqual([classScope([])]);
  });

  it('keeps the unit scope when the management list is searched', async () => {
    await calendarService.findAll({ ...baseQuery, search: 'rapat' }, UNIT_ADMIN);

    const where = lastWhere(prismaMock.calendarEvent.findMany);
    expect(where.OR).toEqual([{ unitId: UNIT }, { unitId: null, isPublic: true }]);
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { title: { contains: 'rapat', mode: 'insensitive' } },
            { description: { contains: 'rapat', mode: 'insensitive' } },
          ],
        },
        classScope([]),
      ])
    );
  });

  it("adds the unit's class events to the management list only", async () => {
    const classScopeOf = () =>
      (lastWhere(prismaMock.calendarEvent.findMany).AND as Array<{ OR?: unknown[] }>).find(
        (clause) => clause.OR?.[0] && JSON.stringify(clause.OR[0]).includes('SPECIFIC_CLASS')
      );

    await calendarService.findAll({ ...baseQuery, manage: true }, UNIT_ADMIN);
    expect(classScopeOf()?.OR).toContainEqual({
      scope: EventScope.SPECIFIC_CLASS,
      unitId: UNIT,
    });

    await calendarService.findAll(baseQuery, UNIT_ADMIN);
    expect(classScopeOf()?.OR).not.toContainEqual({
      scope: EventScope.SPECIFIC_CLASS,
      unitId: UNIT,
    });
  });

  const event = (overrides: Record<string, unknown> = {}) => ({
    id: 'event-1',
    unitId: UNIT,
    classId: 'class-1',
    scope: EventScope.SPECIFIC_CLASS,
    isPublic: false,
    createdById: 'someone-else',
    ...overrides,
  });

  it('refuses a class event to a same-unit teacher outside the class', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(event());

    await expect(calendarService.findById('event-1', TEACHER)).rejects.toThrow(/Access denied/);
  });

  it('lets the unit admin open a class event it does not teach, for management', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(event());

    await expect(calendarService.findById('event-1', UNIT_ADMIN)).resolves.toMatchObject({
      id: 'event-1',
    });
  });

  it("refuses another unit's admin the class event", async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(event());

    await expect(calendarService.findById('event-1', OTHER_ADMIN)).rejects.toThrow(/Access denied/);
  });

  it('lets a member of the class open it', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(event());
    prismaMock.class.findMany.mockResolvedValue([{ id: 'class-1' }]);

    await expect(calendarService.findById('event-1', UNIT_ADMIN)).resolves.toMatchObject({
      id: 'event-1',
    });
  });

  it('lets the creator open their class event', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(event({ createdById: UNIT_ADMIN.sub }));

    await expect(calendarService.findById('event-1', UNIT_ADMIN)).resolves.toMatchObject({
      id: 'event-1',
    });
  });

  it('refuses a private foundation event to a unit user', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(
      event({ unitId: null, scope: EventScope.ALL_UNITS, isPublic: false })
    );

    await expect(calendarService.findById('event-1', UNIT_ADMIN)).rejects.toThrow(/Access denied/);
  });

  it('refuses a public event from another unit, matching the list', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(
      event({ unitId: OTHER, scope: EventScope.ALL_UNITS, isPublic: true })
    );

    await expect(calendarService.findById('event-1', UNIT_ADMIN)).rejects.toThrow(/Access denied/);
  });

  it('lets a foundation role read any class event', async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(event());

    await expect(calendarService.findById('event-1', FOUNDATION)).resolves.toMatchObject({
      id: 'event-1',
    });
  });
});

describe('calendarService.update — no scope escalation', () => {
  beforeEach(() => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      unitId: UNIT,
      classId: 'class-1',
      scope: EventScope.SPECIFIC_CLASS,
      isPublic: false,
      createdById: UNIT_ADMIN.sub,
    });
    prismaMock.calendarEvent.update.mockResolvedValue({ id: 'event-1' });
  });

  it('refuses a unit admin turning a class event into a foundation event', async () => {
    await expect(
      calendarService.update('event-1', { scope: EventScope.ALL_UNITS }, UNIT_ADMIN)
    ).rejects.toThrow(/pengurus yayasan/);
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('keeps a class event class-scoped when the scope is omitted', async () => {
    await calendarService.update('event-1', {}, UNIT_ADMIN);

    expect(
      (prismaMock.calendarEvent.update.mock.calls.at(-1)![0] as { data: { scope: string } }).data
        .scope
    ).toBe(EventScope.SPECIFIC_CLASS);
  });
});

describe("calendarService — a unit admin manages its unit, not another's", () => {
  const classEvent = {
    id: 'event-1',
    unitId: UNIT,
    classId: 'class-1',
    scope: EventScope.SPECIFIC_CLASS,
    isPublic: false,
    createdById: 'super-admin',
  };

  beforeEach(() => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue(classEvent);
    prismaMock.calendarEvent.update.mockResolvedValue({ id: 'event-1' });
  });

  it('lets the unit admin update a class event it did not create', async () => {
    await expect(
      calendarService.update('event-1', { title: 'Baru' }, UNIT_ADMIN)
    ).resolves.toMatchObject({
      id: 'event-1',
    });
    expect(prismaMock.calendarEvent.update).toHaveBeenCalled();
  });

  it('lets the unit admin delete a class event it did not create', async () => {
    await expect(calendarService.delete('event-1', UNIT_ADMIN)).resolves.toEqual({ success: true });
    expect(prismaMock.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("refuses another unit's admin the same update", async () => {
    await expect(calendarService.update('event-1', { title: 'Baru' }, OTHER_ADMIN)).rejects.toThrow(
      /Access denied/
    );
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('refuses a Pengawas the delete it may read', async () => {
    await expect(calendarService.delete('event-1', PENGAWAS)).rejects.toThrow(/Cannot delete/);
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });
});

describe('calendarService.getUpcoming — the real WIB start, not the stored date', () => {
  it('keeps an afternoon meeting after 07:00 WIB', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T06:00:00.000Z')); // 13:00 WIB

    const morning = {
      id: 'morning',
      startDate: new Date('2026-11-25T00:00:00.000Z'),
      startTime: '08:00',
      isAllDay: false,
    };
    const afternoon = {
      id: 'afternoon',
      startDate: new Date('2026-11-25T00:00:00.000Z'),
      startTime: '15:00',
      isAllDay: false,
    };
    prismaMock.calendarEvent.findMany
      .mockResolvedValueOnce([morning, afternoon])
      .mockResolvedValueOnce([]);

    try {
      const events = await calendarService.getUpcoming(UNIT, 10, UNIT_ADMIN);
      expect(events.map((event) => event.id)).toEqual(['afternoon']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an earlier all-day event when the limit lands on its date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T06:00:00.000Z')); // 13:00 WIB

    const allDay = {
      id: 'all-day',
      startDate: new Date('2026-11-26T00:00:00.000Z'), // 07:00 WIB
      startTime: null,
      isAllDay: true,
    };
    const meeting = {
      id: 'meeting',
      startDate: new Date('2026-11-26T00:00:00.000Z'),
      startTime: '09:00',
      isAllDay: false,
    };
    prismaMock.calendarEvent.findMany
      .mockResolvedValueOnce([]) // today
      .mockResolvedValueOnce([meeting]) // the one future row that fits
      .mockResolvedValueOnce([allDay, meeting]); // the whole boundary day

    try {
      const events = await calendarService.getUpcoming(UNIT, 1, UNIT_ADMIN);
      expect(events.map((event) => event.id)).toEqual(['all-day']);
    } finally {
      vi.useRealTimers();
    }
  });
});
