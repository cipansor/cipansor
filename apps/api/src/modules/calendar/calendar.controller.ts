import { Request, Response, NextFunction } from 'express';
import { calendarService } from './calendar.service';
import {
  approveHolidayDraft,
  getHolidaySyncConfig,
  listHolidayDrafts,
  rejectHolidayDraft,
  syncHolidaysForYear,
  updateHolidaySyncConfig,
} from './holiday-sync.service';
import { Errors } from '../../middleware/error';
import { isFoundationScopedRole } from '../../utils/resolve-unit-id';

/**
 * The unit a holiday import may target. A foundation-scoped role (super admin
 * and the yayasan board) may import yayasan-wide or name any unit; everyone
 * else — a school's unit admin — is pinned to their own unit, and naming
 * another unit is refused. Without this, a unit admin could seed another
 * unit's calendar, or the foundation's, through the request body.
 */
function scopedHolidayUnit(
  user: { roleCode?: string | null; unitId?: string | null },
  requested: string | null
): string | null {
  if (isFoundationScopedRole(user.roleCode)) return requested;
  if (!user.unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  if (requested && requested !== user.unitId) {
    throw Errors.forbidden('Tidak dapat mengimpor libur untuk unit lain');
  }
  return user.unitId;
}

export class CalendarController {
  async listEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        unitId: req.query.unitId as string | undefined,
        classId: req.query.classId as string | undefined,
        eventType: req.query.eventType as any,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        month: req.query.month ? parseInt(req.query.month as string) : undefined,
        year: req.query.year ? parseInt(req.query.year as string) : undefined,
        search: req.query.search as string | undefined,
        isPublic:
          req.query.isPublic === 'true' ? true : req.query.isPublic === 'false' ? false : undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
      };
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await calendarService.findAll(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getEventById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const event = await calendarService.findById(id, user);
      res.json({ data: event });
    } catch (error) {
      next(error);
    }
  }

  async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const event = await calendarService.create(req.body, user);
      res.status(201).json({ data: event });
    } catch (error) {
      next(error);
    }
  }

  async updateEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const event = await calendarService.update(id, req.body, user);
      res.json({ data: event });
    } catch (error) {
      next(error);
    }
  }

  async deleteEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      await calendarService.delete(id, user);
      res.json({ success: true, message: 'Event deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async getUpcomingEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;
      const events = await calendarService.getUpcoming(unitId, limit);
      res.json({ data: events });
    } catch (error) {
      next(error);
    }
  }

  async getTodayEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.params;
      const events = await calendarService.getToday(unitId);
      res.json({ data: events });
    } catch (error) {
      next(error);
    }
  }

  async getHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.params;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const events = await calendarService.getHolidays(unitId, startDate, endDate);
      res.json({ data: events });
    } catch (error) {
      next(error);
    }
  }

  async bulkCreateEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { events } = req.body;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await calendarService.bulkCreate(events, user);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async importAcademicCalendar(req: Request, res: Response, next: NextFunction) {
    try {
      const { events } = req.body;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await calendarService.bulkCreate(events, user);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async generateRecurringEvents(req: Request, res: Response, next: NextFunction) {
    try {
      // For now, just return a placeholder - recurrence can be complex
      res.json({ message: 'Recurring event generation not yet implemented' });
    } catch (error) {
      next(error);
    }
  }

  async getStatistics(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = req.query.unitId as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const stats = await calendarService.getStatistics(unitId, startDate, endDate);
      res.json({ data: stats });
    } catch (error) {
      next(error);
    }
  }

  async getHolidaySyncConfig(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ data: await getHolidaySyncConfig() });
    } catch (error) {
      next(error);
    }
  }

  async updateHolidaySyncConfig(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ data: await updateHolidaySyncConfig(req.body) });
    } catch (error) {
      next(error);
    }
  }

  async syncHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const year = Number(req.body?.year ?? new Date().getUTCFullYear());
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw Errors.badRequest('Tahun tidak valid');
      }
      const requestedUnitId = (req.body?.unitId as string | undefined) ?? null;
      const unitId = scopedHolidayUnit(
        { roleCode: req.user!.roleCode, unitId: req.user!.unitId },
        requestedUnitId
      );
      const result = await syncHolidaysForYear(year, {
        unitId,
        createdById: req.user!.sub,
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async listHolidayDrafts(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = scopedHolidayUnit(
        { roleCode: req.user!.roleCode, unitId: req.user!.unitId },
        (req.query.unitId as string | undefined) ?? null
      );
      res.json({ data: await listHolidayDrafts(unitId) });
    } catch (error) {
      next(error);
    }
  }

  async approveHolidayDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = scopedHolidayUnit(
        { roleCode: req.user!.roleCode, unitId: req.user!.unitId },
        (req.body?.unitId as string | undefined) ?? null
      );
      res.json({ data: await approveHolidayDraft(req.params.id, unitId) });
    } catch (error) {
      next(error);
    }
  }

  async rejectHolidayDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = scopedHolidayUnit(
        { roleCode: req.user!.roleCode, unitId: req.user!.unitId },
        (req.body?.unitId as string | undefined) ?? null
      );
      res.json({ data: await rejectHolidayDraft(req.params.id, unitId) });
    } catch (error) {
      next(error);
    }
  }
}

export const calendarController = new CalendarController();
