import { Request, Response, NextFunction } from 'express';
import { extracurricularService } from './extracurricular.service';
import {
  listExtracurricularsQuerySchema,
  createExtracurricularSchema,
  updateExtracurricularSchema,
  enrollStudentSchema,
  bulkEnrollSchema,
  updateEnrollmentSchema,
  recordAttendanceSchema,
  createAchievementSchema,
  listEnrollmentsQuerySchema,
  listAttendanceQuerySchema,
  listAchievementsQuerySchema,
} from './extracurricular.schema';
import { UserRole } from '@prisma/client';

// User type from JwtPayload
interface AuthenticatedUser {
  sub: string;
  role: string;
  /**
   * RoleCode granular. Wajib ada agar scoping bisa memakai seesAllUnits():
   * `role` legacy memetakan setiap YAYASAN_* menjadi 'UNIT_ADMIN', sehingga
   * pemeriksaan yang ditulis atas `role` menggolongkan pengurus yayasan
   * sebagai admin unit — itulah yang menyembunyikan datanya.
   */
  roleCode?: string | null;
  unitId: string | null;
}

export class ExtracurricularController {
  // ======================
  // EXTRACURRICULAR CRUD
  // ======================

  /** GET /extracurricular/public — no session; see the service. */
  async publicList(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ data: await extracurricularService.publicList() });
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listExtracurricularsQuerySchema.parse(req.query);
      const user = req.user as AuthenticatedUser;
      const result = await extracurricularService.findAll(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      const extracurricular = await extracurricularService.findById(id, user);
      res.json({ data: extracurricular });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createExtracurricularSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const extracurricular = await extracurricularService.create(input, user);
      res.status(201).json({ data: extracurricular });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = updateExtracurricularSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const extracurricular = await extracurricularService.update(id, input, user);
      res.json({ data: extracurricular });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      await extracurricularService.delete(id, user);
      res.json({ success: true, message: 'Extracurricular deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // ======================
  // ENROLLMENT
  // ======================

  async enrollStudent(req: Request, res: Response, next: NextFunction) {
    try {
      const input = enrollStudentSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const enrollment = await extracurricularService.enrollStudent(input, user);
      res.status(201).json({ data: enrollment });
    } catch (error) {
      next(error);
    }
  }

  async bulkEnroll(req: Request, res: Response, next: NextFunction) {
    try {
      const input = bulkEnrollSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const result = await extracurricularService.bulkEnroll(input, user);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateEnrollment(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = updateEnrollmentSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const enrollment = await extracurricularService.updateEnrollment(id, input, user);
      res.json({ data: enrollment });
    } catch (error) {
      next(error);
    }
  }

  async listEnrollments(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listEnrollmentsQuerySchema.parse(req.query);
      const user = req.user as AuthenticatedUser;
      const result = await extracurricularService.listEnrollments(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // ======================
  // ATTENDANCE
  // ======================

  async recordAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const input = recordAttendanceSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const result = await extracurricularService.recordAttendance(input, user);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async listAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listAttendanceQuerySchema.parse(req.query);
      const user = req.user as AuthenticatedUser;
      const result = await extracurricularService.listAttendance(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getAttendanceSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      const summary = await extracurricularService.getAttendanceSummary(id, user);
      res.json({ data: summary });
    } catch (error) {
      next(error);
    }
  }

  // ======================
  // ACHIEVEMENTS
  // ======================

  async createAchievement(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createAchievementSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const achievement = await extracurricularService.createAchievement(input, user);
      res.status(201).json({ data: achievement });
    } catch (error) {
      next(error);
    }
  }

  async listAchievements(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listAchievementsQuerySchema.parse(req.query);
      const user = req.user as AuthenticatedUser;
      const result = await extracurricularService.listAchievements(query, user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async deleteAchievement(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      await extracurricularService.deleteAchievement(id, user);
      res.json({ success: true, message: 'Achievement deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // ======================
  // STUDENT & STATISTICS
  // ======================

  async getStudentExtracurriculars(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;
      const result = await extracurricularService.getStudentExtracurriculars(studentId, req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async getStatistics(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.params;
      const { academicYearId } = req.query;
      const stats = await extracurricularService.getStatistics(
        unitId,
        academicYearId as string | undefined
      );
      res.json({ data: stats });
    } catch (error) {
      next(error);
    }
  }
}

export const extracurricularController = new ExtracurricularController();
