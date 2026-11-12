import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { Prisma, UserRole, Gender, UnitType } from '@prisma/client';
import { STUDENT_STATUS, unitDocumentName } from '@cipansor/shared';
import { nisMapForUnit } from '@/utils/student-nis';
import { currentAccreditations } from '@/modules/units';

// User type from JwtPayload
interface AuthenticatedUser {
  sub: string;
  role: string;
  unitId: string | null;
}

interface EmisExportOptions {
  unitId?: string;
  academicYearId?: string;
  includeInactive?: boolean;
}

// EMIS Student Data Format (Kemenag)
interface EmisStudentData {
  no: number;
  nisn: string;
  nis: string;
  nama: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: 'L' | 'P';
  agama: string;
  alamat: string;
  namaAyah: string;
  namaIbu: string;
  teleponOrtu: string;
  kelas: string;
  tingkat: string;
  status: string;
  tahunMasuk: number | null;
  tahunLulus: number | null;
  nisLokal: string;
}

// EMIS Teacher Data Format (Kemenag)
interface EmisTeacherData {
  no: number;
  nuptk: string;
  nip: string;
  nama: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: '' | 'L' | 'P';
  jabatan: string;
  statusPegawai: string;
  bidangKeahlian: string;
  sertifikasi: string;
  tanggalBergabung: string;
  email: string;
  telepon: string;
}

// EMIS Institution Profile Format
interface EmisInstitutionData {
  npsn: string;
  namaLembaga: string;
  jenjang: string;
  alamat: string;
  telepon: string;
  email: string;
  website: string;
  akreditasi: string;
  namaYayasan: string;
  npwpYayasan: string;
  tahunBerdiri: string;
  jumlahSiswa: number;
  jumlahGuru: number;
  jumlahKelas: number;
  jumlahRuangKelas: number;
  visi: string;
  misi: string;
}

// BOS Component Categories (8 Komponen sesuai Permendikbud)
export const BOS_COMPONENTS = [
  {
    code: 'BOS-01',
    name: 'Pengembangan Perpustakaan',
    description: 'Pembelian buku, e-book, akses jurnal',
  },
  {
    code: 'BOS-02',
    name: 'Penerimaan Peserta Didik Baru',
    description: 'Biaya PPDB, formulir, seleksi',
  },
  {
    code: 'BOS-03',
    name: 'Kegiatan Pembelajaran dan Ekstrakurikuler',
    description: 'Alat pembelajaran, ekskul',
  },
  {
    code: 'BOS-04',
    name: 'Kegiatan Evaluasi Pembelajaran',
    description: 'Ujian, ulangan, penilaian',
  },
  { code: 'BOS-05', name: 'Pengelolaan Sekolah', description: 'ATK, administrasi, manajemen' },
  {
    code: 'BOS-06',
    name: 'Pengembangan Profesi Guru',
    description: 'Pelatihan, workshop, sertifikasi',
  },
  {
    code: 'BOS-07',
    name: 'Langganan Daya dan Jasa',
    description: 'Listrik, air, internet, telepon',
  },
  {
    code: 'BOS-08',
    name: 'Pemeliharaan dan Perawatan',
    description: 'Perbaikan gedung, peralatan',
  },
];

export class EmisService {
  // ==================
  // STUDENT EXPORT
  // ==================

  async exportStudentData(
    options: EmisExportOptions,
    currentUser: AuthenticatedUser
  ): Promise<EmisStudentData[]> {
    const { unitId, academicYearId, includeInactive } = options;

    // Access control
    let targetUnitId = unitId;
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      targetUnitId = currentUser.unitId || undefined;
    }

    if (!targetUnitId) {
      throw Errors.badRequest('Unit ID is required');
    }

    // Build query
    const whereClause: Prisma.StudentWhereInput = {
      unitId: targetUnitId,
    };

