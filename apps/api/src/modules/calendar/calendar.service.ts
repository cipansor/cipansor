import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { UserRole, Prisma, EventType, EventScope } from '@prisma/client';
import {
  CLASS_ENROLLMENT_STATUS,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
  createCalendarEventSchema,
  type CalendarEventDeleteScope,
  type EventRecurrenceCode,
  type ListCalendarEventsQuery,
  type ParsedCalendarEventPayload,
} from '@cipansor/shared';
import { isFoundationScopedRole, seesAllUnits } from '@/utils/resolve-unit-id';
import { dayDate, shiftWibDay } from '@/utils/wib';
import { daysBetween, occurrenceDays, recurrenceRuleFor } from './calendar-recurrence';

type ListEventsQuery = ListCalendarEventsQuery;

/** A parsed payload: every default filled in and every day normalised. */
type CreateEventInput = ParsedCalendarEventPayload;

interface UpdateEventInput {
  title?: string;
  description?: string;
  eventType?: EventType;
  scope?: EventScope;
  startDate?: string;
  endDate?: string;
  isAllDay?: boolean;
  startTime?: string;
  endTime?: string;
  location?: string;
  isOnline?: boolean;
  onlineUrl?: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  isPublic?: boolean;
  color?: string;
}

// User type from JwtPayload
interface AuthenticatedUser {
  sub: string;
  role: string;
  /**
   * RoleCode granular. Needed so scoping can use seesAllUnits(): the legacy
   * `role` maps every YAYASAN_* code onto 'UNIT_ADMIN', so a check on `role`
   * classifies the foundation board as unit admins and hides every unit's
   * calendar from them.
   */
  roleCode?: string | null;
  unitId: string | null;
}

/**
 * The classes a student or guardian may see class-scoped events for, or `null`
 * when the caller is staff and sees every class in its unit.
 *
 * A class event names its audience by `classId`; the list's unit scope alone
 * therefore handed a santri every other class's private agenda in the same
 * unit. Staff keep the wider view they manage.
 */
async function visibleClassIds(user: AuthenticatedUser): Promise<string[] | null> {
  const roleCode = user.roleCode ?? '';
  const student = STUDENT_ROLE_CODES.includes(roleCode);
  const parent = PARENT_ROLE_CODES.includes(roleCode);
  if (!student && !parent) return null;

  const enrolled = {
    where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
    select: { classId: true },
  } as const;
  const record = await prisma.user.findUnique({
    where: { id: user.sub },
    select: {
      student: { select: { enrollments: enrolled } },
      parentOf: { select: { student: { select: { enrollments: enrolled } } } },
    },
  });

  const classIds = new Set<string>();
  for (const e of record?.student?.enrollments ?? []) classIds.add(e.classId);
  for (const p of record?.parentOf ?? []) {
    for (const e of p.student.enrollments) classIds.add(e.classId);
  }
  return [...classIds];
}

