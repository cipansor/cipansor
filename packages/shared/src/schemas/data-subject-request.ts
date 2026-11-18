import { z } from "zod";

/**
 * Alur hak subjek data (UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi).
 *
 * Pasal 30 memberi subjek data hak akses dan koreksi, Pasal 40 hak menarik
 * persetujuan, Pasal 43 hak penghapusan, dan Pasal 32 menuntut akses atas
 * salinan data dalam 3×24 jam. Sebelum alur ini ada, yayasan hanya mengumumkan
 * hak itu di teks Kebijakan Privasi dan menunjuk kontak panitia SPMB secara
 * manual: tidak ada tenggat, tidak ada catatan, tidak ada cara tahu permintaan
 * mana yang hampir lewat.
 *
 * Kontrak ini hidup sekali, di sini. Peladen memvalidasi dengannya di tepi dan
 * web membangun formulirnya dari tipe yang sama, sehingga kedua sisi tidak
 * dapat melenceng (AGENTS.md, "Contracts live once").
 */

// ==================== KOSAKATA ====================

/**
 * Keempat hak yang dapat dipakai, dengan pasal yang memberikannya.
 *
 * Nilainya sama persis dengan enum `DataSubjectRequestType` di `schema.prisma`
 * — peladen memetakannya, dan ketidakcocokan adalah galat tipe, bukan galat
 * yang diam.
 */
export const DATA_SUBJECT_REQUEST_TYPES = [
  "ACCESS",
  "RECTIFICATION",
  "CONSENT_WITHDRAWAL",
  "ERASURE",
] as const;
export type DataSubjectRequestType =
  (typeof DATA_SUBJECT_REQUEST_TYPES)[number];

/** Label yang dibaca manusia. Setiap label yang dibaca orang ditulis Indonesia. */
export const DATA_SUBJECT_REQUEST_TYPE_LABELS: Record<
  DataSubjectRequestType,
  string
> = {
  ACCESS: "Akses dan salinan data",
  RECTIFICATION: "Perbaikan data",
  CONSENT_WITHDRAWAL: "Penarikan persetujuan",
  ERASURE: "Penghapusan data",
};

/**
 * Perjalanan satu permintaan. `REJECTED` adalah jalan keluar yang sah menurut
 * Pasal 33 — permintaan yang membahayakan keselamatan orang lain, melanggar hak
 * pihak lain, atau yang identitas pemohonnya tidak dapat dipastikan — bukan
 * kegagalan alur.
 */
export const DATA_SUBJECT_REQUEST_STATUSES = [
  "RECEIVED",
  "VERIFIED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
] as const;
export type DataSubjectRequestStatus =
  (typeof DATA_SUBJECT_REQUEST_STATUSES)[number];

export const DATA_SUBJECT_REQUEST_STATUS_LABELS: Record<
  DataSubjectRequestStatus,
  string
> = {
  RECEIVED: "Diterima",
  VERIFIED: "Terverifikasi",
  PROCESSING: "Diproses",
  COMPLETED: "Selesai",
  REJECTED: "Ditolak",
};

/** Jenis subjek, menentukan kolom mana yang menunjuk siapa yang dimintakan. */
export const DATA_SUBJECT_CATEGORIES = [
  "STUDENT",
  "REGISTRANT",
  "GUARDIAN",
] as const;
export type DataSubjectCategory = (typeof DATA_SUBJECT_CATEGORIES)[number];

// ==================== TENGGAT ====================

/**
 * Tenggat 3×24 jam untuk akses, koreksi, dan penarikan persetujuan.
 *
 * Angkanya datang dari UU, bukan dari selera: Pasal 32 ayat (2) untuk akses,
 * Pasal 30 ayat (1) untuk perbaikan, Pasal 40 ayat (2) untuk penghentian
 * pemrosesan setelah persetujuan ditarik. Ketiganya disebut "3×24 jam", jadi
 * yang dihitung adalah 72 jam, bukan tiga hari kerja — perbedaan itu berarti
 * ketika permintaan masuk hari Jumat.
 */
export const DATA_SUBJECT_REQUEST_DUE_HOURS = 72;

/**
 * Penghapusan mengikuti jadwal retensi (Pasal 43–44), bukan 3×24 jam.
 *
 * Yang dihapus adalah data yang tidak wajib disimpan; arsip akademik santri dan
 * alumni (buku induk, rapor, ijazah, Dapodik/EMIS) dipertahankan selama masa
 * retensinya. Karena itu tenggatnya adalah tanggal tinjauan retensi, bukan
 * hitungan jam — dan angkanya hidup di satu tempat, di bawah ini, supaya
 * tenggat tidak dikarang ulang di setiap pemanggil.
 */
