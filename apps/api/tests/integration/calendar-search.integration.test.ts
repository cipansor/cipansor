/**
 * The calendar search must treat `%` and `_` as literal characters, not SQL
 * LIKE wildcards. The mocked service test can only inspect the Prisma argument;
 * this one runs the query against Postgres so the escaping is proved by rows.
 *
 * Opt-in like the other DB suites (`RUN_DB_TESTS=1`); CI sets it and pushes the
 * schema first.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventType, RoleCode } from '@prisma/client';
import { createPrismaClient } from '../../prisma/client';
import { calendarService } from '@/modules/calendar/calendar.service';

const prisma = createPrismaClient();
const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const literalTitle = `Rapat 100% ${STAMP}`;
const decoyTitle = `Rapat 1000 ${STAMP}`;
const underscoreTitle = `Rapat_A ${STAMP}`;
const underscoreDecoyTitle = `RapatXA ${STAMP}`;

const superAdmin = {
  sub: 'calendar-search-test',
  role: 'SUPER_ADMIN',
  roleCode: RoleCode.SUPER_ADMIN,
  unitId: null,
};

let creatorId = '';

beforeAll(async () => {
  const creator = await prisma.user.create({
    data: {
      name: 'Calendar Search Test',
      email: `calendar-search-${STAMP}@example.test`,
    },
  });
  creatorId = creator.id;

  await prisma.calendarEvent.createMany({
    data: [
      {
        title: literalTitle,
        eventType: EventType.MEETING,
        startDate: new Date('2026-12-01'),
        createdById: creatorId,
      },
      {
        title: decoyTitle,
        eventType: EventType.MEETING,
        startDate: new Date('2026-12-02'),
        createdById: creatorId,
      },
      {
        title: underscoreTitle,
        eventType: EventType.MEETING,
        startDate: new Date('2026-12-03'),
        createdById: creatorId,
      },
      {
        title: underscoreDecoyTitle,
        eventType: EventType.MEETING,
        startDate: new Date('2026-12-04'),
        createdById: creatorId,
      },
    ],
  });
});

afterAll(async () => {
  if (creatorId) {
    await prisma.calendarEvent.deleteMany({ where: { createdById: creatorId } });
    await prisma.user.delete({ where: { id: creatorId } });
  }
  await prisma.$disconnect();
});

describeDb('CalendarService.findAll search against Postgres', () => {
  it('finds "100%" without also matching "1000"', async () => {
    const result = await calendarService.findAll(
      { page: 1, limit: 50, search: '100%' } as Parameters<typeof calendarService.findAll>[0],
      superAdmin
    );

    const titles = result.data.map((event) => event.title).filter((title) => title.includes(STAMP));
    expect(titles).toEqual([literalTitle]);
  });

  it('still finds the decoy when the search is literal "1000"', async () => {
    const result = await calendarService.findAll(
      { page: 1, limit: 50, search: '1000' } as Parameters<typeof calendarService.findAll>[0],
      superAdmin
    );

    const titles = result.data.map((event) => event.title).filter((title) => title.includes(STAMP));
    expect(titles).toEqual([decoyTitle]);
  });

  it('treats "_" as a literal character, not a one-character wildcard', async () => {
    const result = await calendarService.findAll(
      { page: 1, limit: 50, search: 'Rapat_A' } as Parameters<typeof calendarService.findAll>[0],
      superAdmin
    );

    const titles = result.data.map((event) => event.title).filter((title) => title.includes(STAMP));
    expect(titles).toEqual([underscoreTitle]);
  });
});
