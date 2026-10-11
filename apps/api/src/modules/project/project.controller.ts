import { Request, Response, NextFunction } from 'express';
import { Errors } from '../../middleware/error';
import * as service from './project.service';
import {
  createProjectSchema,
  updateProjectSchema,
  createProjectTaskSchema,
  updateProjectTaskSchema,
  updateTaskPositionSchema,
  createColumnSchema,
  updateColumnSchema,
} from './project.schema';
import { ProjectStatus } from '@prisma/client';
import { resolveUnitId, seesAllUnits } from '@/utils/resolve-unit-id';

/**
 * Whether the caller may read/modify a project in `unitId`.
 *
 * A project belongs to exactly one unit, but the roles that oversee every unit
 * (the yayasan board, SUPER_ADMIN) carry no `unitId` in their token — the user
 * row has one `unitId` column and the board belongs to none. Comparing
 * `project.unitId !== req.user.unitId` therefore rejected them outright, which
 * is why `/project/[id]` answered 403 "Access denied" for a project that
 * exists. Foundation-scoped roles are allowed through; everyone else stays
 * pinned to their own unit.
 */
function canAccessProject(req: Request, project: { unitId: string } | null): boolean {
  if (!project) return false;
  if (seesAllUnits({ roleCode: req.user?.roleCode, role: req.user?.role })) {
    return true;
  }
  return project.unitId === req.user?.unitId;
}

export async function createProject(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createProjectSchema.parse(req);
    const unitId = data.body.unitId || resolveUnitId(req);

    if (!unitId) {
      throw Errors.badRequest('Unit is required to create a project');
    }

    const project = await service.createProject({
      ...data.body,
      managerId: req.user!.sub,
      unitId: unitId,
    });
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
}

export async function getProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const filter = {
      unitId: resolveUnitId(req),
      status: req.query.status as ProjectStatus,
    };
    const projects = await service.getProjects(filter);
    res.json(projects);
  } catch (error) {
    next(error);
  }
}

export async function getProjectById(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await service.getProjectById(req.params.id);
    if (!project) {
      throw Errors.notFound('Project not found');
    }
    if (!canAccessProject(req, project)) {
      throw Errors.forbidden('Access denied');
    }
    res.json(project);
  } catch (error) {
    next(error);
  }
}

export async function updateProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await service.getProjectById(req.params.id);
    if (!canAccessProject(req, project ?? null)) {
      throw Errors.notFound('Project not found');
    }
    const data = updateProjectSchema.parse(req);
    const updated = await service.updateProject(req.params.id, data.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await service.getProjectById(req.params.id);
    if (!canAccessProject(req, project ?? null)) {
      throw Errors.notFound('Project not found');
    }
    await service.deleteProject(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await service.getProjectById(req.params.projectId);
    if (!canAccessProject(req, project ?? null)) {
      throw Errors.notFound('Project not found');
    }
    const data = createProjectTaskSchema.parse(req);
    const task = await service.createTask(req.params.projectId, data.body, req.user!.sub);
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await service.getTaskById(req.params.taskId);
    if (!task || !canAccessProject(req, task.project)) {
      throw Errors.notFound('Task not found');
    }

    const data = updateProjectTaskSchema.parse(req);
    const updatedTask = await service.updateTask(req.params.taskId, data.body, req.user!.sub);
    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
}

export async function updateTaskPosition(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await service.getTaskById(req.params.taskId);
    if (!task || !canAccessProject(req, task.project)) {
      throw Errors.notFound('Task not found');
    }

    const data = updateTaskPositionSchema.parse(req);

    // Verify target column belongs to the same project
    if (data.body.columnId) {
      const column = await service.getColumnById(data.body.columnId);
      if (!column || column.projectId !== task.projectId) {
        throw Errors.badRequest('Invalid target column');
      }
    }

    const updatedTask = await service.updateTaskPosition(req.params.taskId, data.body);
    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
}

export async function deleteTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await service.getTaskById(req.params.taskId);
    if (!task || !canAccessProject(req, task.project)) {
      throw Errors.notFound('Task not found');
    }

    await service.deleteTask(req.params.taskId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function createColumn(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await service.getProjectById(req.params.projectId);
    if (!canAccessProject(req, project ?? null)) {
      throw Errors.notFound('Project not found');
    }

    const data = createColumnSchema.parse(req);
    const column = await service.createColumn(req.params.projectId, data.body);
    res.status(201).json(column);
  } catch (error) {
    next(error);
  }
}

export async function updateColumn(req: Request, res: Response, next: NextFunction) {
  try {
    const column = await service.getColumnById(req.params.columnId);
    if (!column || !canAccessProject(req, column.project)) {
      throw Errors.notFound('Column not found');
    }

    const data = updateColumnSchema.parse(req);
    const updatedColumn = await service.updateColumn(req.params.columnId, data.body);
    res.json(updatedColumn);
  } catch (error) {
    next(error);
  }
}

export async function deleteColumn(req: Request, res: Response, next: NextFunction) {
  try {
    const column = await service.getColumnById(req.params.columnId);
    if (!column || !canAccessProject(req, column.project)) {
      throw Errors.notFound('Column not found');
    }

    await service.deleteColumn(req.params.columnId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
