/**
 * Paket data contoh untuk presentasi ke yayasan.
 *
 * Seed dasar (seed.ts) tumbuh modul demi modul: tiap fitur diberi satu-dua
 * baris supaya halamannya tidak kosong. Hasilnya 13 santri untuk empat unit,
 * satu kelas per unit (kelas SMA Qur'an bernama "7A"), mata pelajaran dan jenis
 * pembayaran hanya untuk SMP IT, dua Ketua Yayasan, dan dokumen perencanaan yang
 * disahkan orang yang tidak ada di daftar pengurus. Setiap halaman "ada isinya",
 * tapi gambaran utuhnya tidak masuk akal.
 *
 * Paket ini menyusun satu tahun ajaran yang berjalan dari awal sampai kemarin,
 * saling menyambung:
 *
 *   rombel per jenjang → santri + wali → jadwal → presensi → ulangan & nilai →
 *   rapor semester lalu → tagihan & pembayaran → setoran tahfidz → asrama →
 *   kedisiplinan & perizinan → SPMB tahun depan → kalender.
 *
 * Aturannya:
 * - **Aditif dan idempoten.** Tidak ada TRUNCATE dan tidak ada yang dihapus.
 *   Data yang sudah ada dirapikan di tempat (kelas SMA "7A" jadi "10A", santri
 *   tanpa kelas dimasukkan ke rombel). Kalau paket sudah pernah dijalankan (SD
 *   IT punya rombel 6A di tahun ajaran aktif), ia berhenti tanpa menulis apa
 *   pun. Karena itu ia aman dijalankan di atas basis data yang sudah terisi.
 *   Ia hanya jalan lewat `db:seed:presentasi`; `db:seed` sengaja tidak
 *   memanggilnya (alasannya di prisma/AGENTS.md).
 * - **Tanggal diturunkan dari `now`**, seperti academic-calendar.ts: tahun
 *   ajaran berjalan, presensi sampai kemarin, ulangan yang tanggalnya belum
 *   lewat berstatus terjadwal. Seed yang dijalankan kapan pun tetap masuk akal.
 * - **Tidak ada pesan keluar ke orang sungguhan.** Akun wali yang dibuat di sini
 *   tidak punya nomor HP (`User.phone` kosong), padahal job pengingat SPP
 *   mengirim WhatsApp ke nomor itu setiap tanggal 1. Nomor yang hanya
 *   ditampilkan (`Student.parentPhone`) memakai awalan 0800, bukan seluler.
 *   Alamat e-mail memakai pola `santri.<nis>@` / `wali.<n>@` di domain sendiri.
 * - **Tidak ada fakta yang dikarang.** Identitas yayasan diambil dari
 *   packages/shared/src/public-site.ts (fakta yang sudah terverifikasi untuk
 *   situs publik). Tanggal pendirian dan NPWP yang tidak diketahui dikosongkan,
 *   bukan diisi tebakan. Kode wilayah Kemendagri tidak diisi karena tabel
 *   wilayah hasil seed hanya memuat sampel Sukabumi.
 * - Angka (jumlah santri, tarif, nilai) adalah contoh, bukan data yayasan.
 */
import {
  AdmissionStatus,
  AttendanceStatus,
  BloodType,
  DayOfWeek,
  EducationLevel,
  EmploymentStatus,
  EventScope,
  EventType,
  ExamStatus,
  ExamType,
  Gender,
  GradeType,
  HealthStatus,
  MedicalRecordType,
  IncomeRange,
  MurojaahType,
  NotificationType,
  OccupationType,
  PaymentMethod,
  PaymentStatus,
  PaymentVerificationStatus,
  PermitDecider,
  PermitStatus,
  PermitType,
  Prisma,
  QuranAbility,
  PrismaClient,
  StaffAttendanceStatus,
  SubjectType,
  TahfidzActivityType,
  TakhosusStatus,
  TransportMode,
  UnitType,
  UserRole,
  ViolationType,
} from '@prisma/client';
import {
  academicYearStarting,
  admissionWindows,
  currentAcademicYear,
  nextAcademicYear,
} from '../../src/lib/academic-calendar';
import { ensureDemoIntake } from './spmb-demo';
import { syncParentRoleAssignments, type ParentScopeClient } from '../../src/utils/parent-scope';
import { QURAN_SURAHS } from '../../src/modules/tahfidz/quran-surahs';
import { YAYASAN_ORGANS } from '../../../../packages/shared/src/types/office-holders';
import { siteConfig } from '../../../../packages/shared/src/public-site';
import { randomUUID } from 'crypto';

// ============================================================================
// Rujukan
// ============================================================================

type SchoolUnit = 'TK_QURAN' | 'SD_IT' | 'SMP_IT' | 'SMA_QURAN';

/** Awalan RoleCode per unit (TK tidak punya peran santri). */
const ROLE_PREFIX: Record<SchoolUnit, string> = {
  TK_QURAN: 'TKQ',
  SD_IT: 'SDIT',
  SMP_IT: 'SMPIT',
  SMA_QURAN: 'SMAQ',
};

/** Dua digit kode unit di NIS: 26 02 017 = masuk 2026, SD IT, urutan 17. */
const NIS_UNIT_CODE: Record<SchoolUnit, string> = {
  TK_QURAN: '01',
  SD_IT: '02',
  SMP_IT: '03',
  SMA_QURAN: '04',
};

interface ClassPlan {
  name: string;
  level: string;
  /** Urutan tingkat di dalam unit, 0 = tingkat masuk. */
  grade: number;
  size: number;
  /** SMP dan SMA memisahkan rombel putra (A) dan putri (B). */
  gender?: Gender;
  /** Usia santri pada 15 Juli tahun ajaran berjalan. */
  age: number;
  homeroom: string;
}

const CLASS_PLAN: Record<SchoolUnit, ClassPlan[]> = {
  TK_QURAN: [
    {
      name: 'TK A',
      level: 'A',
      grade: 0,
      size: 10,
      age: 4,
      homeroom: 'tkq.walikelas@cipansor.or.id',
    },
    { name: 'TK B', level: 'B', grade: 1, size: 10, age: 5, homeroom: 'tkq.guru@cipansor.or.id' },
  ],
  SD_IT: [
    { name: '1A', level: '1', grade: 0, size: 8, age: 6, homeroom: 'fatimah@cipansor.or.id' },
    {
      name: '2A',
      level: '2',
      grade: 1,
      size: 8,
      age: 7,
      homeroom: 'sdit.walikelas@cipansor.or.id',
    },
    { name: '3A', level: '3', grade: 2, size: 8, age: 8, homeroom: 'sdit.guru@cipansor.or.id' },
    { name: '4A', level: '4', grade: 3, size: 8, age: 9, homeroom: 'guru.sdit.pkn@cipansor.or.id' },
    {
      name: '5A',
      level: '5',
      grade: 4,
      size: 8,
      age: 10,
      homeroom: 'guru.sdit.arb@cipansor.or.id',
    },
    {
      name: '6A',
      level: '6',
      grade: 5,
      size: 8,
      age: 11,
      homeroom: 'guru.sdit.big@cipansor.or.id',
    },
  ],
  SMP_IT: [
    {
      name: '7A',
      level: '7',
      grade: 0,
      size: 8,
      gender: Gender.MALE,
      age: 12,
      homeroom: 'ahmad@cipansor.or.id',
    },
    {
      name: '7B',
      level: '7',
      grade: 0,
      size: 8,
      gender: Gender.FEMALE,
      age: 12,
      homeroom: 'smpit.walikelas@cipansor.or.id',
    },
    {
      name: '8A',
      level: '8',
      grade: 1,
      size: 8,
      gender: Gender.MALE,
      age: 13,
      homeroom: 'smpit.guru@cipansor.or.id',
    },
    {
      name: '8B',
      level: '8',
      grade: 1,
      size: 8,
      gender: Gender.FEMALE,
      age: 13,
      homeroom: 'guru.smpit.big@cipansor.or.id',
    },
    {
      name: '9A',
      level: '9',
      grade: 2,
      size: 8,
      gender: Gender.MALE,
      age: 14,
      homeroom: 'guru.smpit.qhd@cipansor.or.id',
    },
    {
      name: '9B',
      level: '9',
      grade: 2,
      size: 8,
      gender: Gender.FEMALE,
      age: 14,
      homeroom: 'guru.smpit.ips@cipansor.or.id',
    },
  ],
  SMA_QURAN: [
    {
      name: '10A',
      level: '10',
      grade: 0,
      size: 8,
      gender: Gender.MALE,
      age: 15,
      homeroom: 'smaq.guru@cipansor.or.id',
    },
    {
      name: '10B',
      level: '10',
      grade: 0,
      size: 8,
      gender: Gender.FEMALE,
      age: 15,
      homeroom: 'smaq.walikelas@cipansor.or.id',
    },
    {
      name: '11A',
      level: '11',
      grade: 1,
      size: 8,
      gender: Gender.MALE,
      age: 16,
      homeroom: 'guru.smaq.pai@cipansor.or.id',
    },
    {
      name: '11B',
      level: '11',
      grade: 1,
      size: 8,
      gender: Gender.FEMALE,
      age: 16,
      homeroom: 'guru.smaq.bio@cipansor.or.id',
    },
    {
      name: '12A',
      level: '12',
      grade: 2,
      size: 8,
      gender: Gender.MALE,
      age: 17,
      homeroom: 'guru.smaq.fis@cipansor.or.id',
    },
    {
      name: '12B',
      level: '12',
      grade: 2,
      size: 8,
      gender: Gender.FEMALE,
      age: 17,
      homeroom: 'guru.smaq.kim@cipansor.or.id',
    },
  ],
};

interface NewTeacher {
  email: string;
  name: string;
  gender: Gender;
  education: EducationLevel;
  major: string;
}

/**
 * Guru yang belum ada di seed dasar. Satu guru satu mata pelajaran: dengan itu
 * jadwal yang disusun di bawah tidak pernah menaruh satu guru di dua kelas pada
 * jam yang sama.
 */
const NEW_TEACHERS: Record<SchoolUnit, NewTeacher[]> = {
  TK_QURAN: [],
  SD_IT: [
    {
      email: 'guru.sdit.pkn@cipansor.or.id',
      name: 'Ustadzah Rina Nurlaela, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'PGSD',
    },
    {
      email: 'guru.sdit.sbd@cipansor.or.id',
      name: 'Ustadzah Lia Amalia, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Seni',
    },
    {
      email: 'guru.sdit.pjok@cipansor.or.id',
      name: 'Ustadz Rendi Firmansyah, S.Pd.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Jasmani',
    },
    {
      email: 'guru.sdit.big@cipansor.or.id',
      name: 'Ustadzah Nisa Khairunnisa, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Bahasa Inggris',
    },
    {
      email: 'guru.sdit.arb@cipansor.or.id',
      name: 'Ustadz Irfan Maulana, S.Pd.I.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Bahasa Arab',
    },
    {
      email: 'guru.sdit.thf@cipansor.or.id',
      name: 'Ustadz Fikri Haikal, Al-Hafidz',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: "Ilmu Al-Qur'an dan Tafsir",
    },
  ],
  SMP_IT: [
    {
      email: 'guru.smpit.big@cipansor.or.id',
      name: 'Ustadzah Salma Nabila, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Bahasa Inggris',
    },
    {
      email: 'guru.smpit.ips@cipansor.or.id',
      name: 'Ustadzah Rahmi Fauziah, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan IPS',
    },
    {
      email: 'guru.smpit.pjok@cipansor.or.id',
      name: 'Ustadz Yogi Pratama, S.Pd.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Jasmani',
    },
    {
      email: 'guru.smpit.qhd@cipansor.or.id',
      name: 'Ustadz Hasan Mubarok, Lc.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Hadits',
    },
    {
      email: 'guru.smpit.pkn@cipansor.or.id',
      name: 'Ustadz Dani Ramdani, S.Pd.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Pancasila dan Kewarganegaraan',
    },
    {
      email: 'guru.smpit.inf@cipansor.or.id',
      name: 'Ustadzah Nadia Rahmawati, S.Kom.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Teknik Informatika',
    },
  ],
  SMA_QURAN: [
    {
      email: 'guru.smaq.pai@cipansor.or.id',
      name: 'Ustadz Abdul Aziz, Lc.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Syariah',
    },
    {
      email: 'guru.smaq.pkn@cipansor.or.id',
      name: 'Ustadzah Ai Nurhasanah, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Pancasila dan Kewarganegaraan',
    },
    {
      email: 'guru.smaq.fis@cipansor.or.id',
      name: 'Ustadz Galih Pratama, S.Pd.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Fisika',
    },
    {
      email: 'guru.smaq.kim@cipansor.or.id',
      name: 'Ustadzah Yulia Rahman, S.Si.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Kimia',
    },
    {
      email: 'guru.smaq.bio@cipansor.or.id',
      name: 'Ustadzah Intan Permatasari, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Biologi',
    },
    {
      email: 'guru.smaq.sej@cipansor.or.id',
      name: 'Ustadz Fajar Nugraha, S.Pd.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Sejarah',
    },
    {
      email: 'guru.smaq.big@cipansor.or.id',
      name: 'Ustadzah Mira Lestari, S.Pd.',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: 'Pendidikan Bahasa Inggris',
    },
    {
      email: 'guru.smaq.thf@cipansor.or.id',
      name: 'Ustadz Zaki Mubarak, Al-Hafidz',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: "Ilmu Al-Qur'an dan Tafsir",
    },
    {
      email: 'guru.smaq.thfp@cipansor.or.id',
      name: 'Ustadzah Hilyah Fauziyyah, Al-Hafidzah',
      gender: Gender.FEMALE,
      education: EducationLevel.S1,
      major: "Ilmu Al-Qur'an dan Tafsir",
    },
    {
      email: 'guru.smaq.tfs@cipansor.or.id',
      name: 'Ustadz Ihsan Nurdin, Lc.',
      gender: Gender.MALE,
      education: EducationLevel.S1,
      major: 'Tafsir',
    },
  ],
};

interface SubjectPlan {
  code: string;
  name: string;
  credits: number;
  /** Email pengampu; `female` dipakai untuk rombel putri bila berbeda. */
  teacher: string;
  female?: string;
}

const SUBJECT_PLAN: Record<Exclude<SchoolUnit, 'TK_QURAN'>, SubjectPlan[]> = {
  SD_IT: [
    {
      code: 'PAI',
      name: 'Pendidikan Agama Islam dan Budi Pekerti',
      credits: 4,
      teacher: 'sdit.guru@cipansor.or.id',
    },
    {
      code: 'PKN',
      name: 'Pendidikan Pancasila',
      credits: 3,
      teacher: 'guru.sdit.pkn@cipansor.or.id',
    },
    { code: 'BIN', name: 'Bahasa Indonesia', credits: 5, teacher: 'fatimah@cipansor.or.id' },
    { code: 'MTK', name: 'Matematika', credits: 5, teacher: 'sdit.walikelas@cipansor.or.id' },
    {
      code: 'IPAS',
      name: 'Ilmu Pengetahuan Alam dan Sosial',
      credits: 4,
      teacher: 'sdit.wakasek@cipansor.or.id',
    },
    { code: 'SBD', name: 'Seni Budaya', credits: 2, teacher: 'guru.sdit.sbd@cipansor.or.id' },
    {
      code: 'PJOK',
      name: 'Pendidikan Jasmani, Olahraga, dan Kesehatan',
      credits: 2,
      teacher: 'guru.sdit.pjok@cipansor.or.id',
    },
    { code: 'BIG', name: 'Bahasa Inggris', credits: 2, teacher: 'guru.sdit.big@cipansor.or.id' },
    { code: 'ARB', name: 'Bahasa Arab', credits: 2, teacher: 'guru.sdit.arb@cipansor.or.id' },
    { code: 'THF', name: "Tahfidz Al-Qur'an", credits: 4, teacher: 'guru.sdit.thf@cipansor.or.id' },
  ],
  SMP_IT: [
    { code: 'AQD', name: 'Akidah Akhlak', credits: 2, teacher: 'pesantren.ustadz@cipansor.or.id' },
    { code: 'QHD', name: "Al-Qur'an Hadis", credits: 2, teacher: 'guru.smpit.qhd@cipansor.or.id' },
    { code: 'FIQ', name: 'Fikih', credits: 2, teacher: 'ahmad@cipansor.or.id' },
    {
      code: 'SKI',
      name: 'Sejarah Kebudayaan Islam',
      credits: 2,
      teacher: 'pesantren.murabbi@cipansor.or.id',
    },
    {
      code: 'PKN',
      name: 'Pendidikan Pancasila',
      credits: 2,
      teacher: 'guru.smpit.pkn@cipansor.or.id',
    },
    {
      code: 'BIN',
      name: 'Bahasa Indonesia',
      credits: 4,
      teacher: 'smpit.walikelas@cipansor.or.id',
    },
    { code: 'MTK', name: 'Matematika', credits: 4, teacher: 'smpit.guru@cipansor.or.id' },
    {
      code: 'IPA',
      name: 'Ilmu Pengetahuan Alam',
      credits: 4,
      teacher: 'smpit.wakasek@cipansor.or.id',
    },
    {
      code: 'IPS',
      name: 'Ilmu Pengetahuan Sosial',
      credits: 3,
      teacher: 'guru.smpit.ips@cipansor.or.id',
    },
    { code: 'BIG', name: 'Bahasa Inggris', credits: 3, teacher: 'guru.smpit.big@cipansor.or.id' },
    { code: 'ARB', name: 'Bahasa Arab', credits: 3, teacher: 'smpit.kepala@cipansor.or.id' },
    { code: 'INF', name: 'Informatika', credits: 2, teacher: 'guru.smpit.inf@cipansor.or.id' },
    {
      code: 'PJK',
      name: 'Pendidikan Jasmani, Olahraga, dan Kesehatan',
      credits: 2,
      teacher: 'guru.smpit.pjok@cipansor.or.id',
    },
    {
      code: 'THF',
      name: "Tahfidz Al-Qur'an",
      credits: 4,
      teacher: 'pesantren.muhafidz@cipansor.or.id',
      female: 'pesantren.muhafidzah@cipansor.or.id',
    },
  ],
  SMA_QURAN: [
    {
      code: 'PAI',
      name: 'Pendidikan Agama Islam dan Budi Pekerti',
      credits: 3,
      teacher: 'guru.smaq.pai@cipansor.or.id',
    },
    { code: 'TFS', name: 'Tafsir', credits: 2, teacher: 'guru.smaq.tfs@cipansor.or.id' },
    {
      code: 'PKN',
      name: 'Pendidikan Pancasila',
      credits: 2,
      teacher: 'guru.smaq.pkn@cipansor.or.id',
    },
    { code: 'BIN', name: 'Bahasa Indonesia', credits: 4, teacher: 'smaq.walikelas@cipansor.or.id' },
    { code: 'MTK', name: 'Matematika', credits: 4, teacher: 'smaq.wakasek@cipansor.or.id' },
    { code: 'FIS', name: 'Fisika', credits: 3, teacher: 'guru.smaq.fis@cipansor.or.id' },
    { code: 'KIM', name: 'Kimia', credits: 3, teacher: 'guru.smaq.kim@cipansor.or.id' },
    { code: 'BIO', name: 'Biologi', credits: 3, teacher: 'guru.smaq.bio@cipansor.or.id' },
    { code: 'SEJ', name: 'Sejarah', credits: 2, teacher: 'guru.smaq.sej@cipansor.or.id' },
    { code: 'BIG', name: 'Bahasa Inggris', credits: 3, teacher: 'guru.smaq.big@cipansor.or.id' },
    { code: 'ARB', name: 'Bahasa Arab', credits: 3, teacher: 'smaq.guru@cipansor.or.id' },
    {
      code: 'THF',
      name: "Tahfidz Al-Qur'an",
      credits: 4,
      teacher: 'guru.smaq.thf@cipansor.or.id',
      female: 'guru.smaq.thfp@cipansor.or.id',
    },
  ],
};

