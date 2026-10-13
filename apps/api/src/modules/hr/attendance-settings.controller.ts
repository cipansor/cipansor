import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { todayWib } from '../../utils/wib';
import * as service from './hr.service';
import { Errors } from '../../middleware/error';
import {
  selfAttendanceSchema,
  attendanceSiteSchema,
  workShiftSchema,
  shiftAssignmentSchema,
  shiftRotationSchema,
  workWeekConfigSchema,
  attendancePolicySchema,
  attendanceExemptionSchema,
  payrollPolicyRuleSchema,
  payrollGuardConfigSchema,
  retentionPolicySchema,
  leaveTypeConfigSchema,
} from './hr.schema';

// =====================================
// SELF ATTENDANCE
// =====================================

/**
 * Resolve the caller's own Staff row for self-service attendance. A guru's
 * Staff row is reached through `teachers.staff_id`; the lookup itself is the
 * service's job, not the controller's.
 */
const resolveSelfStaffId = (req: Request) => service.resolveStaffIdForUser(req.user!.sub);

/**
 * Whose attendance this write is for. A caller may only name another staff
 * member when they administer the unit; everyone else is pinned to their own
 * row. Without this the endpoint is an open invitation to punch a colleague in
 * from anywhere.
 */
async function resolveTargetStaffId(req: Request, requested?: string): Promise<string> {
  if (!requested) return resolveSelfStaffId(req);
  return service.resolveDelegatedStaffId(req.user!, requested);
}

