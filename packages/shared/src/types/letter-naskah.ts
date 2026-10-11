import {
  LetterNature,
  LetterStatus,
  LetterType,
  LetterUrgency,
} from "./correspondence";

/**
 * Jenis naskah dan sifat yang boleh menyertainya.
 *
 * Sumber kebenaran tunggal, dipakai dua sisi: server menegakkannya
 * (apps/api/src/utils/letter-naskah.ts membungkusnya dengan pelemparan galat),
 * dan formulir web membaca daftar yang sama agar pilihan yang ditawarkan sama
 * persis dengan pilihan yang diterima. Bila keduanya menyimpan salinannya
 * sendiri, cepat atau lambat mereka berselisih — dan formulir yang menawarkan
 * pilihan yang ditolak server adalah bug yang persis ingin dihindari.
 *
 * Dua sumbu yang berbeda: "jenis" (surat dinas, surat keputusan, surat tugas)
 * dan "sifat" atau derajat kerahasiaan (biasa, terbatas, rahasia, sangat
 * rahasia).
 * Surat keputusan adalah produk hukum yang justru harus dapat dibaca oleh yang
 * terkena keputusannya, jadi jenis penetapan hanya menerima Biasa atau
 * Terbatas — menandainya Rahasia adalah keliru kategori, bukan pilihan sah.
 */
const NATURES_BY_TYPE: Record<LetterType, readonly LetterNature[]> = {
  [LetterType.SURAT_DINAS]: [
    LetterNature.PUBLIC,
    LetterNature.LIMITED,
    LetterNature.CONFIDENTIAL,
    LetterNature.STRICTLY_CONFIDENTIAL,
  ],
  [LetterType.NOTA_DINAS]: [
    LetterNature.PUBLIC,
    LetterNature.LIMITED,
    LetterNature.CONFIDENTIAL,
    LetterNature.STRICTLY_CONFIDENTIAL,
  ],
  [LetterType.SURAT_KEPUTUSAN]: [LetterNature.PUBLIC, LetterNature.LIMITED],
  [LetterType.SURAT_TUGAS]: [LetterNature.PUBLIC, LetterNature.LIMITED],
  [LetterType.BERITA_ACARA]: [LetterNature.PUBLIC, LetterNature.LIMITED],
  [LetterType.SURAT_KETERANGAN]: [LetterNature.PUBLIC, LetterNature.LIMITED],
  [LetterType.SURAT_UNDANGAN]: [LetterNature.PUBLIC, LetterNature.LIMITED],
  [LetterType.SURAT_EDARAN]: [LetterNature.PUBLIC],
  [LetterType.PENGUMUMAN]: [LetterNature.PUBLIC],
};

export const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  [LetterType.SURAT_DINAS]: "Surat Dinas (Korespondensi)",
  [LetterType.NOTA_DINAS]: "Nota Dinas (Internal)",
  [LetterType.SURAT_KEPUTUSAN]: "Surat Keputusan (SK)",
  [LetterType.SURAT_TUGAS]: "Surat Tugas",
  [LetterType.SURAT_EDARAN]: "Surat Edaran",
  [LetterType.SURAT_UNDANGAN]: "Surat Undangan",
  [LetterType.SURAT_KETERANGAN]: "Surat Keterangan",
  [LetterType.BERITA_ACARA]: "Berita Acara",
  [LetterType.PENGUMUMAN]: "Pengumuman",
};

export const LETTER_NATURE_LABELS: Record<LetterNature, string> = {
  [LetterNature.PUBLIC]: "Biasa",
  [LetterNature.LIMITED]: "Terbatas",
  [LetterNature.CONFIDENTIAL]: "Rahasia",
  [LetterNature.STRICTLY_CONFIDENTIAL]: "Sangat Rahasia",
};

/**
 * Derajat kecepatan penyampaian — bukan derajat kerahasiaan.
 *
 * Sumber kebenaran tunggal, dan ia diperlukan. Istilah yang sama pernah ditulis
 * tiga cara berbeda di tiga halaman: formulir pembuatan surat memakai
 * Biasa/Segera/Amat Segera (benar, sesuai skema), beranda menyebut IMMEDIATE
 * sebagai "Penting" dan URGENT sebagai "Segera" (menggeser artinya satu tingkat
 * — sebuah surat "Segera" tampil sebagai "Penting", dan "Amat Segera" tampil
 * sebagai "Segera"), sedangkan daftar surat menampilkan enum mentahnya dalam
 * bahasa Inggris. Pada naskah dinas, derajat kecepatan menentukan tenggat
 * penyampaian; menggesernya satu tingkat bukan soal gaya bahasa.
 *
 * Tiga derajat (keputusan pengguna 2026-10-09,
 * `decisions/derajat-kecepatan-naskah.md`): Sangat Segera (24 jam), Segera
 * (2 × 24 jam), Biasa. "Sangat Segera" adalah derajat 24 jam yang dalam pedoman
 * disebut "Amat Segera/Kilat" — label berganti, artinya tidak.
 */
export const LETTER_URGENCY_LABELS: Record<LetterUrgency, string> = {
  [LetterUrgency.URGENT]: "Sangat Segera",
  [LetterUrgency.IMMEDIATE]: "Segera",
  [LetterUrgency.NORMAL]: "Biasa",
};

export function naturesForType(type: LetterType): readonly LetterNature[] {
  return NATURES_BY_TYPE[type] ?? NATURES_BY_TYPE[LetterType.SURAT_DINAS];
}

export function isNatureAllowedForType(
  type: LetterType,
  nature: LetterNature,
): boolean {
  return naturesForType(type).includes(nature);
}

/**
 * Label status naskah, satu sumber untuk kedua sisi.
 *
 * Sebelumnya peta ini hidup di dalam `letter-list.tsx`, sehingga API yang
 * mengekspor buku agenda tidak punya cara menerjemahkan `PENDING_REVIEW` ke
 * bahasa yang dibaca petugas arsip — dan ekspor yang berisi enum mentah
 * berbahasa Inggris bukan buku agenda yang dapat diserahkan.
 */
export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = {
  [LetterStatus.DRAFT]: "Konsep",
  [LetterStatus.PENDING_REVIEW]: "Menunggu review",
  [LetterStatus.REVISION_NEEDED]: "Perlu revisi",
  [LetterStatus.READY_TO_SIGN]: "Siap tanda tangan",
  [LetterStatus.SIGNED]: "Sudah ditandatangani",
  [LetterStatus.SENT]: "Terkirim",
  [LetterStatus.ARCHIVED]: "Diarsipkan",
  [LetterStatus.DISPOSED]: "Didisposisikan",
};