/** Tarif contoh per bulan / sekali bayar. Bukan tarif yayasan. */
const PAYMENT_PLAN: Record<
  SchoolUnit,
  Array<{ code: string; name: string; amount: number; recurring: boolean }>
> = {
  TK_QURAN: [
    { code: 'SPP', name: 'SPP Bulanan', amount: 200_000, recurring: true },
    { code: 'DU', name: 'Daftar Ulang & Uang Pangkal', amount: 750_000, recurring: false },
  ],
  SD_IT: [
    { code: 'SPP', name: 'SPP Bulanan', amount: 350_000, recurring: true },
    { code: 'DU', name: 'Daftar Ulang & Uang Pangkal', amount: 1_000_000, recurring: false },
  ],
  SMP_IT: [
    { code: 'SPP', name: 'SPP Bulanan', amount: 500_000, recurring: true },
    { code: 'ASRAMA', name: 'Biaya Asrama', amount: 300_000, recurring: true },
    { code: 'MAKAN', name: 'Biaya Makan', amount: 750_000, recurring: true },
    { code: 'EKSKUL', name: 'Kegiatan Ekstrakurikuler', amount: 100_000, recurring: true },
    { code: 'DU', name: 'Daftar Ulang & Uang Pangkal', amount: 1_500_000, recurring: false },
  ],
  SMA_QURAN: [
    { code: 'SPP', name: 'SPP Bulanan', amount: 550_000, recurring: true },
    { code: 'ASRAMA', name: 'Biaya Asrama', amount: 300_000, recurring: true },
    { code: 'MAKAN', name: 'Biaya Makan', amount: 750_000, recurring: true },
    { code: 'DU', name: 'Daftar Ulang & Uang Pangkal', amount: 1_750_000, recurring: false },
  ],
};

const RELIGIOUS_SUBJECTS = new Set(['PAI', 'AQD', 'QHD', 'FIQ', 'SKI', 'TFS']);
function subjectTypeOf(code: string): SubjectType {
  if (code === 'THF') return SubjectType.TAHFIDZ;
  return RELIGIOUS_SUBJECTS.has(code) ? SubjectType.RELIGIOUS : SubjectType.ACADEMIC;
}

const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const BOY_NAMES = [
  'Muhammad',
  'Ahmad',
  'Abdullah',
  'Umar',
  'Ali',
  'Hasan',
  'Husain',
  'Fathan',
  'Rafka',
  'Azka',
  'Daffa',
  'Rayyan',
  'Fariz',
  'Hanif',
  'Zaki',
  'Naufal',
  'Fikri',
  'Haikal',
  'Alif',
  'Ilham',
  'Rizki',
  'Faiz',
  'Arkan',
  'Ghifari',
  'Syauqi',
  'Rasyid',
  'Nabil',
  'Yusuf',
  'Ibrahim',
  'Ismail',
  'Khalid',
  'Salman',
  'Faqih',
  'Rafi',
  'Aqil',
  'Irsyad',
  'Luthfi',
  'Zidan',
  'Hilmi',
  'Raihan',
];
const BOY_SECOND = [
  'Al-Fatih',
  'Ramadhan',
  'Firdaus',
  'Hidayat',
  'Maulana',
  'Syahputra',
  'Rahman',
  'Hakim',
  'Nugraha',
  'Pratama',
  'Ramdani',
  'Hamdani',
  'Fauzan',
  'Mubarok',
  'Al-Ghifari',
  'Khairul Anam',
  'Ihsan',
  'Saputra',
  'Permana',
  'Kurniawan',
  'Abdurrahman',
  'Zulfikar',
  'Hafizhan',
  'Taqiyuddin',
];
const GIRL_NAMES = [
  'Aisyah',
  'Fatimah',
  'Khadijah',
  'Zahra',
  'Nayla',
  'Salma',
  'Hana',
  'Nabila',
  'Syifa',
  'Alya',
  'Kayla',
  'Aqila',
  'Maryam',
  'Zainab',
  'Azzahra',
  'Najwa',
  'Safira',
  'Tsabita',
  'Hilya',
  'Nadhira',
  'Qonita',
  'Shafa',
  'Rania',
  'Annisa',
  'Farah',
  'Khalisa',
  'Luthfiyah',
  'Mutiara',
  'Rahma',
  'Sakinah',
  'Sausan',
  'Zulfa',
  'Azkia',
  'Dzakira',
  'Kamila',
  'Latifa',
  'Meisya',
  'Hasna',
  'Humaira',
  'Nurul',
];
const GIRL_SECOND = [
  'Nur Aini',
  'Putri',
  'Rahmawati',
  'Fitriani',
  'Salsabila',
  'Humaira',
  'Khairunnisa',
  'Nurhaliza',
  'Aulia',
  'Ramadhani',
  'Fadhilah',
  'Maharani',
  'Kamila',
  'Nuraeni',
  'Anggraeni',
  'Septiani',
  'Rizqiyah',
  'Hasanah',
  'Az-Zahra',
  'Mardhiyah',
  'Qurrota Ayun',
  'Syakira',
  'Zakiyyah',
  'Hanifah',
];
const FATHER_NAMES = [
  'Asep Saepudin',
  'Ujang Rahmat',
  'Dede Kurnia',
  'Deden Hermawan',
  'Iwan Setiawan',
  'Yayan Suryana',
  'Cecep Supriatna',
  'Dadang Sudrajat',
  'Agus Rustandi',
  'Wawan Kurniawan',
  'Heri Hidayat',
  'Ade Mulyana',
  'Endang Sopandi',
  'Jajang Nurjaman',
  'Nandang Suherman',
  'Oman Abdurahman',
  'Tatang Ruhimat',
  'Engkus Kusnadi',
  'Budi Permana',
  'Yusuf Firmansyah',
  'Ridwan Saputra',
  'Aan Anwar',
  'Iman Nurjaman',
  'Dodi Ruswandi',
  'Lukman Hakim',
  'Usep Mulyadi',
  'Taufik Rahman',
  'Ikin Sodikin',
  'Maman Suparman',
  'Ahmad Hidayatullah',
  'Yana Mulyana',
  'Sopian Hadi',
  'Dian Hardiana',
  'Eman Sulaeman',
  'Opik Taufik',
  'Encep Hidayat',
  'Aep Saepuloh',
  'Didin Wahyudin',
  'Mamat Rahmat',
  'Undang Sunarya',
  'Wahyu Hidayat',
  'Rahmat Hidayat',
  'Ayi Kurniawan',
  'Ogi Suganda',
  'Jaja Sukmara',
  'Enjang Kurnia',
  'Ruhiyat Hidayat',
  'Mulyadi Saputra',
  'Hamdan Nurdin',
  'Kosasih Permana',
  'Nana Suryana',
  'Ujang Solihin',
  'Atep Supriadi',
  'Asep Kurnia',
  'Deni Ruhiyat',
  'Irwan Gunawan',
  'Ade Suparman',
  'Tedi Rustandi',
  'Oding Sukanda',
  'Gugun Gunawan',
  'Endi Suhendi',
  'Cahya Permana',
  'Sukma Wijaya',
  'Hendi Hermawan',
];
const MOTHER_NAMES = [
  'Euis Komariah',
  'Neneng Hasanah',
  'Iis Aisyah',
  'Lilis Suryani',
  'Siti Rohmah',
  'Tati Sumiati',
  'Eti Rohaeti',
  'Nining Suningsih',
  'Ai Rosita',
  'Enok Nurhayati',
  'Popon Rosmiati',
  'Wiwin Winarti',
  'Ela Nurlaela',
  'Imas Masitoh',
  'Yuyun Yuniarti',
  'Heni Herlina',
  'Cucu Sumiati',
  'Ani Suryani',
  'Irma Suryani',
  'Lina Marlina',
  'Eneng Maryam',
  'Rika Rostika',
  'Mimin Mintarsih',
  'Titin Kartini',
  'Nani Rohaeni',
  'Oom Komariah',
  'Iin Inayah',
  'Yati Rohayati',
  'Wati Hermawati',
  'Evi Nurlaela',
  'Dedeh Kurniasih',
  'Elis Sulastri',
  'Aas Asiah',
  'Rini Andriani',
  'Nurjanah Hasanah',
  'Lela Nurlela',
  'Ipah Saripah',
  'Enung Nurhayati',
  'Uum Umiyati',
  'Nenden Sulastri',
  'Rosmiati Hasanah',
  'Yeti Suryati',
  'Nia Rahmawati',
  'Anih Kurniasih',
  'Ika Rostika',
  'Rina Herlina',
  'Sri Mulyani',
  'Neni Hendrawati',
  'Dewi Kurniasih',
  'Tini Suhartini',
  'Omah Maryamah',
  'Ucu Nurhayati',
  'Ening Suningsih',
  'Ros Rosita',
  'Lia Yuliani',
  'Tuti Alawiyah',
  'Ika Nurhayati',
  'Mira Rostiani',
  'Yani Maryani',
  'Eka Nurjanah',
  'Leni Marlina',
  'Ita Rosita',
  'Fitri Handayani',
  'Siti Maesaroh',
];
const BIRTH_PLACES = [
  'Tasikmalaya',
  'Tasikmalaya',
  'Tasikmalaya',
  'Tasikmalaya',
  'Tasikmalaya',
  'Garut',
  'Ciamis',
  'Bandung',
  'Majalengka',
  'Sumedang',
];
const KAMPUNG = [
  'Nyalindung',
  'Cipansor',
  'Babakan',
  'Sukamaju',
  'Cibeureum',
  'Pasirkaler',
  'Cikoneng',
  'Sindangsari',
  'Legok',
  'Pangkalan',
  'Cisalak',
  'Sukahurip',
  'Margaluyu',
  'Cilumpang',
];
/** Kecamatan di Kabupaten Tasikmalaya di sekitar Kadipaten. */
const KECAMATAN = [
  'Kadipaten',
  'Kadipaten',
  'Kadipaten',
  'Pagerageung',
  'Ciawi',
  'Rajapolah',
  'Jamanis',
  'Sukaresik',
];

/** Satu potong hafalan: rentang ayat di dalam SATU surah dan SATU juz. */
interface QuranPiece {
  surah: number;
  from: number;
  to: number;
}

function wholeSurahs(first: number, last: number): QuranPiece[] {
  const step = first <= last ? 1 : -1;
  const out: QuranPiece[] = [];
  for (let n = first; step > 0 ? n <= last : n >= last; n += step) {
    out.push({ surah: n, from: 1, to: surahInfo(n).verses });
  }
  return out;
}

/**
 * Program hafalan SETAHUN per tingkat, berurutan dari tingkat 1 sampai 12.
 * SD menuntaskan juz 30 dari An-Nas mundur ke An-Naba'; SMP juz 29 (dua
 * tahun) lalu juz 28, tiap surah dari ayat pertama; SMA mulai Al-Baqarah.
 * Potongan tidak pernah melintasi batas juz, jadi kolom `juz` setiap setoran
 * selalu benar. Hafalan santri = semua program tingkat di bawahnya, dan setoran
 * tahun ini meneruskan urutan yang sama — keduanya tidak mungkin tumpang tindih.
 */
const LEVEL_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const YEAR_PROGRAM: Record<string, QuranPiece[]> = {
  '1': wholeSurahs(114, 106),
  '2': wholeSurahs(105, 100),
  '3': wholeSurahs(99, 94),
  '4': wholeSurahs(93, 88),
  '5': wholeSurahs(87, 83),
  '6': wholeSurahs(82, 78),
  '7': wholeSurahs(67, 71),
  '8': wholeSurahs(72, 77),
  '9': wholeSurahs(58, 66),
  '10': [{ surah: 2, from: 1, to: 141 }],
  '11': [
    { surah: 2, from: 142, to: 252 },
    { surah: 2, from: 253, to: 286 },
  ],
  '12': [
    { surah: 3, from: 1, to: 92 },
    { surah: 3, from: 93, to: 200 },
  ],
};
/** Tingkat masuk tiap unit: hafalan dari tingkat sebelum ini dibawa dari sekolah asal. */
const ENTRY_LEVEL: Record<Exclude<SchoolUnit, 'TK_QURAN'>, string> = {
  SD_IT: '1',
  SMP_IT: '7',
  SMA_QURAN: '10',
};

/** Juz dari (surah, ayat) — cukup untuk surah yang dipakai paket ini. */
function juzOf(surah: number, ayah: number): number {
  if (surah === 1) return 1;
  if (surah === 2) return ayah <= 141 ? 1 : ayah <= 252 ? 2 : 3;
  if (surah === 3) return ayah <= 92 ? 3 : 4;
  if (surah === 4) return ayah <= 23 ? 4 : 5;
  const row = QURAN_SURAHS.find((s) => s.number === surah);
  if (!row) throw new Error(`Surah ${surah} tidak dikenal`);
  return row.juz;
}

function surahInfo(n: number) {
  const row = QURAN_SURAHS.find((s) => s.number === n);
  if (!row) throw new Error(`Surah ${n} tidak dikenal`);
  return row;
}

// ============================================================================
// Utilitas
// ============================================================================

/** PRNG deterministik: seed yang sama menghasilkan data yang sama. */
function createRng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)];
  const chance = (p: number) => next() < p;
  const normal = (mean: number, sd: number) => {
    const u = Math.max(next(), 1e-9);
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, int, pick, chance, normal };
}
type Rng = ReturnType<typeof createRng>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
/** Jam WIB pada tanggal `day` (tengah malam UTC) sebagai instan UTC. */
function atWib(day: Date, hour: number, minute = 0): Date {
  return new Date(day.getTime() + (hour * 60 + minute) * 60 * 1000 - WIB_OFFSET_MS);
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
function letterFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'D';
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function createManyChunked<T>(
  label: string,
  rows: T[],
  write: (batch: T[]) => Promise<{ count: number }>
): Promise<number> {
  let total = 0;
  for (const batch of chunk(rows, 1000)) total += (await write(batch)).count;
  console.log(`   ✅ ${label}: ${total}`);
  return total;
}

const DAY_ENUM: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
];

// ============================================================================
// Konteks
// ============================================================================

interface Ctx {
  db: PrismaClient;
  rng: Rng;
  now: Date;
  /** Tanggal hari ini menurut WIB, sebagai tengah malam UTC. */
  today: Date;
  ay: { id: string; name: string; startDate: Date; endDate: Date; startYear: number };
  prevAy: { id: string; name: string; startDate: Date; endDate: Date; startYear: number };
  units: Record<SchoolUnit, { id: string; name: string }>;
  roleIds: Map<string, string>;
  users: Map<string, { id: string; name: string }>;
  superAdminId: string;
}

function roleId(ctx: Ctx, code: string): string {
  const id = ctx.roleIds.get(code);
  if (!id) throw new Error(`Peran ${code} tidak ada`);
  return id;
}

function userId(ctx: Ctx, email: string): string {
  const u = ctx.users.get(email);
  if (!u) throw new Error(`Pengguna ${email} tidak ada`);
  return u.id;
}

/** Hari sekolah (Senin–Jumat) dari awal tahun ajaran sampai kemarin. */
function schoolDays(ctx: Ctx): Date[] {
  const holidays = new Set([isoDay(utcDate(ctx.ay.startYear, 7, 17))]); // 17 Agustus
  const days: Date[] = [];
  for (let d = ctx.ay.startDate; d < ctx.today; d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(isoDay(d))) continue;
    days.push(d);
  }
  return days;
}

// ============================================================================
// Titik masuk
// ============================================================================

