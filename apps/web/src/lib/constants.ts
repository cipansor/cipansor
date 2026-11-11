import { STUDENT_STATUS } from "@cipansor/shared";

/**
 * Application constants
 * Centralized constants for consistency throughout the application
 */

// `API_BASE_URL` and `API_ENDPOINTS` used to live here: a second, unused copy
// of the API's shape. Every caller goes through the axios instance in
// lib/api.ts, which owns the base URL, and web-api-contract.guard.test.ts keeps
// the web's paths honest. A duplicate only drifts, and this one had: the
// endpoint list still pointed the connectivity probe at `/api/health`.

// ============================================
// Pagination
// ============================================

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const MAX_PAGE_SIZE = 100;

// ============================================
// Date & Time
// ============================================

export const DATE_FORMAT = "DD/MM/YYYY";
export const DATE_TIME_FORMAT = "DD/MM/YYYY HH:mm";
export const TIME_FORMAT = "HH:mm";
export const DATE_INPUT_FORMAT = "YYYY-MM-DD";

export const DAYS_OF_WEEK = [
  { value: 0, label: "Minggu", short: "Min" },
  { value: 1, label: "Senin", short: "Sen" },
  { value: 2, label: "Selasa", short: "Sel" },
  { value: 3, label: "Rabu", short: "Rab" },
  { value: 4, label: "Kamis", short: "Kam" },
  { value: 5, label: "Jumat", short: "Jum" },
  { value: 6, label: "Sabtu", short: "Sab" },
] as const;

export const MONTHS = [
  { value: 1, label: "Januari", short: "Jan" },
  { value: 2, label: "Februari", short: "Feb" },
  { value: 3, label: "Maret", short: "Mar" },
  { value: 4, label: "April", short: "Apr" },
  { value: 5, label: "Mei", short: "Mei" },
  { value: 6, label: "Juni", short: "Jun" },
  { value: 7, label: "Juli", short: "Jul" },
  { value: 8, label: "Agustus", short: "Agu" },
  { value: 9, label: "September", short: "Sep" },
  { value: 10, label: "Oktober", short: "Okt" },
  { value: 11, label: "November", short: "Nov" },
  { value: 12, label: "Desember", short: "Des" },
] as const;

// ============================================
// Status Options
// ============================================

/**
 * Label dan warna status santri. Nilainya diturunkan dari STUDENT_STATUS di
 * @cipansor/shared — kosakata yang sama dengan kolom `students.status` dan CHECK
 * `students_status_check`.
 *
 * Sampai 2026-09-13 di sini ada daftar bernama `STUDENT_STATUS` dengan nilai
 * "ACTIVE"/"INACTIVE"/"GRADUATED"/"DROPPED_OUT" — tak satu pun ada di kolomnya,
 * dan daftar itu tidak dipakai siapa pun. Namanya sama persis dengan konstanta
 * kosakata di shared, jadi ia hanya menunggu salah-impor. Diganti nama supaya
 * keduanya tidak bisa tertukar.
 */
export const STUDENT_STATUS_OPTIONS = [
  {
    value: STUDENT_STATUS.ACTIVE,
    label: "Aktif",
    badge: "bg-green-100 text-green-800",
  },
  {
    value: STUDENT_STATUS.ALUMNI,
    label: "Alumni",
    badge: "bg-blue-100 text-blue-800",
  },
  {
    value: STUDENT_STATUS.TRANSFERRED,
    label: "Pindah",
    badge: "bg-yellow-100 text-yellow-800",
  },
  {
    value: STUDENT_STATUS.DROPPED,
    label: "Keluar",
    badge: "bg-red-100 text-red-800",
  },
] as const;

export function studentStatusOption(value: string | null | undefined) {
  return STUDENT_STATUS_OPTIONS.find((o) => o.value === value);
}

export const EMPLOYEE_STATUS = [
  { value: "ACTIVE", label: "Aktif", color: "green" },
  { value: "INACTIVE", label: "Tidak Aktif", color: "gray" },
  { value: "RESIGNED", label: "Resign", color: "yellow" },
  { value: "RETIRED", label: "Pensiun", color: "blue" },
] as const;

export const ATTENDANCE_STATUS = [
  { value: "PRESENT", label: "Hadir", color: "green" },
  { value: "ABSENT", label: "Tidak Hadir", color: "red" },
  { value: "LATE", label: "Terlambat", color: "yellow" },
  { value: "SICK", label: "Sakit", color: "blue" },
  { value: "PERMISSION", label: "Izin", color: "purple" },
  { value: "EXCUSED", label: "Dispensasi", color: "cyan" },
] as const;

export const PERMIT_STATUS = [
  { value: "PENDING", label: "Menunggu", color: "yellow" },
  { value: "APPROVED", label: "Disetujui", color: "green" },
  { value: "REJECTED", label: "Ditolak", color: "red" },
  { value: "EXPIRED", label: "Kadaluarsa", color: "gray" },
] as const;

export const PAYMENT_STATUS = [
  { value: "PENDING", label: "Menunggu", color: "yellow" },
  { value: "PARTIAL", label: "Sebagian", color: "blue" },
  { value: "PAID", label: "Lunas", color: "green" },
  { value: "OVERDUE", label: "Jatuh Tempo", color: "red" },
  { value: "CANCELLED", label: "Dibatalkan", color: "gray" },
] as const;

