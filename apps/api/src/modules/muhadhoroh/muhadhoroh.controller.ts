import { Request, Response, NextFunction } from 'express';
import { muhadhorohService } from './muhadhoroh.service';

export class MuhadhorohController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        unitId: req.query.unitId as string,
        studentId: req.query.studentId as string,
        evaluatorId: req.query.evaluatorId as string,
        status: req.query.status as any,
        language: req.query.language as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };

      const result = await muhadhorohService.list(query, req.user!);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadhorohService.getById(id, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await muhadhorohService.create(req.body, req.user!);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadhorohService.update(id, req.body, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadhorohService.delete(id, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async evaluate(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadhorohService.evaluate(id, req.body, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadhorohService.cancel(id, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getUpcoming(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = (req.query.unitId as string) || undefined;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await muhadhorohService.getUpcoming(req.user!, unitId, limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getStudentHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await muhadhorohService.getStudentHistory(req.user!, studentId, limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getStatistics(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = (req.query.unitId as string) || undefined;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const result = await muhadhorohService.getStatistics(req.user!, unitId, startDate, endDate);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getTopPerformers(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = (req.query.unitId as string) || undefined;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await muhadhorohService.getTopPerformers(req.user!, unitId, limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const muhadhorohController = new MuhadhorohController();