export async function seedPaketPresentasi(
  db: PrismaClient,
  options: { now?: Date } = {}
): Promise<void> {
  const now = options.now ?? new Date();
  console.log('\n📦 Paket data presentasi...');

  const ayRow = await db.academicYear.findFirst({ where: { isActive: true } });
  const spec = currentAcademicYear(now);
  if (!ayRow || ayRow.name !== spec.name) {
    throw new Error(
      `Tahun ajaran aktif di basis data (${ayRow?.name ?? 'tidak ada'}) bukan ${spec.name}; ` +
        'paket ini menyusun data untuk tahun ajaran yang sedang berjalan.'
    );
  }

  const sdUnit = await db.unit.findFirst({ where: { type: UnitType.SD_IT } });
  if (sdUnit) {
    const marker = await db.class.findFirst({
      where: { unitId: sdUnit.id, academicYearId: ayRow.id, name: '6A' },
    });
    if (marker) {
      console.log('   ↷ Sudah pernah diterapkan (SD IT sudah punya rombel 6A) — dilewati.');
      return;
    }
  }

  const prevSpec = academicYearStarting(spec.startYear - 1);
  const prevAyRow =
    (await db.academicYear.findUnique({ where: { name: prevSpec.name } })) ??
    (await db.academicYear.create({
      data: {
        name: prevSpec.name,
        startDate: prevSpec.startDate,
        endDate: prevSpec.endDate,
        isActive: false,
      },
    }));

  const units = {} as Record<SchoolUnit, { id: string; name: string }>;
  for (const type of Object.keys(CLASS_PLAN) as SchoolUnit[]) {
    const u = await db.unit.findFirst({ where: { type: UnitType[type] } });
    if (!u) throw new Error(`Unit ${type} tidak ada`);
    units[type] = { id: u.id, name: u.name };
  }

  const roles = await db.role.findMany({ select: { id: true, code: true } });
  const users = await db.user.findMany({ select: { id: true, name: true, email: true } });
  const superAdmin = await db.user.findFirst({ where: { email: 'super.admin@cipansor.or.id' } });
  if (!superAdmin) throw new Error('super.admin@cipansor.or.id tidak ada');

  const todayWib = new Date(now.getTime() + WIB_OFFSET_MS);
  const ctx: Ctx = {
    db,
    rng: createRng(20260715),
    now,
    today: utcDate(todayWib.getUTCFullYear(), todayWib.getUTCMonth(), todayWib.getUTCDate()),
    ay: {
      id: ayRow.id,
      name: ayRow.name,
      startDate: ayRow.startDate,
      endDate: ayRow.endDate,
      startYear: spec.startYear,
    },
    prevAy: {
      id: prevAyRow.id,
      name: prevAyRow.name,
      startDate: prevAyRow.startDate,
      endDate: prevAyRow.endDate,
      startYear: prevSpec.startYear,
    },
    units,
    roleIds: new Map(roles.map((r) => [r.code as string, r.id])),
    users: new Map(users.map((u) => [u.email, { id: u.id, name: u.name }])),
    superAdminId: superAdmin.id,
  };

  await rapikanIdentitas(ctx);
  await rapikanDataLama(ctx);
  const teachers = await siapkanGuru(ctx);
  const subjects = await siapkanMapel(ctx, teachers);
  const classes = await siapkanRombel(ctx, teachers);
  const roster = await siapkanSantri(ctx, classes);
  await susunJadwal(ctx, classes, subjects, teachers);
  // Santri yang tidak hadir hari itu juga tidak menyetor hafalan.
  const attendance = await catatPresensi(ctx, classes, roster);
  await ulanganDanNilai(ctx, classes, roster, subjects, teachers);
  await raporSemesterLalu(ctx, classes, roster, subjects);
  await tagihanDanPembayaran(ctx, roster);
  await setoranTahfidz(ctx, classes, roster, subjects, teachers, attendance);
  await takhosus(ctx, roster, teachers, attendance);
  await asrama(ctx, roster);
  await kesehatanUks(ctx, roster, attendance);
  await kedisiplinan(ctx, roster, classes);
  await spmb(ctx);
  await kalenderDanPengumuman(ctx);
  await bersihkanCacheDasbor(ctx);

  console.log('📦 Paket data presentasi selesai.');
}

// ============================================================================
// 1. Identitas yayasan, pengurus, akun ganda
// ============================================================================

/** Akun seed lama yang menduplikasi jabatan tunggal milik akun demo. */
const LEGACY_DUPLICATES: Array<{ legacy: string; replacement: string }> = [
  { legacy: 'ketua@cipansor.or.id', replacement: 'yayasan.ketua@cipansor.or.id' },
  { legacy: 'pembina@cipansor.or.id', replacement: 'yayasan.pembina@cipansor.or.id' },
  { legacy: 'sekretaris@cipansor.or.id', replacement: 'yayasan.sekretaris@cipansor.or.id' },
  { legacy: 'bendahara@cipansor.or.id', replacement: 'yayasan.bendahara@cipansor.or.id' },
  { legacy: 'bambang@cipansor.or.id', replacement: 'smpit.tu@cipansor.or.id' },
  { legacy: 'tu.smpit@cipansor.or.id', replacement: 'smpit.tu@cipansor.or.id' },
];

async function rapikanIdentitas(ctx: Ctx): Promise<void> {
  const { db } = ctx;
  const a = siteConfig.contact.address;
  const address = `${a.street}, ${a.village}, ${a.district}, ${a.regency}, ${a.province} ${a.postalCode}`;

  const foundation = await db.foundation.findFirst();
  if (foundation) {
    await db.foundation.update({
      where: { id: foundation.id },
      data: {
        name: siteConfig.legalName,
        legalName: siteConfig.legalName,
        // Tanggal akta pendirian badan hukumnya (Akta Notaris No. 01, 5 April
        // 2012); pesantrennya sendiri berdiri 1911. NPWP tidak diketahui — lebih
        // baik kosong daripada tebakan.
        foundingDate: utcDate(2012, 3, 5),
        taxId: null,
        address,
        phone: siteConfig.contact.phone,
        email: siteConfig.contact.email,
        website: siteConfig.url,
        vision: siteConfig.visi,
        mission: siteConfig.misi.map((m, i) => `${i + 1}. ${m}`).join('\n'),
      },
    });

    // Susunan organ yayasan seperti yang diterbitkan yayasan (office-holders.ts):
    // nama, jabatan, foto. Tanpa telepon dan email (milik pribadi, diisi admin)
    // dan tanpa tanggal mulai menjabat, yang tidak diketahui.
    const names = new Set<string>();
    for (const group of YAYASAN_ORGANS) {
      for (const h of group.holders) {
        names.add(h.name);
        const existing = await db.boardMember.findFirst({
          where: { foundationId: foundation.id, name: h.name, position: h.position },
        });
        const data = { photoUrl: h.photo ?? null, isActive: true, endDate: null };
        if (existing) await db.boardMember.update({ where: { id: existing.id }, data });
        else
          await db.boardMember.create({
            data: { ...data, foundationId: foundation.id, name: h.name, position: h.position },
          });
      }
    }
    // Nama lain bukan organ yang menjabat: dinonaktifkan, tidak dihapus.
    await db.boardMember.updateMany({
      where: { foundationId: foundation.id, name: { notIn: [...names] }, isActive: true },
      data: { isActive: false },
    });
  }

  await db.unit.updateMany({ data: { address } });

  // Akun ganda: nonaktifkan, dan pindahkan jejaknya di dokumen perencanaan ke
  // pemegang jabatan yang sebenarnya dipakai aplikasi.
  const remap = LEGACY_DUPLICATES.filter(
    (p) => ctx.users.has(p.legacy) && ctx.users.has(p.replacement)
  );
  const kepalaSma = ctx.users.get('smaq.kepala@cipansor.or.id');
  const adminSmp = ctx.users.get('admin.smpit@cipansor.or.id');
  const planColumns = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND ccu.table_name = 'users' AND ccu.column_name = 'id'
      AND (kcu.table_name LIKE 'plan\\_%' OR kcu.table_name = 'strategic_plans')
  `;
  const pairs = remap.map((p) => ({ from: userId(ctx, p.legacy), to: userId(ctx, p.replacement) }));
  // Seed dasar memakai "Admin SMP IT" sebagai penanggung jawab indikator SMA.
  if (kepalaSma && adminSmp) pairs.push({ from: adminSmp.id, to: kepalaSma.id });
  let remapped = 0;
  for (const { table_name, column_name } of planColumns) {
    for (const { from, to } of pairs) {
      remapped += await db.$executeRawUnsafe(
        `UPDATE "public"."${table_name}" SET "${column_name}" = $1 WHERE "${column_name}" = $2`,
        to,
        from
      );
    }
  }
  const legacyIds = remap.map((p) => userId(ctx, p.legacy));
  await db.userRoleAssignment.updateMany({
    where: { userId: { in: legacyIds } },
    data: { isActive: false },
  });
  await db.user.updateMany({ where: { id: { in: legacyIds } }, data: { isActive: false } });

  // Lokasi: seed dasar menaruh yayasan di Sukabumi. Tabel wilayah (rujukan
  // resmi) tidak disentuh.
  const textColumns = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
      AND table_name NOT IN ('provinces', 'regencies', 'districts', 'villages', '_prisma_migrations')
  `;
  let relocated = 0;
  for (const { table_name, column_name } of textColumns) {
    relocated += await db.$executeRawUnsafe(
      `UPDATE "public"."${table_name}" SET "${column_name}" =
         replace(replace(replace(replace(replace("${column_name}",
           'Kec. Sukabumi, Kota Sukabumi', 'Kec. Kadipaten, Kab. Tasikmalaya'),
           'Kecamatan Sukabumi', 'Kecamatan Kadipaten'),
           'Kabupaten Sukabumi', 'Kabupaten Tasikmalaya'),
           'Kota Sukabumi', 'Kabupaten Tasikmalaya'),
           'Sukabumi', 'Tasikmalaya')
       WHERE "${column_name}" LIKE '%Sukabumi%'`
    );
  }
  console.log(
    `   ✅ Identitas yayasan dari situs resmi; ${legacyIds.length} akun ganda dinonaktifkan; ` +
      `${remapped} rujukan perencanaan dipindahkan; ${relocated} teks "Sukabumi" dibetulkan`
  );
}

/**
 * Cacat data seed dasar yang terlihat begitu datanya dilihat utuh: nilai
 * ulangan kelas 7A SMP milik santri SD dan SMA, rapor semester yang belum
 * selesai sudah "terbit", tagihan 2024 yang tercatat dibuat tahun 2026 tapi
 * dibayar tahun 2024, dan tagihan lewat jatuh tempo yang masih "belum jatuh
 * tempo". Status tagihan selalu diturunkan dari pembayarannya.
 */
async function rapikanDataLama(ctx: Ctx): Promise<void> {
  const { db } = ctx;
  const strayGrades = await db.$executeRaw`
    DELETE FROM grades g USING exams x
    WHERE x.id = g.exam_id
      AND NOT EXISTS (SELECT 1 FROM class_enrollments e WHERE e.student_id = g.student_id AND e.class_id = x.class_id)
  `;
  const strayCards = await db.$executeRaw`
    DELETE FROM report_cards rc
    WHERE NOT EXISTS (SELECT 1 FROM class_enrollments e WHERE e.student_id = rc.student_id AND e.class_id = rc.class_id)
  `;
  // Semester 1 tahun berjalan baru selesai Desember; rapornya masih draf.
  const drafts = await db.reportCard.updateMany({
    where: { academicYearId: ctx.ay.id, semester: 1, isPublished: true },
    data: { isPublished: false, publishedAt: null },
  });

  // Tagihan dibuat pada awal bulan jatuh temponya, bukan saat seed dijalankan.
  const backdated = await db.$executeRaw`
    UPDATE invoices SET created_at = date_trunc('month', due_date)
    WHERE created_at > due_date
       OR created_at > (SELECT min(p.paid_at) FROM payments p WHERE p.invoice_id = invoices.id)
  `;
  // Tagihan tahun ajaran yang sudah lewat yang belum lunas: santrinya masih
  // aktif dan naik kelas, jadi di gambaran ini tagihannya diselesaikan saat itu.
  const stale = await db.invoice.findMany({
    where: {
      dueDate: { lt: ctx.prevAy.startDate },
      status: { notIn: [PaymentStatus.PAID, PaymentStatus.CANCELLED] },
    },
  });
  for (const inv of stale) {
    const remaining = inv.amount.sub(inv.paidAmount);
    const paidAt = addDays(inv.dueDate, -2);
    await db.payment.create({
      data: {
        invoiceId: inv.id,
        amount: remaining,
        method: PaymentMethod.CASH,
        verificationStatus: PaymentVerificationStatus.FINAL_APPROVED,
        paidAt,
        tuVerifiedAt: paidAt,
        finalVerifiedAt: paidAt,
        createdAt: paidAt,
        notes: 'Dibayar tunai di loket TU',
      },
    });
    await db.invoice.update({
      where: { id: inv.id },
      data: { paidAmount: inv.amount, status: PaymentStatus.PAID },
    });
  }
  const overdue = await db.invoice.updateMany({
    where: { status: PaymentStatus.PENDING, dueDate: { lt: ctx.today } },
    data: { status: PaymentStatus.OVERDUE },
  });
  console.log(
    `   ✅ Data lama dirapikan: ${strayGrades} nilai & ${strayCards} rapor salah rombel dihapus, ` +
      `${drafts.count} rapor semester berjalan jadi draf, ${backdated} tanggal tagihan, ` +
      `${stale.length} tagihan lama diselesaikan, ${overdue.count} tagihan jadi menunggak`
  );
}

// ============================================================================
// 2. Guru, mata pelajaran, rombel
// ============================================================================

interface TeacherRef {
  teacherId: string;
  userId: string;
  name: string;
}
type TeacherMap = Map<string, TeacherRef>; // key: email

async function siapkanGuru(ctx: Ctx): Promise<TeacherMap> {
  const { db, rng } = ctx;
  let created = 0;
  for (const unitType of Object.keys(NEW_TEACHERS) as SchoolUnit[]) {
    const unitId = ctx.units[unitType].id;
    for (const [i, t] of NEW_TEACHERS[unitType].entries()) {
      if (ctx.users.has(t.email)) continue;
      const user = await db.user.create({
        data: {
          name: t.name,
          email: t.email,
          passwordHash: null,
          role: UserRole.TEACHER,
          unitId,
          isActive: true,
          createdAt: utcDate(2024, 6, 1),
          userRoles: {
            create: {
              roleId: roleId(ctx, `${ROLE_PREFIX[unitType]}_GURU`),
              unitId,
              isPrimary: true,
            },
          },
        },
      });
      const joinYear = rng.int(2014, 2024);
      await db.teacher.create({
        data: {
          userId: user.id,
          unitId,
          nip: `NIY.${joinYear}.${NIS_UNIT_CODE[unitType]}.${pad(i + 21, 3)}`,
          specialization: t.major,
          joinDate: utcDate(joinYear, 6, 1),
          gender: t.gender,
          birthPlace: rng.pick(BIRTH_PLACES),
          birthDate: utcDate(rng.int(1982, 1998), rng.int(0, 11), rng.int(1, 28)),
          address: `Kp. ${rng.pick(KAMPUNG)}, Kec. ${rng.pick(KECAMATAN)}, Kab. Tasikmalaya`,
          employmentStatus: joinYear <= 2020 ? EmploymentStatus.GTY : EmploymentStatus.GTT,
          lastEducation: t.education,
          lastEducationMajor: t.major,
          lastEducationYear: joinYear - rng.int(0, 2),
          weeklyHours: rng.int(20, 26),
        },
      });
      ctx.users.set(t.email, { id: user.id, name: t.name });
      created++;
    }
  }
  const rows = await db.teacher.findMany({
    select: { id: true, userId: true, user: { select: { email: true, name: true } } },
  });
  const map: TeacherMap = new Map(
    rows.map((r) => [r.user.email, { teacherId: r.id, userId: r.userId, name: r.user.name }])
  );
  console.log(`   ✅ Guru baru: ${created} (total ${map.size})`);
  return map;
}

function teacherOf(teachers: TeacherMap, email: string): TeacherRef {
  const t = teachers.get(email);
  if (!t) throw new Error(`Guru ${email} tidak ada (baris Teacher belum dibuat)`);
  return t;
}

type SubjectMap = Map<SchoolUnit, Array<SubjectPlan & { id: string }>>;

async function siapkanMapel(ctx: Ctx, teachers: TeacherMap): Promise<SubjectMap> {
  const { db } = ctx;
  const out: SubjectMap = new Map();
  for (const unitType of Object.keys(SUBJECT_PLAN) as Array<keyof typeof SUBJECT_PLAN>) {
    const unitId = ctx.units[unitType].id;
    const list: Array<SubjectPlan & { id: string }> = [];
    for (const s of SUBJECT_PLAN[unitType]) {
      const row = await db.subject.upsert({
        where: { unitId_code: { unitId, code: s.code } },
        create: {
          unitId,
          code: s.code,
          name: s.name,
          type: subjectTypeOf(s.code),
          credits: s.credits,
          isActive: true,
        },
        update: { isActive: true },
      });
      list.push({ ...s, id: row.id });
      for (const email of [s.teacher, s.female].filter((e): e is string => !!e)) {
        const t = teacherOf(teachers, email);
        const exists = await db.teacherSubject.findFirst({
          where: { teacherId: t.teacherId, subjectId: row.id, classId: null },
        });
        if (!exists) {
          await db.teacherSubject.create({
            data: { teacherId: t.teacherId, subjectId: row.id, isActive: true },
          });
        }
      }
    }
    out.set(unitType, list);
  }
  console.log("   ✅ Mata pelajaran + pengampu untuk SD IT, SMP IT, SMA Qur'an");
  return out;
}

interface ClassRef extends ClassPlan {
  id: string;
  unitType: SchoolUnit;
  unitId: string;
  /** Indeks rombel di dalam unit, untuk menyusun jadwal tanpa bentrok. */
  index: number;
  homeroomUserId: string;
}

async function siapkanRombel(ctx: Ctx, teachers: TeacherMap): Promise<ClassRef[]> {
  const { db } = ctx;
  // Seed dasar menamai satu-satunya kelas SMA Qur'an "7A". SMA mulai dari kelas 10.
  await db.class.updateMany({
    where: { unitId: ctx.units.SMA_QURAN.id, academicYearId: ctx.ay.id, name: '7A' },
    data: { name: '10A', level: '10' },
  });

  const out: ClassRef[] = [];
  for (const unitType of Object.keys(CLASS_PLAN) as SchoolUnit[]) {
    const unitId = ctx.units[unitType].id;
    for (const [index, plan] of CLASS_PLAN[unitType].entries()) {
      const wali = teacherOf(teachers, plan.homeroom);
      const existing = await db.class.findFirst({
        where: { unitId, academicYearId: ctx.ay.id, name: plan.name },
      });
      const row = existing
        ? await db.class.update({
            where: { id: existing.id },
            data: {
              level: plan.level,
              homeroomTeacherId: existing.homeroomTeacherId ?? wali.teacherId,
            },
          })
        : await db.class.create({
            data: {
              unitId,
              academicYearId: ctx.ay.id,
              name: plan.name,
              level: plan.level,
              capacity: unitType === 'TK_QURAN' ? 15 : 28,
              homeroomTeacherId: wali.teacherId,
              createdAt: addDays(ctx.ay.startDate, -14),
            },
          });
      const homeroom =
        [...teachers.values()].find((t) => t.teacherId === row.homeroomTeacherId) ?? wali;
      // Wali kelas is the class's homeroomTeacherId, not a role (2026-09-26).
      out.push({ ...plan, id: row.id, unitType, unitId, index, homeroomUserId: homeroom.userId });
    }
  }
  console.log(`   ✅ Rombel tahun ajaran ${ctx.ay.name}: ${out.length}`);
  return out;
}

