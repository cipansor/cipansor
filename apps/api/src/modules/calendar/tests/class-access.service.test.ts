import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleCode } from '@prisma/client';

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return { ...actual };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    class: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { calendarService } from '../calendar.service';
import { prisma } from '@/lib/prisma';

const findMany = prisma.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueEvent = prisma.calendarEvent.findUnique as unknown as ReturnType<typeof vi.fn>;
const findUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const findClasses = prisma.class.findMany as unknown as ReturnType<typeof vi.fn>;

const baseQuery = { page: 1, limit: 10 } as Parameters<typeof calendarService.findAll>[0];

const student = {
  sub: 'santri-1',
  role: 'STUDENT',
  roleCode: RoleCode.SDIT_SISWA,
  unitId: 'unit-sdit',
};

const parent = {
  sub: 'wali-1',
  role: 'PARENT',
  roleCode: RoleCode.SDIT_ORANG_TUA,
  unitId: 'unit-sdit',
};

const teacher = {
  sub: 'guru-1',
  role: 'TEACHER',
  roleCode: RoleCode.SDIT_GURU,
  unitId: 'unit-sdit',
};

/** The class filter findAll added to `AND`, if any. */
function classFilter(where: Record<string, unknown>) {
  const and = (where.AND ?? []) as Record<string, unknown>[];
  return and.find(
    (clause) => Array.isArray(clause.OR) && clause.OR.some((c) => 'classId' in (c as object))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  findUniqueEvent.mockResolvedValue(null);
  findUser.mockResolvedValue(null);
  findClasses.mockResolvedValue([]);
});

/**
 * A class-scoped agenda belongs to its class, not to the whole unit. The list's
 * unit scope alone handed a santri every other class's private agenda in the
 * same unit.
 */
describe('CalendarService.findAll class scope', () => {
  it("restricts a santri to their own classes' events", async () => {
    findUser.mockResolvedValue({
      student: { enrollments: [{ classId: 'class-6a' }] },
      parentOf: [],
    });

    await calendarService.findAll(baseQuery, student);

    const where = findMany.mock.calls[0][0].where;
    expect(classFilter(where)).toEqual({
      OR: [{ classId: null }, { classId: { in: ['class-6a'] } }],
    });
  });

  it('gives a wali every class their children attend', async () => {
    findUser.mockResolvedValue({
      student: null,
      parentOf: [{ student: { enrollments: [{ classId: 'class-6a' }, { classId: 'class-4b' }] } }],
    });

    await calendarService.findAll(baseQuery, parent);

    const where = findMany.mock.calls[0][0].where;
    const filter = classFilter(where) as { OR: { classId?: { in?: string[] } }[] };
    const ids = filter.OR.find((c) => c.classId?.in)?.classId?.in ?? [];
    expect([...ids].sort()).toEqual(['class-4b', 'class-6a']);
  });

  it('restricts a teacher to the classes they teach or homeroom', async () => {
    findClasses.mockResolvedValue([{ id: 'class-5b' }]);

    await calendarService.findAll(baseQuery, teacher);

    const where = findMany.mock.calls[0][0].where;
    expect(classFilter(where)).toEqual({
      OR: [
        { scope: { not: 'SPECIFIC_CLASS' } },
        { scope: 'SPECIFIC_CLASS', createdById: teacher.sub },
        { scope: 'SPECIFIC_CLASS', classId: { in: ['class-5b'] } },
      ],
    });
    expect(findUser).not.toHaveBeenCalled();
  });
});

describe('CalendarService.findById class scope', () => {
  const event = {
    id: 'event-1',
    unitId: 'unit-sdit',
    classId: 'class-5b',
    isPublic: true,
    createdById: 'admin',
    isRecurring: false,
    recurrenceParentId: null,
  };

  it('refuses a santri opening another class’s event by id', async () => {
    findUniqueEvent.mockResolvedValue(event);
    findUser.mockResolvedValue({
      student: { enrollments: [{ classId: 'class-6a' }] },
      parentOf: [],
    });

    await expect(calendarService.findById('event-1', student)).rejects.toThrow(/Access denied/);
  });

  it('opens an event addressed to the santri’s own class', async () => {
    findUniqueEvent.mockResolvedValue({ ...event, classId: 'class-6a' });
    findUser.mockResolvedValue({
      student: { enrollments: [{ classId: 'class-6a' }] },
      parentOf: [],
    });

    await expect(calendarService.findById('event-1', student)).resolves.toMatchObject({
      id: 'event-1',
    });
  });
});
