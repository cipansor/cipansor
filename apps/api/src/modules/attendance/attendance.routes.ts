import { Router } from 'express';
import { authenticate, authorize, isAdmin } from '@/middleware/auth';
import { validate, validateQuery, validateParams } from '@/middleware/error';
import * as controller from './attendance.controller';
import {
  ATTENDANCE_RECORDER_ROUTE_ROLE_CODES,
  bulkAttendanceSchema,
  createAttendanceSchema,
  recordFollowUpSchema,
  updateAttendanceSchema,
} from '@cipansor/shared';
import {
  listAttendanceQuerySchema,
  attendanceIdParamSchema,
  attendanceSummaryQuerySchema,
} from './attendance.schema';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Teachers, kepala sekolah and admin units reach the write routes; which
// classes each records is the class's relation to them, in the service
// (attendance.access.ts).
const recorders = authorize(...ATTENDANCE_RECORDER_ROUTE_ROLE_CODES);

/**
 * @swagger
 * /api/attendance/me/classes:
 *   get:
 *     summary: The classes whose daily register the caller takes
 *     description: ALL for the super admin, UNIT for an admin unit, otherwise the current academic year's classes the caller is wali kelas of or teaches in.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ scope: ALL | UNIT | ASSIGNED, unitId, classes }"
 */
router.get('/me/classes', controller.myClasses);

/**
 * @swagger
 * /api/attendance/follow-ups:
 *   get:
 *     summary: The Alpa marks the caller follows up
 *     description: Alpa within the last 7 days with no explanation yet — the santri mukim of the asrama the caller is musyrif of, and the other pupils of the caller's homeroom classes (a santri mukim among them only when no musyrif covers them) — with whom to contact and what was tried.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The open absences, newest first
 */
router.get('/follow-ups', recorders, controller.followUps);

/**
 * @swagger
 * /api/attendance/patterns:
 *   get:
 *     summary: The caller's santri whose attendance shows a pattern now
 *     description: Absent (Alpa, Sakit or Izin) on at least 10% of the days recorded this semester once 10 are recorded, or late 3 times in 30 days — among the caller's homeroom pupils, the santri mukim they are musyrif of, and their unit's pupils for a guru BK.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The santri with a pattern, the most absent first
 */
router.get('/patterns', recorders, controller.patterns);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     summary: List attendance records
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: classId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PRESENT, ABSENT, LATE, SICK, PERMISSION]
 *     responses:
 *       200:
 *         description: List of attendance records
 */
router.get('/', validateQuery(listAttendanceQuerySchema), controller.list);

/**
 * @swagger
 * /api/attendance/summary:
 *   get:
 *     summary: Get attendance summary
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: classId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Attendance summary statistics
 */
router.get('/summary', validateQuery(attendanceSummaryQuerySchema), controller.getSummary);

/**
 * @swagger
 * /api/attendance/calendar/{classId}:
 *   get:
 *     summary: Get attendance calendar for a class (monthly view)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Year (default current year)
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 11
 *         description: Month (0-11)
 *     responses:
 *       200:
 *         description: Monthly attendance calendar with daily stats
 */
router.get('/calendar/:classId', controller.getCalendar);

/**
 * @swagger
 * /api/attendance/{id}:
 *   get:
 *     summary: Get attendance by ID
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Attendance record
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id', validateParams(attendanceIdParamSchema), controller.getById);

/**
 * @swagger
 * /api/attendance:
 *   post:
 *     summary: Record one pupil's day (the class's wali kelas, a teacher with a lesson in it, or its admin unit)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, classId, date, status]
 *             properties:
 *               studentId:
 *                 type: string
 *                 format: uuid
 *               classId:
 *                 type: string
 *                 format: uuid
 *               date:
 *                 type: string
 *                 format: date
 *                 example: '2026-09-27'
 *               status:
 *                 type: string
 *                 enum: [PRESENT, ABSENT, LATE, SICK, EXCUSED]
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Attendance recorded
 */
router.post('/', recorders, validate(createAttendanceSchema), controller.create);

/**
 * @swagger
 * /api/attendance/bulk:
 *   post:
 *     summary: Record a class's day; pupils already recorded that day are updated
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [classId, date, records]
 *             properties:
 *               classId:
 *                 type: string
 *                 format: uuid
 *               date:
 *                 type: string
 *                 format: date
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     studentId:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                       enum: [PRESENT, ABSENT, LATE, SICK, EXCUSED]
 *                     notes:
 *                       type: string
 *     responses:
 *       201:
 *         description: Attendance bulk recorded
 */
router.post('/bulk', recorders, validate(bulkAttendanceSchema), controller.bulkCreate);

/**
 * @swagger
 * /api/attendance/{id}:
 *   patch:
 *     summary: Change one pupil's day (whoever records the class's register)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PRESENT, ABSENT, LATE, SICK, EXCUSED]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Attendance updated
 */
router.patch(
  '/:id',
  recorders,
  validateParams(attendanceIdParamSchema),
  validate(updateAttendanceSchema),
  controller.update
);

/**
 * @swagger
 * /api/attendance/{id}/follow-ups:
 *   post:
 *     summary: Record one contact about an Alpa the caller follows up
 *     description: ILL makes the mark Sakit, EXCUSED makes it Izin, NO_REASON closes it as Alpa, UNREACHABLE leaves it open. 404 for an absence the caller does not follow up; 409 once it is no longer Alpa, is closed, or is older than 7 days.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [channel, outcome]
 *             properties:
 *               channel:
 *                 type: string
 *                 enum: [PHONE, WHATSAPP, IN_PERSON, OTHER]
 *               outcome:
 *                 type: string
 *                 enum: [ILL, EXCUSED, NO_REASON, UNREACHABLE]
 *               note:
 *                 type: string
 *     responses:
 *       201:
 *         description: The absence with its follow-ups
 */
router.post(
  '/:id/follow-ups',
  recorders,
  validateParams(attendanceIdParamSchema),
  validate(recordFollowUpSchema),
  controller.recordFollowUp
);

/**
 * @swagger
 * /api/attendance/{id}:
 *   delete:
 *     summary: Delete an attendance record (an admin unit)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Attendance deleted
 */
router.delete('/:id', isAdmin, validateParams(attendanceIdParamSchema), controller.remove);

export default router;