// ============================================================================
// 3. Santri dan wali
// ============================================================================

type Payer = 'tertib' | 'telat' | 'menunggak';

interface StudentRef {
  id: string;
  userId: string;
  name: string;
  gender: Gender;
  unitType: SchoolUnit;
  unitId: string;
  classId: string;
  className: string;
  level: string;
  grade: number;
  /** Rata-rata kemampuan akademik (skala nilai 0–100). */
  ability: number;
  /** Peluang tidak hadir pada satu hari sekolah. */
  absenceRisk: number;
  payer: Payer;
  isNew: boolean;
}

interface Family {
  key: string;
  parentUserId: string;
  father: string;
  mother: string;
  phone: string;
  kk: string;
  payer: Payer;
  units: Set<SchoolUnit>;
  children: number;
  address: string;
  kecamatan: string;
  rt: string;
  rw: string;
}

function pickPayer(rng: Rng): Payer {
  const r = rng.next();
  return r < 0.78 ? 'tertib' : r < 0.92 ? 'telat' : 'menunggak';
}
function pickAbsenceRisk(rng: Rng): number {
  const r = rng.next();
  return r < 0.85 ? 0.02 : r < 0.97 ? 0.06 : 0.16;
}

async function siapkanSantri(ctx: Ctx, classes: ClassRef[]): Promise<StudentRef[]> {
  const { db, rng } = ctx;
  const byUnitName = new Map(classes.map((c) => [`${c.unitType}|${c.name}`, c]));
  const unitTypeById = new Map(
    (Object.keys(ctx.units) as SchoolUnit[]).map((t) => [ctx.units[t].id, t] as const)
  );

  // --- santri yang sudah ada: tempatkan di rombel yang benar -----------------
  const existing = await db.student.findMany({
    where: { status: 'active', unitId: { in: [...unitTypeById.keys()] } },
    select: {
      id: true,
      userId: true,
      gender: true,
      unitId: true,
      birthDate: true,
      user: { select: { name: true } },
      parents: { select: { parentId: true }, take: 1 },
      enrollments: {
        where: { status: 'active', class: { academicYearId: ctx.ay.id } },
        select: { id: true, classId: true },
      },
    },
  });
  const members = new Map<string, number>(classes.map((c) => [c.id, 0]));
  const roster: StudentRef[] = [];
  const familyPayer = new Map<string, Payer>();
  let moved = 0;
  let placed = 0;
  let reborn = 0;
  for (const s of existing) {
    const unitType = unitTypeById.get(s.unitId);
    if (!unitType) continue;
    const unitClasses = classes.filter(
      (c) => c.unitType === unitType && (!c.gender || c.gender === s.gender)
    );
    let current = s.enrollments.map((e) => classes.find((c) => c.id === e.classId)).find(Boolean);
    if (current && current.gender && current.gender !== s.gender) {
      const twin = byUnitName.get(
        `${unitType}|${current.level}${s.gender === Gender.FEMALE ? 'B' : 'A'}`
      );
      if (twin) {
        // Dicatat sebagai perpindahan, bukan ditimpa: nilai dan presensinya di
        // rombel lama tetap punya rombel.
        await db.classEnrollment.update({
          where: { id: s.enrollments[0].id },
          data: { status: 'transferred' },
        });
        await db.classEnrollment.create({
          data: {
            studentId: s.id,
            classId: twin.id,
            status: 'active',
            enrolledAt: ctx.ay.startDate,
          },
        });
        current = twin;
        moved++;
      }
    }
    if (!current) {
      current = [...unitClasses].sort(
        (a, b) => (members.get(a.id) ?? 0) - (members.get(b.id) ?? 0)
      )[0];
      await db.classEnrollment.create({
        data: {
          studentId: s.id,
          classId: current.id,
          status: 'active',
          enrolledAt: ctx.ay.startDate,
        },
      });
      placed++;
    }
    members.set(current.id, (members.get(current.id) ?? 0) + 1);
    // Seed dasar memberi santri kelas 1 SD tanggal lahir 2012 (14 tahun).
    const age =
      ctx.ay.startYear - s.birthDate.getUTCFullYear() - (s.birthDate.getUTCMonth() >= 6 ? 1 : 0);
    if (Math.abs(age - current.age) > 1) {
      const fixed = utcDate(
        ctx.ay.startYear - current.age,
        rng.int(0, 5),
        s.birthDate.getUTCDate()
      );
      await db.student.update({ where: { id: s.id }, data: { birthDate: fixed } });
      reborn++;
    }
    const familyKey = s.parents[0]?.parentId ?? `santri:${s.id}`;
    const payer = familyPayer.get(familyKey) ?? pickPayer(rng);
    familyPayer.set(familyKey, payer);
    roster.push({
      id: s.id,
      userId: s.userId,
      name: s.user.name,
      gender: s.gender,
      unitType,
      unitId: s.unitId,
      classId: current.id,
      className: current.name,
      level: current.level,
      grade: current.grade,
      ability: clamp(rng.normal(79, 7), 62, 96),
      absenceRisk: pickAbsenceRisk(rng),
      payer,
      isNew: current.grade === 0,
    });
    await db.studentUnitEnrollment.upsert({
      where: {
        studentId_unitId_academicYearId: {
          studentId: s.id,
          unitId: s.unitId,
          academicYearId: ctx.ay.id,
        },
      },
      create: {
        studentId: s.id,
        unitId: s.unitId,
        academicYearId: ctx.ay.id,
        entryDate: ctx.ay.startDate,
        gradeLevel: current.level,
      },
      update: { gradeLevel: current.level },
    });
  }

  // --- nomor unik yang sudah terpakai -----------------------------------------
  const usedNis = new Set(
    (await db.studentUnitIdentifier.findMany({ select: { unitId: true, nis: true } })).map(
      (r) => `${r.unitId}|${r.nis}`
    )
  );
  const idRows = await db.student.findMany({ select: { nisn: true, nik: true } });
  const usedNisn = new Set(idRows.map((r) => r.nisn).filter((v): v is string => !!v));
  const usedNik = new Set(idRows.map((r) => r.nik).filter((v): v is string => !!v));
  const nisSeq = new Map<string, number>();
  let familySeq = (await db.user.count({ where: { email: { startsWith: 'wali.' } } })) + 1;

  const families: Family[] = [];
  const newParentIds: string[] = [];
  let created = 0;

  const newFamily = async (): Promise<Family> => {
    const n = familySeq++;
    const father = rng.pick(FATHER_NAMES);
    const mother = rng.pick(MOTHER_NAMES);
    const parent = await db.user.create({
      data: {
        name: father,
        email: `wali.${pad(n, 4)}@cipansor.or.id`,
        // Sengaja tanpa nomor HP: pengingat SPP otomatis dikirim lewat WhatsApp
        // ke User.phone, dan nomor karangan bisa milik orang sungguhan.
        phone: null,
        passwordHash: null,
        role: UserRole.PARENT,
        isActive: true,
        createdAt: utcDate(ctx.ay.startYear - 2, 6, 1),
      },
    });
    newParentIds.push(parent.id);
    const kkDay = utcDate(rng.int(2008, 2020), rng.int(0, 11), rng.int(1, 28));
    const fam: Family = {
      key: parent.id,
      parentUserId: parent.id,
      father,
      mother,
      phone: `0800${pad(n, 7)}`,
      kk: `320612${pad(kkDay.getUTCDate(), 2)}${pad(kkDay.getUTCMonth() + 1, 2)}${pad(kkDay.getUTCFullYear() % 100, 2)}${pad(n, 4)}`,
      payer: pickPayer(rng),
      units: new Set(),
      children: 0,
      address: `Kp. ${rng.pick(KAMPUNG)}`,
      kecamatan: rng.pick(KECAMATAN),
      rt: pad(rng.int(1, 6), 3),
      rw: pad(rng.int(1, 9), 3),
    };
    families.push(fam);
    return fam;
  };

  // --- isi setiap rombel sampai ukurannya --------------------------------------
  for (const c of classes) {
    const missing = c.size - (members.get(c.id) ?? 0);
    for (let k = 0; k < missing; k++) {
      const gender = c.gender ?? (rng.chance(0.5) ? Gender.MALE : Gender.FEMALE);
      const first = gender === Gender.MALE ? rng.pick(BOY_NAMES) : rng.pick(GIRL_NAMES);
      let second = gender === Gender.MALE ? rng.pick(BOY_SECOND) : rng.pick(GIRL_SECOND);
      if (second === first) second = gender === Gender.MALE ? 'Ramadhan' : 'Putri';
      const name = `${first} ${second}`;

      // Kakak-adik: sebagian santri berbagi keluarga dengan santri di unit lain.
      const sibling = rng.chance(0.18)
        ? families.find((f) => f.children < 3 && !f.units.has(c.unitType))
        : undefined;
      const fam = sibling ?? (await newFamily());
      fam.children++;
      fam.units.add(c.unitType);

      const entryYear = ctx.ay.startYear - c.grade;
      // Tercatat di sistem sejak tahun masuknya — tren jumlah santri per bulan
      // dibaca dari createdAt.
      const entryDate = utcDate(entryYear, 6, 15);
      const seqKey = `${c.unitType}|${entryYear}`;
      let seq = nisSeq.get(seqKey) ?? 0;
      let nis: string;
      do {
        seq++;
        nis = `${pad(entryYear % 100, 2)}${NIS_UNIT_CODE[c.unitType]}${pad(seq, 3)}`;
      } while (usedNis.has(`${c.unitId}|${nis}`));
      nisSeq.set(seqKey, seq);
      usedNis.add(`${c.unitId}|${nis}`);

      const bornBeforeJuly = rng.chance(0.55);
      const birthYear = ctx.ay.startYear - c.age - (bornBeforeJuly ? 0 : 1);
      const birthDate = utcDate(
        birthYear,
        bornBeforeJuly ? rng.int(0, 5) : rng.int(6, 11),
        rng.int(1, 28)
      );
      let nisn: string;
      do nisn = `${pad(birthYear % 1000, 3)}${pad(rng.int(0, 9_999_999), 7)}`;
      while (usedNisn.has(nisn));
      usedNisn.add(nisn);
      let nik: string;
      let nikSeq = 9000 + rng.int(0, 999);
      do {
        const dd = birthDate.getUTCDate() + (gender === Gender.FEMALE ? 40 : 0);
        nik = `320612${pad(dd, 2)}${pad(birthDate.getUTCMonth() + 1, 2)}${pad(birthYear % 100, 2)}${pad(nikSeq, 4)}`;
        nikSeq++;
      } while (usedNik.has(nik));
      usedNik.add(nik);

      const boarding = c.unitType === 'SMP_IT' || c.unitType === 'SMA_QURAN';
      const isTk = c.unitType === 'TK_QURAN';
      const user = await db.user.create({
        data: {
          name,
          email: `santri.${nis}@cipansor.or.id`,
          passwordHash: null,
          role: UserRole.STUDENT,
          unitId: c.unitId,
          // Santri TK tidak punya akun masuk (tidak ada peran TKQ_SISWA).
          isActive: !isTk,
          createdAt: entryDate,
          ...(isTk
            ? {}
            : {
                userRoles: {
                  create: {
                    roleId: roleId(ctx, `${ROLE_PREFIX[c.unitType]}_SISWA`),
                    unitId: c.unitId,
                    isPrimary: true,
                  },
                },
              }),
        },
      });
      const fatherOccupation = rng.pick([
        OccupationType.WIRASWASTA,
        OccupationType.PEDAGANG,
        OccupationType.PETANI,
        OccupationType.PEGAWAI_SWASTA,
        OccupationType.PNS,
        OccupationType.GURU,
        OccupationType.BURUH,
      ]);
      const student = await db.student.create({
        data: {
          userId: user.id,
          unitId: c.unitId,
          nis,
          nisn: isTk ? null : nisn,
          nik,
          noKK: fam.kk,
          gender,
          birthPlace: rng.pick(BIRTH_PLACES),
          birthDate,
          address: `${fam.address} RT ${fam.rt} RW ${fam.rw}, Kec. ${fam.kecamatan}, Kab. Tasikmalaya`,
          rt: fam.rt,
          rw: fam.rw,
          parentName: fam.father,
          parentPhone: fam.phone,
          status: 'active',
          entryYear,
          religion: 'ISLAM',
          transportMode: boarding
            ? TransportMode.ANTAR_JEMPUT
            : rng.pick([
                TransportMode.ANTAR_JEMPUT,
                TransportMode.SEPEDA_MOTOR,
                TransportMode.JALAN_KAKI,
              ]),
          distanceToSchool: new Prisma.Decimal(rng.int(5, 250) / 10),
          travelTime: rng.int(5, 45),
          bloodType: rng.pick([BloodType.A, BloodType.B, BloodType.AB, BloodType.O, BloodType.O]),
          height: new Prisma.Decimal(Math.round(95 + (c.age - 4) * 6.2 + rng.normal(0, 4))),
          weight: new Prisma.Decimal(Math.round(15 + (c.age - 4) * 3.1 + rng.normal(0, 3))),
          numberOfSiblings: rng.int(1, 4),
          childOrder: rng.int(1, 3),
          livingWith: boarding ? 'Asrama' : 'Orang tua',
          fatherName: fam.father,
          fatherOccupation,
          fatherEducation: rng.pick([
            EducationLevel.SMA,
            EducationLevel.SMA,
            EducationLevel.S1,
            EducationLevel.SMP,
            EducationLevel.D3,
          ]),
          fatherIncome: rng.pick([
            IncomeRange.RANGE_2JT_5JT,
            IncomeRange.RANGE_2JT_5JT,
            IncomeRange.RANGE_1JT_2JT,
            IncomeRange.RANGE_5JT_10JT,
          ]),
          fatherPhone: fam.phone,
          motherName: fam.mother,
          motherOccupation: rng.pick([
            OccupationType.IBU_RUMAH_TANGGA,
            OccupationType.IBU_RUMAH_TANGGA,
            OccupationType.GURU,
            OccupationType.PEDAGANG,
            OccupationType.WIRASWASTA,
          ]),
          motherEducation: rng.pick([
            EducationLevel.SMA,
            EducationLevel.S1,
            EducationLevel.SMP,
            EducationLevel.D3,
          ]),
          motherIncome: rng.pick([
            IncomeRange.TIDAK_BERPENGHASILAN,
            IncomeRange.RANGE_1JT_2JT,
            IncomeRange.RANGE_500K_1JT,
          ]),
          createdAt: entryDate,
        },
      });
      await db.classEnrollment.create({
        data: {
          studentId: student.id,
          classId: c.id,
          status: 'active',
          enrolledAt: ctx.ay.startDate,
        },
      });
      await db.studentUnitIdentifier.create({
        data: { studentId: student.id, unitId: c.unitId, nis },
      });
      await db.studentUnitEnrollment.create({
        data: {
          studentId: student.id,
          unitId: c.unitId,
          academicYearId: ctx.ay.id,
          entryDate: ctx.ay.startDate,
          gradeLevel: c.level,
        },
      });
      await db.studentParent.create({
        data: {
          studentId: student.id,
          parentId: fam.parentUserId,
          relation: 'father',
          isPrimary: true,
        },
      });
      members.set(c.id, (members.get(c.id) ?? 0) + 1);
      roster.push({
        id: student.id,
        userId: user.id,
        name,
        gender,
        unitType: c.unitType,
        unitId: c.unitId,
        classId: c.id,
        className: c.name,
        level: c.level,
        grade: c.grade,
        ability: clamp(rng.normal(79, 7), 62, 96),
        absenceRisk: pickAbsenceRisk(rng),
        payer: fam.payer,
        isNew: c.grade === 0,
      });
      created++;
    }
  }

  let parentRoles = 0;
  for (const id of newParentIds) {
    parentRoles += await syncParentRoleAssignments(db as unknown as ParentScopeClient, id);
  }
  const siblings = families.filter((f) => f.children > 1).length;
  console.log(
    `   ✅ Santri: ${created} baru, ${placed} santri lama dimasukkan ke rombel, ${moved} dipindah ke rombel putri, ${reborn} tanggal lahir disesuaikan dengan tingkatnya; ` +
      `${families.length} keluarga (${siblings} dengan kakak-adik), ${parentRoles} peran wali`
  );
  return roster;
}

// ============================================================================
// 4. Jadwal pelajaran
// ============================================================================

const SLOTS_SD: Array<[string, string]> = [
  ['07:30', '08:05'],
  ['08:05', '08:40'],
  ['08:40', '09:15'],
  ['09:30', '10:05'],
  ['10:05', '10:40'],
  ['10:40', '11:15'],
];
const SLOTS_MENENGAH: Array<[string, string]> = [
  ['07:00', '07:40'],
  ['07:40', '08:20'],
  ['08:20', '09:00'],
  ['09:15', '09:55'],
  ['09:55', '10:35'],
  ['10:35', '11:15'],
  ['12:30', '13:10'],
  ['13:10', '13:50'],
];

function teacherForClass(teachers: TeacherMap, s: SubjectPlan, c: ClassRef): TeacherRef {
  return teacherOf(teachers, c.gender === Gender.FEMALE && s.female ? s.female : s.teacher);
}

async function susunJadwal(
  ctx: Ctx,
  classes: ClassRef[],
  subjects: SubjectMap,
  teachers: TeacherMap
): Promise<void> {
  const { db } = ctx;
  const rows: Prisma.ScheduleCreateManyInput[] = [];
  for (const [unitType, list] of subjects) {
    const unitClasses = classes.filter((c) => c.unitType === unitType);
    // Jadwal lama rombel ini dinonaktifkan (bukan dihapus) supaya tidak bentrok.
    await db.schedule.updateMany({
      where: { classId: { in: unitClasses.map((c) => c.id) }, academicYearId: ctx.ay.id },
      data: { isActive: false },
    });
    const slots = unitType === 'SD_IT' ? SLOTS_SD : SLOTS_MENENGAH;
    for (const c of unitClasses) {
      for (const [d, day] of DAY_ENUM.entries()) {
        const daySlots = day === DayOfWeek.FRIDAY ? slots.slice(0, 4) : slots;
        for (const [t, [start, end]] of daySlots.entries()) {
          // Pada jam yang sama setiap rombel mendapat mapel berbeda, dan satu
          // guru hanya memegang satu mapel — jadi tidak ada guru yang bentrok.
          const s = list[(c.index + t + 2 * d) % list.length];
          rows.push({
            unitId: c.unitId,
            academicYearId: ctx.ay.id,
            classId: c.id,
            subjectId: s.id,
            teacherId: teacherForClass(teachers, s, c).teacherId,
            dayOfWeek: day,
            startTime: start,
            endTime: end,
            room: `Ruang ${c.name}`,
            isActive: true,
            createdAt: addDays(ctx.ay.startDate, -5),
          });
        }
      }
    }
  }
  await createManyChunked('Jadwal pelajaran (slot)', rows, (b) =>
    db.schedule.createMany({ data: b })
  );
}