    if (!includeInactive) {
      whereClause.deletedAt = null;
      whereClause.status = 'active';
    }

    // Get students with enrollments
    const students = await prisma.student.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, email: true, phone: true } },
        enrollments: {
          where: { status: 'active' },
          include: {
            class: {
              include: { academicYear: true },
            },
          },
          orderBy: { enrolledAt: 'desc' },
          take: 1,
        },
        parents: {
          include: {
            parent: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: [{ nis: 'asc' }],
    });

    // NIS lokal di EMIS adalah nomor induk UNIT yang melapor.
    const nisUnit = await nisMapForUnit(prisma, targetUnitId, students);

    // Transform to EMIS format
    const emisData: EmisStudentData[] = students.map((student, index) => {
      const enrollment = student.enrollments[0];
      const fatherParent = student.parents.find((p) => p.relation === 'father');
      const motherParent = student.parents.find((p) => p.relation === 'mother');

      return {
        no: index + 1,
        nisn: student.nisn || '',
        nis: nisUnit.get(student.id) ?? '',
        nama: student.user.name,
        tempatLahir: student.birthPlace,
        tanggalLahir: this.formatDate(student.birthDate),
        jenisKelamin: student.gender === Gender.MALE ? 'L' : 'P',
        agama: 'Islam', // Default for pesantren
        alamat: student.address,
        namaAyah: fatherParent?.parent.name || student.parentName,
        namaIbu: motherParent?.parent.name || '',
        teleponOrtu: student.parentPhone,
        kelas: enrollment?.class.name || '-',
        tingkat: enrollment?.class.level || '-',
        status: student.status,
        tahunMasuk: student.entryYear,
        tahunLulus: student.graduateYear,
        nisLokal: nisUnit.get(student.id) ?? '',
      };
    });

    return emisData;
  }

  // ==================
  // TEACHER EXPORT
  // ==================

  async exportTeacherData(
    options: EmisExportOptions,
    currentUser: AuthenticatedUser
  ): Promise<EmisTeacherData[]> {
    const { unitId, includeInactive } = options;

    // Access control
    let targetUnitId = unitId;
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
      targetUnitId = currentUser.unitId || undefined;
    }

    if (!targetUnitId) {
      throw Errors.badRequest('Unit ID is required');
    }

    // Build query
    const whereClause: Prisma.TeacherWhereInput = {
      unitId: targetUnitId,
    };

    if (!includeInactive) {
      whereClause.deletedAt = null;
    }

    // Get teachers
    const teachers = await prisma.teacher.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, email: true, phone: true } },
        homeroomClasses: {
          include: { academicYear: true },
          where: { academicYear: { isActive: true } },
        },
      },
      orderBy: [{ nip: 'asc' }, { user: { name: 'asc' } }],
    });

    // Transform to EMIS format
    const emisData: EmisTeacherData[] = teachers.map((teacher, index) => {
      const isHomeroom = teacher.homeroomClasses.length > 0;

      return {
        no: index + 1,
        nuptk: teacher.nuptk || '',
        nip: teacher.nip || '',
        nama: teacher.user.name,
        tempatLahir: teacher.birthPlace || '',
        tanggalLahir: teacher.birthDate ? this.formatDate(teacher.birthDate) : '',
        // `teacher.gender` is nullable, so an unrecorded gender exports empty
        // rather than being guessed as one (K11, 2026-11-09): the old literal
        // 'L' sent every teacher as male.
        jenisKelamin:
          teacher.gender === Gender.MALE ? 'L' : teacher.gender === Gender.FEMALE ? 'P' : '',
        jabatan: isHomeroom ? 'Guru & Wali Kelas' : 'Guru',
        statusPegawai: teacher.nip ? 'PNS/ASN' : 'Non-PNS',
        bidangKeahlian: teacher.specialization || '-',
        sertifikasi: teacher.nuptk ? 'Sudah Sertifikasi' : 'Belum Sertifikasi',
        tanggalBergabung: teacher.joinDate ? this.formatDate(teacher.joinDate) : '-',
        email: teacher.user.email || '',
        telepon: teacher.user.phone || '',
      };
    });

    return emisData;
  }

  // ==================
  // INSTITUTION EXPORT
  // ==================

  async exportInstitutionData(
    unitId: string,
    currentUser: AuthenticatedUser
  ): Promise<EmisInstitutionData> {
    // Access control
    if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.unitId !== unitId) {
      throw Errors.forbidden('Access denied');
    }

    // Get unit with foundation
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: {
        foundation: true,
      },
    });

    // Get related counts separately
    const [students, teachers, classes] = await Promise.all([
      prisma.student.findMany({
        where: { unitId, status: STUDENT_STATUS.ACTIVE, deletedAt: null },
      }),
      prisma.teacher.findMany({ where: { unitId, deletedAt: null } }),
      prisma.class.findMany({
        where: { unitId, deletedAt: null },
        include: { academicYear: true },
      }),
    ]);

    if (!unit) {
      throw Errors.notFound('Unit not found');
    }

    const activeClasses = classes.filter((c) => c.academicYear?.isActive);

    // Map unit type to jenjang
    const jenjangMap: Record<UnitType, string> = {
      PESANTREN: 'Pesantren',
      TK_QURAN: 'TK',
      SD_IT: 'SD',
      SMP_IT: 'SMP',
      SMA_QURAN: 'SMA',
      UNIT_USAHA: 'Unit Usaha',
      OTHER: 'Lainnya',
    };

    return {
      npsn: unit.npsn || '',
      namaLembaga: unitDocumentName(unit),
      jenjang: jenjangMap[unit.type] || unit.type,
      alamat: unit.address,
      telepon: unit.phone || '',
      email: unit.email || '',
      website: unit.foundation?.website || '',
      // The certificate in force (decisions/akreditasi-unit.md), never a guess.
      akreditasi:
        (await currentAccreditations([unit.id])).get(unit.id)?.rating ?? 'Belum Terakreditasi',
      namaYayasan: unit.foundation?.name || '-',
      npwpYayasan: unit.foundation?.taxId || '',
      tahunBerdiri: unit.foundation?.foundingDate
        ? new Date(unit.foundation.foundingDate).getFullYear().toString()
        : '-',
      jumlahSiswa: students.length,
      jumlahGuru: teachers.length,
      jumlahKelas: activeClasses.length,
      jumlahRuangKelas: activeClasses.length, // Assuming 1 room per class
      visi: unit.foundation?.vision || '',
      misi: unit.foundation?.mission || '',
    };
  }

  // ==================
  // SUMMARY STATISTICS
  // ==================

  async getExportSummary(unitId: string, currentUser: AuthenticatedUser) {
    // Access control
    if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.unitId !== unitId) {
      throw Errors.forbidden('Access denied');
    }

    const [
      totalStudents,
      maleStudents,
      femaleStudents,
      activeStudents,
      totalTeachers,
      certifiedTeachers,
      totalClasses,
    ] = await Promise.all([
      prisma.student.count({ where: { unitId, deletedAt: null } }),
      prisma.student.count({ where: { unitId, deletedAt: null, gender: Gender.MALE } }),
      prisma.student.count({ where: { unitId, deletedAt: null, gender: Gender.FEMALE } }),
      prisma.student.count({ where: { unitId, deletedAt: null, status: 'active' } }),
      prisma.teacher.count({ where: { unitId, deletedAt: null } }),
      prisma.teacher.count({ where: { unitId, deletedAt: null, nuptk: { not: null } } }),
      prisma.class.count({
        where: {
          unitId,
          deletedAt: null,
          academicYear: { isActive: true },
        },
      }),
    ]);

    // Get NISN completion rate
    const studentsWithNisn = await prisma.student.count({
      where: { unitId, deletedAt: null, status: 'active', nisn: { not: null } },
    });

    // Get NUPTK completion rate
    const teachersWithNuptk = await prisma.teacher.count({
      where: { unitId, deletedAt: null, nuptk: { not: null } },
    });

    return {
      students: {
        total: totalStudents,
        active: activeStudents,
        male: maleStudents,
        female: femaleStudents,
        withNisn: studentsWithNisn,
        nisnCompletionRate:
          activeStudents > 0 ? Math.round((studentsWithNisn / activeStudents) * 100) : 0,
      },
      teachers: {
        total: totalTeachers,
        certified: certifiedTeachers,
        withNuptk: teachersWithNuptk,
        nuptkCompletionRate:
          totalTeachers > 0 ? Math.round((teachersWithNuptk / totalTeachers) * 100) : 0,
        certificationRate:
          totalTeachers > 0 ? Math.round((certifiedTeachers / totalTeachers) * 100) : 0,
      },
      classes: {
        total: totalClasses,
      },
      readinessScore: this.calculateReadinessScore({
        nisnRate: activeStudents > 0 ? (studentsWithNisn / activeStudents) * 100 : 0,
        nuptkRate: totalTeachers > 0 ? (teachersWithNuptk / totalTeachers) * 100 : 0,
      }),
    };
  }

  // ==================
  // VALIDATION
  // ==================

  async validateDataCompleteness(unitId: string, currentUser: AuthenticatedUser) {
    // Access control
    if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.unitId !== unitId) {
      throw Errors.forbidden('Access denied');
    }

    const issues: Array<{
      type: string;
      severity: 'error' | 'warning';
      message: string;
      count: number;
    }> = [];

    // Check students without NISN
    const studentsWithoutNisn = await prisma.student.count({
      where: { unitId, deletedAt: null, status: 'active', nisn: null },
    });
    if (studentsWithoutNisn > 0) {
      issues.push({
        type: 'student_nisn',
        severity: 'error',
        message: `${studentsWithoutNisn} siswa aktif belum memiliki NISN`,
        count: studentsWithoutNisn,
      });
    }

    // Check teachers without NUPTK
    const teachersWithoutNuptk = await prisma.teacher.count({
      where: { unitId, deletedAt: null, nuptk: null },
    });
    if (teachersWithoutNuptk > 0) {
      issues.push({
        type: 'teacher_nuptk',
        severity: 'warning',
        message: `${teachersWithoutNuptk} guru belum memiliki NUPTK`,
        count: teachersWithoutNuptk,
      });
    }

    // Check unit NPSN
    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit?.npsn) {
      issues.push({
        type: 'unit_npsn',
        severity: 'error',
        message: 'Unit belum memiliki NPSN',
        count: 1,
      });
    }

    // Check students without active enrollment
    const studentsWithoutEnrollment = await prisma.student.count({
      where: {
        unitId,
        deletedAt: null,
        status: 'active',
        enrollments: { none: { status: 'active' } },
      },
    });
    if (studentsWithoutEnrollment > 0) {
      issues.push({
        type: 'student_enrollment',
        severity: 'warning',
        message: `${studentsWithoutEnrollment} siswa aktif belum terdaftar di kelas`,
        count: studentsWithoutEnrollment,
      });
    }

    return {
      isReady: issues.filter((i) => i.severity === 'error').length === 0,
      totalIssues: issues.length,
      errorCount: issues.filter((i) => i.severity === 'error').length,
      warningCount: issues.filter((i) => i.severity === 'warning').length,
      issues,
    };
  }

  // ==================
  // HELPERS
  // ==================

  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private calculateReadinessScore(data: { nisnRate: number; nuptkRate: number }): number {
    // Weighted score: NISN 60%, NUPTK 40%
    return Math.round(data.nisnRate * 0.6 + data.nuptkRate * 0.4);
  }
}

export const emisService = new EmisService();