export async function selfCheckIn(req: Request, res: Response, next: NextFunction) {
  try {
    const data = selfAttendanceSchema.parse(req.body);
    const staffId = await resolveTargetStaffId(req, data.staffId);
    const result = await service.selfCheckIn({ ...data, staffId, actorUserId: req.user!.sub });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function selfCheckOut(req: Request, res: Response, next: NextFunction) {
  try {
    const data = selfAttendanceSchema.parse(req.body);
    const staffId = await resolveTargetStaffId(req, data.staffId);
    const result = await service.selfCheckOut({ ...data, staffId, actorUserId: req.user!.sub });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function getMyAttendanceToday(req: Request, res: Response, next: NextFunction) {
  try {
    // No staff record is an answer, not an error: the page tells the employee
    // whom to ask instead of showing greyed-out buttons with no reason.
    const staffId = await service.findStaffIdForUser(req.user!.sub);
    const day = todayWib();
    const data = staffId
      ? await service.getMyAttendance(staffId, day)
      : service.noStaffProfileToday(day);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** Keep a selfie the caller just took; the punch then names it by reference. */
export async function uploadPunchPhoto(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw Errors.badRequest('Foto absen belum dipilih');
    const data = await service.storePunchPhoto(req.user!.sub, req.file);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** One punch's selfie, for the person in it or an admin of their unit. */
export async function getPunchPhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const photo = await service.readPunchPhoto(req.params.id, req.user!);
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.buffer);
  } catch (error) {
    next(error);
  }
}

export async function getWorkCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      month: z.coerce.number().min(1).max(12),
      year: z.coerce.number().min(2000).max(2100),
      unitId: z.string().uuid().optional(),
    });
    const { month, year, unitId } = schema.parse(req.query);
    const scoped = service.scopedUnitId(req.user!, unitId ?? null);
    const data = await service.getWorkCalendar(month, year, scoped);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// =====================================
// SETTINGS — sites, shifts, work week, policy, exemptions
// =====================================

function scoped(req: Request): string | null {
  const requested = (req.query.unitId as string | undefined) ?? null;
  return service.scopedUnitId(req.user!, requested);
}

export async function listAttendanceSites(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listAttendanceSites(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function createAttendanceSite(req: Request, res: Response, next: NextFunction) {
  try {
    const data = attendanceSiteSchema.parse(req.body);
    const unitId = service.scopedUnitId(req.user!, data.unitId ?? null);
    const site = await service.createAttendanceSite({ ...data, unitId });
    res.status(201).json({ success: true, data: site });
  } catch (error) {
    next(error);
  }
}

export async function updateAttendanceSite(req: Request, res: Response, next: NextFunction) {
  try {
    const data = attendanceSiteSchema.partial().parse(req.body);
    res.json({
      success: true,
      data: await service.updateAttendanceSite(req.params.id, data, scoped(req)),
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteAttendanceSite(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteAttendanceSite(req.params.id, scoped(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function listWorkShifts(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listWorkShifts(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function createWorkShift(req: Request, res: Response, next: NextFunction) {
  try {
    const data = workShiftSchema.parse(req.body);
    const unitId = service.scopedUnitId(req.user!, data.unitId ?? null);
    res
      .status(201)
      .json({ success: true, data: await service.createWorkShift({ ...data, unitId }) });
  } catch (error) {
    next(error);
  }
}

export async function updateWorkShift(req: Request, res: Response, next: NextFunction) {
  try {
    const data = workShiftSchema.partial().parse(req.body);
    res.json({
      success: true,
      data: await service.updateWorkShift(req.params.id, data, scoped(req)),
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteWorkShift(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteWorkShift(req.params.id, scoped(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function listShiftAssignments(req: Request, res: Response, next: NextFunction) {
  try {
    const staffId = req.query.staffId as string | undefined;
    res.json({ success: true, data: await service.listShiftAssignments(staffId, scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function createShiftAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = shiftAssignmentSchema.parse(req.body);
    res
      .status(201)
      .json({ success: true, data: await service.createShiftAssignment(data, scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function deleteShiftAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteShiftAssignment(req.params.id, scoped(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function listShiftRotations(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listShiftRotations(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function createShiftRotation(req: Request, res: Response, next: NextFunction) {
  try {
    const data = shiftRotationSchema.parse(req.body);
    res.status(201).json({
      success: true,
      data: await service.createShiftRotation(
        {
          ...data,
          startDate: new Date(data.startDate),
          endDate: data.endDate ? new Date(data.endDate) : null,
        },
        scoped(req)
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateShiftRotation(req: Request, res: Response, next: NextFunction) {
  try {
    const data = shiftRotationSchema.partial().parse(req.body);
    res.json({
      success: true,
      data: await service.updateShiftRotation(
        req.params.id,
        {
          ...data,
          startDate: data.startDate ? new Date(data.startDate) : undefined,
          endDate: data.endDate ? new Date(data.endDate) : undefined,
        },
        scoped(req)
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteShiftRotation(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteShiftRotation(req.params.id, scoped(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function listWorkWeekConfigs(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listWorkWeekConfigs(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function upsertWorkWeekConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const data = workWeekConfigSchema.parse(req.body);
    const unitId = service.scopedUnitId(req.user!, data.unitId ?? null);
    res.json({
      success: true,
      data: await service.upsertWorkWeekConfig(
        { ...data, unitId },
        service.scopedUnitId(req.user!, null)
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function listAttendancePolicies(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listAttendancePolicies(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function upsertAttendancePolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const data = attendancePolicySchema.parse(req.body);
    const unitId = service.scopedUnitId(req.user!, data.unitId ?? null);
    res.json({
      success: true,
      data: await service.upsertAttendancePolicy(
        { ...data, unitId },
        service.scopedUnitId(req.user!, null)
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function listAttendanceExemptions(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listAttendanceExemptions(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function createAttendanceExemption(req: Request, res: Response, next: NextFunction) {
  try {
    const data = attendanceExemptionSchema.parse(req.body);
    res
      .status(201)
      .json({ success: true, data: await service.createAttendanceExemption(data, scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function deleteAttendanceExemption(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteAttendanceExemption(req.params.id, scoped(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

// =====================================
// PAYROLL POLICY
// =====================================

export async function listPayrollPolicyRules(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listPayrollPolicyRules(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function upsertPayrollPolicyRule(req: Request, res: Response, next: NextFunction) {
  try {
    const data = payrollPolicyRuleSchema.parse(req.body);
    const unitId = service.scopedUnitId(req.user!, data.unitId ?? null);
    const rule = await service.upsertPayrollPolicyRule(
      req.params.id === 'new' ? null : req.params.id,
      {
        ...data,
        tiersJson: data.tiersJson as Prisma.InputJsonValue | undefined,
        unitId,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      },
      service.scopedUnitId(req.user!, null)
    );
    res.json({ success: true, data: rule });
  } catch (error) {
    next(error);
  }
}

export async function deletePayrollPolicyRule(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deletePayrollPolicyRule(req.params.id, scoped(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function getPayrollGuardConfig(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.getPayrollGuardConfig(scoped(req)) });
  } catch (error) {
    next(error);
  }
}

export async function upsertPayrollGuardConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const data = payrollGuardConfigSchema.parse(req.body);
    const unitId = service.scopedUnitId(req.user!, data.unitId ?? null);
    res.json({
      success: true,
      data: await service.upsertPayrollGuardConfig(
        { ...data, unitId },
        service.scopedUnitId(req.user!, null)
      ),
    });
  } catch (error) {
    next(error);
  }
}

// =====================================
// RETENTION & LEAVE CONFIG
// =====================================

export async function listRetentionPolicies(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listRetentionPolicies() });
  } catch (error) {
    next(error);
  }
}

export async function upsertRetentionPolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const data = retentionPolicySchema.parse(req.body);
    res.json({ success: true, data: await service.upsertRetentionPolicy(data) });
  } catch (error) {
    next(error);
  }
}

export async function listLeaveTypeConfigs(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await service.listLeaveTypeConfigs() });
  } catch (error) {
    next(error);
  }
}

export async function upsertLeaveTypeConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const data = leaveTypeConfigSchema.parse(req.body);
    res.json({ success: true, data: await service.upsertLeaveTypeConfig(data) });
  } catch (error) {
    next(error);
  }
}