// ============================================================================
// 5. Presensi santri dan guru
// ============================================================================

/** studentId|YYYY-MM-DD → status; dipakai lagi oleh setoran tahfidz. */
type AttendanceLog = Map<string, AttendanceStatus>;

async function catatPresensi(
  ctx: Ctx,
  classes: ClassRef[],
  roster: StudentRef[]
): Promise<AttendanceLog> {
  const { db, rng } = ctx;
  const days = schoolDays(ctx);
  const log: AttendanceLog = new Map();
  const rows: Prisma.AttendanceCreateManyInput[] = [];
  const classById = new Map(classes.map((c) => [c.id, c]));
  for (const s of roster) {
    const c = classById.get(s.classId);
    if (!c) continue;
    for (const day of days) {
      let status: AttendanceStatus = AttendanceStatus.PRESENT;
      let notes: string | null = null;
      if (rng.chance(s.absenceRisk)) {
        const r = rng.next();
        if (r < 0.4) {
          status = AttendanceStatus.SICK;
          notes = rng.pick([
            'Demam, surat dari orang tua',
            'Sakit perut',
            'Batuk pilek',
            'Dirawat di UKS',
          ]);
        } else if (r < 0.7) {
          status = AttendanceStatus.EXCUSED;
          notes = rng.pick(['Acara keluarga', 'Izin keperluan keluarga', 'Mengikuti lomba']);
        } else if (r < 0.9) {
          status = AttendanceStatus.ABSENT;
        } else {
          status = AttendanceStatus.LATE;
          notes = 'Terlambat masuk kelas';
        }
      }
      log.set(`${s.id}|${isoDay(day)}`, status);
      rows.push({
        studentId: s.id,
        classId: c.id,
        date: day,
        status,
        notes,
        recordedById: c.homeroomUserId,
        createdAt: atWib(day, 7, 30),
      });
    }
  }
  await createManyChunked('Presensi santri (hari × santri)', rows, (b) =>
    db.attendance.createMany({ data: b, skipDuplicates: true })
  );

  // Presensi guru. staff_attendance unik pada (staff_id, date): seorang guru
  // ditulis lewat baris Staff-nya, bukan lewat teacher_id, supaya satu orang
  // hanya punya satu baris kehadiran sehari. Guru tanpa baris Staff dilewati.
  const unitIds = Object.values(ctx.units).map((u) => u.id);
  const teacherRows = await db.teacher.findMany({
    where: { unitId: { in: unitIds }, staffId: { not: null } },
    select: { staffId: true },
  });
  const teacherStaffIds = teacherRows
    .map((t) => t.staffId)
    .filter((id): id is string => Boolean(id));
  const taken = new Set(
    (
      await db.staffAttendance.findMany({
        where: { staffId: { in: teacherStaffIds }, date: { gte: ctx.ay.startDate } },
        select: { staffId: true, date: true },
      })
    ).map((r) => `${r.staffId}|${isoDay(r.date)}`)
  );
  const staffRows: Prisma.StaffAttendanceCreateManyInput[] = [];
  for (const staffId of teacherStaffIds) {
    for (const day of days) {
      if (taken.has(`${staffId}|${isoDay(day)}`)) continue;
      const r = rng.next();
      let status: StaffAttendanceStatus = StaffAttendanceStatus.PRESENT;
      let checkIn: Date | null = atWib(day, 6, rng.int(35, 59));
      let checkOut: Date | null = atWib(day, 14, rng.int(0, 59));
      let notes: string | null = null;
      if (r < 0.04) {
        status = StaffAttendanceStatus.LATE;
        checkIn = atWib(day, 7, rng.int(10, 40));
      } else if (r < 0.06) {
        status = StaffAttendanceStatus.SICK;
        checkIn = null;
        checkOut = null;
        notes = 'Sakit';
      } else if (r < 0.075) {
        status = StaffAttendanceStatus.LEAVE;
        checkIn = null;
        checkOut = null;
        notes = 'Cuti';
      } else if (r < 0.085) {
        status = StaffAttendanceStatus.DUTY;
        notes = rng.pick([
          'Pelatihan Kurikulum Merdeka',
          'Rapat KKG/MGMP',
          'Mendampingi lomba santri',
        ]);
      }
      staffRows.push({
        staffId,
        date: day,
        status,
        checkIn,
        checkOut,
        notes,
        createdAt: checkIn ?? atWib(day, 7),
      });
    }
  }
  await createManyChunked('Presensi guru (hari × guru)', staffRows, (b) =>
    db.staffAttendance.createMany({ data: b })
  );
  return log;
}

// ============================================================================
// 6. Ulangan, nilai, rapor semester lalu
// ============================================================================

/** Hari sekolah pertama pada atau setelah `offset` hari dari awal tahun ajaran. */
function schoolDayFrom(ctx: Ctx, offset: number): Date {
  let d = addDays(ctx.ay.startDate, offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, 1);
  return d;
}

/** Selisih kemampuan per mapel, supaya nilai tidak seragam antar-mapel. */
function subjectOffset(code: string): number {
  const table: Record<string, number> = {
    MTK: -4,
    FIS: -5,
    KIM: -4,
    IPA: -2,
    IPAS: -1,
    BIG: -2,
    ARB: -3,
    INF: 1,
    PAI: 3,
    AQD: 3,
    FIQ: 2,
    QHD: 2,
    SKI: 2,
    THF: 4,
    TFS: 1,
    BIN: 1,
    PKN: 2,
    SBD: 4,
    PJOK: 5,
    PJK: 5,
    SEJ: 0,
    IPS: 0,
    BIO: -1,
  };
  return table[code] ?? 0;
}

async function ulanganDanNilai(
  ctx: Ctx,
  classes: ClassRef[],
  roster: StudentRef[],
  subjects: SubjectMap,
  teachers: TeacherMap
): Promise<void> {
  const { db, rng } = ctx;
  const plan: Array<{
    offset: number;
    type: ExamType;
    label: string;
    weight: number;
    duration: number;
  }> = [
    { offset: 21, type: ExamType.DAILY_TEST, label: 'Ulangan Harian 1', weight: 1, duration: 60 },
    { offset: 49, type: ExamType.DAILY_TEST, label: 'Ulangan Harian 2', weight: 1, duration: 60 },
    {
      offset: 84,
      type: ExamType.MIDTERM,
      label: 'Penilaian Tengah Semester',
      weight: 2,
      duration: 90,
    },
  ];
  const exams: Prisma.ExamCreateManyInput[] = [];
  const grades: Prisma.GradeCreateManyInput[] = [];
  for (const [unitType, list] of subjects) {
    for (const c of classes.filter((x) => x.unitType === unitType)) {
      const students = roster.filter((s) => s.classId === c.id);
      for (const [si, s] of list.entries()) {
        const teacher = teacherForClass(teachers, s, c);
        for (const p of plan) {
          // Ulangan satu mapel tidak jatuh di hari yang sama untuk semua rombel.
          const day = schoolDayFrom(ctx, p.offset + ((si + c.index) % 5));
          const done = day < ctx.today;
          const id = randomUUID();
          exams.push({
            id,
            unitId: c.unitId,
            academicYearId: ctx.ay.id,
            subjectId: s.id,
            classId: c.id,
            teacherId: teacher.teacherId,
            type: p.type,
            title: `${p.label} ${s.name}`,
            scheduledAt: atWib(day, 8),
            duration: p.duration,
            weight: new Prisma.Decimal(p.weight),
            status: done ? ExamStatus.GRADED : ExamStatus.SCHEDULED,
            createdAt: atWib(addDays(day, -7), 10),
          });
          if (!done) continue;
          const gradedAt = new Date(
            Math.min(addDays(day, 3).getTime(), addDays(ctx.today, -1).getTime())
          );
          for (const st of students) {
            const score = Math.round(
              clamp(rng.normal(st.ability + subjectOffset(s.code), 7), 40, 100)
            );
            grades.push({
              studentId: st.id,
              subjectId: s.id,
              examId: id,
              academicYearId: ctx.ay.id,
              type: GradeType.EXAM,
              score: new Prisma.Decimal(score),
              maxScore: new Prisma.Decimal(100),
              percentage: new Prisma.Decimal(score),
              letterGrade: letterFor(score),
              gradedById: teacher.userId,
              gradedAt: atWib(gradedAt, 15),
              createdAt: atWib(gradedAt, 15),
            });
          }
        }
      }
    }
  }
  await createManyChunked('Ulangan (UH1, UH2, PTS per mapel × rombel)', exams, (b) =>
    db.exam.createMany({ data: b })
  );
  await createManyChunked('Nilai ulangan', grades, (b) =>
    db.grade.createMany({ data: b, skipDuplicates: true })
  );
}

const DESKRIPSI: Record<string, string> = {
  A: 'menunjukkan penguasaan yang sangat baik dan mampu menjelaskan kembali materi dengan runtut',
  B: 'menunjukkan penguasaan yang baik; perlu penguatan pada soal penerapan',
  C: 'cukup menguasai materi inti; perlu bimbingan pada latihan soal',
  D: 'perlu pendampingan intensif untuk mencapai tujuan pembelajaran',
};

async function raporSemesterLalu(
  ctx: Ctx,
  classes: ClassRef[],
  roster: StudentRef[],
  subjects: SubjectMap
): Promise<void> {
  const { db, rng } = ctx;
  const published = addDays(ctx.prevAy.endDate, -10);
  let cards = 0;
  for (const [unitType, list] of subjects) {
    for (const c of classes.filter((x) => x.unitType === unitType && x.grade > 0)) {
      const prevPlan = CLASS_PLAN[unitType].find(
        (p) => p.grade === c.grade - 1 && (p.gender ?? null) === (c.gender ?? null)
      );
      if (!prevPlan) continue;
      const prev =
        (await db.class.findFirst({
          where: { unitId: c.unitId, academicYearId: ctx.prevAy.id, name: prevPlan.name },
        })) ??
        (await db.class.create({
          data: {
            unitId: c.unitId,
            academicYearId: ctx.prevAy.id,
            name: prevPlan.name,
            level: prevPlan.level,
            capacity: 28,
          },
        }));
      const students = roster.filter((s) => s.classId === c.id);
      const results = students.map((st) => {
        const details = list.map((s) => {
          const base = st.ability + subjectOffset(s.code) - 1;
          const daily = Math.round(clamp(rng.normal(base, 5), 50, 100));
          const midterm = Math.round(clamp(rng.normal(base, 6), 45, 100));
          const final = Math.round(clamp(rng.normal(base, 6), 45, 100));
          const avg = Math.round((2 * daily + midterm + 2 * final) / 5);
          return { s, daily, midterm, final, avg };
        });
        const average = details.reduce((a, d) => a + d.avg, 0) / details.length;
        return { st, details, average };
      });
      results.sort((a, b) => b.average - a.average);
      for (const [rank, r] of results.entries()) {
        const { st } = r;
        const hasEnrollment = await db.classEnrollment.findFirst({
          where: { studentId: st.id, classId: prev.id },
        });
        if (!hasEnrollment) {
          await db.classEnrollment.create({
            data: {
              studentId: st.id,
              classId: prev.id,
              status: 'completed',
              enrolledAt: ctx.prevAy.startDate,
            },
          });
        }
        await db.studentUnitEnrollment.upsert({
          where: {
            studentId_unitId_academicYearId: {
              studentId: st.id,
              unitId: st.unitId,
              academicYearId: ctx.prevAy.id,
            },
          },
          create: {
            studentId: st.id,
            unitId: st.unitId,
            academicYearId: ctx.prevAy.id,
            entryDate: ctx.prevAy.startDate,
            exitDate: ctx.prevAy.endDate,
            exitReason: 'TAHUN_AJARAN_SELESAI',
            gradeLevel: prevPlan.level,
          },
          update: {},
        });
        const exists = await db.reportCard.findFirst({
          where: { studentId: st.id, classId: prev.id, academicYearId: ctx.prevAy.id, semester: 2 },
        });
        if (exists) continue;
        const sick = rng.int(0, Math.round(st.absenceRisk * 60));
        const excused = rng.int(0, Math.round(st.absenceRisk * 40));
        const absent = st.absenceRisk > 0.1 ? rng.int(1, 5) : rng.int(0, 1);
        const firstName = st.name.split(' ')[0];
        await db.reportCard.create({
          data: {
            studentId: st.id,
            classId: prev.id,
            academicYearId: ctx.prevAy.id,
            semester: 2,
            averageScore: new Prisma.Decimal(r.average.toFixed(2)),
            rank: rank + 1,
            totalStudents: results.length,
            attendance: { present: 100 - sick - excused - absent, sick, excused, absent },
            tahfidzSummary: {
              totalJuz:
                unitType === 'SD_IT' ? 0 : unitType === 'SMP_IT' ? c.grade * 2 : 2 + c.grade * 3,
              targetTercapai: r.average >= 75,
            },
            teacherNotes:
              r.average >= 85
                ? `${firstName} rajin, teliti, dan menjadi teladan bagi teman-temannya. Pertahankan!`
                : r.average >= 75
                  ? `${firstName} mengikuti pelajaran dengan baik. Tingkatkan lagi ketekunan dalam mengulang pelajaran di rumah/asrama.`
                  : `${firstName} perlu pendampingan lebih dalam belajar. Mari bersama-sama membiasakan belajar terjadwal.`,
            principalNotes: `Naik ke kelas ${c.level}.`,
            isPublished: true,
            publishedAt: atWib(published, 10),
            createdAt: atWib(addDays(published, -7), 10),
            details: {
              create: r.details.map((d) => ({
                subjectName: d.s.name,
                dailyScore: new Prisma.Decimal(d.daily),
                midtermScore: new Prisma.Decimal(d.midterm),
                finalScore: new Prisma.Decimal(d.final),
                averageScore: new Prisma.Decimal(d.avg),
                letterGrade: letterFor(d.avg),
                description: `Ananda ${DESKRIPSI[letterFor(d.avg)]}.`,
              })),
            },
          },
        });
        cards++;
      }
    }
  }
  console.log(`   ✅ Rapor semester genap ${ctx.prevAy.name} (terbit): ${cards}`);
}

// ============================================================================
// 7. Tagihan dan pembayaran
// ============================================================================

/** Petugas verifikasi pembayaran per unit (TU memeriksa, bendahara menyetujui). */
const FINANCE_OFFICERS: Record<SchoolUnit, { tu: string; bendahara: string }> = {
  TK_QURAN: { tu: 'tkq.tu@cipansor.or.id', bendahara: 'tkq.bendahara@cipansor.or.id' },
  SD_IT: { tu: 'sdit.tu@cipansor.or.id', bendahara: 'sdit.bendahara@cipansor.or.id' },
  SMP_IT: { tu: 'smpit.tu@cipansor.or.id', bendahara: 'smpit.bendahara@cipansor.or.id' },
  SMA_QURAN: { tu: 'smaq.tu@cipansor.or.id', bendahara: 'smaq.bendahara@cipansor.or.id' },
};

