import { Request, Response, NextFunction } from 'express';
import {
  halaqohService,
  enrollmentService,
  sanadService,
  progressService,
  dashboardService,
} from './takhosus.service';
import { murojaahService } from './murojaah.service';
import { targetService } from './target.service';
import { ApiResponse } from '@/utils/response';
import { requireUser, requireStudentId } from '@/middleware/auth';
import { listMurojaahQuerySchema } from './takhosus.schema';

// =====================================
// HALAQOH CONTROLLER
// =====================================

export const halaqohController = {
  /**
   * GET /api/takhosus/halaqoh
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, unitId, teacherId, isActive, level } = req.query;

      const result = await halaqohService.findAll({
        page: Number(page),
        limit: Number(limit),
        unitId: unitId as string,
        teacherId: teacherId as string,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        level: level ? Number(level) : undefined,
      });

      res.json(
        ApiResponse.success(result.data, 'Halaqoh retrieved successfully', result.pagination)
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/halaqoh/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const halaqoh = await halaqohService.findById(req.params.id);

      if (!halaqoh) {
        return res.status(404).json(ApiResponse.error('Halaqoh not found'));
      }

      res.json(ApiResponse.success(halaqoh));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/takhosus/halaqoh
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const halaqoh = await halaqohService.create(req.body);
      res.status(201).json(ApiResponse.success(halaqoh, 'Halaqoh created successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/takhosus/halaqoh/:id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const halaqoh = await halaqohService.update(req.params.id, req.body);
      res.json(ApiResponse.success(halaqoh, 'Halaqoh updated successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/takhosus/halaqoh/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await halaqohService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Halaqoh deleted successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/halaqoh/:id/progress
   */
  async getProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const progress = await progressService.getHalaqohProgress(req.params.id);

      if (!progress) {
        return res.status(404).json(ApiResponse.error('Halaqoh not found'));
      }

      res.json(ApiResponse.success(progress));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// ENROLLMENT CONTROLLER
// =====================================

export const enrollmentController = {
  /**
   * GET /api/takhosus/enrollment
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, halaqohId, status, studentId } = req.query;

      const result = await enrollmentService.findAll({
        page: Number(page),
        limit: Number(limit),
        actor: req.user!,
        halaqohId: halaqohId as string,
        status: status as string,
        studentId: studentId as string,
      });

      res.json(
        ApiResponse.success(result.data, 'Enrollments retrieved successfully', result.pagination)
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/enrollment/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const enrollment = await enrollmentService.findById(req.params.id);

      if (!enrollment) {
        return res.status(404).json(ApiResponse.error('Enrollment not found'));
      }

      res.json(ApiResponse.success(enrollment));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/enrollment/student/:studentId
   */
  async getByStudentId(req: Request, res: Response, next: NextFunction) {
    try {
      const enrollment = await enrollmentService.findByStudentId(req.params.studentId);

      if (!enrollment) {
        return res.status(404).json(ApiResponse.error('Student not enrolled in Takhosus program'));
      }

      res.json(ApiResponse.success(enrollment));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/takhosus/enrollment
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const enrollment = await enrollmentService.create(req.body);
      res.status(201).json(ApiResponse.success(enrollment, 'Student enrolled successfully'));
    } catch (error: any) {
      if (error.message === 'Student is already enrolled in Takhosus program') {
        return res.status(400).json(ApiResponse.error(error.message));
      }
      next(error);
    }
  },

  /**
   * PUT /api/takhosus/enrollment/:id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const enrollment = await enrollmentService.update(req.params.id, req.body);
      res.json(ApiResponse.success(enrollment, 'Enrollment updated successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/takhosus/enrollment/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await enrollmentService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Enrollment deleted successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/enrollment/stats
   */
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.query;
      const stats = await enrollmentService.getStats(unitId as string);
      res.json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// SANAD CONTROLLER
// =====================================

export const sanadController = {
  /**
   * GET /api/takhosus/sanad
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, enrollmentId, teacherId, studentId } = req.query;

      const result = await sanadService.findAll({
        page: Number(page),
        limit: Number(limit),
        enrollmentId: enrollmentId as string,
        teacherId: teacherId as string,
        studentId: studentId as string,
      });

      res.json(
        ApiResponse.success(result.data, 'Sanad records retrieved successfully', result.pagination)
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/sanad/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const sanad = await sanadService.findById(req.params.id);

      if (!sanad) {
        return res.status(404).json(ApiResponse.error('Sanad record not found'));
      }

      res.json(ApiResponse.success(sanad));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/takhosus/sanad
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const sanad = await sanadService.create(req.body);
      res.status(201).json(ApiResponse.success(sanad, 'Sanad record created successfully'));
    } catch (error: any) {
      if (error.message?.includes('Sanad for Juz')) {
        return res.status(400).json(ApiResponse.error(error.message));
      }
      next(error);
    }
  },

  /**
   * PUT /api/takhosus/sanad/:id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const sanad = await sanadService.update(req.params.id, req.body);
      res.json(ApiResponse.success(sanad, 'Sanad record updated successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/takhosus/sanad/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await sanadService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Sanad record deleted successfully'));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// TARGET CONTROLLER
// =====================================

export const targetController = {
  /**
   * POST /api/takhosus/targets
   */
  async createOrUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      const target = await targetService.createOrUpdate(req.body);
      res.json(ApiResponse.success(target, 'Target saved successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/targets/student/:studentId
   */
  async getByStudent(req: Request, res: Response, next: NextFunction) {
    try {
      const { academicYearId } = req.query;
      const target = await targetService.getByStudentId(
        req.params.studentId,
        academicYearId as string
      );

      if (!target) {
        return res.status(404).json(ApiResponse.error('Target not found'));
      }

      res.json(ApiResponse.success(target));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/targets/progress/:studentId
   */
  async getProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const progress = await targetService.getProgress(req.params.studentId);

      if (!progress) {
        return res
          .status(404)
          .json(ApiResponse.error('Progress data not available (check if target exists)'));
      }

      res.json(ApiResponse.success(progress));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// PROGRESS CONTROLLER
// =====================================

export const progressController = {
  /**
   * GET /api/takhosus/progress/student/:studentId
   */
  async getStudentProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const progress = await progressService.getStudentProgress(req.params.studentId, req.user!);

      if (!progress) {
        return res.status(404).json(ApiResponse.error('Student not enrolled in Takhosus program'));
      }

      res.json(ApiResponse.success(progress));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/takhosus/progress/me
   * For authenticated student to get their own progress
   */
  async getMyProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = await requireStudentId(req);

      const progress = await progressService.getStudentProgress(studentId);

      if (!progress) {
        return res.status(404).json(ApiResponse.error('You are not enrolled in Takhosus program'));
      }

      res.json(ApiResponse.success(progress));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// DASHBOARD CONTROLLER
// =====================================

export const dashboardController = {
  /**
   * GET /api/takhosus/dashboard/stats
   */
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.query;
      const stats = await dashboardService.getStats(unitId as string);
      res.json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// MUROJAAH CONTROLLER
// =====================================

export const murojaahController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listMurojaahQuerySchema.parse(req.query);
      const result = await murojaahService.findAll({
        page: query.page,
        limit: query.limit,
        studentId: query.studentId,
        halaqohId: query.halaqohId,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        type: query.type,
      });
      res.json(ApiResponse.success(result.data, 'Murojaah records retrieved', result.pagination));
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const record = await murojaahService.create(req.body, requireUser(req).id);
      res.status(201).json(ApiResponse.success(record, 'Murojaah record created'));
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const record = await murojaahService.update(req.params.id, req.body);
      res.json(ApiResponse.success(record, 'Murojaah record updated'));
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await murojaahService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Murojaah record deleted'));
    } catch (error) {
      next(error);
    }
  },
};

export default {
  halaqoh: halaqohController,
  enrollment: enrollmentController,
  sanad: sanadController,
  target: targetController,
  progress: progressController,
  dashboard: dashboardController,
  murojaah: murojaahController,
};
