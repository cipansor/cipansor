import { Request, Response, NextFunction } from 'express';
import { muhadatsahService } from './muhadatsah.service';

export class MuhadatsahController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        unitId: req.query.unitId as string,
        studentId: req.query.studentId as string,
        partnerId: req.query.partnerId as string,
        evaluatorId: req.query.evaluatorId as string,
        status: req.query.status as any,
        language: req.query.language as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };

      const result = await muhadatsahService.list(query, req.user!);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadatsahService.getById(id, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await muhadatsahService.create(req.body, req.user!);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadatsahService.update(id, req.body, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadatsahService.delete(id, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async evaluate(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadatsahService.evaluate(id, req.body, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await muhadatsahService.cancel(id, req.user!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getUpcoming(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = (req.query.unitId as string) || undefined;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await muhadatsahService.getUpcoming(req.user!, unitId, limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getStudentHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await muhadatsahService.getStudentHistory(req.user!, studentId, limit);
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
      const result = await muhadatsahService.getStatistics(req.user!, unitId, startDate, endDate);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getTopPerformers(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = (req.query.unitId as string) || undefined;
      const language = req.query.language as string;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await muhadatsahService.getTopPerformers(req.user!, unitId, language, limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async matchPartners(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = (req.query.unitId as string) || undefined;
      const language = (req.query.language as string) || 'Arabic';
      const result = await muhadatsahService.matchPartners(req.user!, unitId, language);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const muhadatsahController = new MuhadatsahController();
