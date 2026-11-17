import { Router } from 'express';
import { UserRole, RoleCode } from '@prisma/client';
import * as controller from './analytics.controller';
import * as forecastController from './forecast.controller';
import * as exportController from './export.controller';
import { authenticate, authorize, isStaffMember } from '@/middleware/auth';
import { PRINCIPAL_ROLE_CODES } from '@cipansor/shared';

const router = Router();

// All routes require authentication
router.use(authenticate);

// School statistics, finance, risk registers and exports are staff business.
// Until 2026-09-24 any signed-in account could read them — a santri account
// exported 164 santri and 1,271 invoices from /export/*.
router.use(isStaffMember);

// The exports are the full rows (santri identity, invoices), so they are for
// the people who answer for them: Super Admin, the unit's admin unit and the
// yayasan board, and the kepala sekolah. A unit's account exports its own unit.
const exporter = authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, ...PRINCIPAL_ROLE_CODES);

// Roles allowed to view forecast/projection data. Forecasts can leak
// strategic information (cash position, projected attrition, etc.) so
// students/parents/teachers must NOT reach these endpoints — only admin
// roles can. Each handler still applies its own unit-level scoping where
// applicable (see e.g. `getCashFlowForecast`).
const forecastViewer = authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN);

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     summary: Get dashboard overview statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics including student count, revenue, attendance, etc.
 */
// Dashboard overview
router.get('/dashboard', controller.getDashboardStats);

/**
 * @swagger
 * /api/analytics/students:
 *   get:
 *     summary: Get student statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student statistics (enrollment, demographics, etc.)
 */
// Domain-specific statistics
router.get('/students', controller.getStudentStats);

/**
 * @swagger
 * /api/analytics/tahfidz:
 *   get:
 *     summary: Get tahfidz statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tahfidz statistics (total juz, progress, achievements)
 */
router.get('/tahfidz', controller.getTahfidzStats);

/**
 * @swagger
 * /api/analytics/finance:
 *   get:
 *     summary: Get finance statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
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
 *     responses:
 *       200:
 *         description: Finance statistics (revenue, payments, outstanding)
 */
router.get('/finance', controller.getFinanceStats);

/**
 * @swagger
 * /api/analytics/attendance:
 *   get:
 *     summary: Get attendance statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
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
 *     responses:
 *       200:
 *         description: Attendance statistics (rates, trends)
 */
router.get('/attendance', controller.getAttendanceStats);

/**
 * @swagger
 * /api/analytics/academic:
 *   get:
 *     summary: Get academic statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Academic statistics (grades, performance)
 */
router.get('/academic', controller.getAcademicStats);

/**
 * @swagger
 * /api/analytics/library:
 *   get:
 *     summary: Get library statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Library statistics (borrowings, popular books)
 */
router.get('/library', controller.getLibraryStats);

/**
 * @swagger
 * /api/analytics/psb:
 *   get:
 *     summary: Get PSB (admissions) statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: periodId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PSB statistics (applications, admissions rate)
 */
router.get('/psb', controller.getPSBStats);

/**
 * @swagger
 * /api/analytics/grc:
 *   get:
 *     summary: Get GRC (Governance, Risk, Compliance) statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: GRC statistics (plans, risks, audits, sharia compliance)
 */
router.get('/grc', controller.getGRCStats);

/**
 * @swagger
 * /api/analytics/grc/risk-matrix:
 *   get:
 *     summary: Get inherent vs residual 5x5 risk matrices
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Risk counts per likelihood x impact cell
 */
router.get('/grc/risk-matrix', controller.getRiskMatrix);

/**
 * @swagger
 * /api/analytics/parent-engagement:
 *   get:
 *     summary: Get parent engagement statistics
 *     description: Active-parent rate, message responsiveness, weekly portal activity, per-class breakdown and low-engagement parents. Contains parent PII, so admin roles only.
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Parent engagement statistics
 */
router.get(
  '/parent-engagement',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.getParentEngagementStats
);

// ============================================
// FORECAST ENDPOINTS (Predictive Analytics)
// ============================================

/**
 * @swagger
 * /api/analytics/forecast:
 *   get:
 *     summary: Get all forecasts summary
 *     tags: [Analytics - Forecast]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Combined forecasts for enrollment, payment, outstanding, and tahfidz
 */
