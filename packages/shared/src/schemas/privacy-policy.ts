import { z } from "zod";

/**
 * Kebijakan Privasi publik yang berversi (UU PDP 27/2022 Pasal 30, 35).
 *
 * Teksnya disimpan di basis data, bukan di kode: isinya — identitas pengendali
 * data, kontaknya, masa simpan pendaftar yang tidak diterima — diputuskan
 * yayasan dan belum ada saat kode ini ditulis (decisions/persetujuan-pengguna.md).
 * Satu halaman yang sama dipakai SPMB, layar /persetujuan portal kelak, dan WBS.
 *
 * BERVERSI, dan versi lama tidak pernah disunting: persetujuan hanya menaungi
 * teks yang benar-benar dibaca pendaftar, dan `Registrant.consentVersion`
 * menunjuk nomor versi ini. Super Admin membuat versi baru, bukan mengubah yang
 * lama.
 *
 * Ketiga bahasa wajib (id/en/ar): halaman publik menampilkan bahasa pembaca,
 * dan satu versi tanpa terjemahan berarti versi itu tidak dapat dibaca
 * sebagian pengunjung (`config/i18n-coverage.test.ts` menjaga aturan yang sama
 * di sisi web).
 */

/** Kolom teks satu bahasa. Bentuknya dipakai tiga kali, sekali per bahasa. */
export const privacyPolicyTextFields = {
  body: z
    .string()
    .trim()
    .min(20, "Isi kebijakan privasi terlalu pendek")
    .max(20000, "Isi kebijakan privasi terlalu panjang"),
  summary: z
    .string()
    .trim()
    .min(10, "Ringkasan kebijakan privasi terlalu pendek")
    .max(500, "Ringkasan kebijakan privasi maksimal 500 karakter"),
};

export const privacyPolicyBodies = z.object({
  id: privacyPolicyTextFields.body,
  en: privacyPolicyTextFields.body,
  ar: privacyPolicyTextFields.body,
});

export const privacyPolicySummaries = z.object({
  id: privacyPolicyTextFields.summary,
  en: privacyPolicyTextFields.summary,
  ar: privacyPolicyTextFields.summary,
});

/**
 * POST /privacy-policy/versions — Super Admin menerbitkan versi baru.
 *
 * `version` tidak dikirim pemanggil: peladen menghitungnya (`max(version) + 1`)
 * supaya dua penerbitan tidak pernah bertabrakan pada nomor yang sama. Nomor
 * yang diketik manusia adalah nomor yang akan salah.
 */
export const createPrivacyPolicyVersionSchema = z.object({
  bodies: privacyPolicyBodies,
  summaries: privacyPolicySummaries,
  effectiveAt: z.coerce.date({
    error: "Tanggal berlaku diperlukan",
  }),
});

export type CreatePrivacyPolicyVersionInput = z.infer<
  typeof createPrivacyPolicyVersionSchema
>;

/** GET /privacy-policy/versions — daftar versi untuk layar admin. */
export const listPrivacyPolicyVersionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPrivacyPolicyVersionsQuery = z.infer<
  typeof listPrivacyPolicyVersionsQuerySchema
>;

/** Teks lengkap satu bahasa, sebagaimana dibaca pengunjung halaman publik. */
export interface PrivacyPolicyTextDTO {
  body: string;
  summary: string;
}

/**
 * Versi yang berlaku, untuk halaman publik dan endpoint `current`.
 *
 * `version` adalah nomor yang disimpan di `Registrant.consentVersion`; formulir
 * SPMB mengirimkannya kembali agar persetujuan terikat ke teks yang dibaca.
 */
export interface PrivacyPolicyCurrentDTO {
  version: number;
  effectiveAt: string;
  /** Teks per bahasa, kunci = kode locale situs publik ("id" | "en" | "ar"). */
  texts: Record<"id" | "en" | "ar", PrivacyPolicyTextDTO>;
}

/** Satu baris daftar versi (layar admin) — tanpa isi penuh ketiga bahasa. */
export interface PrivacyPolicyVersionSummaryDTO {
  id: string;
  version: number;
  effectiveAt: string;
  createdAt: string;
  /** Ringkasan bahasa Indonesia, untuk daftar dan pencarian cepat. */
  summary: string;
  createdBy?: { id: string; name: string } | null;
}
