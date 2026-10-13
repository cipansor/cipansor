import { Request, Response } from 'express';
import { asyncHandler } from '@/middleware/error';
import { ApiResponse } from '@/utils/response';
import * as service from './ibadah.service';
import {
  listTargetsQuerySchema,
  listRecordsQuerySchema,
  leaderboardQuerySchema,
  studentIbadahStatsQuerySchema,
  unitIbadahStatsQuerySchema,
  classIbadahStatsQuerySchema,
  listIslamicEventsQuerySchema,
} from './ibadah.schema';

// ======================
// TARGETS
// ======================

/** GET /api/ibadah/targets */
export const listTargets = asyncHandler(async (req: Request, res: Response) => {
  const query = listTargetsQuerySchema.parse(req.query);
  const result = await service.listTargets(query);
  // Flat paginated envelope so the client gets an array at `.data` (matches every
  // other module); nesting under data.data crashed the page with "reduce is not a
  // function".
  res.json({ success: true, data: result.data, meta: { pagination: result.pagination } });
});

/** GET /api/ibadah/targets/:id */
export const getTarget = asyncHandler(async (req: Request, res: Response) => {
  const target = await service.getTargetById(req.params.id);
  if (!target) {
    return res.status(404).json(ApiResponse.error('Target not found'));
  }
  res.json(ApiResponse.success(target));
});

/** POST /api/ibadah/targets */
export const createTarget = asyncHandler(async (req: Request, res: Response) => {
  const target = await service.createTarget(req.body);
  res.status(201).json(ApiResponse.success(target, 'Target created successfully'));
});

/** PUT /api/ibadah/targets/:id */
export const updateTarget = asyncHandler(async (req: Request, res: Response) => {
  const target = await service.updateTarget(req.params.id, req.body);
  res.json(ApiResponse.success(target, 'Target updated successfully'));
});

/** DELETE /api/ibadah/targets/:id */
export const deleteTarget = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteTarget(req.params.id);
  res.json(ApiResponse.success(null, 'Target deleted successfully'));
});

/** POST /api/ibadah/targets/seed/:unitId */
export const seedTargets = asyncHandler(async (req: Request, res: Response) => {
  const targets = await service.seedDefaultTargets(req.params.unitId);
  res.status(201).json(ApiResponse.success(targets, 'Default targets seeded successfully'));
});

// ======================
// RECORDS
// ======================

/** GET /api/ibadah/records */
export const listRecords = asyncHandler(async (req: Request, res: Response) => {
  const query = listRecordsQuerySchema.parse(req.query);
  const result = await service.listRecords(query, req.user!);
  res.json({ success: true, data: result.data, meta: { pagination: result.pagination } });
});

/** GET /api/ibadah/records/:id */
export const getRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await service.getRecordById(req.params.id, req.user!);
  if (!record) {
    return res.status(404).json(ApiResponse.error('Record not found'));
  }
  res.json(ApiResponse.success(record));
});

/** POST /api/ibadah/records */
export const createRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await service.createRecord(req.body);
  res.status(201).json(ApiResponse.success(record, 'Record created successfully'));
});

/** PUT /api/ibadah/records/:id */
export const updateRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await service.updateRecord(req.params.id, req.body);
  res.json(ApiResponse.success(record, 'Record updated successfully'));
});

/** DELETE /api/ibadah/records/:id */
export const deleteRecord = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteRecord(req.params.id);
  res.json(ApiResponse.success(null, 'Record deleted successfully'));
});

/** POST /api/ibadah/records/bulk */
export const bulkCreateRecords = asyncHandler(async (req: Request, res: Response) => {
  const records = await service.bulkCreateRecords(req.body);
  res.status(201).json(ApiResponse.success(records, 'Records created successfully'));
});

/** POST /api/ibadah/records/verify */
export const verifyRecords = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.verifyRecords(req.user!.sub, req.body);
  res.json(ApiResponse.success(result, 'Records verified successfully'));
});

// ======================
// DAILY CHECK-IN
// ======================

/** POST /api/ibadah/check-in */
export const dailyCheckIn = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.dailyCheckIn(req.body);
  res.json(ApiResponse.success(result, 'Check-in completed successfully'));
});

// ======================
// LEADERBOARD
// ======================

/** GET /api/ibadah/leaderboard */
export const getLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  const query = leaderboardQuerySchema.parse(req.query);
  const result = await service.getLeaderboard(query, req.user!);
  res.json(ApiResponse.success(result));
});

// ======================
// ACHIEVEMENTS (GAMIFICATION)
// ======================

/** GET /api/ibadah/achievements/me */
export const getMyAchievements = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.sub as string;
  const result = await service.getMyAchievements(userId);
  if (!result) {
    return res.status(404).json(ApiResponse.error('No student profile linked to this account'));
  }
  res.json(ApiResponse.success(result));
});

/** GET /api/ibadah/achievements/:studentId */
export const getStudentAchievements = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getStudentAchievementsFor(req.params.studentId, req.user!);
  res.json(ApiResponse.success(result));
});

// ======================
// STATISTICS
// ======================

/** GET /api/ibadah/stats/student */
export const getStudentStats = asyncHandler(async (req: Request, res: Response) => {
  const query = studentIbadahStatsQuerySchema.parse(req.query);
  const result = await service.getStudentIbadahStatsFor(query, req.user!);
  res.json(ApiResponse.success(result));
});

/** GET /api/ibadah/stats/unit */
export const getUnitStats = asyncHandler(async (req: Request, res: Response) => {
  const query = unitIbadahStatsQuerySchema.parse(req.query);
  const result = await service.getUnitIbadahStats(query, req.user!);
  res.json(ApiResponse.success(result));
});

/** GET /api/ibadah/stats/class */
export const getClassStats = asyncHandler(async (req: Request, res: Response) => {
  const query = classIbadahStatsQuerySchema.parse(req.query);
  const result = await service.getClassIbadahStats(query, req.user!);
  res.json(ApiResponse.success(result));
});

// ======================
// ISLAMIC EVENTS
// ======================

/** GET /api/ibadah/events */
export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  const query = listIslamicEventsQuerySchema.parse(req.query);
  const result = await service.listIslamicEvents(query);
  res.json(ApiResponse.success(result));
});

/** GET /api/ibadah/events/:id */
export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await service.getIslamicEventById(req.params.id);
  if (!event) {
    return res.status(404).json(ApiResponse.error('Event not found'));
  }
  res.json(ApiResponse.success(event));
});

/** POST /api/ibadah/events */
export const createEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await service.createIslamicEvent(req.body);
  res.status(201).json(ApiResponse.success(event, 'Event created successfully'));
});

/** PUT /api/ibadah/events/:id */
export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await service.updateIslamicEvent(req.params.id, req.body);
  res.json(ApiResponse.success(event, 'Event updated successfully'));
});

/** DELETE /api/ibadah/events/:id */
export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteIslamicEvent(req.params.id);
  res.json(ApiResponse.success(null, 'Event deleted successfully'));
});
