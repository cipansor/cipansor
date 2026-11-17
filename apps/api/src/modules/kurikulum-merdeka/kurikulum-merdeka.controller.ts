import { Request, Response, NextFunction } from 'express';
import { studentScope } from '@/utils/student-scope';
import { requireUser } from '@/middleware/auth';
import type { WriteActor } from '@/utils/write-scope';
import * as kurikulumMerdekaService from './kurikulum-merdeka.service';
import {
  listLearningOutcomesQuerySchema,
  getLearningOutcomeByIdSchema,
  createLearningOutcomeSchema,
  updateLearningOutcomeSchema,
  listLearningObjectivesQuerySchema,
  createLearningObjectiveSchema,
  updateLearningObjectiveSchema,
  listTeachingModulesQuerySchema,
  createTeachingModuleSchema,
  updateTeachingModuleSchema,
  getPhaseByIdSchema,
  createPhaseSchema,
  updatePhaseSchema,
  createP5ThemeSchema,
  updateP5ThemeSchema,
  listP5ProjectsQuerySchema,
  getP5ProjectByIdSchema,
  createP5ProjectSchema,
  updateP5ProjectSchema,
  listP5AssessmentsQuerySchema,
  createP5AssessmentSchema,
  updateP5AssessmentSchema,
  listMerdekaAssessmentsQuerySchema,
  getMerdekaAssessmentByIdSchema,
  createMerdekaAssessmentSchema,
  updateMerdekaAssessmentSchema,
  listMerdekaResultsQuerySchema,
  createMerdekaResultSchema,
  updateMerdekaResultSchema,
} from './kurikulum-merdeka.schema';

/** The write actor a service scopes on, from the verified token. */
function actorOf(req: Request): WriteActor {
  const u = requireUser(req);
  return { sub: u.sub, roleCode: u.roleCode, unitId: u.unitId };
}

// ==================== LEARNING PHASES ====================

export async function getPhases(req: Request, res: Response, next: NextFunction) {
  try {
    const phases = await kurikulumMerdekaService.listPhases();

    res.json({
      success: true,
      data: phases,
    });
  } catch (error) {
    next(error);
  }
}

export async function getPhase(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getPhaseByIdSchema.parse(req.params);
    const phase = await kurikulumMerdekaService.getPhaseById(id);

    if (!phase) {
      return res.status(404).json({
        success: false,
        message: 'Learning phase not found',
      });
    }

    res.json({
      success: true,
      data: phase,
    });
  } catch (error) {
    next(error);
  }
}

export async function postPhase(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPhaseSchema.parse(req.body);
    const phase = await kurikulumMerdekaService.createPhase(data);

    res.status(201).json({
      success: true,
      message: 'Learning phase created successfully',
      data: phase,
    });
  } catch (error) {
    next(error);
  }
}

export async function putPhase(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getPhaseByIdSchema.parse(req.params);
    const data = updatePhaseSchema.parse(req.body);
    const phase = await kurikulumMerdekaService.updatePhase(id, data);

    res.json({
      success: true,
      message: 'Learning phase updated successfully',
      data: phase,
    });
  } catch (error) {
    next(error);
  }
}

// ==================== LEARNING OUTCOMES ====================

