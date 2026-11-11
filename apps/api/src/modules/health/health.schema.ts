import { z } from 'zod';
import { MedicalRecordType, HealthStatus } from '@cipansor/shared';
import { partialUpdateSchema } from '@/lib/partial';

// Medical Record schemas
export const createMedicalRecordSchema = z.object({
  studentId: z.string().uuid(),
  type: z.nativeEnum(MedicalRecordType),
  visitDate: z.coerce.date(),
  complaint: z.string().min(1),
  diagnosis: z.string().optional(),
  treatment: z.string().optional(),
  prescription: z.string().optional(),
  notes: z.string().optional(),
  referredTo: z.string().optional(),
  followUpDate: z.coerce.date().optional(),

  // Extended fields
  status: z.nativeEnum(HealthStatus).optional(),
  temperature: z.number().optional(),
  bloodPressure: z.string().optional(),
  heartRate: z.number().optional(),
  weight: z.number().optional(),
  height: z.number().optional(),

  // Integration flags
  createAttendance: z.boolean().optional(),
  notifyParent: z.boolean().optional(),
});

export const updateMedicalRecordSchema = createMedicalRecordSchema
  .partial()
  .omit({ studentId: true });

export const queryMedicalRecordSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  studentId: z.string().uuid().optional(),
  type: z.nativeEnum(MedicalRecordType).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.nativeEnum(HealthStatus).optional(),
});

// Medication schemas
export const createMedicationSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1).max(255),
  genericName: z.string().optional(),
  type: z.string().min(1).max(50), // tablet, sirup, salep
  dosageForm: z.string().min(1).max(50), // 500mg, 60ml
  quantity: z.number().int().nonnegative().default(0),
  minStock: z.number().int().positive().default(10),
  expiryDate: z.coerce.date().optional(),
  supplier: z.string().optional(),
  notes: z.string().optional(),
});

export const updateMedicationSchema = partialUpdateSchema(createMedicationSchema).omit({
  unitId: true,
});

export const queryMedicationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unitId: z.string().uuid().optional(),
  search: z.string().optional(),
  lowStock: z.coerce.boolean().optional(),
  expired: z.coerce.boolean().optional(),
});

// Medication Usage Log schemas
export const createMedicationUsageSchema = z.object({
  medicationId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1),
});

export const queryMedicationUsageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  medicationId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Growth Record schemas
export const createGrowthRecordSchema = z.object({
  studentId: z.string().uuid(),
  unitId: z.string().uuid(),
  recordDate: z.coerce.date(),
  weight: z.number().positive().optional(),
  height: z.number().positive().optional(),
  headCircumference: z.number().positive().optional(),
  notes: z.string().optional(),
});

export const queryGrowthRecordSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  studentId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

/** The `:id` of a growth record, rejected at the edge before any query runs. */
export const growthIdParamSchema = z.object({
  id: z.string().uuid('Invalid growth record ID format'),
});

/** The `:id` of a medical record, rejected at the edge before any query runs. */
export const medicalRecordIdParamSchema = z.object({
  id: z.string().uuid('Invalid medical record ID format'),
});

/** The `:id` of a medication, rejected at the edge before any query runs. */
export const medicationIdParamSchema = z.object({
  id: z.string().uuid('Invalid medication ID format'),
});

// Clinic (poliklinik) schemas — external patients, appointments, prescriptions
export const createPatientSchema = z.object({
  name: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE']),
  birthDate: z.coerce.date(),
  phone: z.string().optional(),
  address: z.string().optional(),
  userId: z.string().uuid().optional(),
});

export const queryPatientSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

export const createClinicAppointmentSchema = z
  .object({
    unitId: z.string().uuid(),
    patientId: z.string().uuid().optional(),
    studentId: z.string().uuid().optional(),
    appointmentDate: z.coerce.date(),
    complaint: z.string().min(1),
  })
  .refine((d) => d.patientId || d.studentId, {
    message: 'Either patientId or studentId is required',
  });

export const queryClinicAppointmentSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unitId: z.string().uuid().optional(),
  date: z.coerce.date().optional(),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
});

export const createPrescriptionSchema = z
  .object({
    medicalRecordId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    studentId: z.string().uuid().optional(),
    notes: z.string().optional(),
    items: z
      .array(
        z.object({
          medicationId: z.string().uuid(),
          quantity: z.number().int().positive(),
          dosage: z.string().min(1),
          instructions: z.string().optional(),
        })
      )
      .min(1),
  })
  .refine((d) => d.patientId || d.studentId, {
    message: 'Either patientId or studentId is required',
  });

export const queryPrescriptionSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  studentId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'FULFILLED', 'CANCELLED']).optional(),
});

export type CreateMedicalRecordInput = z.infer<typeof createMedicalRecordSchema>;
export type UpdateMedicalRecordInput = z.infer<typeof updateMedicalRecordSchema>;
export type QueryMedicalRecordInput = z.infer<typeof queryMedicalRecordSchema>;
export type CreateMedicationInput = z.infer<typeof createMedicationSchema>;
export type UpdateMedicationInput = z.infer<typeof updateMedicationSchema>;
export type QueryMedicationInput = z.infer<typeof queryMedicationSchema>;
export type CreateMedicationUsageInput = z.infer<typeof createMedicationUsageSchema>;
export type QueryMedicationUsageInput = z.infer<typeof queryMedicationUsageSchema>;
export type CreateGrowthRecordInput = z.infer<typeof createGrowthRecordSchema>;
export type QueryGrowthRecordInput = z.infer<typeof queryGrowthRecordSchema>;
export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type QueryPatientInput = z.infer<typeof queryPatientSchema>;
export type CreateClinicAppointmentInput = z.infer<typeof createClinicAppointmentSchema>;
export type QueryClinicAppointmentInput = z.infer<typeof queryClinicAppointmentSchema>;
export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type QueryPrescriptionInput = z.infer<typeof queryPrescriptionSchema>;
