import { Request, Response, NextFunction } from 'express';
import muhasabahService from './muhasabah.service';
import { ApiResponse } from '@/utils/response';
import { requireStudentId } from '@/middleware/auth';
import { dayOf, todayWib } from '@/utils/wib';

export const muhasabahController = {
  /**
   * GET /api/muhasabah
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, studentId, mood, startDate, endDate } = req.query;

      const result = await muhasabahService.findAll({
        page: Number(page),
        limit: Number(limit),
        studentId: studentId as string,
        mood: mood as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      res.json(
        ApiResponse.success(
          result.data,
          'Muhasabah records retrieved successfully',
          result.pagination
        )
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const muhasabah = await muhasabahService.findById(req.params.id);

      if (!muhasabah) {
        return res.status(404).json(ApiResponse.error('Muhasabah record not found'));
      }

      res.json(ApiResponse.success(muhasabah));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/me
   */
  async getMyRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = await requireStudentId(req);
      const { page = 1, limit = 10, mood, startDate, endDate } = req.query;

      const result = await muhasabahService.findAll({
        page: Number(page),
        limit: Number(limit),
        studentId,
        mood: mood as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      res.json(
        ApiResponse.success(result.data, 'My muhasabah records retrieved', result.pagination)
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/me/today
   */
  async getMyToday(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = await requireStudentId(req);

      const muhasabah = await muhasabahService.findByStudentAndDate(studentId, dayOf(todayWib()));

      if (!muhasabah) {
        return res.json(ApiResponse.success(null, 'No muhasabah recorded for today'));
      }

      res.json(ApiResponse.success(muhasabah));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/me/stats
   */
  async getMyStats(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = await requireStudentId(req);
      const { days = 30 } = req.query;

      const stats = await muhasabahService.getStudentStats(studentId, Number(days));
      res.json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/muhasabah
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const muhasabah = await muhasabahService.create(req.body);
      res.status(201).json(ApiResponse.success(muhasabah, 'Muhasabah recorded successfully'));
    } catch (error: any) {
      if (error.message === 'Muhasabah for this date already exists') {
        return res.status(400).json(ApiResponse.error(error.message));
      }
      next(error);
    }
  },

  /**
   * POST /api/muhasabah/me
   * Student creates their own muhasabah
   */
  async createMine(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = await requireStudentId(req);

      const muhasabah = await muhasabahService.create({
        ...req.body,
        studentId,
        date: req.body.date || todayWib(),
      });
      res.status(201).json(ApiResponse.success(muhasabah, 'Muhasabah recorded successfully'));
    } catch (error: any) {
      if (error.message === 'Muhasabah for this date already exists') {
        return res.status(400).json(ApiResponse.error(error.message));
      }
      next(error);
    }
  },

  /**
   * PUT /api/muhasabah/:id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const muhasabah = await muhasabahService.update(req.params.id, req.body);
      res.json(ApiResponse.success(muhasabah, 'Muhasabah updated successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/muhasabah/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await muhasabahService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Muhasabah deleted successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/student/:studentId/stats
   */
  async getStudentStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { days = 30 } = req.query;
      const stats = await muhasabahService.getStudentStats(req.params.studentId, Number(days));
      res.json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/student/:studentId/history
   */
  async getStudentHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { days = 30 } = req.query;
      const history = await muhasabahService.getStudentHistory(req.params.studentId, Number(days));
      res.json(ApiResponse.success(history));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/group/stats
   */
  async getGroupStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, classId, halaqohId, days = 7 } = req.query;

      const stats = await muhasabahService.getGroupStats({
        unitId: unitId as string,
        classId: classId as string,
        halaqohId: halaqohId as string,
        days: Number(days),
      });

      res.json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/muhasabah/daily-report
   */
  async getDailyReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { date, halaqohId } = req.query;
      const reportDate = (date as string) || todayWib();

      const report = await muhasabahService.getDailyReport(reportDate, halaqohId as string);
      res.json(ApiResponse.success(report));
    } catch (error) {
      next(error);
    }
  },
};

export default muhasabahController;
