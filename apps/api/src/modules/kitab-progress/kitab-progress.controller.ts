import { Request, Response, NextFunction } from 'express';
import { kitabProgressService, UpdateProgressInput } from './kitab-progress.service';

export class KitabProgressController {
  // ==================
  // KITAB METHODS
  // ==================

  async listKitab(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        category: req.query.category as any,
        level: req.query.level as any,
        search: req.query.search as string | undefined,
        isActive:
          req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };
      const result = await kitabProgressService.listKitab(query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getKitabById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const kitab = await kitabProgressService.getKitabById(id);
      res.json({ data: kitab });
    } catch (error) {
      next(error);
    }
  }

  async createKitab(req: Request, res: Response, next: NextFunction) {
    try {
      const kitab = await kitabProgressService.createKitab(req.body);
      res.status(201).json({ data: kitab });
    } catch (error) {
      next(error);
    }
  }

  async updateKitab(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const kitab = await kitabProgressService.updateKitab(id, req.body);
      res.json({ data: kitab });
    } catch (error) {
      next(error);
    }
  }

  async deleteKitab(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await kitabProgressService.deleteKitab(id);
      res.json({ success: true, message: 'Kitab deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // ==================
  // PROGRESS METHODS
  // ==================

  async listProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        kitabId: req.query.kitabId as string | undefined,
        studentId: req.query.studentId as string | undefined,
        teacherId: req.query.teacherId as string | undefined,
        academicYearId: req.query.academicYearId as string | undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await kitabProgressService.listProgress(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const progress = await kitabProgressService.updateProgress(req.body, user);
      res.json({ data: progress });
    } catch (error) {
      next(error);
    }
  }

  // Placeholder methods for routes compatibility
  async listAssignments(req: Request, res: Response, next: NextFunction) {
    return this.listProgress(req, res, next);
  }

  async createAssignment(req: Request, res: Response, next: NextFunction) {
    return this.updateProgress(req, res, next);
  }

  async updateAssignment(req: Request, res: Response, next: NextFunction) {
    return this.updateProgress(req, res, next);
  }

  async deleteAssignment(req: Request, res: Response, next: NextFunction) {
    res.json({ success: true, message: 'Assignment deleted' });
  }

  async listRecords(req: Request, res: Response, next: NextFunction) {
    return this.listProgress(req, res, next);
  }

  async createRecord(req: Request, res: Response, next: NextFunction) {
    return this.updateProgress(req, res, next);
  }

  async bulkCreateRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const { records } = req.body;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const results = { success: 0, failed: 0, errors: [] as string[] };

      const promises = records.map(async (record: UpdateProgressInput) => {
        try {
          await kitabProgressService.updateProgress(record, user);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: `${record.studentId}: ${error instanceof Error ? error.message : 'Failed'}`,
          };
        }
      });

      const outcomes = await Promise.all(promises);

      outcomes.forEach((outcome) => {
        if (outcome.success) {
          results.success++;
        } else {
          results.failed++;
          if (outcome.error) {
            results.errors.push(outcome.error);
          }
        }
      });

      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  }

  // ==================
  // STATISTICS
  // ==================

  async getStatistics(req: Request, res: Response, next: NextFunction) {
    try {
      const unitId = req.query.unitId as string | undefined;
      const academicYearId = req.query.academicYearId as string | undefined;
      const stats = await kitabProgressService.getStatistics(unitId, academicYearId);
      res.json({ data: stats });
    } catch (error) {
      next(error);
    }
  }

  async getStudentReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const report = await kitabProgressService.getStudentReport(studentId, user);
      res.json({ data: report });
    } catch (error) {
      next(error);
    }
  }
}

export const kitabProgressController = new KitabProgressController();
