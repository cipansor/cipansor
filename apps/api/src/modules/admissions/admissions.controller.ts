import { Request, Response } from 'express';
import * as service from './admissions.service';
import {
  createAdmissionPeriodSchema,
  updateAdmissionPeriodSchema,
  createRegistrantSchema,
  createPublicRegistrantSchema,
  updateRegistrantSchema,
  updateRegistrantScoreSchema,
  updateRegistrantStatusSchema,
  recordRegistrationFeeSchema,
  createRegistrantDocumentSchema,
  verifyDocumentSchema,
  trackRegistrantQuerySchema,
} from './admissions.schema';
import { Errors, asyncHandler } from '../../middleware/error';
import { z } from 'zod';
import { nisnSchema } from '@cipansor/shared';
import { requireUser } from '../../middleware/auth';
import { ApiResponse } from '../../utils/response';

// =====================================
// ADMISSION PERIOD CONTROLLERS
// =====================================

export const getAdmissionPeriods = asyncHandler(async (req: Request, res: Response) => {
  const query = res.locals.validatedQuery;
  const result = await service.getAdmissionPeriods(query);
  res.json({ success: true, ...result });
});

/**
 * Public document OCR & AI cross-matching endpoint (`POST /admissions/public/parse-document`).
 * Parses uploaded document images (KTP, KK, etc.) and cross-checks data against user inputs.
 */
export const parsePublicDocument = asyncHandler(async (req: Request, res: Response) => {
  const { parseAndVerifyDocument } = await import('./document-ocr.service');
  const result = await parseAndVerifyDocument(req.body);
  res.json({ success: true, data: result });
});

export const getAdmissionPeriodById = asyncHandler(async (req: Request, res: Response) => {
  const period = await service.getAdmissionPeriodById(req.params.id);
  if (!period) {
    throw Errors.notFound('Admission period');
  }
  res.json({ success: true, data: period });
});

export const createAdmissionPeriod = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = createAdmissionPeriodSchema.parse(req.body);
  const period = await service.createAdmissionPeriod(data, user);
  res.status(201).json({ success: true, data: period });
});

export const updateAdmissionPeriod = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = updateAdmissionPeriodSchema.parse(req.body);
  const period = await service.updateAdmissionPeriod(req.params.id, data, user);
  res.json({ success: true, data: period });
});

export const replaceAdmissionFees = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const items = await service.replaceAdmissionFees(req.params.id, req.body, user);
  res.json({ success: true, data: items });
});

export const deleteAdmissionPeriod = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await service.deleteAdmissionPeriod(req.params.id, user);
  res.json({ success: true, message: 'Admission period deleted successfully' });
});

export const getAdmissionPeriodStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await service.getAdmissionPeriodStats(req.params.id);
  if (!stats) {
    throw Errors.notFound('Admission period');
  }
  res.json({ success: true, data: stats });
});

// =====================================
// REGISTRANT CONTROLLERS
// =====================================

export const getRegistrants = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const query = res.locals.validatedQuery;
  const result = await service.getRegistrants(query, user);
  res.json({ success: true, ...result });
});

export const getRegistrantById = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const registrant = await service.getRegistrantById(req.params.id, user);
  if (!registrant) {
    throw Errors.notFound('Registrant');
  }
  res.json(ApiResponse.success(registrant));
});

export const createRegistrant = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = createRegistrantSchema.parse(req.body);
  const registrant = await service.createRegistrant(data, true, user);
  res.status(201).json({ success: true, data: registrant });
});

export const updateRegistrant = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = updateRegistrantSchema.parse(req.body);
  const registrant = await service.updateRegistrant(req.params.id, data, user);
  res.json(ApiResponse.success(registrant));
});

export const updateRegistrantScore = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = updateRegistrantScoreSchema.parse(req.body);
  const registrant = await service.updateRegistrantScore(req.params.id, data, user);
  res.json(ApiResponse.success(registrant));
});

export const recordRegistrationFee = asyncHandler(async (req: Request, res: Response) => {
  const data = recordRegistrationFeeSchema.parse(req.body);
  const user = requireUser(req);
  const registrant = await service.recordRegistrationFee(req.params.id, data, user.id, user);
  res.json(ApiResponse.success(registrant));
});