async function tagihanDanPembayaran(ctx: Ctx, roster: StudentRef[]): Promise<void> {
  const { db, rng } = ctx;
  const types = new Map<
    SchoolUnit,
    Array<{ id: string; code: string; name: string; amount: number; recurring: boolean }>
  >();
  for (const unitType of Object.keys(PAYMENT_PLAN) as SchoolUnit[]) {
    const unitId = ctx.units[unitType].id;
    const list = [];
    for (const p of PAYMENT_PLAN[unitType]) {
      const row = await db.paymentType.upsert({
        where: { unitId_code: { unitId, code: p.code } },
        create: {
          unitId,
          code: p.code,
          name: p.name,
          amount: new Prisma.Decimal(p.amount),
          isRecurring: p.recurring,
          isActive: true,
          description: p.recurring
            ? 'Ditagihkan setiap bulan, jatuh tempo tanggal 10'
            : 'Dibayar sekali saat masuk',
        },
        update: {},
      });
      list.push({
        id: row.id,
        code: row.code,
        name: row.name,
        amount: Number(row.amount),
        recurring: row.isRecurring,
      });
    }
    types.set(unitType, list);
  }

  // Bulan tagihan: dari bulan awal tahun ajaran sampai bulan ini.
  const months: Array<{ y: number; m: number }> = [];
  for (
    let y = ctx.ay.startDate.getUTCFullYear(), m = ctx.ay.startDate.getUTCMonth();
    y < ctx.today.getUTCFullYear() ||
    (y === ctx.today.getUTCFullYear() && m <= ctx.today.getUTCMonth());
    m === 11 ? ((m = 0), y++) : m++
  ) {
    months.push({ y, m });
  }

  // Tagihan yang sudah ada (mis. dari job tagihan otomatis) tidak diduplikasi.
  const existing = await db.invoice.findMany({
    where: {
      studentId: { in: roster.map((s) => s.id) },
      dueDate: { gte: addDays(ctx.ay.startDate, -31) },
    },
    select: { studentId: true, paymentTypeId: true, dueDate: true },
  });
  const have = new Set(
    existing.map(
      (i) =>
        `${i.studentId}|${i.paymentTypeId}|${i.dueDate.getUTCFullYear()}-${i.dueDate.getUTCMonth()}`
    )
  );
  const seqByPrefix = new Map<string, number>();
  const nextNumber = async (y: number, m: number): Promise<string> => {
    const prefix = `INV-${y}${pad(m + 1, 2)}`;
    if (!seqByPrefix.has(prefix)) {
      const last = await db.invoice.findFirst({
        where: { invoiceNumber: { startsWith: `${prefix}-` } },
        orderBy: { invoiceNumber: 'desc' },
      });
      seqByPrefix.set(prefix, last ? parseInt(last.invoiceNumber.split('-')[2], 10) || 0 : 0);
    }
    const n = (seqByPrefix.get(prefix) ?? 0) + 1;
    seqByPrefix.set(prefix, n);
    return `${prefix}-${pad(n, 5)}`;
  };

  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  let pendingVerification = 0;
  const yesterday = addDays(ctx.today, -1);

  /** Kapan (dan apakah) sebuah tagihan dibayar, menurut kebiasaan keluarganya. */
  const decide = (st: StudentRef, dueDate: Date, idx: number, code: string, amount: number) => {
    const y = dueDate.getUTCFullYear();
    const m = dueDate.getUTCMonth();
    const firstMonth =
      m === ctx.ay.startDate.getUTCMonth() && y === ctx.ay.startDate.getUTCFullYear();
    let paidAt: Date | null = null;
    let paidAmount = amount;
    if (st.payer === 'tertib') {
      paidAt = atWib(utcDate(y, m, rng.int(1, 9)), rng.int(8, 16), rng.int(0, 59));
    } else if (st.payer === 'telat') {
      paidAt = atWib(addDays(dueDate, rng.int(8, 24)), rng.int(8, 16), rng.int(0, 59));
    } else if (firstMonth) {
      paidAt = atWib(addDays(dueDate, rng.int(0, 10)), rng.int(8, 16), rng.int(0, 59));
    } else if (idx % 3 === 0 && code === 'SPP') {
      paidAt = atWib(addDays(dueDate, rng.int(10, 20)), rng.int(8, 16), rng.int(0, 59));
      paidAmount = Math.round(amount / 2);
    }
    if (paidAt && paidAt >= ctx.now) paidAt = null;
    // Sebagian pembayaran bulan ini baru diunggah wali dan menunggu diperiksa TU.
    const awaiting =
      paidAt !== null && paidAt >= addDays(yesterday, -4) && code === 'SPP' && rng.chance(0.5);
    return { paidAt, paidAmount, awaiting };
  };
  const statusFor = (settled: number, amount: number, dueDate: Date): PaymentStatus =>
    settled >= amount
      ? PaymentStatus.PAID
      : settled > 0
        ? PaymentStatus.PARTIAL
        : dueDate < ctx.today
          ? PaymentStatus.OVERDUE
          : PaymentStatus.PENDING;
  const paymentRow = (
    st: StudentRef,
    invoiceId: string,
    paidAt: Date,
    paidAmount: number,
    awaiting: boolean
  ): Prisma.PaymentCreateManyInput => {
    const officers = FINANCE_OFFICERS[st.unitType];
    const method = rng.pick([
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.VIRTUAL_ACCOUNT,
      PaymentMethod.CASH,
    ]);
    const verified = !awaiting;
    if (awaiting) pendingVerification++;
    return {
      invoiceId,
      amount: new Prisma.Decimal(paidAmount),
      method,
      referenceNo:
        method === PaymentMethod.CASH
          ? null
          : `TRF${isoDay(paidAt).replace(/-/g, '')}${pad(rng.int(0, 9999), 4)}`,
      verificationStatus: verified
        ? PaymentVerificationStatus.FINAL_APPROVED
        : PaymentVerificationStatus.PENDING_VERIFICATION,
      tuVerifiedAt: verified
        ? new Date(Math.min(paidAt.getTime() + DAY_MS, ctx.now.getTime()))
        : null,
      tuVerifiedById: verified ? (ctx.users.get(officers.tu)?.id ?? null) : null,
      finalVerifiedAt: verified
        ? new Date(Math.min(paidAt.getTime() + 2 * DAY_MS, ctx.now.getTime()))
        : null,
      finalVerifiedById: verified ? (ctx.users.get(officers.bendahara)?.id ?? null) : null,
      paidAt,
      createdAt: paidAt,
      notes: awaiting
        ? 'Bukti transfer diunggah wali melalui aplikasi'
        : method === PaymentMethod.CASH
          ? 'Dibayar tunai di loket TU'
          : null,
    };
  };

  // Tagihan tahun berjalan yang sudah ada tapi belum pernah dibayar (seed dasar,
  // job tagihan otomatis) mengikuti kebiasaan bayar keluarga santrinya juga.
  const rosterById = new Map(roster.map((s) => [s.id, s]));
  const untouched = await db.invoice.findMany({
    where: {
      studentId: { in: roster.map((s) => s.id) },
      dueDate: { gte: addDays(ctx.ay.startDate, -31) },
      paidAmount: 0,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
      payments: { none: {} },
    },
    include: { paymentType: { select: { code: true } } },
  });
  let settledExisting = 0;
  for (const [idx, inv] of untouched.entries()) {
    const st = rosterById.get(inv.studentId);
    if (!st) continue;
    const amount = Number(inv.amount);
    const { paidAt, paidAmount, awaiting } = decide(
      st,
      inv.dueDate,
      idx,
      inv.paymentType.code,
      amount
    );
    const settled = paidAt && !awaiting ? paidAmount : 0;
    if (paidAt) {
      payments.push(paymentRow(st, inv.id, paidAt, paidAmount, awaiting));
      settledExisting++;
    }
    await db.invoice.update({
      where: { id: inv.id },
      data: {
        paidAmount: new Prisma.Decimal(settled),
        status: statusFor(settled, amount, inv.dueDate),
      },
    });
  }

  for (const st of roster) {
    const unitTypes = types.get(st.unitType) ?? [];
    const due: Array<{
      type: (typeof unitTypes)[number];
      dueDate: Date;
      y: number;
      m: number;
      period: string;
    }> = [];
    for (const { y, m } of months) {
      for (const t of unitTypes.filter((x) => x.recurring)) {
        due.push({ type: t, dueDate: utcDate(y, m, 10), y, m, period: `${MONTHS_ID[m]} ${y}` });
      }
    }
    const du = unitTypes.find((x) => x.code === 'DU');
    if (st.isNew && du) {
      const y = ctx.ay.startDate.getUTCFullYear();
      const m = ctx.ay.startDate.getUTCMonth();
      due.push({
        type: du,
        dueDate: ctx.ay.startDate,
        y,
        m,
        period: `Tahun Ajaran ${ctx.ay.name}`,
      });
    }
    for (const [idx, d] of due.entries()) {
      const key = `${st.id}|${d.type.id}|${d.dueDate.getUTCFullYear()}-${d.dueDate.getUTCMonth()}`;
      if (have.has(key)) continue;
      have.add(key);
      const id = randomUUID();
      const amount = d.type.amount;
      const { paidAt, paidAmount, awaiting } = decide(st, d.dueDate, idx, d.type.code, amount);
      const settled = paidAt !== null && !awaiting ? paidAmount : 0;
      invoices.push({
        id,
        studentId: st.id,
        paymentTypeId: d.type.id,
        invoiceNumber: await nextNumber(d.y, d.m),
        amount: new Prisma.Decimal(amount),
        dueDate: d.dueDate,
        status: statusFor(settled, amount, d.dueDate),
        paidAmount: new Prisma.Decimal(settled),
        period: d.period,
        notes: `Tagihan ${d.type.name} untuk ${d.period}`,
        createdAt: atWib(utcDate(d.y, d.m, 1), 4),
      });
      if (paidAt) payments.push(paymentRow(st, id, paidAt, paidAmount, awaiting));
    }
  }
  await createManyChunked('Tagihan', invoices, (b) => db.invoice.createMany({ data: b }));
  await createManyChunked('Pembayaran', payments, (b) => db.payment.createMany({ data: b }));
  console.log(
    `   ✅ Pembayaran menunggu verifikasi TU: ${pendingVerification}; ` +
      `${settledExisting} tagihan lama ikut dibayar menurut kebiasaan keluarganya`
  );
}

// ============================================================================
// 8. Tahfidz, takhosus, asrama
// ============================================================================

const PRESENT_LIKE = new Set<AttendanceStatus>([AttendanceStatus.PRESENT, AttendanceStatus.LATE]);

async function setoranTahfidz(
  ctx: Ctx,
  classes: ClassRef[],
  roster: StudentRef[],
  subjects: SubjectMap,
  teachers: TeacherMap,
  attendance: AttendanceLog
): Promise<void> {
  const { db, rng } = ctx;
  const days = schoolDays(ctx);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const records: Prisma.TahfidzRecordCreateManyInput[] = [];
  const targets: Prisma.TahfidzTargetCreateManyInput[] = [];
  let carried = 0;
  let earlier = 0;

  const record = (
    st: StudentRef,
    type: TahfidzActivityType,
    piece: QuranPiece,
    at: Date,
    recordedById: string,
    notes: string | null
  ) => {
    const info = surahInfo(piece.surah);
    records.push({
      studentId: st.id,
      activityType: type,
      surahNumber: piece.surah,
      surahName: info.name,
      ayahStart: piece.from,
      ayahEnd: piece.to,
      juz: juzOf(piece.surah, piece.from),
      totalAyah: piece.to - piece.from + 1,
      score: type === TahfidzActivityType.MUROJAAH ? rng.int(70, 96) : rng.int(74, 98),
      notes,
      recordedAt: at,
      recordedById,
      createdAt: at,
    });
  };
  /** Potong program menjadi setoran sebesar kemampuan santri per pertemuan. */
  const chunked = (pieces: QuranPiece[], size: () => number): QuranPiece[] => {
    const out: QuranPiece[] = [];
    for (const p of pieces) {
      for (let from = p.from; from <= p.to;) {
        const to = Math.min(p.to, from + size() - 1);
        out.push({ surah: p.surah, from, to });
        from = to + 1;
      }
    }
    return out;
  };

  for (const st of roster) {
    if (st.unitType === 'TK_QURAN') continue;
    const c = classById.get(st.classId);
    const thf = subjects.get(st.unitType)?.find((s) => s.code === 'THF');
    const levelIdx = LEVEL_ORDER.indexOf(st.level);
    if (!c || !thf || levelIdx < 0) continue;
    const muhafidz = teacherForClass(teachers, thf, c);
    // Target KUMULATIF: juz yang tersentuh program sampai akhir tahun ini
    // (SD 1 = juz 30, SMP 9 = 3, SMA 12 = 7) — sejalan dengan cara
    // dasbor wali kelas menghitung capaian (juz yang punya setoran).
    const targetJuz = new Set(
      LEVEL_ORDER.slice(0, levelIdx + 1)
        .flatMap((l) => YEAR_PROGRAM[l])
        .map((p) => juzOf(p.surah, p.from))
    ).size;
    targets.push({
      studentId: st.id,
      academicYearId: ctx.ay.id,
      targetJuz,
      notes: `Target hafalan kumulatif sampai akhir tahun ajaran ${ctx.ay.name}`,
      createdAt: ctx.ay.startDate,
    });
    // SD menyetor Selasa & Kamis; SMP dan SMA Senin, Rabu, Jumat.
    const setoranDays = st.unitType === 'SD_IT' ? [2, 4] : [1, 3, 5];
    const base = st.unitType === 'SD_IT' ? [2, 4] : st.unitType === 'SMP_IT' ? [4, 7] : [3, 5];
    const bonus = st.ability >= 86 ? 1 : 0;
    const size = () => rng.int(base[0], base[1]) + bonus;

    // ── Hafalan sebelum tahun ini ────────────────────────────────────────
    // Santri masuk unitnya di tingkat masuk, `grade` tahun lalu. Program tingkat
    // sebelum itu dibawa dari sekolah asal dan diverifikasi saat tes penempatan;
    // program tingkat sesudahnya disetor di sini, tahun demi tahun.
    const entryIdx = LEVEL_ORDER.indexOf(ENTRY_LEVEL[st.unitType]);
    const joinYear = ctx.ay.startYear - st.grade;
    const memorized: QuranPiece[] = [];
    const carriedPieces = LEVEL_ORDER.slice(0, entryIdx).flatMap((l) => YEAR_PROGRAM[l]);
    // Tes penempatan: hari sekolah pertama santri itu hadir sejak 16 Juli tahun masuknya.
    let verifyDay = utcDate(joinYear, 6, 16);
    const absent = (d: Date) => {
      const status = attendance.get(`${st.id}|${isoDay(d)}`);
      return status !== undefined && !PRESENT_LIKE.has(status);
    };
    while ([0, 6].includes(verifyDay.getUTCDay()) || absent(verifyDay))
      verifyDay = addDays(verifyDay, 1);
    for (const [i, piece] of carriedPieces.entries()) {
      record(
        st,
        TahfidzActivityType.ZIYADAH,
        piece,
        atWib(verifyDay, 8 + Math.floor(i / 20), (i * 3) % 60),
        muhafidz.userId,
        'Hafalan dari sekolah asal, diuji saat tes penempatan'
      );
      memorized.push(piece);
      carried++;
    }
    for (let k = entryIdx; k < levelIdx; k++) {
      const yearStart = ctx.ay.startYear - (levelIdx - k);
      const yearDays: Date[] = [];
      for (
        let d = utcDate(yearStart, 6, 15);
        d < utcDate(yearStart + 1, 5, 10);
        d = addDays(d, 1)
      ) {
        if (setoranDays.includes(d.getUTCDay())) yearDays.push(d);
      }
      const pieces = chunked(YEAR_PROGRAM[LEVEL_ORDER[k]], size);
      for (const [i, piece] of pieces.entries()) {
        const day = yearDays[Math.floor((i * yearDays.length) / pieces.length)];
        record(
          st,
          TahfidzActivityType.ZIYADAH,
          piece,
          atWib(day, 6, rng.int(0, 59)),
          muhafidz.userId,
          null
        );
        earlier++;
      }
      memorized.push(...YEAR_PROGRAM[LEVEL_ORDER[k]]);
    }

    // ── Tahun ini: meneruskan urutan program dari tingkatnya sendiri ──────
    const queue = LEVEL_ORDER.slice(levelIdx).flatMap((l) => YEAR_PROGRAM[l]);
    let qi = 0;
    let ayah = queue[0]?.from ?? 1;
    for (const day of days) {
      const status = attendance.get(`${st.id}|${isoDay(day)}`);
      if (status && !PRESENT_LIKE.has(status)) continue;
      const dow = day.getUTCDay();
      if (setoranDays.includes(dow) && qi < queue.length) {
        const piece = queue[qi];
        const end = Math.min(piece.to, ayah + size() - 1);
        record(
          st,
          TahfidzActivityType.ZIYADAH,
          { surah: piece.surah, from: ayah, to: end },
          atWib(day, 6, rng.int(0, 59)),
          muhafidz.userId,
          rng.chance(0.2)
            ? rng.pick([
                'Lancar',
                'Perbaiki panjang pendek (mad)',
                'Makharijul huruf baik',
                'Perlu diulang di asrama',
              ])
            : null
        );
        if (end >= piece.to) {
          memorized.push(piece);
          qi++;
          ayah = queue[qi]?.from ?? 1;
        } else {
          ayah = end + 1;
        }
      } else if (dow === 5 || (st.unitType === 'SD_IT' && dow === 3)) {
        // Murojaah pekanan: mengulang hafalan yang sudah tuntas; potongan panjang
        // diulang sebagian, dua puluh ayat.
        if (!memorized.length) continue;
        const p = rng.pick(memorized);
        const from = p.to - p.from > 30 ? rng.int(p.from, p.to - 19) : p.from;
        const to = p.to - p.from > 30 ? from + 19 : p.to;
        record(
          st,
          TahfidzActivityType.MUROJAAH,
          { surah: p.surah, from, to },
          atWib(day, 15, rng.int(30, 59)),
          muhafidz.userId,
          null
        );
      }
    }
  }
  // Upsert, bukan skipDuplicates: target lama dari seed dasar (5 juz untuk santri
  // SD, misalnya) harus ikut aturan kurikulum yang sama.
  for (const t of targets) {
    await db.tahfidzTarget.upsert({
      where: {
        studentId_academicYearId: { studentId: t.studentId, academicYearId: t.academicYearId },
      },
      create: t,
      update: { targetJuz: t.targetJuz, notes: t.notes },
    });
  }
  console.log(`   ✅ Target hafalan kumulatif: ${targets.length}`);
  await createManyChunked('Setoran tahfidz (riwayat + tahun ini)', records, (b) =>
    db.tahfidzRecord.createMany({ data: b })
  );
  console.log(
    `   ✅ Riwayat hafalan: ${carried} surah dari sekolah asal (tes penempatan), ${earlier} setoran tahun-tahun lalu`
  );
}

async function takhosus(
  ctx: Ctx,
  roster: StudentRef[],
  teachers: TeacherMap,
  attendance: AttendanceLog
): Promise<void> {
  const { db, rng } = ctx;
  const already = new Set(
    (await db.takhosusEnrollment.findMany({ select: { studentId: true } })).map((r) => r.studentId)
  );
  const eligible = roster
    .filter(
      (s) =>
        (s.unitType === 'SMA_QURAN' || (s.unitType === 'SMP_IT' && s.grade >= 1)) &&
        !already.has(s.id)
    )
    .sort((a, b) => b.ability - a.ability);
  const groups: Array<{
    gender: Gender;
    code: string;
    name: string;
    teacher: string;
    location: string;
  }> = [
    {
      gender: Gender.MALE,
      code: 'HLQ-TKH-PA',
      name: 'Halaqoh Takhosus Putra',
      teacher: 'pesantren.muhafidz@cipansor.or.id',
      location: 'Masjid Pesantren',
    },
    {
      gender: Gender.FEMALE,
      code: 'HLQ-TKH-PI',
      name: 'Halaqoh Takhosus Putri',
      teacher: 'pesantren.muhafidzah@cipansor.or.id',
      location: 'Aula Asrama Putri',
    },
  ];
  const days = schoolDays(ctx);
  const murojaah: Prisma.MurojaahRecordCreateManyInput[] = [];
  let enrolled = 0;
  for (const g of groups) {
    const t = teacherOf(teachers, g.teacher);
    const halaqoh = await db.halaqoh.upsert({
      where: { code: g.code },
      create: {
        unitId: ctx.units.SMP_IT.id,
        name: g.name,
        code: g.code,
        // Halaqoh.teacherId menunjuk ke users, bukan teachers.
        teacherId: t.userId,
        level: 3,
        capacity: 10,
        scheduleTime: '04:30-06:00',
        location: g.location,
        description:
          'Program takhosus tahfidz: target 30 juz bersanad, setoran dan murojaah setiap hari.',
        isActive: true,
      },
      update: {},
    });
    for (const st of eligible.filter((s) => s.gender === g.gender).slice(0, 6)) {
      const completedJuz = st.unitType === 'SMA_QURAN' ? rng.int(4, 8) : rng.int(2, 4);
      const enrollment = await db.takhosusEnrollment.create({
        data: {
          studentId: st.id,
          halaqohId: halaqoh.id,
          enrolledAt: ctx.ay.startDate,
          status: TakhosusStatus.ACTIVE,
          targetJuz: 30,
          targetCompletionDate: utcDate(ctx.ay.startYear + 3, 5, 30),
          completedJuz,
          currentJuz: completedJuz + 1,
          notes: 'Peserta takhosus dari santri berasrama',
          createdAt: ctx.ay.startDate,
        },
      });
      enrolled++;
      for (const day of days) {
        const status = attendance.get(`${st.id}|${isoDay(day)}`);
        if (status && !PRESENT_LIKE.has(status)) continue;
        const weekly = day.getUTCDay() === 5;
        const juz = rng.int(1, completedJuz);
        murojaah.push({
          studentId: st.id,
          enrollmentId: enrollment.id,
          halaqohId: halaqoh.id,
          recordedById: t.userId,
          murojaahType: weekly ? MurojaahType.USBUIYAH : MurojaahType.YAUMIYAH,
          murojaahDate: day,
          juzStart: weekly ? 1 : juz,
          juzEnd: weekly ? completedJuz : juz,
          pagesReviewed: weekly ? completedJuz * 20 : rng.int(5, 20),
          durationMinutes: weekly ? rng.int(90, 150) : rng.int(30, 60),
          qualityScore: rng.int(72, 98),
          mistakeCount: rng.int(0, 6),
          fluencyLevel: rng.int(3, 5),
          tajwidScore: rng.int(75, 97),
          createdAt: atWib(day, 6, 30),
        });
      }
    }
  }
  console.log(`   ✅ Peserta takhosus: ${enrolled}`);
  await createManyChunked('Murojaah takhosus', murojaah, (b) =>
    db.murojaahRecord.createMany({ data: b })
  );
}

