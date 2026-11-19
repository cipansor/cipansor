-- Alur hak subjek data (UU PDP 27/2022 Pasal 30, 32, 35, 40, 43–44), #1111.
--
-- Sebelum ini #786 merekam persetujuan dan menerbitkan pemberitahuan privasi,
-- tetapi tidak ada ALUR bagi orang tua/wali untuk memakai haknya. Teks
-- kebijakan hanya menunjuk kontak panitia SPMB secara manual: tidak ada
-- tenggat, tidak ada bukti kapan sebuah permintaan dijawab, dan tidak ada
-- tempat melihat permintaan mana yang hampir lewat.
--
-- `data_subject_requests` adalah alur itu. Satu tabel untuk keempat hak
-- (akses, koreksi, tarik persetujuan, hapus): keempatnya berbagi pemohon,
-- subjek, tenggat, status, dan riwayat. Empat tabel berarti empat daftar
-- petugas dan empat tempat yang bisa lupa menghitung tenggat.
--
-- `registrants.consent_withdrawn_at` mencatat kapan pemrosesan atas dasar
-- persetujuan berhenti (Pasal 40 ayat 2). Bukti persetujuan lama TIDAK
-- dihapus: Pasal 21 menuntut kemampuan menunjukkan persetujuan pernah sah.
--
-- Tanpa ekstensi: hanya tipe bawaan PostgreSQL. `gen_random_uuid()` bawaan
-- sejak PostgreSQL 13 (migrasi lain pun memakainya).

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'CONSENT_WITHDRAWAL', 'ERASURE');
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'PROCESSING', 'COMPLETED', 'REJECTED');
CREATE TYPE "DataSubjectCategory" AS ENUM ('STUDENT', 'REGISTRANT', 'GUARDIAN');

-- AlterTable
ALTER TABLE "registrants" ADD COLUMN "consent_withdrawn_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "request_no" TEXT NOT NULL,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "subject_category" "DataSubjectCategory" NOT NULL,
    "subject_student_id" TEXT,
    "subject_registrant_id" TEXT,
    "subject_user_id" TEXT,
    "subject_label" TEXT NOT NULL,
    "requester_user_id" TEXT,
    "requester_name" TEXT NOT NULL,
    "requester_contact" TEXT NOT NULL,
    "requester_relation" TEXT,
    "detail" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "handled_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "verification_code_hash" TEXT,
    "verification_expires_at" TIMESTAMP(3),
    "verification_attempts" INTEGER NOT NULL DEFAULT 0,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_request_no_key" ON "data_subject_requests"("request_no");
CREATE INDEX "data_subject_requests_status_due_at_idx" ON "data_subject_requests"("status", "due_at");
CREATE INDEX "data_subject_requests_subject_student_id_idx" ON "data_subject_requests"("subject_student_id");
CREATE INDEX "data_subject_requests_subject_registrant_id_idx" ON "data_subject_requests"("subject_registrant_id");
CREATE INDEX "data_subject_requests_subject_user_id_idx" ON "data_subject_requests"("subject_user_id");
CREATE INDEX "data_subject_requests_requester_user_id_idx" ON "data_subject_requests"("requester_user_id");
CREATE INDEX "data_subject_requests_handled_by_id_idx" ON "data_subject_requests"("handled_by_id");

-- AddForeignKey
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_subject_student_id_fkey"
    FOREIGN KEY ("subject_student_id") REFERENCES "students"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_subject_registrant_id_fkey"
    FOREIGN KEY ("subject_registrant_id") REFERENCES "registrants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_subject_user_id_fkey"
    FOREIGN KEY ("subject_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_requester_user_id_fkey"
    FOREIGN KEY ("requester_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_handled_by_id_fkey"
    FOREIGN KEY ("handled_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Paling banyak satu subjek per permintaan.
--
-- Ditegakkan basis data, bukan hanya kode. Permintaan yang menunjuk DUA subjek
-- berarti satu di antaranya akan terlewat saat penghapusan dijalankan, dan itu
-- baris yang tidak boleh ada — kode yang menjaganya akan dilewati begitu ada
-- jalur tulis kedua (impor, perbaikan manual). `GUARDIAN` memakai
-- `subject_user_id` — wali adalah pengguna.
--
-- Sengaja "≤ 1", bukan "= 1": ketiganya kunci asing `ON DELETE SET NULL`, jadi
-- menghapus subjek mengosongkan kolomnya. Justru saat itulah catatan
-- kepatuhan ini paling perlu tetap ada — ia bukti permintaan pernah dijawab.
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_at_most_one_subject_check"
    CHECK (
        (CASE WHEN "subject_student_id"    IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN "subject_registrant_id" IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN "subject_user_id"       IS NULL THEN 0 ELSE 1 END) <= 1
    );

-- `REJECTED` tanpa alasan tidak dapat diaudit, dan `COMPLETED` tanpa waktu
-- tidak dapat dihitung tenggatnya. Pasal 33 menuntut alasan penolakan ada.
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_rejection_reason_check"
    CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_completed_at_check"
    CHECK ("status" NOT IN ('COMPLETED', 'REJECTED') OR "completed_at" IS NOT NULL);
