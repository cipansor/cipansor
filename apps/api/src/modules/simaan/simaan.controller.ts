import { Request, Response, NextFunction } from 'express';
import { simaanService } from './simaan.service';
import { ApiResponse } from '@/utils/response';
import { assertStudentInScope } from '@/utils/student-scope';
import { requireUser } from '@/middleware/auth';
import type { WriteActor } from '@/utils/write-scope';

// ============================================
// Simaan Controllers
// ============================================

/** The write actor a service scopes a write on, from the verified token. */
function actorOf(req: Request): WriteActor {
  const u = requireUser(req);
  return { sub: u.sub, roleCode: u.roleCode, unitId: u.unitId };
}

export const listSimaan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // `validateQuery` parks the parsed result in `res.locals.validatedQuery`
    // (Express 5 makes `req.query` read-only). Reading `req.query` directly
    // discarded the schema's page=1/limit=20 defaults, so a call that omitted
    // `page` computed `skip: NaN` and Prisma answered with a 500.
    const query = (res.locals.validatedQuery || req.query) as any;
    const result = await simaanService.findAll(query, req.user!);
    res.json(
      ApiResponse.paginated(
        result.records,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total
      )
    );
  } catch (error) {
    next(error);
  }
};

export const getSimaanById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const record = await simaanService.findById(id, req.user!);
    res.json(ApiResponse.success(record));
  } catch (error) {
    next(error);
  }
};

export const createSimaan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await simaanService.create(req.body, actorOf(req));
    res.status(201).json(ApiResponse.success(record, 'Simaan exam created successfully'));
  } catch (error) {
    next(error);
  }
};

export const updateSimaan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const record = await simaanService.update(id, req.body, actorOf(req));
    res.json(ApiResponse.success(record, 'Simaan exam updated successfully'));
  } catch (error) {
    next(error);
  }
};

export const deleteSimaan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await simaanService.delete(id, actorOf(req));
    res.json(ApiResponse.success(result));
  } catch (error) {
    next(error);
  }
};

export const addExaminer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const examiner = await simaanService.addExaminer(req.body, actorOf(req));
    res.status(201).json(ApiResponse.success(examiner, 'Examiner added successfully'));
  } catch (error) {
    next(error);
  }
};

export const updateExaminer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const examiner = await simaanService.updateExaminer(id, req.body, actorOf(req));
    res.json(ApiResponse.success(examiner, 'Examiner updated successfully'));
  } catch (error) {
    next(error);
  }
};

export const deleteExaminer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await simaanService.deleteExaminer(id, actorOf(req));
    res.json(ApiResponse.success(result));
  } catch (error) {
    next(error);
  }
};

export const submitScores = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await simaanService.submitScores(req.body, actorOf(req));
    res.json(ApiResponse.success(record, 'Scores submitted successfully'));
  } catch (error) {
    next(error);
  }
};

export const getStudentSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studentId } = req.params;
    // The summary is about one santri, taken from the URL: refuse one out of
    // the caller's reach (404, so the answer does not confirm the id) before
    // reading their exam scores and juz coverage.
    await assertStudentInScope(studentId, req.user!);
    // The URL's `studentId` must win over `req.query`: `{ studentId, ...req.query }`
    // let a `?studentId=<other>` replace the id that was just scope-checked, so a
    // santri could read another santri's scores and juz coverage (#954). Same
    // order as `murojaah`/`wallet` — spread the query, then pin the path value.
    const query = { ...req.query, studentId } as any;
    const summary = await simaanService.getStudentSummary(query);
    res.json(ApiResponse.success(summary));
  } catch (error) {
    next(error);
  }
};

export const getHalaqohRecords = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { halaqohId } = req.params;
    const query = { halaqohId, ...req.query } as any;
    const result = await simaanService.getHalaqohRecords(query, req.user!);
    res.json(ApiResponse.success(result));
  } catch (error) {
    next(error);
  }
};

export const getUpcomingExams = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const halaqohId = req.query.halaqohId as string | undefined;
    const days = req.query.days ? parseInt(req.query.days as string) : 7;
    const exams = await simaanService.getUpcomingExams(req.user!, halaqohId, days);
    res.json(ApiResponse.success(exams));
  } catch (error) {
    next(error);
  }
};
