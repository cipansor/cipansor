import { Request, Response, NextFunction } from 'express';
import * as ReceptionService from './reception.service';
import { ApiResponse } from '@cipansor/shared';
import { ReceptionStats, GuestBook, StudentVisit, StudentPackage } from '@cipansor/shared';
import { Errors } from '../../middleware/error';
import { isFoundationScopedRole } from '../../utils/resolve-unit-id';

/**
 * Resolve the unit scope for reception operations.
 *
 * Unit staff always use the unit in their own JWT. A *foundation-scoped* role
 * has no unitId — there is no single unit it belongs to — so it names one
 * explicitly. Missing scope is a 400, never a 401, which the web client treats
 * as "session expired" and bounces on.
 *
 * The role check is the point. Without it this read
 * `req.user?.unitId || fromQuery || fromBody`, which trusts the caller's own
 * parameter for *anyone* holding a JWT with no unitId. The comment claimed
 * those are only super admin and yayasan; production says otherwise —
 * BUSINESS_MANAGER and BUSINESS_STAFF are active accounts with no unit and no
 * foundation remit, and could have read any unit's guest book and santri
 * visits by passing ?unitId=. utils/resolve-unit-id.ts states the rule this
 * restores: never let a non-foundation caller choose its own scope.
 *
 * The body is still consulted, unlike resolveUnitId, because the write routes
 * here take their unit from the submitted form. That is safe now only because
 * the source no longer decides anything — the role does.
 */
function requireUnitId(req: Request): string {
  const own = req.user?.unitId;
  if (own) return own;

  if (!isFoundationScopedRole(req.user?.roleCode)) {
    throw Errors.forbidden('Account has no unit assigned');
  }

  const fromQuery = typeof req.query.unitId === 'string' ? req.query.unitId : undefined;
  const fromBody = typeof req.body?.unitId === 'string' ? req.body.unitId : undefined;
  const unitId = fromQuery || fromBody;
  if (!unitId) {
    throw Errors.badRequest('unitId is required (foundation-level accounts must pass ?unitId=)');
  }
  return unitId;
}

// --- Stats ---

export const getStats = async (
  req: Request,
  res: Response<ApiResponse<ReceptionStats>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.getStats(requireUnitId(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// --- Guest Book ---

export const getGuestBooks = async (
  req: Request,
  res: Response<ApiResponse<GuestBook[]>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.getGuestBooks(requireUnitId(req), req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createGuestBook = async (
  req: Request,
  res: Response<ApiResponse<GuestBook>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.createGuestBook(requireUnitId(req), req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updateGuestBook = async (
  req: Request,
  res: Response<ApiResponse<GuestBook>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.updateGuestBook(req.params.id, req.body, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// --- Student Visits ---

export const getStudentVisits = async (
  req: Request,
  res: Response<ApiResponse<StudentVisit[]>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.getStudentVisits(requireUnitId(req), req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createStudentVisit = async (
  req: Request,
  res: Response<ApiResponse<StudentVisit>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.createStudentVisit(requireUnitId(req), req.body, req.user!);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updateStudentVisit = async (
  req: Request,
  res: Response<ApiResponse<StudentVisit>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.updateStudentVisit(req.params.id, req.body, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// --- Packages ---

export const getPackages = async (
  req: Request,
  res: Response<ApiResponse<StudentPackage[]>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.getPackages(requireUnitId(req), req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createPackage = async (
  req: Request,
  res: Response<ApiResponse<StudentPackage>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.createPackage(
      requireUnitId(req),
      req.user!.id,
      req.body,
      req.user!
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updatePackage = async (
  req: Request,
  res: Response<ApiResponse<StudentPackage>>,
  next: NextFunction
) => {
  try {
    const data = await ReceptionService.updatePackage(req.params.id, req.body, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
