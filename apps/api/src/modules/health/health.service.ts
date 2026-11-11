import { Prisma } from '@prisma/client';
import { onlyScopedStudents, STUDENT_SAFE_SELECT } from '@/utils/student-scope';
import { prisma } from '../../lib/prisma';
import { attendanceService } from '../attendance/attendance.service';
import { eventBus } from '../../lib/event-bus';
import { logger } from '../../lib/logger';
import type {
  CreateMedicalRecordInput,
  UpdateMedicalRecordInput,
  QueryMedicalRecordInput,
  CreateMedicationInput,
  UpdateMedicationInput,
  QueryMedicationInput,
  CreateMedicationUsageInput,
  QueryMedicationUsageInput,
  MedicalRecord,
  HealthStats,
} from '@cipansor/shared';
import { AttendanceStatus } from '@cipansor/shared';
import { CreateGrowthRecordInput, QueryGrowthRecordInput } from './health.schema';
import { Errors } from '../../middleware/error';

// ==================== MEDICAL RECORD ====================

export async function getMedicalRecords(
  query: QueryMedicalRecordInput & { status?: string },
  scope: Prisma.StudentWhereInput
) {
  const { page = 1, limit = 20, studentId, type, startDate, endDate, status } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.MedicalRecordWhereInput = {
    ...onlyScopedStudents(scope),
    ...(studentId && { studentId }),
    ...(type && { type: type as unknown as import('@prisma/client').MedicalRecordType }),
    ...(startDate &&
      endDate && {
        visitDate: { gte: startDate, lte: endDate },
      }),
    ...(status && { status: status as unknown as import('@prisma/client').HealthStatus }),
  };

  const [data, total] = await Promise.all([
    prisma.medicalRecord.findMany({
      where,
      skip,
      take: limit,
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { visitDate: 'desc' },
    }),
    prisma.medicalRecord.count({ where }),
  ]);

  return {
    success: true,
    data: data.map((record: any) => ({
      ...record,
      student: record.student
        ? {
            id: record.student.id,
            nis: record.student.nis,
            name: record.student?.user?.name,
            user: record.student.user,
            unit: record.student.unit,
          }
        : undefined,
      recordedBy: record.recordedBy,
    })) as MedicalRecord[],
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
}

export async function getMedicalRecordById(id: string, scope: Prisma.StudentWhereInput) {
  const record = await prisma.medicalRecord.findFirst({
    where: { id, ...onlyScopedStudents(scope) },
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          gender: true,
          birthDate: true,
          user: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true } },
        },
      },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  if (!record) return null;

  return {
    ...record,
    student: record.student
      ? {
          id: record.student.id,
          nis: record.student.nis,
          name: record.student?.user?.name,
          user: record.student.user,
          unit: record.student.unit,
        }
      : undefined,
    recordedBy: record.recordedBy,
  } as unknown as MedicalRecord;
}