export async function getLearningOutcomes(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listLearningOutcomesQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listLearningOutcomes(query);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLearningOutcome(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getLearningOutcomeByIdSchema.parse(req.params);
    const outcome = await kurikulumMerdekaService.getLearningOutcomeById(id);

    if (!outcome) {
      return res.status(404).json({
        success: false,
        message: 'Learning outcome not found',
      });
    }

    res.json({
      success: true,
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}

export async function postLearningOutcome(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createLearningOutcomeSchema.parse(req.body);
    const outcome = await kurikulumMerdekaService.createLearningOutcome(data);

    res.status(201).json({
      success: true,
      message: 'Learning outcome created successfully',
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}

export async function putLearningOutcome(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getLearningOutcomeByIdSchema.parse(req.params);
    const data = updateLearningOutcomeSchema.parse(req.body);
    const outcome = await kurikulumMerdekaService.updateLearningOutcome(id, data);

    res.json({
      success: true,
      message: 'Learning outcome updated successfully',
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeLearningOutcome(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getLearningOutcomeByIdSchema.parse(req.params);
    await kurikulumMerdekaService.deleteLearningOutcome(id);

    res.json({
      success: true,
      message: 'Learning outcome deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== LEARNING OBJECTIVES ====================

export async function getLearningObjectives(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listLearningObjectivesQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listLearningObjectives(query);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLearningObjective(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const objective = await kurikulumMerdekaService.getLearningObjectiveById(id);

    if (!objective) {
      return res.status(404).json({
        success: false,
        message: 'Learning objective not found',
      });
    }

    res.json({
      success: true,
      data: objective,
    });
  } catch (error) {
    next(error);
  }
}

export async function postLearningObjective(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createLearningObjectiveSchema.parse(req.body);
    const objective = await kurikulumMerdekaService.createLearningObjective(data);

    res.status(201).json({
      success: true,
      message: 'Learning objective created successfully',
      data: objective,
    });
  } catch (error) {
    next(error);
  }
}

export async function putLearningObjective(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateLearningObjectiveSchema.parse(req.body);
    const objective = await kurikulumMerdekaService.updateLearningObjective(id, data);

    res.json({
      success: true,
      message: 'Learning objective updated successfully',
      data: objective,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeLearningObjective(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await kurikulumMerdekaService.deleteLearningObjective(id);

    res.json({
      success: true,
      message: 'Learning objective deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== TEACHING MODULES ====================

export async function getTeachingModules(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listTeachingModulesQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listTeachingModules(query);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTeachingModule(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const module = await kurikulumMerdekaService.getTeachingModuleById(id);

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Teaching module not found',
      });
    }

    res.json({
      success: true,
      data: module,
    });
  } catch (error) {
    next(error);
  }
}

export async function postTeachingModule(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createTeachingModuleSchema.parse(req.body);
    const module = await kurikulumMerdekaService.createTeachingModule(data);

    res.status(201).json({
      success: true,
      message: 'Teaching module created successfully',
      data: module,
    });
  } catch (error) {
    next(error);
  }
}

export async function putTeachingModule(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateTeachingModuleSchema.parse(req.body);
    const module = await kurikulumMerdekaService.updateTeachingModule(id, data);

    res.json({
      success: true,
      message: 'Teaching module updated successfully',
      data: module,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeTeachingModule(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await kurikulumMerdekaService.deleteTeachingModule(id);

    res.json({
      success: true,
      message: 'Teaching module deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== P5 THEMES ====================

export async function getP5Themes(req: Request, res: Response, next: NextFunction) {
  try {
    const themes = await kurikulumMerdekaService.listP5Themes();

    res.json({
      success: true,
      data: themes,
    });
  } catch (error) {
    next(error);
  }
}

export async function getP5Theme(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const theme = await kurikulumMerdekaService.getP5ThemeById(id);

    if (!theme) {
      return res.status(404).json({
        success: false,
        message: 'P5 theme not found',
      });
    }

    res.json({
      success: true,
      data: theme,
    });
  } catch (error) {
    next(error);
  }
}

export async function postP5Theme(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createP5ThemeSchema.parse(req.body);
    const theme = await kurikulumMerdekaService.createP5Theme(data);

    res.status(201).json({
      success: true,
      message: 'P5 theme created successfully',
      data: theme,
    });
  } catch (error) {
    next(error);
  }
}

export async function putP5Theme(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateP5ThemeSchema.parse(req.body);
    const theme = await kurikulumMerdekaService.updateP5Theme(id, data);

    res.json({
      success: true,
      message: 'P5 theme updated successfully',
      data: theme,
    });
  } catch (error) {
    next(error);
  }
}

// ==================== P5 DIMENSIONS ====================

export async function getP5Dimensions(req: Request, res: Response, next: NextFunction) {
  try {
    const dimensions = kurikulumMerdekaService.getP5Dimensions();

    res.json({
      success: true,
      data: dimensions,
    });
  } catch (error) {
    next(error);
  }
}

// ==================== P5 PROJECTS ====================

export async function getP5Projects(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listP5ProjectsQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listP5Projects(query, actorOf(req));

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getP5Project(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getP5ProjectByIdSchema.parse(req.params);
    const project = await kurikulumMerdekaService.getP5ProjectById(id, studentScope(req.user!));

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'P5 project not found',
      });
    }

    res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

export async function postP5Project(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createP5ProjectSchema.parse(req.body);
    const project = await kurikulumMerdekaService.createP5Project(data);

    res.status(201).json({
      success: true,
      message: 'P5 project created successfully',
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

export async function putP5Project(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getP5ProjectByIdSchema.parse(req.params);
    const data = updateP5ProjectSchema.parse(req.body);
    const project = await kurikulumMerdekaService.updateP5Project(id, data);

    res.json({
      success: true,
      message: 'P5 project updated successfully',
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeP5Project(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getP5ProjectByIdSchema.parse(req.params);
    await kurikulumMerdekaService.deleteP5Project(id);

    res.json({
      success: true,
      message: 'P5 project deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== P5 ASSESSMENTS ====================

export async function getP5Assessments(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listP5AssessmentsQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listP5Assessments(query, studentScope(req.user!));

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getP5Assessment(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const assessment = await kurikulumMerdekaService.getP5AssessmentById(
      id,
      studentScope(req.user!)
    );

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'P5 assessment not found',
      });
    }

    res.json({
      success: true,
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function postP5Assessment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createP5AssessmentSchema.parse(req.body);
    const assessment = await kurikulumMerdekaService.createP5Assessment(data, actorOf(req));

    res.status(201).json({
      success: true,
      message: 'P5 assessment created successfully',
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function putP5Assessment(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateP5AssessmentSchema.parse(req.body);
    const assessment = await kurikulumMerdekaService.updateP5Assessment(id, data, actorOf(req));

    res.json({
      success: true,
      message: 'P5 assessment updated successfully',
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeP5Assessment(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await kurikulumMerdekaService.deleteP5Assessment(id, actorOf(req));

    res.json({
      success: true,
      message: 'P5 assessment deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== MERDEKA ASSESSMENTS ====================

export async function getMerdekaAssessments(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listMerdekaAssessmentsQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listMerdekaAssessments(query, actorOf(req));

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMerdekaAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getMerdekaAssessmentByIdSchema.parse(req.params);
    const assessment = await kurikulumMerdekaService.getMerdekaAssessmentById(
      id,
      studentScope(req.user!)
    );

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Merdeka assessment not found',
      });
    }

    res.json({
      success: true,
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function postMerdekaAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createMerdekaAssessmentSchema.parse(req.body);
    const assessment = await kurikulumMerdekaService.createMerdekaAssessment(data);

    res.status(201).json({
      success: true,
      message: 'Merdeka assessment created successfully',
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function putMerdekaAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getMerdekaAssessmentByIdSchema.parse(req.params);
    const data = updateMerdekaAssessmentSchema.parse(req.body);
    const assessment = await kurikulumMerdekaService.updateMerdekaAssessment(id, data);

    res.json({
      success: true,
      message: 'Merdeka assessment updated successfully',
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeMerdekaAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = getMerdekaAssessmentByIdSchema.parse(req.params);
    await kurikulumMerdekaService.deleteMerdekaAssessment(id);

    res.json({
      success: true,
      message: 'Merdeka assessment deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== MERDEKA ASSESSMENT RESULTS ====================

export async function getMerdekaResults(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listMerdekaResultsQuerySchema.parse(req.query);
    const result = await kurikulumMerdekaService.listMerdekaResults(query, studentScope(req.user!));

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMerdekaResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const result = await kurikulumMerdekaService.getMerdekaResultById(id, studentScope(req.user!));

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Merdeka assessment result not found',
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function postMerdekaResult(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createMerdekaResultSchema.parse(req.body);
    const result = await kurikulumMerdekaService.createMerdekaResult(data, actorOf(req));

    res.status(201).json({
      success: true,
      message: 'Merdeka assessment result created successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function putMerdekaResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = updateMerdekaResultSchema.parse(req.body);
    const result = await kurikulumMerdekaService.updateMerdekaResult(id, data, actorOf(req));

    res.json({
      success: true,
      message: 'Merdeka assessment result updated successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeMerdekaResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await kurikulumMerdekaService.deleteMerdekaResult(id, actorOf(req));

    res.json({
      success: true,
      message: 'Merdeka assessment result deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== SUMMARY ====================

export async function getSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const { unitId, academicYearId } = req.query as { unitId?: string; academicYearId?: string };
    const summary = await kurikulumMerdekaService.getKurikulumMerdekaSummary(
      actorOf(req),
      unitId,
      academicYearId
    );

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
}