async function asrama(ctx: Ctx, roster: StudentRef[]): Promise<void> {
  const { db } = ctx;
  const boarders = roster.filter((s) => s.unitType === 'SMP_IT' || s.unitType === 'SMA_QURAN');
  const active = new Set(
    (
      await db.roomAssignment.findMany({ where: { isActive: true }, select: { studentId: true } })
    ).map((r) => r.studentId)
  );
  let assigned = 0;
  let roomsAdded = 0;
  for (const gender of [Gender.MALE, Gender.FEMALE]) {
    const dorm = await db.dormitory.findFirst({
      where: { gender, deletedAt: null },
      orderBy: { code: 'asc' },
    });
    if (!dorm) continue;
    const prefix = gender === Gender.MALE ? 'P' : 'W';
    const need = boarders
      .filter((s) => s.gender === gender && !active.has(s.id))
      .sort((a, b) => a.unitType.localeCompare(b.unitType) || a.grade - b.grade);
    // Kamar cukup untuk semua santri berasrama, delapan per kamar.
    const rooms = await db.room.findMany({
      where: { dormitoryId: dorm.id, isActive: true },
      include: { _count: { select: { assignments: { where: { isActive: true } } } } },
      orderBy: { name: 'asc' },
    });
    let free = rooms.reduce((a, r) => a + Math.max(0, r.capacity - r._count.assignments), 0);
    let n = rooms.length;
    while (free < need.length) {
      n++;
      const room = await db.room.create({
        data: {
          dormitoryId: dorm.id,
          name: `Kamar ${prefix}${n}`,
          floor: Math.ceil(n / 3),
          capacity: 8,
          isActive: true,
        },
      });
      rooms.push({ ...room, _count: { assignments: 0 } });
      free += 8;
      roomsAdded++;
    }
    const occupancy = new Map(rooms.map((r) => [r.id, r._count.assignments]));
    for (const st of need) {
      const room = rooms.find((r) => (occupancy.get(r.id) ?? 0) < r.capacity);
      if (!room) break;
      await db.roomAssignment.create({
        data: {
          studentId: st.id,
          roomId: room.id,
          assignedAt: ctx.ay.startDate,
          isActive: true,
          createdAt: ctx.ay.startDate,
        },
      });
      occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1);
      assigned++;
    }
  }
  console.log(`   ✅ Penempatan asrama: ${assigned} santri, ${roomsAdded} kamar ditambahkan`);
}

// ============================================================================
// 8b. Kesehatan (UKS)
// ============================================================================

/** Median tinggi (cm) dan berat (kg) per usia, dibulatkan dari standar WHO. */
const BODY_MEDIAN: Record<Gender, Record<number, [number, number]>> = {
  [Gender.MALE]: {
    4: [103, 16],
    5: [110, 18],
    6: [116, 21],
    7: [122, 23],
    8: [128, 26],
    9: [133, 29],
    10: [138, 32],
    11: [143, 36],
    12: [149, 40],
    13: [156, 45],
    14: [163, 51],
    15: [169, 56],
    16: [173, 60],
    17: [175, 63],
    18: [176, 65],
  },
  [Gender.FEMALE]: {
    4: [102, 16],
    5: [109, 18],
    6: [115, 20],
    7: [121, 23],
    8: [127, 26],
    9: [133, 29],
    10: [138, 33],
    11: [144, 37],
    12: [151, 41],
    13: [156, 45],
    14: [159, 48],
    15: [161, 51],
    16: [162, 53],
    17: [163, 54],
    18: [163, 55],
  },
};

const ILLNESSES: Array<{
  complaint: string;
  diagnosis: string;
  treatment: string;
  fever: boolean;
}> = [
  {
    complaint: 'Demam dan badan lemas sejak malam',
    diagnosis: 'Febris, suspek ISPA',
    treatment: 'Paracetamol 500 mg 3×1, kompres hangat, istirahat di ruang UKS',
    fever: true,
  },
  {
    complaint: 'Batuk dan pilek, tenggorokan sakit',
    diagnosis: 'ISPA ringan',
    treatment: 'Obat batuk sirup 3×1, vitamin C, banyak minum air hangat',
    fever: false,
  },
  {
    complaint: 'Nyeri ulu hati dan mual setelah makan',
    diagnosis: 'Dispepsia',
    treatment: 'Antasida 3×1 sebelum makan, makan teratur',
    fever: false,
  },
  {
    complaint: 'Buang air besar cair lebih dari tiga kali',
    diagnosis: 'Diare akut tanpa dehidrasi',
    treatment: 'Oralit, zinc 1×1 selama 10 hari, pantau asupan cairan',
    fever: false,
  },
  {
    complaint: 'Pusing dan kurang tidur',
    diagnosis: 'Cephalgia',
    treatment: 'Paracetamol 500 mg bila perlu, istirahat',
    fever: false,
  },
  {
    complaint: 'Gatal-gatal di sela jari dan lipatan badan',
    diagnosis: 'Suspek skabies',
    treatment: 'Salep permetrin 5%, seprai dan pakaian kamar dicuci air panas',
    fever: false,
  },
];

const MINOR_VISITS: Array<{ type: MedicalRecordType; complaint: string; treatment: string }> = [
  {
    type: MedicalRecordType.FIRST_AID,
    complaint: 'Lutut lecet terjatuh saat olahraga',
    treatment: 'Luka dibersihkan, diberi antiseptik dan plester',
  },
  {
    type: MedicalRecordType.INJURY,
    complaint: 'Pergelangan kaki terkilir saat bermain bola',
    treatment: 'Kompres dingin, dibalut elastis, istirahat dari olahraga 3 hari',
  },
  {
    type: MedicalRecordType.FIRST_AID,
    complaint: 'Mimisan di kelas',
    treatment: 'Posisi duduk condong ke depan, hidung ditekan 10 menit',
  },
  {
    type: MedicalRecordType.FIRST_AID,
    complaint: 'Pusing saat upacara',
    treatment: 'Istirahat di UKS, teh manis hangat',
  },
  {
    type: MedicalRecordType.FIRST_AID,
    complaint: 'Jari tergores saat praktik prakarya',
    treatment: 'Luka dibersihkan dan diplester',
  },
];

/**
 * Catatan UKS yang sejalan dengan presensi: pemeriksaan awal tahun ajaran untuk
 * setiap santri, kunjungan sakit untuk santri BERASRAMA pada hari presensinya
 * "sakit" (santri harian sakit di rumah, jadi tidak ke UKS), dan pertolongan
 * pertama sesekali di semua unit.
 */
async function kesehatanUks(
  ctx: Ctx,
  roster: StudentRef[],
  attendance: AttendanceLog
): Promise<void> {
  const { db, rng } = ctx;
  const nurse = ctx.users.get('sarana.perawat@cipansor.or.id')?.id ?? ctx.superAdminId;
  const days = schoolDays(ctx);
  const rows: Prisma.MedicalRecordCreateManyInput[] = [];
  const vitals = (fever: boolean) => ({
    temperature: fever
      ? Math.round((37.8 + rng.next() * 1.2) * 10) / 10
      : Math.round((36.4 + rng.next() * 0.8) * 10) / 10,
    bloodPressure: `${rng.int(100, 120)}/${rng.int(65, 80)}`,
    heartRate: rng.int(fever ? 90 : 72, fever ? 110 : 92),
  });

  // 1. Pemeriksaan kesehatan awal tahun ajaran: hari sekolah kedua dan ketiga.
  const screening = days.slice(1, 3);
  for (const [i, st] of roster.entries()) {
    const day = screening[i % screening.length] ?? ctx.ay.startDate;
    const planned = CLASS_PLAN[st.unitType].find((c) => c.name === st.className)?.age ?? 12;
    const age = clamp(planned, 4, 18); // usia per 15 Juli, dan pemeriksaan jatuh di pekan yang sama
    const [h, w] = BODY_MEDIAN[st.gender][age] ?? BODY_MEDIAN[st.gender][18];
    const visitDate = atWib(day, rng.int(8, 13), rng.int(0, 59));
    rows.push({
      studentId: st.id,
      type: MedicalRecordType.CHECKUP,
      visitDate,
      complaint: 'Pemeriksaan kesehatan awal tahun ajaran',
      diagnosis: 'Sehat',
      treatment: null,
      recordedById: nurse,
      status: HealthStatus.HEALTHY,
      height: Math.round(h * (0.95 + rng.next() * 0.1) * 10) / 10,
      weight: Math.round(w * (0.88 + rng.next() * 0.24) * 10) / 10,
      ...vitals(false),
      createdAt: visitDate,
    });
  }

  // 2. Santri berasrama yang sakit dirawat UKS; hari sakit berturut-turut = satu episode.
  const boarders = roster.filter((s) => s.unitType === 'SMP_IT' || s.unitType === 'SMA_QURAN');
  let episodes = 0;
  let referrals = 0;
  for (const st of boarders) {
    let i = 0;
    while (i < days.length) {
      if (attendance.get(`${st.id}|${isoDay(days[i])}`) !== AttendanceStatus.SICK) {
        i++;
        continue;
      }
      let j = i;
      while (
        j + 1 < days.length &&
        attendance.get(`${st.id}|${isoDay(days[j + 1])}`) === AttendanceStatus.SICK
      )
        j++;
      const length = j - i + 1;
      const ill = rng.pick(ILLNESSES);
      const visitDate = atWib(days[i], rng.int(5, 7), rng.int(0, 59));
      const endsAgo = Math.round((ctx.today.getTime() - days[j].getTime()) / DAY_MS);
      const referred = length >= 3;
      rows.push({
        studentId: st.id,
        type: referred ? MedicalRecordType.REFERRAL : MedicalRecordType.ILLNESS,
        visitDate,
        complaint: ill.complaint,
        diagnosis: ill.diagnosis,
        treatment: ill.treatment,
        referredTo: referred ? 'Puskesmas Kadipaten' : null,
        notes: referred
          ? `Tidak membaik setelah ${length} hari di UKS, dirujuk dan wali santri dihubungi`
          : `Istirahat di UKS ${length} hari, izin tidak masuk kelas`,
        followUpDate: addDays(days[j], 1),
        recordedById: nurse,
        status:
          endsAgo <= 1
            ? HealthStatus.SICK
            : endsAgo <= 4
              ? HealthStatus.RECOVERING
              : HealthStatus.HEALTHY,
        ...vitals(ill.fever),
        createdAt: visitDate,
      });
      episodes++;
      if (referred) referrals++;
      i = j + 1;
    }
  }

  // 3. Pertolongan pertama: sekitar satu kunjungan per unit per empat hari sekolah.
  const byUnit = new Map<SchoolUnit, StudentRef[]>();
  for (const st of roster) byUnit.set(st.unitType, [...(byUnit.get(st.unitType) ?? []), st]);
  let minor = 0;
  for (const day of days) {
    for (const [, students] of byUnit) {
      if (!rng.chance(0.25)) continue;
      const st = rng.pick(students);
      if (attendance.get(`${st.id}|${isoDay(day)}`) !== AttendanceStatus.PRESENT) continue;
      const v = rng.pick(MINOR_VISITS);
      const visitDate = atWib(day, rng.int(8, 13), rng.int(0, 59));
      rows.push({
        studentId: st.id,
        type: v.type,
        visitDate,
        complaint: v.complaint,
        treatment: v.treatment,
        recordedById: nurse,
        status: HealthStatus.HEALTHY,
        ...vitals(false),
        createdAt: visitDate,
      });
      minor++;
    }
  }

  await createManyChunked('Catatan UKS', rows, (b) => db.medicalRecord.createMany({ data: b }));
  console.log(
    `   ✅ UKS: ${roster.length} pemeriksaan awal, ${episodes} episode sakit santri asrama ` +
      `(${referrals} dirujuk), ${minor} pertolongan pertama`
  );
}

/**
 * Riwayat dasbor adalah CACHE turunan yang ditulis job metrik dari data saat
 * itu. Baris lama dihitung atas data seed dasar yang jauh lebih kecil, sehingga
 * dasbor memamerkan "pertumbuhan +1162%" yang tidak pernah terjadi. Job akan
 * mengisinya kembali dari data sekarang.
 */
async function bersihkanCacheDasbor(ctx: Ctx): Promise<void> {
  const history = await ctx.db.dashboardHistory.deleteMany({});
  const snapshots = await ctx.db.dashboardMetricSnapshot.deleteMany({});
  console.log(
    `   ✅ Cache dasbor dikosongkan: ${history.count} riwayat, ${snapshots.count} snapshot`
  );
}

// ============================================================================
// 9. Kedisiplinan dan perizinan
// ============================================================================

const VIOLATIONS: Array<{
  type: ViolationType;
  category: string;
  description: string;
  points: number;
  action: string;
}> = [
  {
    type: ViolationType.MINOR,
    category: 'ibadah',
    description: 'Terlambat hadir salat Subuh berjamaah',
    points: 5,
    action: 'Teguran lisan dan istighfar 100 kali',
  },
  {
    type: ViolationType.MINOR,
    category: 'kebersihan',
    description: 'Kamar tidak rapi saat pemeriksaan pagi',
    points: 3,
    action: 'Membersihkan area kamar',
  },
  {
    type: ViolationType.MINOR,
    category: 'ketertiban',
    description: 'Terlambat masuk kelas setelah istirahat',
    points: 3,
    action: 'Teguran lisan',
  },
  {
    type: ViolationType.MINOR,
    category: 'bahasa',
    description: 'Tidak memakai bahasa Arab pada hari bahasa',
    points: 2,
    action: 'Menghafal 10 mufradat baru',
  },
  {
    type: ViolationType.MINOR,
    category: 'ketertiban',
    description: 'Membawa makanan ke dalam kamar',
    points: 3,
    action: 'Teguran lisan',
  },
  {
    type: ViolationType.MODERATE,
    category: 'ketertiban',
    description: 'Keluar lingkungan pesantren tanpa izin',
    points: 15,
    action: 'Pemanggilan orang tua',
  },
  {
    type: ViolationType.MODERATE,
    category: 'akhlak',
    description: 'Berkata kasar kepada teman',
    points: 10,
    action: 'Pembinaan oleh murabbi',
  },
  {
    type: ViolationType.MODERATE,
    category: 'ketertiban',
    description: 'Membawa telepon genggam ke asrama',
    points: 15,
    action: 'Telepon disita dan diserahkan kepada orang tua',
  },
];