export const DATA_SUBJECT_REQUEST_ERASURE_DEFAULT_DAYS = 30;

/**
 * Berapa lama kode verifikasi berlaku dan berapa kali boleh dicoba.
 *
 * Kode dikirim ke kontak yang SUDAH terdaftar pada data subjek; tanpa batas
 * percobaan, enam angka dapat ditebak dengan mencoba terus, dan verifikasi yang
 * dapat ditebak sama saja dengan tidak ada verifikasi — justru ia yang membuka
 * data orang lain.
 */
export const DATA_SUBJECT_VERIFICATION_TTL_MINUTES = 15;
export const DATA_SUBJECT_VERIFICATION_MAX_ATTEMPTS = 5;

// ==================== MASUKAN ====================

/** Panjang kode verifikasi — enam angka, seperti OTP yang sudah dikenal orang. */
export const DATA_SUBJECT_VERIFICATION_CODE_LENGTH = 6;

const contact = z
  .string()
  .trim()
  .min(5, "Kontak (email atau nomor telepon) wajib diisi")
  .max(255);

const detail = z
  .string()
  .trim()
  .min(10, "Jelaskan permintaan Anda sedikit lebih lengkap")
  .max(5000);

/**
 * Permintaan yang diajukan wali yang sudah punya akun, untuk dirinya atau
 * santri tanggungannya.
 *
 * `subjectStudentId` boleh kosong bila wali meminta datanya SENDIRI
 * (`subjectCategory = GUARDIAN`); layanan yang memutuskan mana yang wajib
 * menurut kategorinya, dan memeriksa bahwa santri itu benar-benar tanggungan
 * pemohon — bukan sekadar santri mana pun yang id-nya diketahui.
 */
export const createGuardianDataSubjectRequestSchema = z.object({
  type: z.enum(DATA_SUBJECT_REQUEST_TYPES),
  subjectCategory: z.enum(DATA_SUBJECT_CATEGORIES),
  subjectStudentId: z.string().uuid("Santri tidak valid").optional(),
  detail,
  /** Hubungan pemohon dengan subjek, mis. "Ayah" / "Ibu" / "Wali". */
  requesterRelation: z.string().trim().max(50).optional(),
});

export type CreateGuardianDataSubjectRequestInput = z.infer<
  typeof createGuardianDataSubjectRequestSchema
>;

/**
 * Permintaan dari pendaftar SPMB yang belum punya akun, lewat formulir publik.
 *
 * Permintaannya TIDAK mengungkap data apa pun sampai identitasnya diverifikasi
 * (Pasal 33): peladen mengirim kode ke kontak yang sudah terdaftar pada baris
 * pendaftar, dan baru setelah kode itu benar data boleh ditampilkan. Tanpa itu,
 * memberi akses hanya dengan nomor pendaftaran berarti membuka data anak orang
 * lain kepada siapa pun yang pernah melihat nomornya.
 */
export const createPublicDataSubjectRequestSchema = z.object({
  type: z.enum(DATA_SUBJECT_REQUEST_TYPES),
  /** Nomor pendaftaran SPMB — identitas pertama yang harus diketahui pemohon. */
  registrationNo: z
    .string()
    .trim()
    .min(3, "Nomor pendaftaran wajib diisi")
    .max(50),
  /** Tanggal lahir pendaftar, faktor kedua yang hanya diketahui keluarganya. */
  birthDate: z.coerce.date({ error: "Tanggal lahir pendaftar wajib diisi" }),
  requesterName: z.string().trim().min(3, "Nama pemohon wajib diisi").max(150),
  requesterContact: contact,
  requesterRelation: z.string().trim().max(50).optional(),
  detail,
});

export type CreatePublicDataSubjectRequestInput = z.infer<
  typeof createPublicDataSubjectRequestSchema
>;

