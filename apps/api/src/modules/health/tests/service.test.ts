import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MedicalRecordType } from '@cipansor/shared';

const prismaMock = vi.hoisted(() => ({
  medicalRecord: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  medication: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
  },
  medicationUsageLog: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  growthRecord: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  classEnrollment: {
    findFirst: vi.fn(),
  },
  studentParent: {
    findMany: vi.fn(),
  },
  // `createMedicalRecord` checks the santri is inside the caller's scope before
  // writing (R27.8); the default lets every case below pass.
  student: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn((callback) => callback(prismaMock)),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/modules/attendance/attendance.service', () => ({
  attendanceService: { recordFromIntegration: vi.fn() },
}));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import * as healthService from '../health.service';
import { attendanceService } from '@/modules/attendance/attendance.service';
import { eventBus } from '@/lib/event-bus';

/** The nurse's scope: any santri of the units they serve. */
const SCOPE = {};

describe('Health Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The santri is inside the caller's Cakupan_Santri unless a case says
    // otherwise (R27.8).
    vi.mocked(prismaMock.student.findFirst).mockResolvedValue({ id: 'std-1' } as any);
  });

  describe('getMedicalRecords', () => {
    it('should return paginated medical records with vitals from DB columns', async () => {
      const mockData = [
        {
          id: '1',
          studentId: 'student-1',
          type: 'CHECKUP',
          notes: 'Regular checkup',
          temperature: 37.5,
          status: 'HEALTHY',
          student: {
            id: 'student-1',
            nis: '123',
            user: { id: 'user-1', name: 'John Doe' },
            unit: { id: 'unit-1', name: 'Unit 1' },
          },
          recordedBy: { id: 'staff-1', name: 'Dr. Smith' },
        },
      ];

      prismaMock.medicalRecord.findMany.mockResolvedValue(mockData as any);
      prismaMock.medicalRecord.count.mockResolvedValue(1);

      const result = await healthService.getMedicalRecords({ page: 1, limit: 10 }, {});

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      const record = result.data[0];
      expect(record.id).toBe('1');
      expect(record.temperature).toBe(37.5);
      expect(record.status).toBe('HEALTHY');
      expect(record.notes).toBe('Regular checkup');

      expect(prismaMock.medicalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      );
    });
  });

  describe('createMedicalRecord', () => {
    it('should create medical record and not trigger external things if flags are false', async () => {
      const dto = {
        studentId: 'std-1',
        type: 'SICK' as any,
        visitDate: new Date(),
        complaint: 'Pusing',
        temperature: 38.5,
      };

      const mockRecord = {
        id: 'med-1',
        ...dto,
        student: { id: 'std-1', user: { name: 'Ali' } },
        status: 'OPEN',
      };

      vi.mocked(prismaMock.medicalRecord.create).mockResolvedValue(mockRecord as any);

      const result = await healthService.createMedicalRecord(dto, 'user-1', SCOPE);

      expect(prismaMock.medicalRecord.create).toHaveBeenCalled();
      expect(attendanceService.recordFromIntegration).not.toHaveBeenCalled();

      // eventBus.emit is always called for dashboard update
      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:medical-record-created',
        expect.any(Object)
      );
      expect(result).toHaveProperty('id', 'med-1');
    });

    it('should create a medical record with vitals in columns', async () => {
      const input = {
        studentId: 'std-1',
        type: MedicalRecordType.CHECKUP,
        visitDate: new Date(),
        complaint: 'Fever',
        temperature: 38.5,
        status: 'SICK',
        notes: 'Patient looks pale',
      };

      const mockCreated = {
        id: '1',
        studentId: input.studentId,
        type: input.type,
        visitDate: input.visitDate,
        complaint: input.complaint,
        notes: 'Patient looks pale',
        temperature: 38.5,
        status: 'SICK',
        recordedById: 'staff-1',
        student: { id: 'std-1', nis: '123', user: { id: 'user-1', name: 'John Doe' } },
        recordedBy: { id: 'staff-1', name: 'Dr. Smith' },
      };

      prismaMock.medicalRecord.create.mockResolvedValue(mockCreated as any);

      const result = await healthService.createMedicalRecord(input as any, 'staff-1', SCOPE);

      expect(result.id).toBe('1');
      expect(result.temperature).toBe(38.5);

      expect(prismaMock.medicalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId: 'std-1',
            complaint: 'Fever',
            temperature: 38.5,
            status: 'SICK',
            notes: 'Patient looks pale',
          }),
        })
      );
    });

    it('should create attendance if createAttendance is true', async () => {
      const dto = {
        studentId: 'std-1',
        type: 'SICK' as any,
        visitDate: new Date(),
        complaint: 'Demam',
        createAttendance: true,
      };

      vi.mocked(prismaMock.medicalRecord.create).mockResolvedValue({
        id: 'med-2',
        student: { id: 'std-2', user: { name: 'Test User' } },
      } as any);
      vi.mocked(prismaMock.classEnrollment.findFirst).mockResolvedValue({
        classId: 'cls-1',
      } as any);

      await healthService.createMedicalRecord(dto, 'user-1', SCOPE);

      expect(prismaMock.classEnrollment.findFirst).toHaveBeenCalledWith({
        where: { studentId: 'std-1', status: 'active' },
        select: { classId: true },
      });
      expect(attendanceService.recordFromIntegration).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'std-1',
          classId: 'cls-1',
          on: dto.visitDate,
          status: 'SICK',
        }),
        'user-1'
      );
    });

    it('should notify parents if notifyParent is true', async () => {
      const dto = {
        studentId: 'std-1',
        type: 'SICK' as any,
        visitDate: new Date(),
        complaint: 'Demam',
        notifyParent: true,
      };

      vi.mocked(prismaMock.medicalRecord.create).mockResolvedValue({
        id: 'med-3',
        student: { user: { name: 'Budi' } },
      } as any);

      vi.mocked(prismaMock.studentParent.findMany).mockResolvedValue([
        { parentId: 'parent-1' },
      ] as any);

      await healthService.createMedicalRecord(dto, 'user-1', SCOPE);

      expect(prismaMock.studentParent.findMany).toHaveBeenCalledWith({
        where: { studentId: 'std-1' },
        include: { parent: true },
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        'notification:send',
        expect.objectContaining({ userId: 'parent-1', type: 'HEALTH' })
      );
    });
  });

  describe('updateMedicalRecord', () => {
    it('should update medical record vitals in columns', async () => {
      const updateInput = { temperature: 37.0, notes: 'New notes' };

      const mockUpdated = {
        id: '1',
        notes: 'New notes',
        temperature: 37.0,
        student: { id: 's1', user: { name: 'John' } },
      };

      prismaMock.medicalRecord.findFirst.mockResolvedValue({ id: '1' });
      prismaMock.medicalRecord.update.mockResolvedValue(mockUpdated as any);

      const result = await healthService.updateMedicalRecord('1', updateInput, {});

      expect(prismaMock.medicalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
          data: expect.objectContaining({ notes: 'New notes', temperature: 37.0 }),
        })
      );

      expect(result.temperature).toBe(37.0);
    });
  });

  describe('createMedicationUsage', () => {
    it('should reduce available medication stock', async () => {
      const dto = {
        medicationId: 'med-1',
        studentId: 'std-1',
        quantity: 2,
        reason: 'Sakit kepala',
      };

      vi.mocked(prismaMock.medication.findUnique).mockResolvedValue({
        id: 'med-1',
        quantity: 10,
      } as any);
      vi.mocked(prismaMock.medicationUsageLog.create).mockResolvedValue({ id: 'log-1' } as any);
      vi.mocked(prismaMock.medication.update).mockResolvedValue({} as any);

      await healthService.createMedicationUsage(dto, 'user-1');

      expect(prismaMock.medicationUsageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ medicationId: 'med-1', quantity: 2 }),
        include: expect.any(Object),
      });

      expect(prismaMock.medication.update).toHaveBeenCalledWith({
        where: { id: 'med-1' },
        data: { quantity: { decrement: 2 } },
      });
    });

    it('should throw error if insufficient stock', async () => {
      const dto = {
        medicationId: 'med-1',
        studentId: 'std-1',
        quantity: 5,
        reason: 'Sakit kepala',
      };

      vi.mocked(prismaMock.medication.findUnique).mockResolvedValue({
        id: 'med-1',
        quantity: 2,
      } as any);

      await expect(healthService.createMedicationUsage(dto, 'user-1')).rejects.toThrow(
        'Insufficient medication stock'
      );
    });
  });

  describe('getHealthStats', () => {
    it('should return aggregated stats', async () => {
      vi.mocked(prismaMock.medication.findMany).mockResolvedValue([
        { quantity: 5, minStock: 10 },
      ] as any);
      vi.mocked(prismaMock.medication.count).mockResolvedValue(2);
      vi.mocked(prismaMock.medicalRecord.count).mockResolvedValue(15);
      vi.mocked(prismaMock.medicalRecord.groupBy).mockResolvedValue([
        { type: 'SICK', _count: 10 },
        { type: 'CHECKUP', _count: 5 },
      ] as any);

      const stats = await healthService.getHealthStats('unit-1');

      expect(stats.medications.total).toBe(1);
      expect(stats.medications.lowStock).toBe(1); // 5 <= 10
      expect(stats.medications.expired).toBe(2);
      expect(stats.thisMonthRecords).toBe(15);
      expect(stats.recordsByType).toHaveLength(2);
    });
  });
});