export async function createMedicalRecord(data: CreateMedicalRecordInput, recordedById: string) {
  const {
    status,
    temperature,
    bloodPressure,
    heartRate,
    weight,
    height,
    createAttendance,
    notifyParent,
    ...mainData
  } = data;

  const record = await prisma.medicalRecord.create({
    data: {
      studentId: mainData.studentId,
      type: mainData.type as unknown as import('@prisma/client').MedicalRecordType,
      visitDate: mainData.visitDate,
      complaint: mainData.complaint,
      diagnosis: mainData.diagnosis,
      treatment: mainData.treatment,
      prescription: mainData.prescription,
      notes: mainData.notes,
      referredTo: mainData.referredTo,
      followUpDate: mainData.followUpDate,
      status: status as unknown as import('@prisma/client').HealthStatus,
      temperature,
      bloodPressure,
      heartRate,
      weight,
      height,
      recordedById,
    },
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          unitId: true,
          unit: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  // Integration: Attendance
  if (createAttendance) {
    try {
      const enrollment = await prisma.classEnrollment.findFirst({
        where: { studentId: mainData.studentId, status: 'active' },
        select: { classId: true },
      });

      if (enrollment) {
        // The visit's own day in WIB; a register the teachers already took
        // that day is left as it is.
        await attendanceService.recordFromIntegration(
          {
            studentId: mainData.studentId,
            classId: enrollment.classId,
            on: new Date(mainData.visitDate),
            status: AttendanceStatus.SICK,
            notes: `Sakit: ${mainData.complaint} (via UKS)`,
          },
          recordedById
        );
      }
    } catch (error) {
      logger.warn('Failed to create attendance from health record:', { error });
    }
  }

  // Integration: Notification
  if (notifyParent) {
    try {
      const parents = await prisma.studentParent.findMany({
        where: { studentId: mainData.studentId },
        include: { parent: true },
      });

      const studentName = record.student?.user?.name || 'Santri';

      parents.forEach((p) =>
        eventBus.emit('notification:send', {
          userId: p.parentId,
          type: 'HEALTH',
          title: 'Laporan Kesehatan Santri',
          message: `Ananda ${studentName} tercatat sakit dengan keluhan: ${mainData.complaint}. Kami telah memberikan penanganan awal.`,
          data: {
            studentId: mainData.studentId,
            healthRecordId: record.id,
          },
        })
      );
    } catch (error) {
      logger.warn('Failed to trigger parent notifications:', { error });
    }
  }

  // Emit Event for other listeners (e.g., Dashboard)
  eventBus.emit('health:medical-record-created', {
    id: record.id,
    studentId: record.studentId || '',
    studentName: record.student?.user?.name || 'Unknown',
    unitId: record.student?.unitId || 'unknown',
    unitName: record.student?.unit?.name || 'Unknown',
    type: record.type,
    complaint: record.complaint,
    status: record.status || 'UNKNOWN',
    recordedAt: record.visitDate instanceof Date ? record.visitDate : new Date(record.visitDate),
  });

  return {
    ...record,
    student: record.student
      ? {
          id: record.student.id,
          nis: record.student.nis,
          name: record.student?.user?.name,
          user: record.student.user,
        }
      : undefined,
  } as unknown as MedicalRecord;
}

/** A record id outside the caller's santri reads as not found, not forbidden. */
async function assertRecordInScope(id: string, scope: Prisma.StudentWhereInput) {
  const found = await prisma.medicalRecord.findFirst({
    where: { id, ...onlyScopedStudents(scope) },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Medical record');
}

export async function updateMedicalRecord(
  id: string,
  data: UpdateMedicalRecordInput,
  scope: Prisma.StudentWhereInput
) {
  await assertRecordInScope(id, scope);
  const { status, temperature, bloodPressure, heartRate, weight, height, ...mainData } = data;

  const record = await prisma.medicalRecord.update({
    where: { id },
    data: {
      ...mainData,
      type: mainData.type
        ? (mainData.type as unknown as import('@prisma/client').MedicalRecordType)
        : undefined,
      status: status ? (status as unknown as import('@prisma/client').HealthStatus) : undefined,
      temperature,
      bloodPressure,
      heartRate,
      weight,
      height,
    },
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          user: { select: { id: true, name: true } },
        },
      },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  return {
    ...record,
    student: record.student
      ? {
          id: record.student.id,
          nis: record.student.nis,
          name: record.student?.user?.name,
          user: record.student.user,
        }
      : undefined,
  } as unknown as MedicalRecord;
}

export async function deleteMedicalRecord(id: string, scope: Prisma.StudentWhereInput) {
  await assertRecordInScope(id, scope);
  return prisma.medicalRecord.delete({ where: { id } });
}

export async function getStudentMedicalHistory(studentId: string, scope: Prisma.StudentWhereInput) {
  const records = await prisma.medicalRecord.findMany({
    where: { studentId, ...onlyScopedStudents(scope) },
    include: {
      recordedBy: { select: { id: true, name: true } },
    },
    orderBy: { visitDate: 'desc' },
  });

  return records as unknown as MedicalRecord[];
}

// ==================== MEDICATION ====================

export async function getMedications(query: QueryMedicationInput) {
  const { page = 1, limit = 20, unitId, search, lowStock, expired } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.MedicationWhereInput = {
    ...(unitId && { unitId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(expired && {
      expiryDate: { lt: new Date() },
    }),
  };

  let [data, total] = await Promise.all([
    prisma.medication.findMany({
      where,
      skip,
      take: limit,
      include: {
        unit: { select: { id: true, name: true } },
        _count: { select: { usageLogs: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.medication.count({ where }),
  ]);

  if (lowStock) {
    data = data.filter((m) => m.quantity <= m.minStock);
    total = data.length;
  }

  return {
    success: true,
    data: data,
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
}

export async function getMedicationById(id: string) {
  return prisma.medication.findUnique({
    where: { id },
    include: {
      unit: { select: { id: true, name: true } },
      usageLogs: {
        take: 10,
        orderBy: { givenAt: 'desc' },
        include: {
          student: {
            select: {
              id: true,
              user: { select: { name: true } },
            },
          },
          givenBy: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function createMedication(data: CreateMedicationInput) {
  return prisma.medication.create({
    data: {
      unitId: data.unitId!,
      name: data.name,
      genericName: data.genericName,
      type: data.type,
      dosageForm: data.dosageForm,
      quantity: data.quantity ?? 0,
      minStock: data.minStock ?? 10,
      expiryDate: data.expiryDate,
      supplier: data.supplier,
      notes: data.notes,
    },
    include: {
      unit: { select: { id: true, name: true } },
    },
  });
}

export async function updateMedication(id: string, data: UpdateMedicationInput) {
  return prisma.medication.update({
    where: { id },
    data,
    include: {
      unit: { select: { id: true, name: true } },
    },
  });
}

export async function deleteMedication(id: string) {
  return prisma.medication.delete({ where: { id } });
}

export async function addMedicationStock(id: string, quantity: number) {
  return prisma.medication.update({
    where: { id },
    data: { quantity: { increment: quantity } },
  });
}

// ==================== MEDICATION USAGE LOG ====================

export async function getMedicationUsageLogs(
  query: QueryMedicationUsageInput,
  scope: Prisma.StudentWhereInput
) {
  const { page = 1, limit = 20, medicationId, studentId, startDate, endDate } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.MedicationUsageLogWhereInput = {
    ...onlyScopedStudents(scope),
    ...(medicationId && { medicationId }),
    ...(studentId && { studentId }),
    ...(startDate &&
      endDate && {
        givenAt: { gte: startDate, lte: endDate },
      }),
  };

  const [data, total] = await Promise.all([
    prisma.medicationUsageLog.findMany({
      where,
      skip,
      take: limit,
      include: {
        medication: { select: { id: true, name: true, type: true, dosageForm: true } },
        student: {
          select: {
            id: true,
            user: { select: { name: true } },
          },
        },
        givenBy: { select: { id: true, name: true } },
      },
      orderBy: { givenAt: 'desc' },
    }),
    prisma.medicationUsageLog.count({ where }),
  ]);

  return {
    success: true,
    data: data.map((log: any) => ({
      ...log,
      student: log.student ? { id: log.student.id, user: log.student.user } : null,
    })),
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
}

export async function createMedicationUsage(data: CreateMedicationUsageInput, givenById: string) {
  const medication = await prisma.medication.findUnique({ where: { id: data.medicationId } });
  if (!medication || medication.quantity < data.quantity) {
    throw new Error('Insufficient medication stock');
  }

  return prisma.$transaction(async (tx) => {
    const usage = await tx.medicationUsageLog.create({
      data: {
        medicationId: data.medicationId,
        studentId: data.studentId!,
        quantity: data.quantity,
        reason: data.reason,
        givenById,
      },
      include: {
        medication: { select: { id: true, name: true } },
        student: {
          select: {
            id: true,
            user: { select: { name: true } },
          },
        },
        givenBy: { select: { id: true, name: true } },
      },
    });

    await tx.medication.update({
      where: { id: data.medicationId },
      data: { quantity: { decrement: data.quantity } },
    });

    return usage;
  });
}

// ==================== CLINIC MANAGEMENT ====================

export async function createPatient(data: {
  name: string;
  gender: string;
  birthDate: string | Date;
  phone?: string;
  address?: string;
  userId?: string;
}) {
  return prisma.patient.create({
    data: {
      ...data,
      gender: data.gender as any,
      birthDate: new Date(data.birthDate),
    },
  });
}

export async function createClinicAppointment(data: {
  unitId: string;
  patientId?: string;
  studentId?: string;
  userId?: string;
  appointmentDate: string | Date;
  complaint: string;
}) {
  // Generate queue number for the day
  const startOfDay = new Date(data.appointmentDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(data.appointmentDate);
  endOfDay.setHours(23, 59, 59, 999);

  const count = await prisma.clinicAppointment.count({
    where: {
      unitId: data.unitId!,
      appointmentDate: { gte: startOfDay, lte: endOfDay },
    },
  });

  return prisma.clinicAppointment.create({
    data: {
      ...data,
      appointmentDate: new Date(data.appointmentDate),
      queueNumber: count + 1,
    },
  });
}

export async function createPrescription(data: {
  medicalRecordId?: string;
  patientId?: string;
  studentId?: string;
  doctorId: string;
  notes?: string;
  items: { medicationId: string; quantity: number; dosage: string; instructions?: string }[];
}) {
  return prisma.prescription.create({
    data: {
      medicalRecordId: data.medicalRecordId,
      patientId: data.patientId,
      studentId: data.studentId,
      doctorId: data.doctorId,
      notes: data.notes,
      items: {
        create: data.items,
      },
    },
    include: {
      items: true,
    },
  });
}

export async function getPatients(query: { page: number; limit: number; search?: string }) {
  const where = query.search
    ? { name: { contains: query.search, mode: 'insensitive' as const } }
    : {};

  const [data, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.patient.count({ where }),
  ]);

  return { data, meta: { page: query.page, limit: query.limit, total } };
}

export async function getClinicAppointments(
  query: {
    page: number;
    limit: number;
    unitId?: string;
    date?: Date;
    status?: string;
  },
  scope: Prisma.StudentWhereInput
) {
  const where: Record<string, unknown> = { ...onlyScopedStudents(scope) };
  if (query.unitId) where.unitId = query.unitId;
  if (query.status) where.status = query.status;
  if (query.date) {
    const startOfDay = new Date(query.date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(query.date);
    endOfDay.setHours(23, 59, 59, 999);
    where.appointmentDate = { gte: startOfDay, lte: endOfDay };
  }

  const [data, total] = await Promise.all([
    prisma.clinicAppointment.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true } },
        student: { select: STUDENT_SAFE_SELECT },
      },
      orderBy: [{ appointmentDate: 'desc' }, { queueNumber: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.clinicAppointment.count({ where }),
  ]);

  return { data, meta: { page: query.page, limit: query.limit, total } };
}

export async function getPrescriptions(
  query: {
    page: number;
    limit: number;
    studentId?: string;
    patientId?: string;
    status?: string;
  },
  scope: Prisma.StudentWhereInput
) {
  const where: Record<string, unknown> = { ...onlyScopedStudents(scope) };
  if (query.studentId) where.studentId = query.studentId;
  if (query.patientId) where.patientId = query.patientId;
  if (query.status) where.status = query.status;

  const [data, total] = await Promise.all([
    prisma.prescription.findMany({
      where,
      include: {
        items: {
          include: {
            medication: { select: { id: true, name: true, type: true, dosageForm: true } },
          },
        },
        patient: { select: { id: true, name: true } },
        student: { select: STUDENT_SAFE_SELECT },
        doctor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.prescription.count({ where }),
  ]);

  return { data, meta: { page: query.page, limit: query.limit, total } };
}

export async function fulfillPrescription(prescriptionId: string, fulfilledById: string) {
  return prisma.$transaction(async (tx) => {
    const prescription = await tx.prescription.findUnique({
      where: { id: prescriptionId },
      include: { items: true },
    });

    if (!prescription) throw Errors.notFound('Prescription');
    if (prescription.status !== 'PENDING') {
      throw Errors.conflict('Prescription already processed');
    }

    for (const item of prescription.items) {
      const medication = await tx.medication.findUnique({ where: { id: item.medicationId } });
      if (!medication || medication.quantity < item.quantity) {
        throw Errors.badRequest(
          `Insufficient stock for medication: ${medication?.name || item.medicationId}`
        );
      }

      await tx.medication.update({
        where: { id: item.medicationId },
        data: { quantity: { decrement: item.quantity } },
      });

      await tx.medicationUsageLog.create({
        data: {
          medicationId: item.medicationId,
          studentId: prescription.studentId || undefined,
          quantity: item.quantity,
          reason: `Resep: ${prescription.id}`,
          givenById: fulfilledById,
        },
      });
    }

    return tx.prescription.update({
      where: { id: prescriptionId },
      data: { status: 'FULFILLED' },
    });
  });
}

// ==================== STATISTICS ====================

/**
 * Health statistics, scoped to a unit or across every unit.
 *
 * `unitId` is optional because the dashboard and the health landing page want
 * a yayasan-wide figure and have no unit in scope. Prisma treats an
 * `undefined` filter as "no filter", so the same query serves both.
 */
export async function getHealthStats(unitId?: string): Promise<HealthStats> {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [medications, expiredMedications, thisMonthRecords, recordsByType] = await Promise.all([
    prisma.medication.findMany({ where: { unitId } }),
    prisma.medication.count({
      where: {
        unitId,
        expiryDate: { lt: today },
      },
    }),
    prisma.medicalRecord.count({
      where: {
        student: { unitId },
        visitDate: { gte: startOfMonth },
      },
    }),
    prisma.medicalRecord.groupBy({
      by: ['type'],
      where: {
        student: { unitId },
        visitDate: { gte: startOfMonth },
      },
      _count: true,
    }),
  ]);

  const lowStockMedications = medications.filter((m) => m.quantity <= m.minStock).length;

  return {
    medications: {
      total: medications.length,
      lowStock: lowStockMedications,
      expired: expiredMedications,
    },
    thisMonthRecords,
    recordsByType: recordsByType.map((r) => ({
      type: r.type as unknown as import('@cipansor/shared').MedicalRecordType,
      count: r._count,
    })),
  };
}

// ==================== GROWTH RECORD ====================

// WHO growth-standard milestones (approximate medians and SDs) for
// height-for-age and weight-for-age, early childhood through 18y.
const GROWTH_STANDARDS: Record<
  'MALE' | 'FEMALE',
  Record<number, { hM: number; hS: number; wM: number; wS: number }>
> = {
  MALE: {
    12: { hM: 75.7, hS: 2.5, wM: 9.6, wS: 0.9 },
    24: { hM: 87.8, hS: 3.2, wM: 12.2, wS: 1.1 },
    36: { hM: 96.1, hS: 3.8, wM: 14.3, wS: 1.3 },
    48: { hM: 103.3, hS: 4.2, wM: 16.3, wS: 1.6 },
    60: { hM: 110.0, hS: 4.6, wM: 18.3, wS: 1.9 },
    84: { hM: 121.7, hS: 5.4, wM: 22.9, wS: 2.8 },
    120: { hM: 137.8, hS: 6.4, wM: 31.2, wS: 4.5 },
    144: { hM: 149.1, hS: 7.5, wM: 38.6, wS: 6.5 },
    180: { hM: 170.1, hS: 7.6, wM: 54.0, wS: 9.0 },
    216: { hM: 176.0, hS: 7.0, wM: 65.0, wS: 10.5 },
  },
  FEMALE: {
    12: { hM: 74.0, hS: 2.4, wM: 8.9, wS: 0.9 },
    24: { hM: 86.4, hS: 3.1, wM: 11.5, wS: 1.1 },
    36: { hM: 95.1, hS: 3.7, wM: 13.9, wS: 1.3 },
    48: { hM: 102.7, hS: 4.2, wM: 16.1, wS: 1.6 },
    60: { hM: 109.4, hS: 4.6, wM: 18.2, wS: 1.9 },
    84: { hM: 120.8, hS: 5.5, wM: 22.4, wS: 3.1 },
    120: { hM: 138.4, hS: 7.0, wM: 31.8, wS: 5.4 },
    144: { hM: 151.2, hS: 7.2, wM: 40.8, wS: 7.8 },
    180: { hM: 161.7, hS: 6.2, wM: 52.0, wS: 9.2 },
    216: { hM: 163.0, hS: 5.8, wM: 56.5, wS: 9.8 },
  },
};

/**
 * Height-for-age and weight-for-age Z-scores against the nearest WHO
 * milestone, plus a derived nutrition status label.
 */
export function calculateGrowthZScores(input: {
  ageMonths: number;
  gender: 'MALE' | 'FEMALE';
  weight?: number | null;
  height?: number | null;
}) {
  const { ageMonths, gender, weight, height } = input;
  const milestones = Object.keys(GROWTH_STANDARDS[gender]).map(Number);
  const nearest = milestones.reduce((prev, curr) =>
    Math.abs(curr - ageMonths) < Math.abs(prev - ageMonths) ? curr : prev
  );
  const std = GROWTH_STANDARDS[gender][nearest];

  const heightZScore = height ? Math.round(((height - std.hM) / std.hS) * 100) / 100 : null;
  const weightZScore = weight ? Math.round(((weight - std.wM) / std.wS) * 100) / 100 : null;

  let nutritionStatus: string | null = null;
  if (weightZScore !== null) {
    if (weightZScore <= -3) nutritionStatus = 'SEVERELY_UNDERWEIGHT';
    else if (weightZScore <= -2) nutritionStatus = 'UNDERWEIGHT';
    else if (weightZScore >= 2) nutritionStatus = 'OVERWEIGHT';
    else nutritionStatus = 'NORMAL';
  }

  return { heightZScore, weightZScore, nutritionStatus };
}

export async function createGrowthRecord(data: CreateGrowthRecordInput, recordedById: string) {
  // Compute real age + WHO Z-scores from the student's profile
  const student = await prisma.student.findUnique({
    where: { id: data.studentId },
    select: { birthDate: true, gender: true },
  });
  let ageMonths = 0;
  let zScores: ReturnType<typeof calculateGrowthZScores> = {
    heightZScore: null,
    weightZScore: null,
    nutritionStatus: null,
  };
  if (student?.birthDate) {
    const recordDate = new Date(data.recordDate);
    ageMonths =
      (recordDate.getFullYear() - student.birthDate.getFullYear()) * 12 +
      (recordDate.getMonth() - student.birthDate.getMonth());
    ageMonths = Math.max(0, ageMonths);
    if (student.gender === 'MALE' || student.gender === 'FEMALE') {
      zScores = calculateGrowthZScores({
        ageMonths,
        gender: student.gender,
        weight: data.weight,
        height: data.height,
      });
    }
  }

  return prisma.growthRecord.create({
    data: {
      studentId: data.studentId!,
      unitId: data.unitId!,
      recordDate: data.recordDate,
      weight: data.weight,
      height: data.height,
      headCircumference: data.headCircumference,
      notes: data.notes,
      ageMonths,
      heightZScore: zScores.heightZScore,
      weightZScore: zScores.weightZScore,
      nutritionStatus: zScores.nutritionStatus,
      recordedById,
    },
    include: {
      student: { select: { id: true, user: { select: { name: true } } } },
      recordedBy: { select: { id: true, name: true } },
    },
  });
}

export async function getGrowthRecords(
  query: QueryGrowthRecordInput,
  scope: Prisma.StudentWhereInput
) {
  const { page = 1, limit = 20, studentId, unitId, startDate, endDate } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.GrowthRecordWhereInput = {
    ...onlyScopedStudents(scope),
    ...(studentId && { studentId }),
    ...(unitId && { unitId }),
    ...(startDate &&
      endDate && {
        recordDate: { gte: startDate, lte: endDate },
      }),
  };

  const [data, total] = await Promise.all([
    prisma.growthRecord.findMany({
      where,
      skip,
      take: limit,
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { recordDate: 'desc' },
    }),
    prisma.growthRecord.count({ where }),
  ]);

  return {
    success: true,
    data,
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
}

export async function deleteGrowthRecord(id: string, scope: Prisma.StudentWhereInput) {
  // One scoped statement, not a scoped read followed by an unscoped delete:
  // between the two the record could move out of the caller's reach (TOCTOU).
  const { count } = await prisma.growthRecord.deleteMany({
    where: { id, ...onlyScopedStudents(scope) },
  });
  if (count === 0) throw Errors.notFound('Growth record');
  return { id };
}
