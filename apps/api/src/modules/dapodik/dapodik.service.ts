import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { Gender, UnitType } from '@prisma/client';
import { currentAccreditations } from '@/modules/units';
import { unitDocumentName } from '@cipansor/shared';
import { actorReachesUnit, writeUnitScopeFor, type UnitActor } from '@/utils/resolve-unit-id';

// User type from JwtPayload
interface AuthenticatedUser extends UnitActor {
  sub: string;
  role: string;
  unitId: string | null;
}

interface DapodikExportOptions {
  unitId?: string;
  academicYearId?: string;
  includeInactive?: boolean;
}

// ============================================
// DAPODIK STUDENT DATA FORMAT (Kemendikbud)
// ============================================

interface DapodikStudentData {
  no: number;
  nisn: string;
  nik: string;
  namaLengkap: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: 'L' | 'P';
  agama: string;
  alamat: string;
  rt: string;
  rw: string;
  kelurahan: string;
  kecamatan: string;
  kabupaten: string;
  provinsi: string;
  kodePos: string;
  namaAyah: string;
  nikAyah: string;
  pekerjaanAyah: string;
  namaIbu: string;
  nikIbu: string;
  pekerjaanIbu: string;
  noTelepon: string;
  email: string;
  tingkat: string;
  rombelId: string;
  rombelNama: string;
  jurusan: string;
  tahunMasuk: number | null;
  statusPesertaDidik: string;
  jenisKeluar: string | null;
  tanggalKeluar: string | null;
}

// ============================================
// DAPODIK TEACHER DATA FORMAT (Kemendikbud)
// ============================================

interface DapodikTeacherData {
  no: number;
  nuptk: string;
  nip: string;
  nik: string;
  namaLengkap: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: 'L' | 'P';
  agama: string;
  alamat: string;
  kabupaten: string;
  provinsi: string;
  noTelepon: string;
  email: string;
  statusKepegawaian: string;
  jenisPtk: string;
  tugasUtama: string;
  pendidikanTerakhir: string;
  bidangStudi: string;
  sertifikasiPendidik: boolean;
  tanggalMasuk: string;
  tmtPegawai: string | null;
  masaKerja: number;
}

// ============================================
// DAPODIK SCHOOL PROFILE FORMAT
// ============================================

interface DapodikSekolahData {
  npsn: string;
  namaSekolah: string;
  bentukPendidikan: string;
  statusSekolah: 'Negeri' | 'Swasta';
  alamat: string;
  kelurahan: string;
  kecamatan: string;
  kabupaten: string;
  provinsi: string;
  kodePos: string;
  lintang: string;
  bujur: string;
  noTelepon: string;
  noFax: string;
  email: string;
  website: string;
  akreditasi: string;
  waktuPenyelenggaraan: string;
  namaYayasan: string;
  skPendirian: string;
  tanggalSkPendirian: string;
  statusKepemilikan: string;
  luasTanah: number;
  jumlahSiswa: number;
  jumlahRombel: number;
  jumlahGuru: number;
  jumlahTendik: number;
}

// ============================================
// DAPODIK ROMBEL/CLASS DATA FORMAT
// ============================================

interface DapodikRombelData {
  rombelId: string;
  namaRombel: string;
  tingkat: string;
  kurikulum: string;
  waliKelas: string;
  nuptkWali: string;
  jumlahSiswa: number;
  siswaLaki: number;
  siswaPerempuan: number;
}

// ============================================
// SERVICE CLASS
// ============================================

class DapodikService {
  // Export student data in Dapodik format
  async exportStudentData(
    options: DapodikExportOptions,
    currentUser: AuthenticatedUser
  ): Promise<DapodikStudentData[]> {
    const unitId = writeUnitScopeFor(currentUser, options.unitId);

    const students = await prisma.student.findMany({
      where: {
        unitId,
        status: options.includeInactive ? undefined : 'active',
      },
      include: {
        enrollments: {
          where: { status: 'active' },
          include: { class: true },
          take: 1,
        },
        user: true,
      },
      orderBy: { user: { name: 'asc' } },
    });

    return students.map((student, index) => {
      const currentClass = student.enrollments[0]?.class;
      return {
        no: index + 1,
        nisn: student.nisn || '',
        nik: student.nik || '',
        namaLengkap: student.user.name,
        tempatLahir: student.birthPlace || '',
        tanggalLahir: student.birthDate ? this.formatDate(student.birthDate) : '',
        jenisKelamin: student.gender === Gender.MALE ? 'L' : 'P',
        agama: student.religion || 'Islam',
        alamat: student.address || '',
        rt: student.rt || '',
        rw: student.rw || '',
        kelurahan: student.villageId || '',
        kecamatan: student.districtId || '',
        kabupaten: student.regencyId || '',
        provinsi: student.provinceId || '',
        kodePos: student.postalCode || '',
        namaAyah: student.fatherName || '',
        nikAyah: student.fatherNik || '',
        pekerjaanAyah: student.fatherOccupation || '',
        namaIbu: student.motherName || '',
        nikIbu: student.motherNik || '',
        pekerjaanIbu: student.motherOccupation || '',
        noTelepon: student.parentPhone || '',
        email: student.parentEmail || '',
        tingkat: currentClass?.level || '',
        rombelId: currentClass?.id || '',
        rombelNama: currentClass?.name || '',
        jurusan: '',
        tahunMasuk: student.entryYear,
        statusPesertaDidik: student.status === 'active' ? 'Aktif' : 'Keluar',
        jenisKeluar: student.status === 'active' ? null : 'Mutasi',
        tanggalKeluar: null,
      };
    });
  }

