import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { UserRole, Prisma, EventType, EventScope } from '@prisma/client';
import { seesAllUnits } from '@/utils/resolve-unit-id';

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

interface CreateEventInput {
  unitId?: string;
  classId?: string;
  title: string;
  description?: string;
  eventType: EventType;
  scope?: EventScope;
  startDate: string;
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

    // Date filters
    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) where.startDate.lte = new Date(endDate);
    }

    // Month/Year filter
    if (month && year) {
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      where.startDate = {
        gte: monthStart,
        lte: monthEnd,
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
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
   * Create calendar event
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

    const event = await prisma.calendarEvent.create({
      data: {
        unitId: input.unitId || null,
        classId: input.classId || null,
        title: input.title,
        description: input.description,
        eventType: input.eventType,
        scope: input.scope || EventScope.ALL_UNITS,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        isAllDay: input.isAllDay ?? false,
        startTime: input.startTime,
        endTime: input.endTime,
        location: input.location,
        isOnline: input.isOnline ?? false,
        onlineUrl: input.onlineUrl,
        isRecurring: input.isRecurring ?? false,
        recurrenceRule: input.recurrenceRule,
        isPublic: input.isPublic ?? true,
        color: input.color,
        createdById: currentUser.sub,
      },
      include: {
        unit: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return event;
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
   * Soft delete event
   */
  async delete(id: string, currentUser: AuthenticatedUser) {
    const event = await this.findById(id, currentUser);

    // Check delete permission
    if (currentUser.role !== UserRole.SUPER_ADMIN && event.createdById !== currentUser.sub) {
      if (currentUser.role !== UserRole.UNIT_ADMIN || event.unitId !== currentUser.unitId) {
        throw Errors.forbidden('Cannot delete this event');
      }
    }

    await prisma.calendarEvent.update({
      where: { id },
      data: { deletedAt: new Date() },
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
    const where: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
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
