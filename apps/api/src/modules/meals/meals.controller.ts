import { Request, Response, NextFunction } from 'express';
import { mealsService } from './meals.service';

export class MealsController {
  // ==================
  // MENU METHODS
  // ==================

  async listMenus(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        unitId: req.query.unitId as string | undefined,
        mealType: req.query.mealType as any,
        date: req.query.date as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await mealsService.listMenus(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getMenuById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const menu = await mealsService.getMenuById(id, user);
      res.json({ data: menu });
    } catch (error) {
      next(error);
    }
  }

  async createMenu(req: Request, res: Response, next: NextFunction) {
    try {
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const menu = await mealsService.createMenu(req.body, user);
      res.status(201).json({ data: menu });
    } catch (error) {
      next(error);
    }
  }

  async updateMenu(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const menu = await mealsService.updateMenu(id, req.body, user);
      res.json({ data: menu });
    } catch (error) {
      next(error);
    }
  }

  async deleteMenu(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      await mealsService.deleteMenu(id, user);
      res.json({ success: true, message: 'Menu deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async getTodayMenu(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const menus = await mealsService.getTodayMenu(unitId, user);
      res.json({ data: menus });
    } catch (error) {
      next(error);
    }
  }

  async bulkCreateMenus(req: Request, res: Response, next: NextFunction) {
    try {
      const { menus } = req.body;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const results = { success: 0, failed: 0, errors: [] as string[] };

      for (const menuInput of menus) {
        try {
          await mealsService.createMenu(menuInput, user);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push(
            `${menuInput.date}: ${error instanceof Error ? error.message : 'Failed'}`
          );
        }
      }

      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  }

  // Placeholder methods for routes compatibility
  async listSchedules(req: Request, res: Response, next: NextFunction) {
    return this.listMenus(req, res, next);
  }

  async getScheduleById(req: Request, res: Response, next: NextFunction) {
    return this.getMenuById(req, res, next);
  }

  async createSchedule(req: Request, res: Response, next: NextFunction) {
    return this.createMenu(req, res, next);
  }

  async updateSchedule(req: Request, res: Response, next: NextFunction) {
    return this.updateMenu(req, res, next);
  }

  async deleteSchedule(req: Request, res: Response, next: NextFunction) {
    return this.deleteMenu(req, res, next);
  }

  // ==================
  // ATTENDANCE METHODS
  // ==================

  async listAttendances(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        menuId: req.query.menuId as string | undefined,
        studentId: req.query.studentId as string | undefined,
        status: req.query.status as any,
        date: req.query.date as string | undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
      };
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await mealsService.listAttendance(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async recordAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const attendance = await mealsService.recordAttendance(req.body, user);
      res.status(201).json({ data: attendance });
    } catch (error) {
      next(error);
    }
  }

  async bulkRecordAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { menuId, records } = req.body;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const result = await mealsService.bulkRecordAttendance(menuId, records, user);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const attendance = await mealsService.updateAttendance(id, req.body, user);
      res.json({ data: attendance });
    } catch (error) {
      next(error);
    }
  }

  // ==================
  // STATISTICS
  // ==================

  async getStatistics(req: Request, res: Response, next: NextFunction) {
    try {
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const unitId = req.query.unitId as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const stats = await mealsService.getStatistics(user, unitId, startDate, endDate);
      res.json({ data: stats });
    } catch (error) {
      next(error);
    }
  }

  async getStudentHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;
      const user = {
        sub: req.user!.sub,
        role: req.user!.role,
        roleCode: req.user!.roleCode,
        unitId: req.user!.unitId,
      };
      const limit = parseInt(req.query.limit as string) || 30;
      const history = await mealsService.getStudentHistory(studentId, user, limit);
      res.json({ data: history });
    } catch (error) {
      next(error);
    }
  }
}

export const mealsController = new MealsController();
