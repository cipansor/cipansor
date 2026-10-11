import { z } from 'zod';
import { SigningKeyRevocationCode, SigningAuthorityForm } from '@prisma/client';
import { MIN_PASSPHRASE_LENGTH } from '@/utils/esign';
import { MAX_VALIDITY_DAYS, MIN_VALIDITY_DAYS } from '@/utils/esign-lifecycle';
import {
  MAX_REVOCATION_REASON_LENGTH,
  MIN_REVOCATION_REASON_LENGTH,
} from '@/utils/esign-revocation';

const passphrase = z.string().min(MIN_PASSPHRASE_LENGTH);

/**
 * Sidik jari kunci untuk layanan status publik.
 *
 * Diterima dalam bentuk apa pun yang wajar (huruf besar/kecil, dengan atau
 * tanpa titik dua) dan dinormalkan di layanan. Panjangnya dibatasi agar
 * masukan asal-asalan tidak masuk ke pencarian basis data; batas atas yang
 * longgar cukup, karena bentuk kanonik satu kunci selalu 95 karakter.
 */
export const keyStatusQuerySchema = z.object({
  fingerprint: z.string().min(1).max(200),
});

export const requestKeySchema = z.object({
  reason: z.string().max(1000).optional(),
});

export const activateKeySchema = z.object({
  passphrase,
});

/**
 * Ganti passphrase menuntut dua bukti berbeda: passphrase lama (pemilik kunci)
 * dan password akun (bukan sesi yang tertinggal terbuka).
 */
export const changePassphraseSchema = z.object({
  currentPassphrase: z.string().min(1),
  accountPassword: z.string().min(1),
  newPassphrase: passphrase,
});

export const decideRequestSchema = z.object({
  approve: z.boolean(),
  grantedDays: z.number().int().min(MIN_VALIDITY_DAYS).max(MAX_VALIDITY_DAYS).optional(),
  note: z.string().max(1000).optional(),
  /**
   * Pernyataan bahwa foto KTP pemohon sudah dibuka dan datanya cocok.
   *
   * Wajib bila identitasnya belum pernah diverifikasi — server yang
   * memeriksanya, bukan skema ini, sebab jawabannya bergantung pada keadaan
   * baris identitas dan bukan pada bentuk permintaan. Tidak ada lagi pilihan
   * *cara*: satu-satunya cara adalah foto KTP yang diunggah lewat sistem ini,
   * karena pilihan yang tidak meninggalkan bukti mengubah verifikasi menjadi
   * sekadar klik.
   */
  identityVerification: z
    .object({
      note: z.string().max(1000).optional(),
    })
    .optional(),
});

/**
 * Identitas yang menjadi dasar sebuah kunci.
 *
 * NIK diterima apa adanya lalu dinormalkan di layanan — orang menyalinnya dari
 * KTP berikut titik dan spasinya, dan menolak karena itu adalah menolak isian
 * yang sebenarnya benar.
 */
export const saveIdentitySchema = z.object({
  legalName: z.string().trim().min(3).max(200),
  nik: z.string().trim().min(16).max(25),
  birthPlace: z.string().trim().min(2).max(100),
  birthDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Tanggal lahir tidak sah' })
    .refine((v) => Date.parse(v) < Date.now(), {
      message: 'Tanggal lahir tidak boleh di masa depan',
    }),
});

/**
 * Alasan pencabutan, dengan panjang minimum yang sama untuk kunci dan surat.
 *
 * Naik dari tiga karakter menjadi sepuluh. Alasan pencabutan surat tampil apa
 * adanya di halaman verifikasi publik, dan "sal" bukan keterangan; alasan
 * pencabutan kunci dibaca pemiliknya sebagai satu-satunya penjelasan mengapa
 * wewenangnya dicabut. Panjangnya tetap diperiksa ulang di
 * `utils/esign-revocation.ts` setelah dipangkas spasinya — sepuluh spasi lolos
 * dari `min()` di sini.
 */
const revocationReason = z
  .string()
  .min(MIN_REVOCATION_REASON_LENGTH)
  .max(MAX_REVOCATION_REASON_LENGTH);

/**
 * Sebab pencabutan kunci, mengikuti RFC 5280 §5.3.1.
 *
 * Bawaannya AFFILIATION_CHANGED — keadaan yang paling sering dan yang paling
 * tidak berbahaya. Yang menuntut perhatian adalah KEY_COMPROMISE, dan itu harus
 * dipilih dengan sengaja, bukan didapat karena lalai.
 */
export const revokeKeySchema = z.object({
  reason: revocationReason,
  code: z.nativeEnum(SigningKeyRevocationCode).optional(),
});

/**
 * Mencabut menuntut passphrase, sama seperti menandatangani.
 *
 * Pencabutan adalah pernyataan kriptografis, bukan pengubahan status: sebuah
 * CRL pun ditandatangani penerbitnya (RFC 5280). Passphrase yang diminta adalah
 * milik **pencabutnya**, bukan milik penandatangan — sehingga passphrase yang
 * bocor atau pejabat yang sudah tidak ada tidak menghalangi pencabutan.
 */
export const revokeSignatureSchema = z.object({
  reason: revocationReason,
  passphrase: z.string().min(1),
});

/** Permohonan pencabutan — tanpa passphrase: mengajukan bukan memutuskan. */
export const requestRevocationSchema = z.object({
  reason: revocationReason,
  attachmentUrl: z.string().max(2000).optional(),
});

export const decideRevocationSchema = z.object({
  approve: z.boolean(),
  note: z.string().max(1000).optional(),
  /** Wajib bila menyetujui: pencabutannya sendiri yang ditandatangani. */
  passphrase: z.string().min(1).optional(),
  /** Boleh menyunting alasan pemohon sebelum ia menjadi teks publik. */
  reason: revocationReason.optional(),
});

export const signLetterSchema = z.object({
  passphrase: z.string().min(1),
  /**
   * Garis kewenangan penandatanganan (a.n./u.b./Plt./Plh.).
   *
   * Opsional dan berdefault NONE, sehingga pemanggil lama (dan tanda tangan
   * yang sudah ada) tidak terpengaruh. Yang memeriksa konsistensinya adalah
   * layanan, bukan skema ini: aturan seperti "bentuk selain NONE menuntut
   * jabatan yang diwakili" bergantung pada nilai yang masuk, bukan pada
   * bentuk permintaannya.
   */
  signingAuthorityForm: z.nativeEnum(SigningAuthorityForm).optional(),
  /** Jabatan pejabat yang diwakili; wajib bila bentuknya bukan NONE. */
  representedOffice: z.string().trim().min(3).max(200).optional(),
});