export const PSB_STATUS = [
  { value: "DRAFT", label: "Draft", color: "gray" },
  { value: "SUBMITTED", label: "Terkirim", color: "blue" },
  { value: "REVIEWING", label: "Ditinjau", color: "yellow" },
  { value: "INTERVIEW", label: "Wawancara", color: "purple" },
  { value: "ACCEPTED", label: "Diterima", color: "green" },
  { value: "REJECTED", label: "Ditolak", color: "red" },
  { value: "ENROLLED", label: "Terdaftar", color: "cyan" },
] as const;

// ============================================
// Gender Options
// ============================================

export const GENDER_OPTIONS = [
  { value: "MALE", label: "Laki-laki" },
  { value: "FEMALE", label: "Perempuan" },
] as const;

// ============================================
// Education Levels
// ============================================

export const EDUCATION_LEVELS = [
  { value: "RA", label: "Raudhatul Athfal (RA)" },
  { value: "MI", label: "Madrasah Ibtidaiyah (MI)" },
  { value: "MTs", label: "Madrasah Tsanawiyah (MTs)" },
  { value: "MA", label: "Madrasah Aliyah (MA)" },
  { value: "SMK", label: "Sekolah Menengah Kejuruan (SMK)" },
] as const;

export const GRADE_LEVELS = [
  { value: "1", label: "Kelas 1" },
  { value: "2", label: "Kelas 2" },
  { value: "3", label: "Kelas 3" },
  { value: "4", label: "Kelas 4" },
  { value: "5", label: "Kelas 5" },
  { value: "6", label: "Kelas 6" },
  { value: "7", label: "Kelas 7" },
  { value: "8", label: "Kelas 8" },
  { value: "9", label: "Kelas 9" },
  { value: "10", label: "Kelas 10" },
  { value: "11", label: "Kelas 11" },
  { value: "12", label: "Kelas 12" },
] as const;

// ============================================
// Role Options
// ============================================

export const USER_ROLES = [
  {
    value: "SUPER_ADMIN",
    label: "Super Admin",
    description: "Akses penuh ke semua fitur",
  },
  { value: "ADMIN", label: "Admin", description: "Mengelola data unit" },
  {
    value: "TEACHER",
    label: "Guru/Ustadz",
    description: "Mengelola kelas dan nilai",
  },
  {
    value: "STAFF",
    label: "Staff",
    description: "Akses terbatas sesuai tugas",
  },
  { value: "PARENT", label: "Wali Santri", description: "Melihat data anak" },
  { value: "STUDENT", label: "Santri", description: "Melihat data pribadi" },
] as const;

// ============================================
// Religion Options (for Indonesian context)
// ============================================

export const RELIGION_OPTIONS = [
  { value: "ISLAM", label: "Islam" },
  { value: "KRISTEN", label: "Kristen" },
  { value: "KATOLIK", label: "Katolik" },
  { value: "HINDU", label: "Hindu" },
  { value: "BUDDHA", label: "Buddha" },
  { value: "KONGHUCU", label: "Konghucu" },
] as const;

// ============================================
// Blood Types
// ============================================

export const BLOOD_TYPES = [
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "AB", label: "AB" },
  { value: "O", label: "O" },
] as const;

// ============================================
// Relationship (Guardian)
// ============================================

export const GUARDIAN_RELATIONSHIPS = [
  { value: "FATHER", label: "Ayah" },
  { value: "MOTHER", label: "Ibu" },
  { value: "GRANDFATHER", label: "Kakek" },
  { value: "GRANDMOTHER", label: "Nenek" },
  { value: "UNCLE", label: "Paman" },
  { value: "AUNT", label: "Bibi" },
  { value: "SIBLING", label: "Saudara" },
  { value: "OTHER", label: "Lainnya" },
] as const;

// ============================================
// File Upload
// ============================================

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// ============================================
// UI Constants
// ============================================

export const TOAST_DURATION = 5000;
export const DEBOUNCE_DELAY = 300;
export const ANIMATION_DURATION = 200;

export const COLORS = {
  primary: "#16a34a",
  secondary: "#64748b",
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#3b82f6",
} as const;

// ============================================
// Quran Constants (for Tahfidz)
// ============================================

export const QURAN_JUZ_COUNT = 30;
export const QURAN_SURAH_COUNT = 114;

export const QURAN_JUZ = Array.from({ length: 30 }, (_, i) => ({
  value: i + 1,
  label: `Juz ${i + 1}`,
}));

// Simplified surah list (first 10 and common ones)
export const COMMON_SURAHS = [
  { value: 1, label: "Al-Fatihah", ayat: 7 },
  { value: 2, label: "Al-Baqarah", ayat: 286 },
  { value: 3, label: "Ali Imran", ayat: 200 },
  { value: 36, label: "Yasin", ayat: 83 },
  { value: 67, label: "Al-Mulk", ayat: 30 },
  { value: 78, label: "An-Naba", ayat: 40 },
  { value: 112, label: "Al-Ikhlas", ayat: 4 },
  { value: 113, label: "Al-Falaq", ayat: 5 },
  { value: 114, label: "An-Nas", ayat: 6 },
] as const;

export const TAHFIDZ_GRADES = [
  { value: "A", label: "Mumtaz (A)", min: 90, max: 100 },
  { value: "B", label: "Jayyid Jiddan (B)", min: 80, max: 89 },
  { value: "C", label: "Jayyid (C)", min: 70, max: 79 },
  { value: "D", label: "Maqbul (D)", min: 60, max: 69 },
  { value: "E", label: "Rasib (E)", min: 0, max: 59 },
] as const;