export const updateRegistrantStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = updateRegistrantStatusSchema.parse(req.body);
  const registrant = await service.updateRegistrantStatus(req.params.id, data, user);
  res.json(ApiResponse.success(registrant));
});

export const enrollRegistrant = asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({
    nis: z.string().optional(),
    nisn: nisnSchema,
    classId: z.string().optional(),
    roomId: z.string().optional(),
  });
  const user = requireUser(req);
  const data = schema.parse(req.body);
  const result = await service.enrollRegistrant(
    req.params.id,
    {
      nis: data.nis,
      nisn: data.nisn ?? undefined,
      classId: data.classId,
      roomId: data.roomId,
      processedById: user.id,
    },
    user
  );
  res.json(ApiResponse.success(result, 'Registrant enrolled successfully'));
});

export const deleteRegistrant = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await service.deleteRegistrant(req.params.id, user);
  res.json(ApiResponse.success(null, 'Registrant deleted successfully'));
});

// =====================================
// DOCUMENT CONTROLLERS
// =====================================

export const getRegistrantDocuments = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const documents = await service.getRegistrantDocuments(req.params.registrantId, user);
  res.json(ApiResponse.success(documents));
});

export const createRegistrantDocument = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = createRegistrantDocumentSchema.parse({
    ...req.body,
    registrantId: req.params.registrantId,
  });
  const document = await service.createRegistrantDocument(data, user);
  res.status(201).json(ApiResponse.success(document));
});

export const verifyDocument = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = verifyDocumentSchema.parse(req.body);
  const document = await service.verifyDocument(req.params.id, data.isVerified, data.notes, user);
  res.json(ApiResponse.success(document));
});

export const deleteRegistrantDocument = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await service.deleteRegistrantDocument(req.params.id, user);
  res.json(ApiResponse.success(null, 'Document deleted successfully'));
});

// =====================================
// PUBLIC CONTROLLERS (no authentication)
// =====================================

/** GET /admissions/public/intakes — each unit's intake, for the public page. */
export const getPublicIntakes = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await service.findPublicIntakes()));
});

export const createPublicRegistrantDocument = asyncHandler(async (req: Request, res: Response) => {
  const { registrantId } = req.params;
  const { type, url, base64, fileName, registrationToken, ocrNotes, ocrStatus } = req.body;

  const document = await service.createPublicRegistrantDocumentService({
    registrantId,
    type,
    url,
    base64,
    fileName,
    registrationToken,
    ocrNotes,
    ocrStatus,
  });

  res.status(201).json(ApiResponse.success(document));
});

export const createPublicRegistrant = asyncHandler(async (req: Request, res: Response) => {
  const {
    consent: _consent,
    consentVersion,
    ...data
  } = createPublicRegistrantSchema.parse(req.body);
  // `app.set('trust proxy', 1)` is set, so `req.ip` is the client address behind
  // the one trusted proxy (nginx), not the proxy's own — the address the
  // parent's consent actually came from (UU PDP 27/2022 Pasal 21, evidence).
  const result = await service.createPublicRegistrantService(data, {
    version: consentVersion,
    ip: req.ip,
  });
  res.status(201).json({
    success: true,
    data: result,
  });
});

export const trackPublicRegistrantStatus = asyncHandler(async (req: Request, res: Response) => {
  const { registrationNo, birthDate } = trackRegistrantQuerySchema.parse(req.query);

  const registrant = await service.getRegistrantTrackingInfo(registrationNo, birthDate);
  if (!registrant) {
    throw Errors.notFound('Registrant with provided details');
  }

  res.json({ success: true, data: registrant });
});

export const getPriorityLeads = asyncHandler(async (req: Request, res: Response) => {
  const { unitId } = req.query;
  const user = requireUser(req);

  let effectiveUnitId = unitId as string | undefined;
  if (user && user.role !== 'SUPER_ADMIN') {
    if (!user.unitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
    if (effectiveUnitId && effectiveUnitId !== user.unitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
    effectiveUnitId = user.unitId;
  }

  const { getPriorityLeads: getLeads } = await import('./lead-scoring.service');
  const leads = await getLeads(effectiveUnitId);
  res.json({ success: true, data: leads });
});