  // Export teacher data in Dapodik format
  async exportTeacherData(
    options: DapodikExportOptions,
    currentUser: AuthenticatedUser
  ): Promise<DapodikTeacherData[]> {
    const unitId = writeUnitScopeFor(currentUser, options.unitId);

    // Use Teacher model instead of generic Employee
    const teachers = await prisma.teacher.findMany({
      where: {
        unitId,
        user: { isActive: options.includeInactive ? undefined : true },
      },
      include: {
        user: true,
      },
      orderBy: { user: { name: 'asc' } },
    });

    const startDate = new Date();

    return teachers.map((teacher, index) => ({
      no: index + 1,
      nuptk: teacher.nuptk || '',
      nip: teacher.nip || '',
      nik: teacher.nik || '',
      namaLengkap: teacher.user.name,
      tempatLahir: teacher.birthPlace || '',
      tanggalLahir: teacher.birthDate ? this.formatDate(teacher.birthDate) : '',
      jenisKelamin: teacher.gender === Gender.MALE ? 'L' : 'P',
      agama: teacher.religion || 'Islam',
      alamat: teacher.address || '',
      kabupaten: teacher.regencyId || '',
      provinsi: teacher.provinceId || '',
      noTelepon: teacher.user.phone || '',
      email: teacher.user.email,
      statusKepegawaian: teacher.employmentStatus || 'GTY',
      jenisPtk: 'Guru',
      tugasUtama: 'Guru Kelas/Mapel',
      pendidikanTerakhir: teacher.lastEducation || '',
      bidangStudi: teacher.specialization || '',
      sertifikasiPendidik: teacher.certificationStatus === 'SUDAH_SERTIFIKASI',
      tanggalMasuk: teacher.joinDate ? this.formatDate(teacher.joinDate) : '',
      tmtPegawai: teacher.tmtGuru ? this.formatDate(teacher.tmtGuru) : null,
      masaKerja: teacher.joinDate
        ? Math.floor(
            (startDate.getTime() - teacher.joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
          )
        : 0,
    }));
  }

  // Export rombel/class data
  async exportRombelData(
    options: DapodikExportOptions,
    currentUser: AuthenticatedUser
  ): Promise<DapodikRombelData[]> {
    const unitId = writeUnitScopeFor(currentUser, options.unitId);

    const classes = await prisma.class.findMany({
      where: {
        unitId,
        academicYearId: options.academicYearId || undefined,
      },
      include: {
        homeroomTeacher: {
          include: {
            user: true,
          },
        },
        _count: {
          select: { enrollments: { where: { status: 'active' } } },
        },
        enrollments: {
          where: { status: 'active' },
          include: { student: true },
        },
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });

    return classes.map((cls) => ({
      rombelId: cls.id,
      namaRombel: cls.name,
      tingkat: cls.level,
      kurikulum: 'Kurikulum Merdeka',
      waliKelas: cls.homeroomTeacher?.user?.name || '',
      nuptkWali: cls.homeroomTeacher?.nuptk || '',
      jumlahSiswa: cls._count.enrollments,
      siswaLaki: cls.enrollments.filter((e) => e.student.gender === Gender.MALE).length,
      siswaPerempuan: cls.enrollments.filter((e) => e.student.gender === Gender.FEMALE).length,
    }));
  }

  // Export school profile data
  async exportSekolahData(
    unitId: string,
    currentUser: AuthenticatedUser
  ): Promise<DapodikSekolahData> {
    if (!actorReachesUnit(currentUser, unitId)) {
      throw Errors.forbidden('Tidak memiliki akses ke unit ini');
    }

    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: {
        _count: {
          select: {
            students: { where: { status: 'active' } },
            classes: true,
            teachers: true,
            staff: true,
          },
        },
      },
    });

    if (!unit) {
      throw Errors.notFound('Unit tidak ditemukan');
    }

    return {
      npsn: unit.npsn || '',
      namaSekolah: unitDocumentName(unit),
      bentukPendidikan: this.mapUnitTypeToDapodik(unit.type),
      statusSekolah: 'Swasta',
      alamat: unit.address || '',
      kelurahan: '',
      kecamatan: '',
      kabupaten: '',
      provinsi: '',
      kodePos: '',
      lintang: '',
      bujur: '',
      noTelepon: unit.phone || '',
      noFax: '',
      email: unit.email || '',
      website: '',
      // The certificate in force (decisions/akreditasi-unit.md), never a guess.
      akreditasi: (await currentAccreditations([unit.id])).get(unit.id)?.rating ?? '',
      waktuPenyelenggaraan: 'Pagi',
      namaYayasan: 'Yayasan Cipansor',
      skPendirian: '',
      tanggalSkPendirian: '',
      statusKepemilikan: 'Yayasan',
      luasTanah: 0,
      jumlahSiswa: unit._count.students,
      jumlahRombel: unit._count.classes,
      jumlahGuru: unit._count.teachers,
      jumlahTendik: unit._count.staff,
    };
  }

