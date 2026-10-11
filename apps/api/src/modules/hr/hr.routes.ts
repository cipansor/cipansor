import { Router } from 'express';
import { UserRole } from '@prisma/client';
import * as controller from './hr.controller';
import { departmentController } from './departments.controller';
import { contractController } from './contracts.controller';
import { leaveBalanceController } from './leave-balances.controller';
import { employeeDocumentController } from './employee-documents.controller';
import { employmentHistoryController } from './employment-history.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { z } from 'zod';
import { validateQuery } from '../../middleware/error';
import { validate } from '../../middleware/validate';
import {
  queryStaffAttendanceSchema,
  queryLeaveSchema,
  queryStaffSchema,
  queryTeachersSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
} from './hr.schema';

const router = Router();

router.use(authenticate);

// Employees are a User with a Teacher or Staff row — the list the HR pages
// read. Same admin gate as the other HR mutations; TEACHER/STAFF may read
// their own record (see the `/employees/:userId/*` routes below).
const EMPLOYEE_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.UNIT_ADMIN,
  UserRole.TEACHER,
  UserRole.STAFF,
] as const;

const queryEmployeesSchema = queryTeachersSchema.extend({
  role: z.enum(['TEACHER', 'STAFF']).optional(),
});

// ==================== STAFF ====================

/**
 * @swagger
 * /api/hr/staff:
 *   get:
 *     summary: List staff members
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of staff members
 */
router.get(
  '/staff',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validateQuery(queryStaffSchema),
  controller.getStaffList
);

/**
 * @swagger
 * /api/hr/teachers:
 *   get:
 *     summary: List teachers (for pickers and directories)
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, ON_LEAVE]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated teacher list with user + unit info
 */
router.get(
  '/teachers',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  validateQuery(queryTeachersSchema),
  controller.getTeachers
);

/**
 * @swagger
 * /api/hr/staff/{id}:
 *   get:
 *     summary: Get staff member by ID
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staff member details
 */
router.get(
  '/staff/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.getStaffById
);

// ==================== STAFF ATTENDANCE ====================

/**
 * @swagger
 * /api/hr/attendance:
 *   get:
 *     summary: List staff attendance
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staffId
 *         schema:
 *           type: string
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
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of staff attendance records
 */
router.get(
  '/attendance',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validateQuery(queryStaffAttendanceSchema),
  controller.getStaffAttendance
);

/**
 * @swagger
 * /api/hr/attendance:
 *   post:
 *     summary: Record staff attendance
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - staffId
 *               - date
 *               - status
 *             properties:
 *               staffId:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum: [PRESENT, ABSENT, LATE, LEAVE, SICK]
 *               checkIn:
 *                 type: string
 *                 format: date-time
 *               checkOut:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Attendance recorded
 */
router.post(
  '/attendance',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.createStaffAttendance
);

/**
 * @swagger
 * /api/hr/attendance/bulk:
 *   post:
 *     summary: Record bulk staff attendance
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - date
 *               - records
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     staffId:
 *                       type: string
 *                     status:
 *                       type: string
 *     responses:
 *       201:
 *         description: Bulk attendance recorded
 */
router.post(
  '/attendance/bulk',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.recordBulkAttendance
);

/**
 * @swagger
 * /api/hr/attendance/{id}:
 *   get:
 *     summary: Get attendance record by ID
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attendance record details
 */
router.get(
  '/attendance/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.getStaffAttendanceById
);

/**
 * @swagger
 * /api/hr/attendance/{id}:
 *   put:
 *     summary: Update attendance record
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attendance updated
 */
router.put(
  '/attendance/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.updateStaffAttendance
);

/**
 * @swagger
 * /api/hr/attendance/{id}:
 *   delete:
 *     summary: Delete attendance record
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Attendance deleted
 */
router.delete(
  '/attendance/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.deleteStaffAttendance
);

/**
 * @swagger
 * /api/hr/staff/{staffId}/attendance/summary:
 *   get:
 *     summary: Get staff attendance summary
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staffId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Staff attendance summary (present, absent, late counts)
 */
router.get(
  '/staff/:staffId/attendance/summary',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.STAFF),
  controller.getStaffAttendanceSummary
);

// ==================== LEAVES ====================

/**
 * @swagger
 * /api/hr/leaves:
 *   get:
 *     summary: List leave requests
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staffId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [ANNUAL, SICK, PERSONAL, MATERNITY, PATERNITY]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of leave requests
 */
