import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleCode } from '@prisma/client';

// Spread the real @prisma/client so RoleCode (read at load by resolve-unit-id)
// survives, then mock only the singleton the service queries through.
vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return { ...actual };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    class: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { calendarService } from '../calendar.service';
import { prisma } from '@/lib/prisma';

const findMany = prisma.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;

/** The `where` the service actually handed Prisma on the last findAll call. */
function lastWhere(): Record<string, unknown> {
  return findMany.mock.calls.at(-1)![0].where as Record<string, unknown>;
}

const baseQuery = { page: 1, limit: 10 } as Parameters<typeof calendarService.findAll>[0];

/**
 * The calendar list is unit-scoped. Two groups must not be scoped to a single
 * unit: the yayasan board (no unitId — the old check on legacy `role` hid every
 * unit's calendar behind the public-only branch) and boarding/shared staff
 * whose remit spans units. These assert the emitted `where`, so they fail if
 * the widening is reverted rather than merely exercising the code.
 */
describe('CalendarService.findAll unit scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not restrict the yayasan board to a unit', async () => {
    await calendarService.findAll(baseQuery, {
      sub: 'ketua',
      role: 'UNIT_ADMIN', // what deriveLegacyRole() produces for the board
      roleCode: RoleCode.YAYASAN_KETUA,
      unitId: null,
    });
    // No OR branch restricting to `unitId: null` — the board sees every unit.
    expect(lastWhere().OR).toBeUndefined();
  });

  it('does not restrict cross-unit boarding staff to their seed unit', async () => {
    await calendarService.findAll(baseQuery, {
      sub: 'muhafidz',
      role: 'TEACHER',
      roleCode: RoleCode.MUHAFIDZ,
      unitId: 'smp-it',
    });
    expect(lastWhere().OR).toBeUndefined();
  });

  it('still scopes a single-unit administrator to their unit plus public events', async () => {
    await calendarService.findAll(baseQuery, {
      sub: 'smpadmin',
      role: 'UNIT_ADMIN',
      roleCode: RoleCode.SMPIT_ADMIN,
      unitId: 'smp-it',
    });
    expect(lastWhere().OR).toEqual([{ unitId: 'smp-it' }, { unitId: null, isPublic: true }]);
  });
});
