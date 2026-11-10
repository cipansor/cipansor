import { Router } from 'express';
import * as controller from './health.controller';
import { authenticate, hasPermission } from '../../middleware/auth';
import { PERMISSIONS } from '../roles/permissions';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Reading needs HEALTH_VIEW, anything else HEALTH_MANAGE (the nurse, the unit
// admin). Until 2026-09-24 there was no check at all: a santri account read
// every santri's diagnosis and could create, edit and delete medical records.
// Wali read their child's health through /parent/children/:id/health, not here.
const viewHealth = hasPermission(PERMISSIONS.HEALTH_VIEW);
const manageHealth = hasPermission(PERMISSIONS.HEALTH_MANAGE);
router.use((req, res, next) => (req.method === 'GET' ? viewHealth : manageHealth)(req, res, next));

// ==================== MEDICAL RECORDS ====================

/**
 * @swagger
 * /api/health/records:
 *   get:
 *     summary: List medical records
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [CHECKUP, ILLNESS, INJURY, VACCINATION]
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
 *         description: List of medical records
 */
router.get('/records', controller.getMedicalRecords);

/**
 * @swagger
 * /api/health/records/{id}:
 *   get:
 *     summary: Get medical record by ID
 *     tags: [Health]
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
 *         description: Medical record details
 */
router.get('/records/:id', controller.getMedicalRecordById);

/**
 * @swagger
 * /api/health/records:
 *   post:
 *     summary: Create medical record
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - studentId
 *               - type
 *               - date
 *             properties:
 *               studentId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [CHECKUP, ILLNESS, INJURY, VACCINATION]
 *               date:
 *                 type: string
 *                 format: date-time
 *               diagnosis:
 *                 type: string
 *               treatment:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Medical record created
 */
router.post('/records', controller.createMedicalRecord);

/**
 * @swagger
 * /api/health/records/{id}:
 *   put:
 *     summary: Update medical record
 *     tags: [Health]
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
 *         description: Medical record updated
 */
router.put('/records/:id', controller.updateMedicalRecord);

/**
 * @swagger
 * /api/health/records/{id}:
 *   delete:
 *     summary: Delete medical record
 *     tags: [Health]
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
 *         description: Medical record deleted
 */
router.delete('/records/:id', controller.deleteMedicalRecord);

/**
 * @swagger
 * /api/health/students/{studentId}/history:
 *   get:
 *     summary: Get student's medical history
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student's complete medical history
 */
router.get('/students/:studentId/history', controller.getStudentMedicalHistory);

// ==================== MEDICATIONS ====================

/**
 * @swagger
 * /api/health/medications:
 *   get:
 *     summary: List medications
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: lowStock
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of medications
 */
router.get('/medications', controller.getMedications);

/**
 * @swagger
 * /api/health/medications/{id}:
 *   get:
 *     summary: Get medication by ID
 *     tags: [Health]
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
 *         description: Medication details
 */
router.get('/medications/:id', controller.getMedicationById);

/**
 * @swagger
 * /api/health/medications:
 *   post:
 *     summary: Add medication
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - unitId
 *             properties:
 *               name:
 *                 type: string
 *               unitId:
 *                 type: string
 *               description:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               minStock:
 *                 type: integer
 *               expiryDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Medication added
 */
router.post('/medications', controller.createMedication);

/**
 * @swagger
 * /api/health/medications/{id}:
 *   put:
 *     summary: Update medication
 *     tags: [Health]
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
 *         description: Medication updated
 */
router.put('/medications/:id', controller.updateMedication);

/**
 * @swagger
 * /api/health/medications/{id}:
 *   delete:
 *     summary: Delete medication
 *     tags: [Health]
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
 *         description: Medication deleted
 */
router.delete('/medications/:id', controller.deleteMedication);

/**
 * @swagger
 * /api/health/medications/{id}/stock:
 *   post:
 *     summary: Add medication stock
 *     tags: [Health]
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
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: integer
 *               expiryDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Stock added
 */
router.post('/medications/:id/stock', controller.addMedicationStock);

// ==================== MEDICATION USAGE ====================

/**
 * @swagger
 * /api/health/usage:
 *   get:
 *     summary: List medication usage logs
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: medicationId
 *         schema:
 *           type: string
 *       - in: query
 *         name: recordId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of medication usage
 */
router.get('/usage', controller.getMedicationUsageLogs);

/**
 * @swagger
 * /api/health/usage:
 *   post:
 *     summary: Log medication usage
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - medicationId
 *               - recordId
 *               - quantity
 *             properties:
 *               medicationId:
 *                 type: string
 *               recordId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usage logged
 */
router.post('/usage', controller.createMedicationUsage);

// ==================== STATISTICS ====================

/**
 * @swagger
 * /api/health/stats/{unitId}:
 *   get:
 *     summary: Get health statistics for unit
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: unitId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Health statistics (visits, common conditions, etc.)
 */
router.get('/stats/:unitId', controller.getHealthStats);

/**
 * @swagger
 * /api/health/summary:
 *   get:
 *     summary: Health statistics across every unit
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Yayasan-wide health summary
 */
router.get('/summary', controller.getHealthSummary);

// ==================== GROWTH RECORDS ====================

/**
 * @swagger
 * /api/health/growth:
 *   post:
 *     summary: Create growth record
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - studentId
 *               - unitId
 *               - recordDate
 *             properties:
 *               studentId:
 *                 type: string
 *               unitId:
 *                 type: string
 *               recordDate:
 *                 type: string
 *                 format: date
 *               weight:
 *                 type: number
 *               height:
 *                 type: number
 *               headCircumference:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Growth record created
 */
router.post('/growth', controller.createGrowthRecord);

/**
 * @swagger
 * /api/health/growth:
 *   get:
 *     summary: Get growth records
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of growth records
 */
router.get('/growth', controller.getGrowthRecords);

/**
 * @swagger
 * /api/health/growth/{id}:
 *   delete:
 *     summary: Delete growth record
 *     tags: [Health]
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
 *         description: Growth record deleted
 */
router.delete('/growth/:id', controller.deleteGrowthRecord);

// ==================== CLINIC (POLIKLINIK) ====================

/**
 * @swagger
 * /api/health/patients:
 *   get:
 *     summary: List external clinic patients
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Register an external clinic patient
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 */
router.get('/patients', controller.getPatients);
router.post('/patients', controller.createPatient);

/**
 * @swagger
 * /api/health/appointments:
 *   get:
 *     summary: List clinic appointments (daily queue)
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Create a clinic appointment with an auto-assigned queue number
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 */
router.get('/appointments', controller.getClinicAppointments);
router.post('/appointments', controller.createClinicAppointment);

/**
 * @swagger
 * /api/health/prescriptions:
 *   get:
 *     summary: List prescriptions
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Create a prescription (doctor = authenticated user)
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 */
router.get('/prescriptions', controller.getPrescriptions);
router.post('/prescriptions', controller.createPrescription);

/**
 * @swagger
 * /api/health/prescriptions/{id}/fulfill:
 *   post:
 *     summary: Fulfill a prescription, decrementing medication stock atomically
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 */
router.post('/prescriptions/:id/fulfill', controller.fulfillPrescription);

export default router;
