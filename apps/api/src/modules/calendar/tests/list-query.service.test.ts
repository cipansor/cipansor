import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleCode } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    user: { findUnique: vi.fn() },
  },
}));

import { calendarService } from '../calendar.service';
import { prisma } from '@/lib/prisma';

const findMany = prisma.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;

const superAdmin = {
  sub: 'admin-1',
  role: 'SUPER_ADMIN',
  roleCode: RoleCode.SUPER_ADMIN,
  unitId: null,
};

const query = (overrides: Record<string, unknown> = {}) =>
  ({ page: 1, limit: 50, ...overrides }) as Parameters<typeof calendarService.findAll>[0];

/** The search clause findAll added to `AND`, if any. */
function searchFilter(where: Record<string, unknown>) {
  const and = (where.AND ?? []) as Record<string, unknown>[];
  return and.find(
    (clause) => Array.isArray(clause.OR) && clause.OR.some((c) => 'title' in (c as object))
  ) as { OR: { title: { contains: string } }[] } | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe('CalendarService.findAll search', () => {
  it('escapes the LIKE wildcards so a literal % does not match everything', async () => {
    await calendarService.findAll(query({ search: '100%' }), superAdmin);

    const where = findMany.mock.calls[0][0].where;
    const values = searchFilter(where)?.OR.map((clause) => Object.values(clause)[0].contains);
    expect(values).toEqual(['100\\%', '100\\%', '100\\%']);
  });

  it('escapes _ and the escape character itself', async () => {
    await calendarService.findAll(query({ search: 'a_b\\c' }), superAdmin);

    const where = findMany.mock.calls[0][0].where;
    expect(searchFilter(where)?.OR[0].title.contains).toBe('a\\_b\\\\c');
  });
});

describe('CalendarService.findAll ordering', () => {
  it('breaks same-day ties on id so paging is stable', async () => {
    await calendarService.findAll(query(), superAdmin);

    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ startDate: 'asc' }, { id: 'asc' }]);
  });
});
