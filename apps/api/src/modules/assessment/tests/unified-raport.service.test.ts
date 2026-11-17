import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import RaportMerdekaService from '../raport-merdeka.service';
import * as raporPesantrenService from '../../rapor-pesantren/rapor-pesantren.service';
import { UnifiedRaportService } from '../unified-raport.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findUnique: vi.fn() },
    academicYear: { findUnique: vi.fn() },
    grade: { aggregate: vi.fn() },
    tahfidzRecord: { aggregate: vi.fn() },
    violation: { aggregate: vi.fn() },
    attendance: { groupBy: vi.fn() },
    dailyIbadahRecord: { aggregate: vi.fn() },
  },
}));

vi.mock('../raport-merdeka.service', () => ({
  default: {
    generateRaportMerdeka: vi.fn(),
  },
}));

vi.mock('../../rapor-pesantren/rapor-pesantren.service', () => ({
  generateRaporPesantren: vi.fn(),
}));

describe('UnifiedRaportService Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockStudent = {
    id: 's1',
    user: { name: 'Ahmad' },
    unit: { name: 'SD IT Cipansor', address: 'Cianjur', logoUrl: '/logo.png', id: 'u1' },
    nis: '1001',
    nisn: '0012345678',
    unitId: 'u1',
    enrollments: [
      {
        class: {
          name: 'Kelas 4A',
          level: '4',
          homeroomTeacher: { user: { name: 'Ustadz Fulan' } },
        },
      },
    ],
  };

  const mockMerdeka = {
    // RaportMerdekaService sudah menghitung NIS unit rombel rapornya.
    siswa: { nis: '1001', nisn: '0012345678' },
    tahunAjaran: { tahun: '2024/2025' },
    intrakurikuler: [{ subjectName: 'Matematika', finalScore: 85 }],
    projekP5: [],
    ekstrakurikuler: [],
    kehadiran: { sick: 0, excused: 1, absent: 0 },
    catatanWaliKelas: 'Pertahankan prestasinya',
    catatanKepalaSekolah: 'Bagus',
  };

  const mockPesantren = {
    tahfidz: { totalJuz: 5, latestSurah: 'An-Naba' },
    ibadah: { grade: 'A', score: 95 },
    akhlak: {},
    kitabProgress: [],
    muhadhoroh: null,
    muhadatsah: null,
    overallGrade: 'MUMTAZ',
    overallScore: 92,
    notes: 'Rajin sholat dhuha',
    musyrifNotes: 'Kamar selalu rapi',
  };

  it('should throw an error if student is not found', async () => {
    (prisma.student.findUnique as any).mockResolvedValue(null);

    await expect(UnifiedRaportService.generateUnifiedRaport('s1', 'ay1', 1)).rejects.toThrow(
      'Siswa tidak ditemukan'
    );
  });

  it('should throw an error if enrollment data is missing', async () => {
    (prisma.student.findUnique as any).mockResolvedValue({
      ...mockStudent,
      enrollments: [],
    });

    await expect(UnifiedRaportService.generateUnifiedRaport('s1', 'ay1', 1)).rejects.toThrow(
      'Data enrollment tidak ditemukan untuk tahun ajaran ini'
    );
  });

  it('should combine merdeka and pesantren data into a single object', async () => {
    (prisma.student.findUnique as any).mockResolvedValue(mockStudent);
    (RaportMerdekaService.generateRaportMerdeka as any).mockResolvedValue(mockMerdeka);
    (raporPesantrenService.generateRaporPesantren as any).mockResolvedValue(mockPesantren);

    // Mock analytics dependencies
    (prisma.academicYear.findUnique as any).mockResolvedValue({
      startDate: new Date('2024-07-01'),
      endDate: new Date('2025-06-30'),
    });
    (prisma.grade.aggregate as any).mockResolvedValue({ _avg: { percentage: 85 } });
    (prisma.tahfidzRecord.aggregate as any).mockResolvedValue({
      _sum: { totalAyah: 100 },
      _max: { juz: 5 },
    });
    (prisma.violation.aggregate as any).mockResolvedValue({ _sum: { points: 0 } });
    (prisma.attendance.groupBy as any).mockResolvedValue([
      { status: 'PRESENT', _count: { _all: 10 } },
    ]);
    (prisma.dailyIbadahRecord.aggregate as any).mockResolvedValue({ _sum: { pointsEarned: 1000 } });

    const result = await UnifiedRaportService.generateUnifiedRaport('s1', 'ay1', 1);

    expect(result.student.name).toBe('Ahmad');
    expect(result.student.nis).toBe('1001');
    expect(result.student.nisn).toBe('0012345678');
    expect(result.school.name).toBe('SD IT Cipansor');
    expect(result.meta.academicYear).toBe('2024/2025');
    expect((result as any).academic.intrakurikuler[0].subjectName).toBe('Matematika');
    expect(result.islamic.tahfidz.totalJuz).toBe(5);
    expect(result.islamic.grade).toBe('MUMTAZ');
    expect(result.islamic.score).toBe(92);
    expect(result.remarks.academic).toBe('Pertahankan prestasinya');
    expect(result.remarks.principal).toBe('Bagus');
    expect(result.remarks.islamic).toBe('Rajin sholat dhuha');
    expect(result.remarks.musyrif).toBe('Kamar selalu rapi');
    expect(result.remarks.recommendation).toBeDefined();
    expect(typeof result.remarks.recommendation).toBe('string');
    expect(result.signatures.homeroomTeacher).toBe('Ustadz Fulan');

    // Verify parallel execution with correct parameters
    expect(RaportMerdekaService.generateRaportMerdeka).toHaveBeenCalledWith(
      's1',
      'ay1',
      1,
      undefined
    );
    expect(raporPesantrenService.generateRaporPesantren).toHaveBeenCalledWith({
      studentId: 's1',
      academicYearId: 'ay1',
      semester: 1,
      unitId: 'u1',
    });
  });

  it('forwards the authenticated user to generateRaportMerdeka for scope validation', async () => {
    (prisma.student.findUnique as any).mockResolvedValue(mockStudent);
    (RaportMerdekaService.generateRaportMerdeka as any).mockResolvedValue(mockMerdeka);
    (raporPesantrenService.generateRaporPesantren as any).mockResolvedValue(mockPesantren);

    const user = { id: 'u-1', roleCode: 'SDIT_GURU', unitId: 'u1' };
    await UnifiedRaportService.generateUnifiedRaport('s1', 'ay1', 1, user as any);

    expect(RaportMerdekaService.generateRaportMerdeka).toHaveBeenCalledWith('s1', 'ay1', 1, user);
  });
});