router.get('/forecast', forecastViewer, forecastController.getAllForecasts);

/**
 * @swagger
 * /api/analytics/forecast/enrollment:
 *   get:
 *     summary: Get enrollment forecast
 *     tags: [Analytics - Forecast]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Enrollment prediction for next 6 months
 */
router.get('/forecast/enrollment', forecastViewer, forecastController.getEnrollmentForecast);

/**
 * @swagger
 * /api/analytics/forecast/payment:
 *   get:
 *     summary: Get payment forecast
 *     tags: [Analytics - Forecast]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment prediction for next 6 months
 */
router.get('/forecast/payment', forecastViewer, forecastController.getPaymentForecast);

/**
 * @swagger
 * /api/analytics/forecast/outstanding:
 *   get:
 *     summary: Get outstanding payment prediction
 *     tags: [Analytics - Forecast]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Outstanding payment risk analysis
 */
router.get('/forecast/outstanding', forecastViewer, forecastController.getOutstandingPrediction);

/**
 * @swagger
 * /api/analytics/forecast/tahfidz:
 *   get:
 *     summary: Get tahfidz completion forecast
 *     tags: [Analytics - Forecast]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tahfidz completion projection
 */
router.get('/forecast/tahfidz', forecastViewer, forecastController.getTahfidzForecast);

/**
 * @swagger
 * /api/analytics/forecast/cash-flow:
 *   get:
 *     summary: Get 6-month cash flow forecast
 *     tags: [Analytics - Forecast]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Monthly projected income vs outflow with overdue receivables
 */
router.get('/forecast/cash-flow', forecastViewer, forecastController.getCashFlowForecast);

// ============================================
// EXPORT ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/analytics/export/all:
 *   get:
 *     summary: Export comprehensive data
 *     tags: [Analytics - Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
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
 *     responses:
 *       200:
 *         description: Complete export of students, attendance, finance, tahfidz
 */
router.get('/export/all', exporter, exportController.exportAll);

/**
 * @swagger
 * /api/analytics/export/students:
 *   get:
 *     summary: Export students data
 *     tags: [Analytics - Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *     responses:
 *       200:
 *         description: Students data export
 */
router.get('/export/students', exporter, exportController.exportStudents);

/**
 * @swagger
 * /api/analytics/export/attendance:
 *   get:
 *     summary: Export attendance data
 *     tags: [Analytics - Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *     responses:
 *       200:
 *         description: Attendance data export
 */
router.get('/export/attendance', exporter, exportController.exportAttendance);

/**
 * @swagger
 * /api/analytics/export/finance:
 *   get:
 *     summary: Export finance data
 *     tags: [Analytics - Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *     responses:
 *       200:
 *         description: Finance data export
 */
router.get('/export/finance', exporter, exportController.exportFinance);

/**
 * @swagger
 * /api/analytics/export/tahfidz:
 *   get:
 *     summary: Export tahfidz data
 *     tags: [Analytics - Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *     responses:
 *       200:
 *         description: Tahfidz data export
 */
router.get('/export/tahfidz', exporter, exportController.exportTahfidz);

// ============================================
// BENCHMARK ENDPOINTS (Comparative Analytics)
// ============================================

import * as benchmarkController from './benchmark.controller';

/**
 * @swagger
 * /api/analytics/benchmark:
 *   get:
 *     summary: Get benchmark summary
 *     tags: [Analytics - Benchmark]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Top performers and overall averages
 */
router.get('/benchmark', benchmarkController.getBenchmarkSummary);

/**
 * @swagger
 * /api/analytics/benchmark/compare:
 *   get:
 *     summary: Compare performance across units
 *     tags: [Analytics - Benchmark]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unit comparison data
 */
router.get('/benchmark/compare', benchmarkController.compareUnits);

/**
 * @swagger
 * /api/analytics/benchmark/rankings:
 *   get:
 *     summary: Get unit rankings
 *     tags: [Analytics - Benchmark]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rankings by metric
 */
router.get('/benchmark/rankings', benchmarkController.getUnitRankings);

/**
 * @swagger
 * /api/analytics/benchmark/yoy/{unitId}:
 *   get:
 *     summary: Year-over-year comparison
 *     tags: [Analytics - Benchmark]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: YoY comparison for unit
 */
router.get('/benchmark/yoy/:unitId', benchmarkController.getYearOverYear);

export default router;
