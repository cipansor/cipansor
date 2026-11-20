import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { UserRole, Prisma, EventType, EventScope } from '@prisma/client';
import type { EventRecurrenceCode, ParsedCalendarEventPayload } from '@cipansor/shared';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { dayDate, shiftWibDay } from '@/utils/wib';
import { daysBetween, occurrenceDays, recurrenceRuleFor } from './calendar-recurrence';

interface ListEventsQuery {
  unitId?: string;
  classId?: string;
  eventType?: EventType;
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  search?: string;
  isPublic?: boolean;
  page: number;
  limit: number;
}

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

/** Which occurrences a delete applies to when the event belongs to a series. */
export type DeleteScope = 'SINGLE' | 'SERIES';

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

    if (classId) {
      where.classId = classId;
    }

    if (eventType) {
      where.eventType = eventType;
    }

    if (isPublic !== undefined) {
      where.isPublic = isPublic;
    }

    // Date filters. An event belongs to the window when it *overlaps* it, not
    // merely when it starts inside it: an event running 31 Dec–4 Jan must also
    // appear in January. Filtering on `startDate` alone dropped it (#911). The
    // overlap goes in `AND` because `OR` already carries the unit scope.
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
      const overlapping: Prisma.CalendarEventWhereInput[] = [];
      if (rangeEnd) overlapping.push({ startDate: { lte: rangeEnd } });
      if (rangeStart) {
        overlapping.push({
          OR: [{ endDate: { gte: rangeStart } }, { endDate: null, startDate: { gte: rangeStart } }],
        });
      }
      where.AND = overlapping;
    }

    // Search goes in `AND`, never into `where.OR`: that OR carries the unit
    // scope above, and overwriting it made a search from any unit return every
    // unit's private events.
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.calendarEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startDate: 'asc' },
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
    // Validate unit access
    if (
      input.unitId &&
      currentUser.role !== UserRole.SUPER_ADMIN &&
      input.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Cannot create event for another unit');
    }

    const recurrence = input.recurrence ?? 'NONE';
    const startDate = dayDate(input.startDate);
    const endDate = input.endDate ? dayDate(input.endDate) : null;
    const daySpan = input.endDate ? daysBetween(input.startDate, input.endDate) : 0;

    // `scope` is derived, not sent: the unit and class columns are what decide
    // who sees the event, and a form's own `scope` could contradict them.
    const scope = input.classId
      ? EventScope.SPECIFIC_CLASS
      : input.unitId
        ? EventScope.SPECIFIC_UNIT
        : EventScope.ALL_UNITS;

    const shared = {
      unitId: input.unitId || null,
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
  async delete(id: string, currentUser: AuthenticatedUser, scope: DeleteScope = 'SINGLE') {
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
   * Bulk create events
   */
  async bulkCreate(events: CreateEventInput[], currentUser: AuthenticatedUser) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const eventInput of events) {
      try {
        await this.create(eventInput, currentUser);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `${eventInput.title}: ${error instanceof Error ? error.message : 'Failed'}`
        );
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
