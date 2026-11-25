import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { Prisma, EventType, EventScope } from '@prisma/client';
import {
  CALENDAR_FOUNDATION_WRITE_ROLE_CODES,
  CALENDAR_WRITE_ROLE_CODES,
  UNIT_ADMIN_ROLE_CODES,
} from '@cipansor/shared';
import { isFoundationScopedRole, seesAllUnits } from '@/utils/resolve-unit-id';
import { shiftWibDay, todayWib, wibDayOf, wibDayStart, wibTimeOnDay } from '@/utils/wib';

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
  /** The management screen may show class events to the unit admin; the
   * calendar itself must not. */
  manage?: boolean;
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
      const overlapping: Prisma.CalendarEventWhereInput[] = [];
      if (rangeEnd) overlapping.push({ startDate: { lte: rangeEnd } });
      if (rangeStart) {
        overlapping.push({
          OR: [{ endDate: { gte: rangeStart } }, { endDate: null, startDate: { gte: rangeStart } }],
        });
      }
      and.push(...overlapping);
    }

    // Search must not replace the unit `OR`: a unit user who searched saw
    // every unit's events because this clause overwrote the scope.
    if (search) {
      and.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const classScope = query.manage
      ? await this.managementClassScopeWhere(currentUser)
      : await this.classScopeWhere(currentUser);
    if (classScope) and.push(classScope);

    if (and.length) where.AND = and;

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
      const ownUnit = !!currentUser.unitId && event.unitId === currentUser.unitId;
      const foundationPublic = event.unitId === null && event.isPublic;
      if (!ownUnit && !foundationPublic) {
        throw Errors.forbidden('Access denied');
      }
      if (event.scope === EventScope.SPECIFIC_CLASS && !this.bypassesClassScope(currentUser)) {
        const managesUnit =
          this.isUnitAdmin(currentUser) &&
          !!currentUser.unitId &&
          event.unitId === currentUser.unitId;
        if (event.createdById !== currentUser.sub && !managesUnit) {
          const classIds = await this.classIdsVisibleTo(currentUser.sub);
          if (!event.classId || !classIds.includes(event.classId)) {
            throw Errors.forbidden('Access denied');
          }
        }
      }
    }

    return event;
  }

  /**
   * Create calendar event
   */
  async create(input: CreateEventInput, currentUser: AuthenticatedUser) {
    if (!this.canWriteCalendar(currentUser)) {
      throw Errors.forbidden('Peran ini tidak dapat menulis agenda kalender');
    }
    const foundationWide = this.canPublishFoundationWide(currentUser);
    let unitId = input.unitId || null;

    if (!foundationWide) {
      if (!currentUser.unitId) {
        throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
      }
      if (unitId && unitId !== currentUser.unitId) {
        throw Errors.forbidden('Cannot create event for another unit');
      }
      unitId = currentUser.unitId;
    }

    let classId = input.classId || null;
    if (classId) {
      const kelas = await prisma.class.findFirst({
        where: { id: classId, deletedAt: null },
        select: { unitId: true },
      });
      if (!kelas) throw Errors.badRequest('Kelas tidak ditemukan');
      if (unitId && kelas.unitId !== unitId) {
        throw Errors.forbidden('Kelas bukan milik unit ini');
      }
      unitId = unitId || kelas.unitId;
    }

    let scope = input.scope;
    if (classId) {
      if (scope && scope !== EventScope.SPECIFIC_CLASS) {
        throw Errors.badRequest('Event kelas harus bercakupan SPECIFIC_CLASS');
      }
      scope = EventScope.SPECIFIC_CLASS;
    } else if (!unitId) {
      if (scope && scope !== EventScope.ALL_UNITS) {
        throw Errors.badRequest('Event tanpa unit harus bercakupan ALL_UNITS');
      }
      scope = EventScope.ALL_UNITS;
    } else {
      if (scope === EventScope.ALL_UNITS) {
        if (!foundationWide) {
          throw Errors.forbidden(
            'Hanya pengurus yayasan yang dapat membuat agenda seluruh yayasan'
          );
        }
        throw Errors.badRequest('Event dengan unit tidak dapat bercakupan ALL_UNITS');
      }
      if (scope === EventScope.SPECIFIC_CLASS) {
        throw Errors.badRequest('Event tanpa kelas tidak dapat bercakupan SPECIFIC_CLASS');
      }
      scope = scope || EventScope.SPECIFIC_UNIT;
    }

    const event = await prisma.calendarEvent.create({
      data: {
        unitId,
        classId,
        title: input.title,
        description: input.description,
        eventType: input.eventType,
        scope,
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

    if (!this.canManageEvent(event, currentUser)) {
      throw Errors.forbidden('Cannot edit this event');
    }

    const foundationWide = this.canPublishFoundationWide(currentUser);
    let scope = input.scope;
    if (!foundationWide) {
      const expected = event.classId ? EventScope.SPECIFIC_CLASS : EventScope.SPECIFIC_UNIT;
      if (scope === EventScope.ALL_UNITS) {
        throw Errors.forbidden('Hanya pengurus yayasan yang dapat membuat agenda seluruh yayasan');
      }
      if (scope && scope !== expected) {
        throw Errors.badRequest(`Event ini harus bercakupan ${expected}`);
      }
      scope = expected;
    } else if (scope) {
      if (event.classId && scope !== EventScope.SPECIFIC_CLASS) {
        throw Errors.badRequest('Event kelas harus bercakupan SPECIFIC_CLASS');
      }
      if (!event.classId && scope === EventScope.SPECIFIC_CLASS) {
        throw Errors.badRequest('Event tanpa kelas tidak dapat bercakupan SPECIFIC_CLASS');
      }
      if (!event.unitId && scope !== EventScope.ALL_UNITS) {
        throw Errors.badRequest('Event tanpa unit harus bercakupan ALL_UNITS');
      }
      if (event.unitId && scope === EventScope.ALL_UNITS) {
        throw Errors.badRequest('Event dengan unit tidak dapat bercakupan ALL_UNITS');
      }
    }

    const updated = await prisma.calendarEvent.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        eventType: input.eventType,
        scope,
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

    if (!this.canManageEvent(event, currentUser)) {
      throw Errors.forbidden('Cannot delete this event');
    }

    await prisma.calendarEvent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Publishing a foundation-wide agenda is a foundation act, not a read
   * breadth: the Pengawas and Pembina read across units but do not write the
   * agenda they supervise. Only the Super Admin and the Pengurus publish it.
   */
  private canPublishFoundationWide(currentUser: AuthenticatedUser): boolean {
    return (
      !!currentUser.roleCode && CALENDAR_FOUNDATION_WRITE_ROLE_CODES.includes(currentUser.roleCode)
    );
  }

  private canWriteCalendar(currentUser: AuthenticatedUser): boolean {
    return !!currentUser.roleCode && CALENDAR_WRITE_ROLE_CODES.includes(currentUser.roleCode);
  }

  private isSuperAdmin(currentUser: AuthenticatedUser): boolean {
    return currentUser.roleCode === 'SUPER_ADMIN';
  }

  private isUnitAdmin(currentUser: AuthenticatedUser): boolean {
    return !!currentUser.roleCode && UNIT_ADMIN_ROLE_CODES.includes(currentUser.roleCode);
  }

  /**
   * Who may change an event: its creator, the Super Admin, the admin of the
   * event's unit (including a class event the admin does not teach), and a
   * Pengurus for a foundation-wide event.
   */
  private canManageEvent(
    event: { createdById: string; unitId: string | null },
    currentUser: AuthenticatedUser
  ): boolean {
    if (!this.canWriteCalendar(currentUser)) return false;
    if (this.isSuperAdmin(currentUser) || event.createdById === currentUser.sub) return true;
    if (
      this.isUnitAdmin(currentUser) &&
      !!currentUser.unitId &&
      event.unitId === currentUser.unitId
    ) {
      return true;
    }
    return this.canPublishFoundationWide(currentUser) && event.unitId === null;
  }

  /** Reading a class event is wider than writing it: the foundation's
   * oversight organs read every unit, but `canManageEvent` still governs the
   * writes. */
  private bypassesClassScope(currentUser: AuthenticatedUser): boolean {
    return isFoundationScopedRole(currentUser.roleCode);
  }

  /**
   * Classes whose private events the user may read: their own enrollment, a
   * class they homeroom or teach, or a class their child is enrolled in.
   */
  private async classIdsVisibleTo(userId: string): Promise<string[]> {
    const classes = await prisma.class.findMany({
      where: {
        deletedAt: null,
        OR: [
          { enrollments: { some: { status: 'active', student: { userId } } } },
          { homeroomTeacher: { is: { userId } } },
          { teacherSubjects: { some: { isActive: true, teacher: { userId } } } },
          {
            enrollments: {
              some: {
                status: 'active',
                student: { parents: { some: { parentId: userId } } },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    return classes.map((kelas) => kelas.id);
  }

  /**
   * A class-scoped event is readable by its creator, the class members above,
   * and foundation roles. Without this a private class event reached every
   * user of the unit, because the unit `OR` was the only read gate.
   */
  private async classScopeWhere(
    currentUser: AuthenticatedUser
  ): Promise<Prisma.CalendarEventWhereInput | null> {
    if (this.bypassesClassScope(currentUser)) return null;

    const classIds = await this.classIdsVisibleTo(currentUser.sub);
    const or: Prisma.CalendarEventWhereInput[] = [
      { scope: { not: EventScope.SPECIFIC_CLASS } },
      { scope: EventScope.SPECIFIC_CLASS, createdById: currentUser.sub },
    ];
    if (classIds.length) {
      or.push({ scope: EventScope.SPECIFIC_CLASS, classId: { in: classIds } });
    }
    return { OR: or };
  }

  /**
   * The management list adds every class event of the admin's own unit, so the
   * unit admin can find and delete one created by the Super Admin or another
   * teacher. The calendar list keeps `classScopeWhere`, so this does not open a
   * class agenda to ordinary users outside the class.
   */
  private async managementClassScopeWhere(
    currentUser: AuthenticatedUser
  ): Promise<Prisma.CalendarEventWhereInput | null> {
    if (this.bypassesClassScope(currentUser)) return null;

    const classIds = await this.classIdsVisibleTo(currentUser.sub);
    const or: Prisma.CalendarEventWhereInput[] = [
      { scope: { not: EventScope.SPECIFIC_CLASS } },
      { scope: EventScope.SPECIFIC_CLASS, createdById: currentUser.sub },
    ];
    if (this.isUnitAdmin(currentUser) && currentUser.unitId) {
      or.push({ scope: EventScope.SPECIFIC_CLASS, unitId: currentUser.unitId });
    }
    if (classIds.length) {
      or.push({ scope: EventScope.SPECIFIC_CLASS, classId: { in: classIds } });
    }
    return { OR: or };
  }

  /**
   * A unit's private events are readable only by a session whose active role
   * covers that unit. A unit user naming another unit is refused, not silently
   * served their own agenda under the other unit's name.
   */
  private assertUnitScope(unitId: string, currentUser: AuthenticatedUser) {
    if (!seesAllUnits(currentUser) && currentUser.unitId !== unitId) {
      throw Errors.forbidden('Tidak dapat melihat agenda unit lain');
    }
  }

  /**
   * Get upcoming events
   */
  async getUpcoming(unitId: string, limit: number = 10, currentUser: AuthenticatedUser) {
    this.assertUnitScope(unitId, currentUser);
    const now = new Date();
    const today = todayWib(now);
    const tomorrow = shiftWibDay(today, 1);

    const scope: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
      OR: [{ unitId: unitId }, { unitId: null, isPublic: true }],
    };
    const classScope = await this.classScopeWhere(currentUser);
    if (classScope) scope.AND = [classScope];

    const include = {
      unit: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
    };

    // `startDate` holds a date-only value at 07:00 WIB for a timed event, so
    // filtering it with `gte: now` dropped an afternoon meeting after 07:00.
    // Read today's rows whole and filter on the real WIB start instant; read
    // the following days already ordered, so `limit` future rows are enough.
    const [todayRows, futureRows] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          ...scope,
          startDate: { gte: wibDayStart(today), lt: wibDayStart(tomorrow) },
        },
        orderBy: [{ startDate: 'asc' }, { startTime: 'asc' }],
        include,
      }),
      prisma.calendarEvent.findMany({
        where: { ...scope, startDate: { gte: wibDayStart(tomorrow) } },
        take: limit,
        orderBy: [{ startDate: 'asc' }, { startTime: 'asc' }],
        include,
      }),
    ]);

    return [...todayRows, ...futureRows]
      .filter((event) => eventStartInstant(event) >= now)
      .sort((a, b) => eventStartInstant(a).getTime() - eventStartInstant(b).getTime())
      .slice(0, limit);
  }

  /**
   * Get today's events
   *
   * "Today" is the WIB calendar day. `CalendarEvent.startDate` is a real
   * instant, so the window is `[00:00, 24:00) WIB` — which also covers an
   * all-day event stored at midnight UTC. Building it with `setHours(0,0,0,0)`
   * on the UTC container made it `[07:00 yesterday, 07:00 today) WIB` and
   * returned yesterday's agenda all morning (#1152).
   */
  async getToday(unitId: string, currentUser: AuthenticatedUser) {
    this.assertUnitScope(unitId, currentUser);
    const today = todayWib();
    const startDate = wibDayStart(today);
    const endDate = wibDayStart(shiftWibDay(today, 1));

    const where: Prisma.CalendarEventWhereInput = {
      deletedAt: null,
      startDate: { gte: startDate, lt: endDate },
      OR: [{ unitId: unitId }, { unitId: null, isPublic: true }],
    };
    const classScope = await this.classScopeWhere(currentUser);
    if (classScope) where.AND = [classScope];

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

/**
 * The instant a timed event really starts. The create form sends a date-only
 * `startDate` plus a WIB `startTime`; the API stores that date at midnight UTC
 * (07:00 WIB) and keeps the time separately. Comparing `startDate` alone hid
 * an afternoon meeting from "Event Mendatang" all morning.
 */
function eventStartInstant(event: {
  startDate: Date;
  startTime: string | null;
  isAllDay: boolean;
}): Date {
  if (event.isAllDay || !event.startTime) return event.startDate;
  if (
    event.startDate.getUTCHours() ||
    event.startDate.getUTCMinutes() ||
    event.startDate.getUTCSeconds()
  ) {
    return event.startDate;
  }
  return wibTimeOnDay(wibDayOf(event.startDate), event.startTime);
}

export const calendarService = new CalendarService();