router.get(
  '/leaves',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  validateQuery(queryLeaveSchema),
  controller.getLeaves
);

/**
 * @swagger
 * /api/hr/leaves:
 *   post:
 *     summary: Create leave request
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - startDate
 *               - endDate
 *               - reason
 *             properties:
 *               staffId:
 *                 type: string
 *               teacherId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [ANNUAL, SICK, PERSONAL, MATERNITY, PATERNITY]
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Leave request created
 */
router.post(
  '/leaves',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  controller.createLeave
);

/**
 * @swagger
 * /api/hr/leaves/{id}:
 *   get:
 *     summary: Get leave request by ID
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Leave request details
 */
router.get(
  '/leaves/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  controller.getLeaveById
);

/**
 * @swagger
 * /api/hr/leaves/{id}:
 *   put:
 *     summary: Update leave request
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Leave request updated
 */
router.put(
  '/leaves/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  controller.updateLeave
);

/**
 * @swagger
 * /api/hr/leaves/{id}/approve:
 *   patch:
 *     summary: Approve or reject leave request
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Leave request approved/rejected
 */
router.patch(
  '/leaves/:id/approve',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.approveLeave
);

/**
 * @swagger
 * /api/hr/leaves/{id}/cancel:
 *   patch:
 *     summary: Cancel leave request
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Leave request cancelled
 */
router.patch(
  '/leaves/:id/cancel',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  controller.cancelLeave
);

/**
 * @swagger
 * /api/hr/leaves/{id}:
 *   delete:
 *     summary: Delete leave request
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Leave request deleted
 */
router.delete(
  '/leaves/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.deleteLeave
);

/**
 * @swagger
 * /api/hr/staff/{staffId}/leave-balance:
 *   get:
 *     summary: Get staff leave balance
 *     tags: [HR]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staffId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staff leave balance by type
 */
router.get(
  '/staff/:staffId/leave-balance',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  controller.getLeaveBalance
);

router.get(
  '/analytics/retention-risk',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.getRetentionRisk
);

// ==================== DEPARTMENTS ====================

router.post(
  '/departments',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  departmentController.create
);
router.get(
  '/departments',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  departmentController.findAll
);
router.get(
  '/departments/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  departmentController.findOne
);
router.patch(
  '/departments/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  departmentController.update
);
router.delete(
  '/departments/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  departmentController.delete
);

// ==================== CONTRACTS ====================

router.post(
  '/contracts',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  contractController.create
);
router.get(
  '/contracts',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  contractController.findAll
);
router.get(
  '/contracts/expiring',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  contractController.getExpiring
);
router.get(
  '/contracts/user/:userId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  contractController.findByUser
);
router.patch(
  '/contracts/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  contractController.update
);

// ==================== EMPLOYEES (TEACHER + STAFF) ====================
//
// `/employees/:id` cannot shadow `/employees/:userId/documents` (2 segments vs
// 3), so registration order is free here. The web hooks call exactly these
// paths; the service functions already existed — only the routes were missing,
// which is why every HR page 404'd and rendered an empty roster.
router.get(
  '/employees',
  authorize(...EMPLOYEE_READ_ROLES),
  validateQuery(queryEmployeesSchema),
  controller.getEmployees
);
router.post(
  '/employees',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(createEmployeeSchema),
  controller.createEmployee
);
router.get('/employees/:id', authorize(...EMPLOYEE_READ_ROLES), controller.getEmployeeById);
router.put(
  '/employees/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updateEmployeeSchema),
  controller.updateEmployee
);
router.delete(
  '/employees/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.deleteEmployee
);

// ==================== EMPLOYEE DOCUMENTS ====================

router.get(
  '/employees/:userId/documents',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  employeeDocumentController.findAll
);
router.post(
  '/documents',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  employeeDocumentController.create
);
router.delete(
  '/documents/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  employeeDocumentController.delete
);

// ==================== EMPLOYMENT HISTORY ====================

router.get(
  '/employees/:userId/history',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  employmentHistoryController.findAll
);
router.post(
  '/history',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  employmentHistoryController.create
);

// ==================== LEAVE BALANCES (ENHANCED) ====================

router.get(
  '/leave-balances/user/:userId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  leaveBalanceController.getBalances
);
router.post(
  '/leave-balances/initialize',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  leaveBalanceController.initialize
);
router.patch(
  '/leave-balances/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  leaveBalanceController.update
);

export default router;
