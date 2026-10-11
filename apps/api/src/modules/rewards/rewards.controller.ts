import { Request, Response, NextFunction } from 'express';
import * as rewardService from './rewards.service';
import { createRewardSchema, updateRewardSchema, queryRewardSchema } from './rewards.schema';
import { Errors } from '../../middleware/error';
import { requireUser } from '../../middleware/auth';
import type { ScopeActor } from '../../utils/student-scope';

/** The verified token, reduced to what decides which santri a read may reach. */
function actor(req: Request): ScopeActor {
  const user = requireUser(req);
  return { sub: user.sub, roleCode: user.roleCode, unitId: user.unitId };
}

export async function createReward(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createRewardSchema.parse(req.body);
    const userId = req.user?.sub;

    if (!userId) {
      throw Errors.unauthorized();
    }

    const reward = await rewardService.createReward(data, userId, actor(req));
    res.status(201).json({
      success: true,
      message: 'Reward recorded successfully',
      data: reward,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRewards(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryRewardSchema.parse(res.locals.validatedQuery || req.query);
    const result = await rewardService.getRewards(query, actor(req));
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRewardById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const reward = await rewardService.getRewardById(id, actor(req));
    if (!reward) {
      throw Errors.notFound('Reward');
    }
    res.json({
      success: true,
      data: reward,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateReward(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateRewardSchema.parse(req.body);
    const reward = await rewardService.updateReward(id, data, actor(req));
    if (!reward) throw Errors.notFound('Reward');
    res.json({
      success: true,
      message: 'Reward updated successfully',
      data: reward,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteReward(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const removed = await rewardService.deleteReward(id, actor(req));
    if (!removed) throw Errors.notFound('Reward');
    res.json({
      success: true,
      message: 'Reward deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function getStudentRewardSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId } = req.params;
    const summary = await rewardService.getStudentRewardSummary(studentId, actor(req));
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
}

export async function getStudentPointBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId } = req.params;
    const balance = await rewardService.getStudentPointBalance(studentId, actor(req));
    res.json({
      success: true,
      data: balance,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRewardCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await rewardService.getRewardCategories(actor(req));
    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRewardCategoryById(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await rewardService.getRewardCategoryById(req.params.id, actor(req));
    if (!category) throw Errors.notFound('Reward category');
    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTopStudentsByPoints(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const topStudents = await rewardService.getTopStudentsByPoints(actor(req), limit);
    res.json({
      success: true,
      data: topStudents,
    });
  } catch (error) {
    next(error);
  }
}
