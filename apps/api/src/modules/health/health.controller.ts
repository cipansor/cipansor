import type { Request, Response, NextFunction } from 'express';
import * as service from './health.service';
import {
  createMedicalRecordSchema,
  updateMedicalRecordSchema,
  queryMedicalRecordSchema,
  createMedicationSchema,
  updateMedicationSchema,
  queryMedicationSchema,
  createMedicationUsageSchema,
  queryMedicationUsageSchema,
  createGrowthRecordSchema,
  queryGrowthRecordSchema,
  createPatientSchema,
  queryPatientSchema,
  createClinicAppointmentSchema,
  queryClinicAppointmentSchema,
  createPrescriptionSchema,
  queryPrescriptionSchema,
} from './health.schema';
import { Errors } from '../../middleware/error';
import { studentScope } from '@/utils/student-scope';
import {
  MedicalRecordType,
  CreateMedicalRecordInput,
  CreateMedicationInput,
  CreateMedicationUsageInput,
} from '@cipansor/shared';

// ==================== MEDICAL RECORD ====================

export async function getMedicalRecords(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryMedicalRecordSchema.parse(req.query);
    const result = await service.getMedicalRecords(
      {
        ...query,
        // Pass optional status filter if present
        status: req.query.status as string,
      },
      studentScope(req.user!)
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// ==================== GROWTH RECORDS ====================

export async function createGrowthRecord(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createGrowthRecordSchema.parse(req.body);
    const record = await service.createGrowthRecord(data, req.user!.sub);
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
}

export async function getGrowthRecords(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryGrowthRecordSchema.parse(req.query);
    const result = await service.getGrowthRecords(query, studentScope(req.user!));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteGrowthRecord(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteGrowthRecord(req.params.id, studentScope(req.user!));
    res.json({ success: true, message: 'Growth record deleted' });
  } catch (error) {
    next(error);
  }
}

export async function getMedicalRecordById(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await service.getMedicalRecordById(req.params.id, studentScope(req.user!));
    if (!record) {
      throw Errors.notFound('Medical record not found');
    }
    res.json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
}

export async function createMedicalRecord(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createMedicalRecordSchema.parse(req.body);
    const record = await service.createMedicalRecord(
      data as CreateMedicalRecordInput,
      req.user!.sub
    );
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
}

export async function updateMedicalRecord(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateMedicalRecordSchema.parse(req.body);
    const record = await service.updateMedicalRecord(req.params.id, data, studentScope(req.user!));
    res.json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
}

export async function deleteMedicalRecord(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteMedicalRecord(req.params.id, studentScope(req.user!));
    res.json({ success: true, message: 'Medical record deleted' });
  } catch (error) {
    next(error);
  }
}

export async function getStudentMedicalHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const history = await service.getStudentMedicalHistory(
      req.params.studentId,
      studentScope(req.user!)
    );
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
}

// ==================== MEDICATION ====================

export async function getMedications(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryMedicationSchema.parse(req.query);
    const result = await service.getMedications(query);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getMedicationById(req: Request, res: Response, next: NextFunction) {
  try {
    const medication = await service.getMedicationById(req.params.id);
    if (!medication) {
      throw Errors.notFound('Medication not found');
    }
    res.json({ success: true, data: medication });
  } catch (error) {
    next(error);
  }
}

export async function createMedication(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createMedicationSchema.parse(req.body);
    const medication = await service.createMedication(data as CreateMedicationInput);
    res.status(201).json({ success: true, data: medication });
  } catch (error) {
    next(error);
  }
}

export async function updateMedication(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateMedicationSchema.parse(req.body);
    const medication = await service.updateMedication(req.params.id, data);
    res.json({ success: true, data: medication });
  } catch (error) {
    next(error);
  }
}

export async function deleteMedication(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteMedication(req.params.id);
    res.json({ success: true, message: 'Medication deleted' });
  } catch (error) {
    next(error);
  }
}

export async function addMedicationStock(req: Request, res: Response, next: NextFunction) {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0) {
      throw Errors.badRequest('Quantity must be positive');
    }
    const medication = await service.addMedicationStock(req.params.id, quantity);
    res.json({ success: true, data: medication });
  } catch (error) {
    next(error);
  }
}

// ==================== MEDICATION USAGE ====================

export async function getMedicationUsageLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryMedicationUsageSchema.parse(req.query);
    const result = await service.getMedicationUsageLogs(query, studentScope(req.user!));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function createMedicationUsage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createMedicationUsageSchema.parse(req.body);
    const usage = await service.createMedicationUsage(
      data as CreateMedicationUsageInput,
      req.user!.sub
    );
    res.status(201).json({ success: true, data: usage });
  } catch (error) {
    next(error);
  }
}

// ==================== STATISTICS ====================

export async function getHealthStats(req: Request, res: Response, next: NextFunction) {
  try {
    const unitId = req.params.unitId;
    const stats = await service.getHealthStats(unitId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

/**
 * Yayasan-wide health summary. The web app has called GET /api/health/summary
 * from the dashboard and the health page since those pages were written; the
 * route never existed, so both silently rendered empty cards.
 */
export async function getHealthSummary(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await service.getHealthStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

// ==================== CLINIC (POLIKLINIK) ====================

export async function createPatient(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPatientSchema.parse(req.body);
    const patient = await service.createPatient(data);
    res.status(201).json({ success: true, data: patient });
  } catch (error) {
    next(error);
  }
}

export async function getPatients(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryPatientSchema.parse(req.query);
    const result = await service.getPatients(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function createClinicAppointment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createClinicAppointmentSchema.parse(req.body);
    const appointment = await service.createClinicAppointment({
      ...data,
      userId: req.user!.sub,
    });
    res.status(201).json({ success: true, data: appointment });
  } catch (error) {
    next(error);
  }
}

export async function getClinicAppointments(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryClinicAppointmentSchema.parse(req.query);
    const result = await service.getClinicAppointments(query, studentScope(req.user!));
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function createPrescription(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPrescriptionSchema.parse(req.body);
    // The prescribing doctor is always the authenticated user — never
    // taken from the request body.
    const prescription = await service.createPrescription({
      ...data,
      doctorId: req.user!.sub,
    });
    res.status(201).json({ success: true, data: prescription });
  } catch (error) {
    next(error);
  }
}

export async function getPrescriptions(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryPrescriptionSchema.parse(req.query);
    const result = await service.getPrescriptions(query, studentScope(req.user!));
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function fulfillPrescription(req: Request, res: Response, next: NextFunction) {
  try {
    const prescription = await service.fulfillPrescription(req.params.id, req.user!.sub);
    res.json({ success: true, data: prescription });
  } catch (error) {
    next(error);
  }
}