  // Get export summary for validation
  async getExportSummary(unitId: string, currentUser: AuthenticatedUser) {
    if (!actorReachesUnit(currentUser, unitId)) {
      throw Errors.forbidden('Tidak memiliki akses ke unit ini');
    }

    const [studentCount, teacherCount, classCount] = await Promise.all([
      prisma.student.count({ where: { unitId, status: 'active' } }),
      prisma.teacher.count({
        where: {
          unitId,
          user: { isActive: true },
        },
      }),
      prisma.class.count({ where: { unitId } }),
    ]);

    // Check NISN completeness
    const studentsWithNisn = await prisma.student.count({
      where: { unitId, status: 'active', nisn: { not: null } },
    });

    // Check NUPTK completeness
    const teachersWithNuptk = await prisma.teacher.count({
      where: {
        unitId,
        user: { isActive: true },
        nuptk: { not: null },
      },
    });

    const nisnRate = studentCount > 0 ? (studentsWithNisn / studentCount) * 100 : 0;
    const nuptkRate = teacherCount > 0 ? (teachersWithNuptk / teacherCount) * 100 : 0;

    return {
      students: {
        total: studentCount,
        withNisn: studentsWithNisn,
        completeness: Math.round(nisnRate),
      },
      teachers: {
        total: teacherCount,
        withNuptk: teachersWithNuptk,
        completeness: Math.round(nuptkRate),
      },
      classes: classCount,
      readiness: this.calculateReadinessScore({ nisnRate, nuptkRate }),
    };
  }

  // Validate data before export
  async validateData(unitId: string, currentUser: AuthenticatedUser) {
    if (!actorReachesUnit(currentUser, unitId)) {
      throw Errors.forbidden('Tidak memiliki akses ke unit ini');
    }

    const issues: {
      type: string;
      severity: 'error' | 'warning';
      message: string;
      count: number;
    }[] = [];

    // Check students without NISN
    const studentsWithoutNisn = await prisma.student.count({
      where: { unitId, status: 'active', OR: [{ nisn: null }, { nisn: '' }] },
    });
    if (studentsWithoutNisn > 0) {
      issues.push({
        type: 'MISSING_NISN',
        severity: 'error',
        message: `${studentsWithoutNisn} siswa belum memiliki NISN`,
        count: studentsWithoutNisn,
      });
    }

    // Check teachers without NUPTK
    const teachersWithoutNuptk = await prisma.teacher.count({
      where: {
        unitId,
        user: { isActive: true },
        OR: [{ nuptk: null }, { nuptk: '' }],
      },
    });
    if (teachersWithoutNuptk > 0) {
      issues.push({
        type: 'MISSING_NUPTK',
        severity: 'warning',
        message: `${teachersWithoutNuptk} guru belum memiliki NUPTK`,
        count: teachersWithoutNuptk,
      });
    }

    // Check students without NIK
    const studentsWithoutNik = await prisma.student.count({
      where: { unitId, status: 'active', OR: [{ nik: null }, { nik: '' }] },
    });
    if (studentsWithoutNik > 0) {
      issues.push({
        type: 'MISSING_NIK',
        severity: 'warning',
        message: `${studentsWithoutNik} siswa belum memiliki NIK`,
        count: studentsWithoutNik,
      });
    }

    return {
      isValid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      totalErrors: issues.filter((i) => i.severity === 'error').length,
      totalWarnings: issues.filter((i) => i.severity === 'warning').length,
    };
  }

  // Helper functions
  private formatDate(date: Date): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private mapUnitTypeToDapodik(type: UnitType): string {
    const map: Record<string, string> = {
      PAUD: 'PAUD',
      TK_QURAN: 'TK',
      SD_IT: 'SD',
      SMP_IT: 'SMP',
      SMA_QURAN: 'SMA',
      PESANTREN: 'Pondok Pesantren',
      OTHER: 'Lainnya',
    };
    return map[type] || type;
  }

  private calculateReadinessScore(data: { nisnRate: number; nuptkRate: number }): number {
    return Math.round(data.nisnRate * 0.6 + data.nuptkRate * 0.4);
  }
}

export const dapodikService = new DapodikService();
