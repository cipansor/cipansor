-- Dasar pemrosesan (persetujuan wali) dan Kebijakan Privasi publik (#786).
--
-- UU 27/2022 (PDP) Pasal 20 menuntut dasar pemrosesan yang sah — antara lain
-- persetujuan — dan Pasal 25 menuntut persetujuan orang tua/wali untuk data
-- anak. Formulir SPMB publik mengumpulkan NIK, KK, akta, dan foto anak dari
-- keluarga sungguhan, dan sampai kini tidak ada satu pun dasar itu yang
-- terekam. Pasal 30 dan 35 menuntut pula pemberitahuan privasi yang dapat
-- dibaca subjek data.
--
-- `registrants`: tiga kolom persetujuan. Persetujuan disimpan sebagai WAKTU,
-- bukan boolean (preseden `chatbot_escalations.consent_at`), plus versi teks
-- yang dibaca dan alamat IP asalnya. Semua nullable, jadi baris lama tetap
-- sah — pendaftar lama dan pendaftar yang dibuat admin unit tidak punya
-- persetujuan digital.
--
-- `privacy_policy_versions`: teks kebijakan yang BERVERSI. Versi lama tidak
-- pernah disunting; `registrants.consent_version` menunjuk nomornya. Isinya
-- (identitas pengendali, masa simpan) diisi yayasan lewat versi baru, bukan
-- ditulis di kode.
--
-- Tanpa ekstensi: hanya tipe bawaan PostgreSQL.

ALTER TABLE "registrants" ADD COLUMN "consent_at" TIMESTAMP(3);
ALTER TABLE "registrants" ADD COLUMN "consent_version" TEXT;
ALTER TABLE "registrants" ADD COLUMN "consent_ip" TEXT;

CREATE TABLE "privacy_policy_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body_id" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "body_ar" TEXT NOT NULL,
    "summary_id" TEXT NOT NULL,
    "summary_en" TEXT NOT NULL,
    "summary_ar" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_policy_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "privacy_policy_versions"
    ADD CONSTRAINT "privacy_policy_versions_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "privacy_policy_versions_version_key"
    ON "privacy_policy_versions"("version");
CREATE INDEX "privacy_policy_versions_effective_at_idx"
    ON "privacy_policy_versions"("effective_at");
