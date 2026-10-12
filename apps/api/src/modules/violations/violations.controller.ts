import { Request, Response, NextFunction } from 'express';
import * as violationService from './violations.service';
import {
  createViolationSchema,
  updateViolationSchema,
  queryViolationSchema,
} from './violations.schema';
import { Errors } from '../../middleware/error';
import { requireUser } from '../../middleware/auth';
import type { ScopeActor } from '../../utils/student-scope';

/** The verified token, reduced to what decides which santri a read may reach. */
function actor(req: Request): ScopeActor {
  const user = requireUser(req);
  return { sub: user.sub, roleCode: user.roleCode, unitId: user.unitId };
}

export async function createViolation(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createViolationSchema.parse(req.body);
    const userId = req.user?.sub;

    if (!userId) {
      throw Errors.unauthorized();
    }

    const violation = await violationService.createViolation(data, userId, actor(req));
    res.status(201).json({
      success: true,
      message: 'Violation recorded successfully',
      data: violation,
    });
  } catch (error) {
    next(error);
  }
}

export async function getViolations(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryViolationSchema.parse(res.locals.validatedQuery || req.query);
    const result = await violationService.getViolations(query, actor(req));
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getViolationById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const violation = await violationService.getViolationById(id, actor(req));
    if (!violation) {
      throw Errors.notFound('Violation');
    }
    res.json({
      success: true,
      data: violation,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateViolation(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateViolationSchema.parse(req.body);
    const violation = await violationService.updateViolation(id, data, actor(req));
    if (!violation) throw Errors.notFound('Violation');
    res.json({
      success: true,
      message: 'Violation updated successfully',
      data: violation,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteViolation(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const removed = await violationService.deleteViolation(id, actor(req));
    if (!removed) throw Errors.notFound('Violation');
    res.json({
      success: true,
      message: 'Violation deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function getStudentViolationSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId } = req.params;
    const summary = await violationService.getStudentViolationSummary(studentId, actor(req));
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
}

export async function getViolationCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await violationService.getViolationCategories(actor(req));
    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
}

export async function getViolationCategoryById(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await violationService.getViolationCategoryById(req.params.id, actor(req));
    if (!category) throw Errors.notFound('Violation category');
    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
}