export class CalendarService {
  /**
   * List calendar events
   */
  async findAll(query: ListEventsQuery, currentUser: AuthenticatedUser) {
    const {
      page,
      limit,
      unitId,
      classId,
      eventType,
      startDate,
      endDate,
      month,
      year,
      search,
      isPublic,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
      // A draft is a holiday a third-party source suggested but nobody has
      // reviewed (decisions/absensi-pegawai.md). `getHolidays` always filtered
      // it out; this list did not, so an unapproved import showed up on the
      // live calendar before anyone had looked at it (#1155).
      isDraft: false,
    };
    // Everything that narrows the unit scope goes here, never into `where.OR`:
    // that OR carries the unit scope, and overwriting it returned every unit's
    // private events.
    const and: Prisma.CalendarEventWhereInput[] = [];

    // Filter by unit.
    //
    // seesAllUnits() covers the yayasan board (no unitId, so the old check hid
    // every unit's calendar behind the public-only branch) and boarding/shared
    // staff whose remit spans units. A unit user still sees their own unit plus
    // the foundation-wide public events.
    if (!seesAllUnits(currentUser)) {
      where.OR = [{ unitId: currentUser.unitId }, { unitId: null, isPublic: true }];
    } else if (unitId) {
      where.unitId = unitId;
    }

    // A class event is addressed to that class. A santri or wali sees their own
    // classes' events, never another class's in the same unit.
    const classScope = await visibleClassIds(currentUser);
    if (classScope) {
      and.push({ OR: [{ classId: null }, { classId: { in: classScope } }] });
    }

    if (classId) {
      where.classId = classId;
    }

    if (eventType) {
      where.eventType = eventType as EventType;
    }

    if (isPublic !== undefined) {
      where.isPublic = isPublic;
    }

    // Date filters. An event belongs to the window when it *overlaps* it, not
    // merely when it starts inside it: an event running 31 Dec–4 Jan must also
    // appear in January. Filtering on `startDate` alone dropped it (#911).
    let rangeStart: Date | undefined;
    let rangeEnd: Date | undefined;
    if (startDate || endDate) {
      rangeStart = startDate ? new Date(startDate) : undefined;
      rangeEnd = endDate ? new Date(endDate) : undefined;
    } else if (month && year) {
      rangeStart = new Date(year, month - 1, 1);
      rangeEnd = new Date(year, month, 0);
    }
    if (rangeStart || rangeEnd) {
      if (rangeEnd) and.push({ startDate: { lte: rangeEnd } });
      if (rangeStart) {
        and.push({
          OR: [{ endDate: { gte: rangeStart } }, { endDate: null, startDate: { gte: rangeStart } }],
        });
      }
    }

    // Search runs before pagination, on the server: filtering the page the
    // browser already has hid every later occurrence of a recurring agenda.
    // `%` and `_` are LIKE wildcards, so a literal "100%" would also match
    // "100"; escape them (and the escape character itself) before Prisma sends
    // the value as a pattern.
    if (search) {
      const literalSearch = search.replace(/[\\%_]/g, '\\$&');
      and.push({
        OR: [
          { title: { contains: literalSearch, mode: 'insensitive' } },
          { description: { contains: literalSearch, mode: 'insensitive' } },
          { location: { contains: literalSearch, mode: 'insensitive' } },
        ],
      });
    }

    if (and.length) where.AND = and;

    const [events, total] = await Promise.all([
      prisma.calendarEvent.findMany({
        where,
        skip,
        take: limit,
        // `id` breaks ties between events that start on the same day: without
        // it the database may order a tie differently per query, so a row can
        // appear on two pages or on none while the month grid stitches pages
        // together.
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        include: {
          unit: { select: { id: true, name: true } },
          class: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.calendarEvent.count({ where }),
    ]);

    return {
      data: events,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get event by ID
   */
  async findById(id: string, currentUser: AuthenticatedUser) {
    const event = await prisma.calendarEvent.findUnique({
      where: { id, deletedAt: null },
      include: {
        unit: true,
        class: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!event) {
      throw Errors.notFound('Calendar event not found');
    }

    // Check access. This is a read gate, so it widens with the list above: a
    // user who can see an event in the list must be able to open it. (Unlike a
    // mutation gate, where cross-unit breadth would be an escalation.)
    if (!seesAllUnits(currentUser)) {
      if (event.unitId && event.unitId !== currentUser.unitId && !event.isPublic) {
        throw Errors.forbidden('Access denied');
      }
      const classScope = await visibleClassIds(currentUser);
      if (classScope && event.classId && !classScope.includes(event.classId)) {
        throw Errors.forbidden('Access denied');
      }
    }

    return event;
  }

  /**
   * Create calendar event — and, when it repeats, every occurrence with it.
   *
   * A series is materialised in one transaction: the parent (the first
   * occurrence) and one row per later occurrence pointing back at it. All or
   * nothing, so a half-written series never reaches the calendar.
   */
  async create(input: CreateEventInput, currentUser: AuthenticatedUser) {
    // A unit admin writes into its own unit, whatever the body says — including
    // an empty unit, which used to mean "the whole yayasan" and let a school's
    // admin publish a foundation-wide holiday from the form's default. Only a
    // foundation role may name a unit or omit one.
    const foundationScope =
      isFoundationScopedRole(currentUser.roleCode) || currentUser.role === UserRole.SUPER_ADMIN;
    let unitId = input.unitId || null;
    if (!foundationScope) {
      if (!currentUser.unitId) {
        throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
      }
      if (unitId && unitId !== currentUser.unitId) {
        throw Errors.forbidden('Cannot create event for another unit');
      }
      unitId = currentUser.unitId;
    }

    const recurrence = input.recurrence ?? 'NONE';
    const startDate = dayDate(input.startDate);
    const endDate = input.endDate ? dayDate(input.endDate) : null;
    const daySpan = input.endDate ? daysBetween(input.startDate, input.endDate) : 0;

    // `scope` is derived, not sent: the unit and class columns are what decide
    // who sees the event, and a form's own `scope` could contradict them.
    const scope = input.classId
      ? EventScope.SPECIFIC_CLASS
      : unitId
        ? EventScope.SPECIFIC_UNIT
        : EventScope.ALL_UNITS;

    const shared = {
      unitId,
      classId: input.classId || null,
      title: input.title,
      description: input.description ?? null,
      eventType: input.eventType,
      scope,
      isAllDay: input.isAllDay ?? false,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      location: input.location ?? null,
      isOnline: input.isOnline ?? false,
      onlineUrl: input.onlineUrl ?? null,
      isPublic: input.isPublic ?? true,
      color: input.color ?? null,
      createdById: currentUser.sub,
    };

    const include = {
      unit: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    } as const;

    if (recurrence === 'NONE' || !input.recurrenceEnd) {
      return prisma.calendarEvent.create({
        data: { ...shared, startDate, endDate, isRecurring: false },
        include,
      });
    }

    const frequency = recurrence as Exclude<EventRecurrenceCode, 'NONE'>;
    const rule = recurrenceRuleFor(frequency, input.recurrenceEnd);
    const occurrences = occurrenceDays(input.startDate, frequency, input.recurrenceEnd);

    return prisma.$transaction(async (tx) => {
      const parent = await tx.calendarEvent.create({
        data: {
          ...shared,
          startDate,
          endDate,
          isRecurring: true,
          recurrenceRule: rule,
        },
        include,
      });

      for (const day of occurrences) {
        await tx.calendarEvent.create({
          data: {
            ...shared,
            startDate: dayDate(day),
            endDate: endDate ? dayDate(shiftWibDay(day, daySpan)) : null,
            isRecurring: true,
            recurrenceRule: rule,
            recurrenceParentId: parent.id,
          },
        });
      }

      return parent;
    });
  }

  /**
   * Update calendar event
   */
  async update(id: string, input: UpdateEventInput, currentUser: AuthenticatedUser) {
    const event = await this.findById(id, currentUser);

    // Check edit permission
    if (currentUser.role !== UserRole.SUPER_ADMIN && event.createdById !== currentUser.sub) {
      if (currentUser.role !== UserRole.UNIT_ADMIN || event.unitId !== currentUser.unitId) {
        throw Errors.forbidden('Cannot edit this event');
      }
    }

    const updated = await prisma.calendarEvent.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        eventType: input.eventType,
        scope: input.scope,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        isAllDay: input.isAllDay,
        startTime: input.startTime,
        endTime: input.endTime,
        location: input.location,
        isOnline: input.isOnline,
        onlineUrl: input.onlineUrl,
        isRecurring: input.isRecurring,
        recurrenceRule: input.recurrenceRule,
        isPublic: input.isPublic,
        color: input.color,
      },
      include: {
        unit: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  /**
   * Soft delete event — one occurrence, or the whole series.
   *
   * Delete here is a soft delete (`deletedAt`), so a series delete marks the
   * parent and every child in one statement — atomic by itself, since a single
   * `updateMany` either lands on all matching rows or on none. `SERIES` on an
   * event that is not part of a series just deletes it; there is nothing else
   * to mark.
   */
  async delete(
    id: string,
    currentUser: AuthenticatedUser,
    scope: CalendarEventDeleteScope = 'SINGLE'
  ) {
    const event = await this.findById(id, currentUser);

    // Check delete permission
    if (currentUser.role !== UserRole.SUPER_ADMIN && event.createdById !== currentUser.sub) {
      if (currentUser.role !== UserRole.UNIT_ADMIN || event.unitId !== currentUser.unitId) {
        throw Errors.forbidden('Cannot delete this event');
      }
    }

    const deletedAt = new Date();

    if (scope !== 'SERIES') {
      await prisma.calendarEvent.update({ where: { id }, data: { deletedAt } });
      return { success: true };
    }

    // A child names its parent; a parent is found by the children that point
    // at it. Either way the whole series is one parent id.
    const parentId = event.recurrenceParentId ?? event.id;
    await prisma.calendarEvent.updateMany({
      where: {
        deletedAt: null,
        OR: [{ id: parentId }, { recurrenceParentId: parentId }],
      },
      data: { deletedAt },
    });

    return { success: true };
  }

  /**
   * Get upcoming events
   */
  async getUpcoming(unitId: string, limit: number = 10) {
    const now = new Date();

    const where: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
      startDate: { gte: now },
      OR: [{ unitId: unitId }, { unitId: null, isPublic: true }],
    };

    const events = await prisma.calendarEvent.findMany({
      where,
      take: limit,
      orderBy: { startDate: 'asc' },
      include: {
        unit: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
      },
    });

    return events;
  }

  /**
   * Get today's events
   */
  async getToday(unitId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
      startDate: { gte: today, lt: tomorrow },
      OR: [{ unitId: unitId }, { unitId: null, isPublic: true }],
    };

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: [{ isAllDay: 'desc' }, { startTime: 'asc' }],
      include: {
        unit: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
      },
    });

    return events;
  }

  /**
   * Get holidays
   */
  async getHolidays(unitId: string, startDate: string, endDate: string) {
    const events = await prisma.calendarEvent.findMany({
      where: {
        deletedAt: null,
        eventType: EventType.HOLIDAY,
        // Drafts are not holidays yet; they show only in the review list.
        isDraft: false,
        OR: [{ unitId: unitId }, { unitId: null }],
        startDate: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      orderBy: { startDate: 'asc' },
    });

    return events;
  }

  /**
   * Bulk create events.
   *
   * Each row is parsed by the shared write contract first: the import route
   * does not run the Zod middleware, and an ISO instant handed straight to
   * `dayDate()` became `…Z T00:00:00.000Z`, which Prisma rejected. Parsing here
   * normalises the day and reports a bad row without failing the whole import.
   */
  async bulkCreate(events: unknown[], currentUser: AuthenticatedUser) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const raw of events) {
      const title =
        raw && typeof raw === 'object' && typeof (raw as { title?: unknown }).title === 'string'
          ? (raw as { title: string }).title
          : 'Agenda';
      try {
        await this.create(createCalendarEventSchema.parse(raw), currentUser);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(`${title}: ${error instanceof Error ? error.message : 'Failed'}`);
      }
    }

    return results;
  }

  /**
   * Get calendar statistics
   */
  async getStatistics(unitId?: string, startDate?: string, endDate?: string) {
    // Drafts are excluded for the same reason the list excludes them: an
    // unreviewed holiday import is not part of the calendar yet (#1155).
    const where: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
      isDraft: false,
    };

    if (unitId) {
      where.unitId = unitId;
    }

    if (startDate && endDate) {
      where.startDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [totalEvents, eventsByType] = await Promise.all([
      prisma.calendarEvent.count({ where }),
      prisma.calendarEvent.groupBy({
        by: ['eventType'],
        where,
        _count: { eventType: true },
      }),
    ]);

    return {
      totalEvents,
      eventsByType: eventsByType.map((item) => ({
        type: item.eventType,
        count: item._count.eventType,
      })),
    };
  }
}

export const calendarService = new CalendarService();
