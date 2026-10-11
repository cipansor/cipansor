import { Request, Response, NextFunction } from 'express';
import { RoleCode } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import * as service from './hr.service';
import {
  createStaffAttendanceSchema,
  updateStaffAttendanceSchema,
  bulkAttendanceSchema,
  createLeaveSchema,
  updateLeaveSchema,
  approveLeaveSchema,
} from './hr.schema';
import { Errors } from '../../middleware/error';
import { requireUser } from '../../middleware/auth';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import type { HrActor } from './hr.service';

/** The verified token, reduced to what decides an employee's reach. */
function actor(req: Request): HrActor {
  const user = requireUser(req);
  return { sub: user.sub, roleCode: user.roleCode, unitId: user.unitId };
}

// =====================================
// STAFF ATTENDANCE CONTROLLERS
// =====================================

export async function getTeachers(req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.validatedQuery;
    const result = await service.getTeachers(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.validatedQuery;
    const result = await service.getStaffAttendance(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getRetentionRisk(req: Request, res: Response, next: NextFunction) {
  try {
    const { unitId } = req.query;
    const user = req.user!;

    // `req.user.roleCode` is the canonical role (see root AGENTS.md rule 3);
    // comparing the deprecated `role` string against SUPER_ADMIN never matched,
    // so a super admin was wrongly forced to pass a unitId.
    const targetUnitId =
      user.roleCode === RoleCode.SUPER_ADMIN
        ? ((unitId as string | undefined) ?? undefined)
        : (user.unitId ?? undefined);
    if (user.roleCode !== RoleCode.SUPER_ADMIN && !targetUnitId) {
      throw Errors.badRequest('Unit ID missing from user');
    }

    const data = await service.getRetentionRiskAnalytics(targetUnitId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getStaffAttendanceById(req: Request, res: Response, next: NextFunction) {
  try {
    const attendance = await service.getStaffAttendanceById(req.params.id);
    if (!attendance) {
      throw Errors.notFound('Attendance record not found');
    }
    res.json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

export async function createStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createStaffAttendanceSchema.parse(req.body);
    const attendance = await service.createStaffAttendance(data);
    res.status(201).json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

export async function updateStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateStaffAttendanceSchema.parse(req.body);
    const attendance = await service.updateStaffAttendance(req.params.id, data);
    res.json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

export async function recordBulkAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = bulkAttendanceSchema.parse(req.body);
    const result = await service.recordBulkAttendance(data);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function getStaffAttendanceSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      month: z.coerce.number().min(1).max(12),
      year: z.coerce.number().min(2000).max(2100),
    });
    const { month, year } = schema.parse(req.query);
    const summary = await service.getStaffAttendanceSummary(req.params.staffId, month, year);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

export async function deleteStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteStaffAttendance(req.params.id);
    res.json({ success: true, message: 'Attendance record deleted successfully' });
  } catch (error) {
    next(error);
  }
}

// =====================================
// LEAVE CONTROLLERS
// =====================================

export async function getLeaves(req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.validatedQuery;
    const user = req.user!;

    const { mine, ...otherQuery } = query;
    const shouldFilterByMe =
      mine === true || (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.UNIT_ADMIN);

    // Apply filtering if explicitly requested or required by role
    if (shouldFilterByMe) {
      // Resolve teacher/staff profile from user ID
      const [teacher, staff] = await Promise.all([
        prisma.teacher.findUnique({ where: { userId: user.sub } }),
        prisma.staff.findUnique({ where: { userId: user.sub } }),
      ]);

      if (teacher) query.teacherId = teacher.id;
      else if (staff) query.staffId = staff.id;
      else {
        // If "mine" requested but no profile found:
        // - For non-admins, strict error.
        // - For admins who just pressed "My Leaves", return empty list instead of error.
        if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.UNIT_ADMIN) {
          throw Errors.notFound('Employee profile not found');
        } else {
          // Admin with no profile: Force a filter that matches nothing
          // Or we can return empty array immediately.
          // Let's use a dummy ID that won't match to reuse service logic.
          query.staffId = '00000000-0000-0000-0000-000000000000';
        }
      }
    } else {
      // For admins viewing all, filter by unit if specified in token (UNIT_ADMIN)
      if (user.role === UserRole.UNIT_ADMIN && user.unitId) {
        query.unitId = user.unitId;
      }
    }

    const result = await service.getLeaves(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getLeaveById(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await service.getLeaveById(req.params.id);
    if (!leave) {
      throw Errors.notFound('Leave request not found');
    }
    res.json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function createLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createLeaveSchema.parse(req.body);
    const user = req.user!;

    // Auto-fill staffId/teacherId if creating for self
    if (!data.staffId && !data.teacherId) {
      if (user.role === UserRole.TEACHER) {
        const teacher = await prisma.teacher.findUnique({ where: { userId: user.sub } });
        if (!teacher) throw Errors.notFound('Teacher profile not found');
        data.teacherId = teacher.id;
      } else if (user.role === UserRole.STAFF) {
        const staff = await prisma.staff.findUnique({ where: { userId: user.sub } });
        if (!staff) throw Errors.notFound('Staff profile not found');
        data.staffId = staff.id;
      }
    }

    const leave = await service.createLeave(data);
    res.status(201).json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function updateLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateLeaveSchema.parse(req.body);
    const leave = await service.updateLeave(req.params.id, data);
    res.json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function approveLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const data = approveLeaveSchema.parse(req.body);
    const approverId = req.user?.sub;
    if (!approverId) {
      throw Errors.unauthorized('User not authenticated');
    }
    const leave = await service.approveLeave(req.params.id, approverId, data);
    res.json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function cancelLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await service.cancelLeave(req.params.id);
    res.json({ success: true, data: leave, message: 'Leave request cancelled' });
  } catch (error) {
    next(error);
  }
}

export async function deleteLeave(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteLeave(req.params.id);
    res.json({ success: true, message: 'Leave request deleted successfully' });
  } catch (error) {
    next(error);
  }
}

export async function getLeaveBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({ year: z.coerce.number().min(2000).max(2100) });
    const { year } = schema.parse(req.query);
    const balance = await service.getLeaveBalance(req.params.staffId, year);
    res.json({ success: true, data: balance });
  } catch (error) {
    next(error);
  }
}

// =====================================
// STAFF CONTROLLERS (HR listing)
// =====================================

export async function getStaffList(req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.validatedQuery;
    const result = await service.getStaffList(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getStaffById(req: Request, res: Response, next: NextFunction) {
  try {
    const staff = await service.getStaffById(req.params.id);
    if (!staff) {
      throw Errors.notFound('Staff not found');
    }
    res.json({ success: true, data: staff });
  } catch (error) {
    next(error);
  }
}

// =====================================
// EMPLOYEE (TEACHER + STAFF) CONTROLLERS
// =====================================
//
// A user is an "employee" in this module whether they hold a Teacher or a
// Staff row; `service.getEmployees` returns the User with both relations
// included, so one list can serve the HR pages' mixed roster. The web
// `/hr/employees*` hooks have always called these paths — the service
// functions existed but were never routed, so every HR page 404'd and
// rendered an empty roster.

export async function getEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.validatedQuery;
    const result = await service.getEmployees(query, actor(req));
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getEmployeeById(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await service.getEmployeeById(req.params.id, actor(req));
    if (!employee) {
      throw Errors.notFound('Employee not found');
    }
    res.json({ success: true, data: employee });
  } catch (error) {
    next(error);
  }
}

export async function createEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await service.createEmployee(req.body, actor(req));
    res.status(201).json({ success: true, data: employee });
  } catch (error) {
    next(error);
  }
}

export async function updateEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await service.updateEmployee(req.params.id, req.body, actor(req));
    res.json({ success: true, data: employee });
  } catch (error) {
    next(error);
  }
}

export async function deleteEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteEmployee(req.params.id, actor(req));
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    next(error);
  }
}