async function kedisiplinan(ctx: Ctx, roster: StudentRef[], classes: ClassRef[]): Promise<void> {
  const { db, rng } = ctx;
  const days = schoolDays(ctx);
  if (days.length === 0) return;
  const boarders = roster.filter((s) => s.unitType === 'SMP_IT' || s.unitType === 'SMA_QURAN');
  const musyrif = userId(ctx, 'pesantren.musyrif@cipansor.or.id');
  const musyrifah = userId(ctx, 'pesantren.musyrifah@cipansor.or.id');
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Santri yang sering absen juga lebih sering tercatat melanggar.
  const weighted = boarders.flatMap((s) =>
    s.absenceRisk > 0.1 ? [s, s, s, s] : s.absenceRisk > 0.05 ? [s, s] : [s]
  );
  const violations: Prisma.ViolationCreateManyInput[] = [];
  for (let i = 0; i < 28 && weighted.length; i++) {
    const st = rng.pick(weighted);
    const v =
      i % 5 === 4
        ? rng.pick(VIOLATIONS.filter((x) => x.type === ViolationType.MODERATE))
        : rng.pick(VIOLATIONS.filter((x) => x.type === ViolationType.MINOR));
    violations.push({
      studentId: st.id,
      type: v.type,
      category: v.category,
      description: v.description,
      points: v.points,
      action: v.action,
      occurredAt: atWib(rng.pick(days), v.category === 'ibadah' ? 4 : 19, rng.int(30, 59)),
      reportedById: st.gender === Gender.MALE ? musyrif : musyrifah,
    });
    violations[violations.length - 1].createdAt = violations[violations.length - 1].occurredAt;
  }
  await createManyChunked('Catatan pelanggaran', violations, (b) =>
    db.violation.createMany({ data: b })
  );

  const rewardsList: Array<{ category: string; description: string; points: number }> = [
    {
      category: 'tahfidz',
      description: 'Menuntaskan setoran satu surah dengan predikat mumtaz',
      points: 10,
    },
    {
      category: 'akademik',
      description: 'Nilai tertinggi Ulangan Harian 1 di rombelnya',
      points: 10,
    },
    { category: 'akhlak', description: 'Membantu petugas kebersihan tanpa diminta', points: 5 },
    {
      category: 'kebersihan',
      description: 'Kamar terbersih pada pemeriksaan pekan ini',
      points: 5,
    },
    { category: 'prestasi', description: 'Juara lomba MHQ tingkat kecamatan', points: 20 },
  ];
  const rewards: Prisma.RewardCreateManyInput[] = [];
  const pool = roster
    .filter((s) => s.unitType !== 'TK_QURAN')
    .sort((a, b) => b.ability - a.ability);
  for (let i = 0; i < 40 && pool.length; i++) {
    const st =
      pool[Math.min(pool.length - 1, Math.floor(Math.abs(rng.normal(0, pool.length / 3))))];
    const r =
      st.unitType === 'SD_IT'
        ? rng.pick(rewardsList.filter((x) => x.category !== 'kebersihan'))
        : rng.pick(rewardsList);
    const c = classById.get(st.classId);
    rewards.push({
      studentId: st.id,
      category: r.category,
      description: r.description,
      points: r.points,
      givenAt: atWib(rng.pick(days), 13, rng.int(0, 59)),
      givenById: c?.homeroomUserId ?? ctx.superAdminId,
    });
    rewards[rewards.length - 1].createdAt = rewards[rewards.length - 1].givenAt;
  }
  await createManyChunked('Catatan penghargaan', rewards, (b) => db.reward.createMany({ data: b }));

  // Izin pulang/keluar santri berasrama.
  const permits: Prisma.PermitCreateManyInput[] = [];
  const existingCodes = await db.permit.count();
  let seq = existingCodes + 1;
  const yy = pad(ctx.today.getUTCFullYear() % 100, 2);
  for (let i = 0; i < 16 && boarders.length; i++) {
    const st = rng.pick(boarders);
    const approver = st.gender === Gender.MALE ? musyrif : musyrifah;
    const kind = rng.pick([
      {
        type: PermitType.PULANG,
        reason: 'Pulang akhir pekan bulanan',
        destination: 'Rumah orang tua',
        span: 2,
      },
      {
        type: PermitType.SAKIT,
        reason: 'Berobat ke puskesmas didampingi wali kamar',
        destination: 'Puskesmas Kadipaten',
        span: 0,
      },
      {
        type: PermitType.KELUARGA,
        reason: 'Menghadiri pernikahan kakak',
        destination: 'Rumah orang tua',
        span: 1,
      },
    ]);
    let status: PermitStatus;
    let start: Date;
    if (i < 11) {
      status = PermitStatus.COMPLETED;
      start = rng.pick(days.slice(0, Math.max(1, days.length - 3)));
    } else if (i < 13) {
      status = PermitStatus.APPROVED;
      start = addDays(ctx.today, rng.int(2, 9));
    } else if (i < 15) {
      status = PermitStatus.PENDING;
      start = addDays(ctx.today, rng.int(3, 12));
    } else {
      status = PermitStatus.REJECTED;
      start = addDays(ctx.today, rng.int(1, 5));
    }
    const end = addDays(start, kind.span);
    const decided = status !== PermitStatus.PENDING;
    permits.push({
      studentId: st.id,
      type: kind.type,
      reason: kind.reason,
      destination: kind.destination,
      startDate: atWib(start, 13),
      endDate: atWib(end, 17),
      status,
      approvedById: decided ? approver : null,
      approvedAt: decided ? atWib(addDays(start, -1), 20) : null,
      // Boarders: their musyrif decides (2026-09-25).
      decidedAs: decided ? PermitDecider.MUSYRIF : null,
      rejectionNote:
        status === PermitStatus.REJECTED ? 'Bertepatan dengan Penilaian Tengah Semester' : null,
      departedAt: status === PermitStatus.COMPLETED ? atWib(start, 13, 30) : null,
      returnedAt: status === PermitStatus.COMPLETED ? atWib(end, 16, 45) : null,
      code: `IZN-${yy}${pad(seq++, 4)}`,
      // Diajukan wali/santri beberapa hari sebelum berangkat (paling lambat kemarin).
      createdAt: atWib(
        new Date(Math.min(addDays(start, -3).getTime(), addDays(ctx.today, -1).getTime())),
        19
      ),
    });
  }
  await createManyChunked('Perizinan santri', permits, (b) =>
    db.permit.createMany({ data: b, skipDuplicates: true })
  );
}

// ============================================================================
// 10. SPMB tahun ajaran berikutnya
// ============================================================================

/**
 * Kuota gelombang 1 dan 2, jumlah pendaftar, usia termuda pada 1 Juli tahun
 * masuk, dan asal sekolah per unit. Biaya, persyaratan, dan usia minimal
 * diambil dari brosur (seeds/spmb-demo.ts), jadi `age` tidak boleh di bawah
 * usia minimal brosur.
 */
const SPMB_PLAN: Record<
  SchoolUnit,
  { quota: [number, number]; count: number; age: number; from: string[] }
> = {
  TK_QURAN: {
    quota: [20, 10],
    count: 8,
    age: 5,
    from: ['Belum bersekolah', 'PAUD di lingkungan tempat tinggal'],
  },
  SD_IT: {
    quota: [28, 12],
    count: 12,
    age: 7,
    from: [
      "TK Qur'an Cipansor",
      "TK Qur'an Cipansor",
      'RA di Kec. Kadipaten',
      'TK di Kec. Pagerageung',
    ],
  },
  SMP_IT: {
    quota: [50, 20],
    count: 14,
    age: 12,
    from: [
      'SD IT Cipansor',
      'SD IT Cipansor',
      'MI di Kec. Kadipaten',
      'SD Negeri di Kec. Ciawi',
      'SD Negeri di Kec. Rajapolah',
    ],
  },
  SMA_QURAN: {
    quota: [32, 16],
    count: 12,
    age: 15,
    from: [
      'SMP IT Cipansor',
      'SMP IT Cipansor',
      'MTs di Kec. Kadipaten',
      'SMP Negeri di Kec. Jamanis',
    ],
  },
};

async function spmb(ctx: Ctx): Promise<void> {
  const { db, rng } = ctx;
  const intake = nextAcademicYear(ctx.now);
  const intakeRow =
    (await db.academicYear.findUnique({ where: { name: intake.name } })) ??
    (await db.academicYear.create({
      data: {
        name: intake.name,
        startDate: intake.startDate,
        endDate: intake.endDate,
        isActive: false,
      },
    }));
  const statuses: AdmissionStatus[] = [
    AdmissionStatus.REGISTERED,
    AdmissionStatus.REGISTERED,
    AdmissionStatus.REGISTERED,
    AdmissionStatus.DOCUMENT_CHECK,
    AdmissionStatus.DOCUMENT_CHECK,
    AdmissionStatus.TEST_SCHEDULED,
    AdmissionStatus.TEST_SCHEDULED,
    AdmissionStatus.TEST_COMPLETED,
    AdmissionStatus.TEST_COMPLETED,
    AdmissionStatus.ACCEPTED,
    AdmissionStatus.ACCEPTED,
    AdmissionStatus.ACCEPTED,
    AdmissionStatus.REJECTED,
    AdmissionStatus.ACCEPTED,
  ];
  const tuByUnit: Record<SchoolUnit, string> = {
    TK_QURAN: FINANCE_OFFICERS.TK_QURAN.tu,
    SD_IT: FINANCE_OFFICERS.SD_IT.tu,
    SMP_IT: FINANCE_OFFICERS.SMP_IT.tu,
    SMA_QURAN: FINANCE_OFFICERS.SMA_QURAN.tu,
  };
  let total = 0;
  for (const unitType of Object.keys(SPMB_PLAN) as SchoolUnit[]) {
    const plan = SPMB_PLAN[unitType];
    const unitId = ctx.units[unitType].id;
    // Satu periode per unit dengan dua gelombang di sekitar hari ini. Periode
    // SMP IT dari seed dasar bernama sama, jadi dipakai ulang beserta
    // pendaftarnya.
    const period = await ensureDemoIntake(db, {
      unit: unitType,
      unitId,
      academicYear: intakeRow,
      quotas: plan.quota,
      now: ctx.now,
    });
    const waves = period.waves;
    const wave1 = waves[0];
    const unitSeq = await db.registrant.count({ where: { admissionPeriodId: period.id } });
    const tuId = ctx.users.get(tuByUnit[unitType])?.id ?? null;
    const minDay = period.startDate.getTime();
    const span = Math.max(1, ctx.now.getTime() - minDay);
    const rows: Prisma.RegistrantCreateManyInput[] = [];
    for (let i = 0; i < plan.count; i++) {
      const gender = i % 2 === 0 ? Gender.MALE : Gender.FEMALE;
      const name = `${gender === Gender.MALE ? rng.pick(BOY_NAMES) : rng.pick(GIRL_NAMES)} ${gender === Gender.MALE ? rng.pick(BOY_SECOND) : rng.pick(GIRL_SECOND)}`;
      const status = statuses[i % statuses.length];
      const createdAt = new Date(minDay + Math.floor(rng.next() * span * 0.9));
      const tested = (
        [
          AdmissionStatus.TEST_COMPLETED,
          AdmissionStatus.ACCEPTED,
          AdmissionStatus.REJECTED,
        ] as AdmissionStatus[]
      ).includes(status);
      const accepted = status === AdmissionStatus.ACCEPTED;
      const feePaid = accepted && i % 2 === 1;
      const secondary = unitType === 'SMP_IT' || unitType === 'SMA_QURAN';
      const father = rng.pick(FATHER_NAMES);
      rows.push({
        admissionPeriodId: period.id,
        waveId: wave1.id,
        registrationNo: `SPMB${pad(intake.startYear % 100, 2)}-${NIS_UNIT_CODE[unitType]}-${pad(unitSeq + i + 1, 4)}`,
        fullName: name,
        name,
        gender,
        birthPlace: rng.pick(BIRTH_PLACES),
        // Lahir setahun sebelum tahun yang membuatnya genap `age` tahun pada
        // 1 Juli tahun masuk: umurnya `age` sampai `age`+1 pada hari itu.
        birthDate: utcDate(intake.startYear - plan.age - 1, rng.int(0, 11), rng.int(1, 28)),
        address: `Kp. ${rng.pick(KAMPUNG)}, Kec. ${rng.pick(KECAMATAN)}, Kab. Tasikmalaya`,
        previousSchool: rng.pick(plan.from),
        quranAbility: secondary
          ? rng.pick([QuranAbility.LANCAR, QuranAbility.TARTIL, QuranAbility.TAHFIDZ])
          : rng.pick([QuranAbility.BELUM_BISA, QuranAbility.IQRA, QuranAbility.LANCAR]),
        memorizedJuz:
          unitType === 'SMA_QURAN' ? rng.int(2, 6) : unitType === 'SMP_IT' ? rng.int(0, 2) : 0,
        parentName: father,
        parentPhone: `0800${pad(9_000_000 + total + i, 7)}`,
        parentOccupation: rng.pick(['Wiraswasta', 'Petani', 'Pegawai swasta', 'Guru', 'Pedagang']),
        status,
        testScore: tested ? new Prisma.Decimal(rng.int(62, 95)) : null,
        interviewScore: tested ? new Prisma.Decimal(rng.int(70, 95)) : null,
        tahfidzScore: tested && secondary ? new Prisma.Decimal(rng.int(65, 98)) : null,
        acceptedAt: accepted
          ? new Date(Math.min(createdAt.getTime() + 14 * DAY_MS, ctx.now.getTime()))
          : null,
        registrationFeePaidAt: feePaid
          ? new Date(Math.min(createdAt.getTime() + 18 * DAY_MS, ctx.now.getTime()))
          : null,
        registrationFeeAmount: feePaid ? period.registrationFee : null,
        registrationFeeVerifiedById: feePaid ? tuId : null,
        notes:
          status === AdmissionStatus.REJECTED
            ? "Belum memenuhi batas minimal tes baca Al-Qur'an"
            : null,
        source: rng.pick(['Website', 'Media sosial', 'Rekomendasi wali santri', 'Alumni']),
        createdAt,
      });
    }
    await db.registrant.createMany({ data: rows, skipDuplicates: true });
    total += rows.length;

    for (const wave of waves) {
      const registered = await db.registrant.count({ where: { waveId: wave.id } });
      const acceptedCount = await db.registrant.count({
        where: {
          waveId: wave.id,
          status: { in: [AdmissionStatus.ACCEPTED, AdmissionStatus.ENROLLED] },
        },
      });
      await db.admissionWave.update({
        where: { id: wave.id },
        data: {
          quota: Math.max(wave.quota, registered, 1),
          registeredCount: registered,
          acceptedCount,
        },
      });
    }
  }
  console.log(`   ✅ Pendaftar SPMB ${intake.name}: ${total} baru di empat unit`);
}

// ============================================================================
// 11. Kalender akademik dan pengumuman
// ============================================================================

async function kalenderDanPengumuman(ctx: Ctx): Promise<void> {
  const { db } = ctx;
  const y = ctx.ay.startYear;
  const creator = ctx.users.get('yayasan.sekretaris@cipansor.or.id')?.id ?? ctx.superAdminId;
  const pts = schoolDayFrom(ctx, 84);
  const events: Array<{
    title: string;
    description: string;
    type: EventType;
    start: Date;
    end: Date;
  }> = [
    {
      title: 'Masa Pengenalan Lingkungan Sekolah (MPLS)',
      description: 'Pengenalan sekolah dan asrama bagi santri baru semua jenjang.',
      type: EventType.ACADEMIC,
      start: ctx.ay.startDate,
      end: addDays(ctx.ay.startDate, 2),
    },
    {
      title: `Upacara HUT ke-${y - 1945} Kemerdekaan RI`,
      description: 'Upacara bendera bersama seluruh unit. Kegiatan belajar diliburkan.',
      type: EventType.CEREMONY,
      start: utcDate(y, 7, 17),
      end: utcDate(y, 7, 17),
    },
    {
      title: 'Penilaian Tengah Semester Ganjil',
      description: "PTS untuk SD IT, SMP IT, dan SMA Qur'an sesuai jadwal masing-masing rombel.",
      type: EventType.ACADEMIC,
      start: pts,
      end: addDays(pts, 4),
    },
    {
      title: 'Pembagian Hasil PTS Ganjil',
      description: 'Wali kelas menyampaikan hasil PTS kepada orang tua/wali santri.',
      type: EventType.MEETING,
      start: addDays(pts, 12),
      end: addDays(pts, 12),
    },
    // Tanggal PAS dan libur mengikuti pengumuman yang sudah ada (10–18 Desember,
    // libur 20 Desember s.d. 5 Januari) supaya kalender dan pengumuman sepakat.
    {
      title: 'Penilaian Akhir Semester Ganjil',
      description: 'PAS semester ganjil semua jenjang.',
      type: EventType.ACADEMIC,
      start: utcDate(y, 11, 10),
      end: utcDate(y, 11, 18),
    },
    {
      title: 'Pembagian Rapor Semester Ganjil',
      description: 'Rapor dibagikan melalui aplikasi dan pertemuan wali kelas.',
      type: EventType.ACADEMIC,
      start: utcDate(y, 11, 19),
      end: utcDate(y, 11, 19),
    },
    {
      title: 'Libur Semester Ganjil',
      description: 'Santri pulang ke rumah masing-masing.',
      type: EventType.HOLIDAY,
      start: utcDate(y, 11, 20),
      end: utcDate(y + 1, 0, 5),
    },
    {
      title: 'Rapat Evaluasi Semester Ganjil Yayasan',
      description: 'Pengurus yayasan bersama kepala unit mengevaluasi capaian semester ganjil.',
      type: EventType.MEETING,
      start: utcDate(y, 11, 21),
      end: utcDate(y, 11, 21),
    },
  ];
  let added = 0;
  for (const e of events) {
    const exists = await db.calendarEvent.findFirst({ where: { title: e.title, deletedAt: null } });
    if (exists) continue;
    await db.calendarEvent.create({
      data: {
        title: e.title,
        description: e.description,
        eventType: e.type,
        scope: EventScope.ALL_UNITS,
        startDate: atWib(e.start, 7),
        endDate: atWib(e.end, 15),
        isAllDay: true,
        isPublic: true,
        createdById: creator,
        createdAt: addDays(ctx.ay.startDate, -10),
      },
    });
    added++;
  }

  const windows = admissionWindows(ctx.now);
  const announcements = [
    {
      title: 'Jadwal Penilaian Tengah Semester Ganjil',
      content: `Penilaian Tengah Semester Ganjil dilaksanakan mulai ${pts.toISOString().slice(0, 10)} selama lima hari sekolah. Jadwal per rombel dapat dilihat di menu Jadwal. Santri diharapkan menjaga kesehatan dan mempersiapkan diri.`,
      priority: 1,
      publishedAt: new Date(Math.min(addDays(pts, -14).getTime(), ctx.now.getTime())),
    },
    {
      title: 'Pembayaran SPP melalui Virtual Account',
      content:
        'Pembayaran SPP, biaya asrama, dan biaya makan dapat dilakukan melalui virtual account atau transfer bank. Unggah bukti transfer di menu Tagihan & Pembayaran; TU akan memverifikasi dalam 1×24 jam kerja.',
      priority: 0,
      publishedAt: addDays(ctx.now, -20),
    },
    {
      title: `Pendaftaran SPMB ${nextAcademicYear(ctx.now).name} Gelombang 1 Dibuka`,
      content:
        "Pendaftaran santri baru untuk TK Qur'an, SD IT, SMP IT, dan SMA Qur'an telah dibuka. Informasi persyaratan dan formulir tersedia di situs cipansor.or.id.",
      priority: 1,
      publishedAt: windows[0].startDate,
    },
  ];
  for (const a of announcements) {
    const exists = await db.announcement.findFirst({ where: { title: a.title } });
    if (exists) continue;
    await db.announcement.create({
      data: {
        title: a.title,
        content: a.content,
        type: NotificationType.ANNOUNCEMENT,
        priority: a.priority,
        publishedAt: a.publishedAt,
        createdById: creator,
        createdAt: a.publishedAt,
      },
    });
    added++;
  }
  const stale = await db.announcement.findMany({ where: { content: { contains: String(y - 2) } } });
  for (const a of stale) {
    await db.announcement.update({
      where: { id: a.id },
      data: {
        content: a.content
          .split(String(y - 1))
          .join(String(y + 1))
          .split(String(y - 2))
          .join(String(y)),
      },
    });
  }
  console.log(
    `   ✅ Kalender & pengumuman: ${added}; ${stale.length} pengumuman lama disesuaikan ke ${ctx.ay.name}`
  );
}
