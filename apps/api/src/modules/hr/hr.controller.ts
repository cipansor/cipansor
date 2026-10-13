import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import * as service from './hr.service';
import {
  createStaffAttendanceSchema,
  updateStaffAttendanceSchema,
  deleteStaffAttendanceSchema,
  bulkAttendanceSchema,
  createLeaveSchema,
  updateLeaveSchema,
  approveLeaveSchema,
} from './hr.schema';
import { Errors } from '../../middleware/error';
import { requireUser } from '../../middleware/auth';
import { z } from 'zod';
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
    const user = req.user!;

    // A unit admin sees only their own unit; SUPER_ADMIN may pass any unitId;
    // a yayasan organ (same bucket, no unit) is refused rather than handed
    // every unit's punches and coordinates.
    service.assertHrAdmin(user);
    if (service.isUnitAdminUser(user)) {
      if (!user.unitId) throw Errors.forbidden('Akun admin belum terhubung ke unit');
      query.unitId = user.unitId;
    }

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
    // so a super admin was wrongly forced to pass a unitId. A super admin with
    // no unitId aggregates the whole yayasan.
    const superAdmin = service.isSuperAdminUser(user);
    const targetUnitId = superAdmin
      ? ((unitId as string | undefined) ?? undefined)
      : (user.unitId ?? undefined);
    if (!superAdmin && !targetUnitId) {
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
    await service.assertMayManageStaff(req.user!, attendance.staffId);
    res.json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

export async function createStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createStaffAttendanceSchema.parse(req.body);
    const staffId = await service.resolveStaffId(data);
    await service.assertMayManageStaff(req.user!, staffId);
    const attendance = await service.createStaffAttendance({ ...data, staffId }, req.user?.sub);
    res.status(201).json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

export async function updateStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateStaffAttendanceSchema.parse(req.body);
    const existing = await service.getStaffAttendanceById(req.params.id);
    if (!existing) throw Errors.notFound('Attendance record not found');
    await service.assertMayManageStaff(req.user!, existing.staffId);
    const attendance = await service.updateStaffAttendance(req.params.id, data, req.user?.sub);
    res.json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

export async function recordBulkAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const data = bulkAttendanceSchema.parse(req.body);
    // Every row must be within the caller's remit before any is written, so a
    // unit admin cannot slip a foreign unit's staff into a bulk submission.
    for (const record of data.records) {
      await service.assertMayManageStaff(req.user!, await service.resolveStaffId(record));
    }
    const result = await service.recordBulkAttendance(data, req.user?.sub);
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
    const target = await service.leaveStaffId({ staffId: req.params.staffId });
    await service.assertMayManageStaff(req.user!, target);
    const scopeUnitId = service.isUnitAdminUser(req.user!)
      ? (req.user!.unitId ?? undefined)
      : undefined;
    const summary = await service.getStaffAttendanceSummary(
      req.params.staffId,
      month,
      year,
      scopeUnitId
    );
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

export async function deleteStaffAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    // A deletion of a recorded day is a correction: it needs a reason and
    // leaves an audit trail, like an edit.
    const { reason } = deleteStaffAttendanceSchema.parse(req.body ?? {});
    const existing = await service.getStaffAttendanceById(req.params.id);
    if (!existing) throw Errors.notFound('Attendance record not found');
    await service.assertMayManageStaff(req.user!, existing.staffId);
    await service.deleteStaffAttendance(req.params.id, reason, req.user?.sub);
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
      mine === true || (!service.isSuperAdminUser(user) && !service.isUnitAdminUser(user));

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
        if (!service.isSuperAdminUser(user) && !service.isUnitAdminUser(user)) {
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
      if (service.isUnitAdminUser(user) && user.unitId) {
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
    await service.assertMayManageLeave(req.user!, leave);
    res.json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function createLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createLeaveSchema.parse(req.body);
    const user = req.user!;

    // Auto-fill the applicant when creating for self. One person is one Staff
    // identity, so a guru's leave is filed against their Staff row too.
    if (!data.staffId && !data.teacherId) {
      data.staffId = await service.resolveStaffIdForUser(user.sub);
    }
    // Filing for someone else is an admin action, and an admin stays in their unit.
    await service.assertMayManageLeave(user, {
      staffId: data.staffId ?? null,
      teacherId: data.teacherId ?? null,
    });

    const leave = await service.createLeave(data);
    res.status(201).json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function updateLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateLeaveSchema.parse(req.body);
    const existing = await service.getLeaveById(req.params.id);
    if (!existing) throw Errors.notFound('Leave request not found');
    await service.assertMayManageLeave(req.user!, existing);
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
    const existing = await service.getLeaveById(req.params.id);
    if (!existing) throw Errors.notFound('Leave request not found');
    await service.assertMayManageLeave(req.user!, existing);
    const leave = await service.approveLeave(req.params.id, approverId, data);
    res.json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
}

export async function cancelLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await service.getLeaveById(req.params.id);
    if (!existing) throw Errors.notFound('Leave request not found');
    await service.assertMayManageLeave(req.user!, existing);
    const leave = await service.cancelLeave(req.params.id);
    res.json({ success: true, data: leave, message: 'Leave request cancelled' });
  } catch (error) {
    next(error);
  }
}

export async function deleteLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await service.getLeaveById(req.params.id);
    if (!existing) throw Errors.notFound('Leave request not found');
    await service.assertMayManageLeave(req.user!, existing);
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
    const target = await service.leaveStaffId({ staffId: req.params.staffId });
    await service.assertMayManageStaff(req.user!, target);
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