/** Memverifikasi permintaan publik dengan kode yang dikirim ke kontak terdaftar. */
export const verifyPublicDataSubjectRequestSchema = z.object({
  requestNo: z.string().trim().min(3, "Nomor permintaan wajib diisi").max(50),
  code: z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{${DATA_SUBJECT_VERIFICATION_CODE_LENGTH}}$`),
      `Kode verifikasi adalah ${DATA_SUBJECT_VERIFICATION_CODE_LENGTH} angka`,
    ),
});

export type VerifyPublicDataSubjectRequestInput = z.infer<
  typeof verifyPublicDataSubjectRequestSchema
>;

/**
 * Perpindahan status oleh petugas pelindungan data pribadi.
 *
 * `note` wajib pada `REJECTED` (Pasal 33 menuntut alasan penolakan ada) dan
 * pada `COMPLETED` ia menjadi ringkasan tindakan yang diambil — mis. apa saja
 * yang dihapus, dan apa yang dipertahankan karena retensi.
 */
export const updateDataSubjectRequestStatusSchema = z
  .object({
    status: z.enum(DATA_SUBJECT_REQUEST_STATUSES),
    note: z.string().trim().max(2000).optional(),
    /** Petugas yang menangani; kosong = tetap pada petugas sekarang. */
    handledById: z.string().uuid("Petugas tidak valid").optional(),
  })
  .refine((v) => v.status !== "REJECTED" || (v.note?.trim().length ?? 0) > 0, {
    error: "Alasan penolakan wajib diisi",
    path: ["note"],
  });

export type UpdateDataSubjectRequestStatusInput = z.infer<
  typeof updateDataSubjectRequestStatusSchema
>;

/** Daftar untuk petugas: penyaring status, jenis, dan tenggat. */
export const listDataSubjectRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(DATA_SUBJECT_REQUEST_STATUSES).optional(),
  type: z.enum(DATA_SUBJECT_REQUEST_TYPES).optional(),
  subjectCategory: z.enum(DATA_SUBJECT_CATEGORIES).optional(),
  /** Hanya yang tenggatnya sudah lewat. */
  overdueOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  /** Hanya yang belum selesai (belum `COMPLETED`/`REJECTED`). */
  openOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type ListDataSubjectRequestsQuery = z.infer<
  typeof listDataSubjectRequestsQuerySchema
>;

/** Satu tindakan pada riwayat permintaan. */
export interface DataSubjectRequestAction {
  at: string;
  byId?: string | null;
  byName: string;
  from: DataSubjectRequestStatus | null;
  to: DataSubjectRequestStatus;
  note?: string;
}

/**
 * Satu permintaan sebagaimana dibaca petugas.
 *
 * Tidak memuat `verificationCodeHash` dan tidak akan pernah: itu rahasia, dan
 * DTO yang dibaca layar petugas tidak punya alasan membawanya. Yang dibawa
 * hanyalah fakta bahwa verifikasi sudah terjadi (`verifiedAt`).
 */
export interface DataSubjectRequestDTO {
  id: string;
  requestNo: string;
  type: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  subjectCategory: DataSubjectCategory;
  subjectLabel: string;
  requesterName: string;
  requesterContact: string;
  requesterRelation?: string | null;
  detail: string;
  rejectionReason?: string | null;
  dueAt: string;
  completedAt?: string | null;
  verifiedAt?: string | null;
  /** Sudah lewat tenggat dan belum selesai. Dihitung peladen, bukan layar. */
  overdue: boolean;
  handledBy?: { id: string; name: string } | null;
  actions: DataSubjectRequestAction[];
  createdAt: string;
  updatedAt: string;
}

/** Ringkasan untuk daftar petugas — tanpa `detail` dan tanpa riwayat penuh. */
export interface DataSubjectRequestSummaryDTO {
  id: string;
  requestNo: string;
  type: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  subjectCategory: DataSubjectCategory;
  subjectLabel: string;
  requesterName: string;
  /**
   * Alasan penolakan, bila permintaan ditolak (Pasal 33).
   *
   * Ikut pada ringkasan karena pemohon membacanya dari daftar miliknya sendiri:
   * rincian lengkap hanya terbuka bagi petugas, jadi tanpa kolom ini pemohon
   * yang ditolak tidak pernah tahu apa yang perlu dilengkapinya.
   */
  rejectionReason?: string | null;
  dueAt: string;
  completedAt?: string | null;
  overdue: boolean;
  handledBy?: { id: string; name: string } | null;
  createdAt: string;
}

/**
 * Hasil pengajuan publik: nomor permintaan dan tenggat, TANPA data subjek.
 *
 * Sengaja begitu. Permintaan publik yang baru masuk belum terverifikasi, jadi
 * jawabannya tidak boleh memberi tahu pemohon apa pun tentang data yang
 * dimintakan — cukup nomor untuk menanyakan kabar.
 */
export interface PublicDataSubjectRequestCreatedDTO {
  requestNo: string;
  dueAt: string;
  /** Ke kontak mana kode verifikasi dikirim, disamarkan (mis. `••••0078`). */
  verificationSentTo: string;
}

/**
 * Hasil verifikasi permintaan publik: apakah kode benar.
 *
 * Ia tidak mengembalikan data subjek. Membaca data menuntut pemohon menunggu
 * petugas menghubunginya setelah permintaan berstatus `VERIFIED`, sebab
 * pengungkapan data kepada pihak yang baru saja memasukkan kode lewat formulir
 * anonim adalah risiko yang tidak sebanding dengan kenyamanannya.
 */
export interface PublicDataSubjectRequestVerifiedDTO {
  requestNo: string;
  status: DataSubjectRequestStatus;
  dueAt: string;
}
