-- Hash salinan bercap DICABUT dan nama pencabut yang membeku.
--
-- Kolom `revoked_sha256` semula hidup di `letter_signed_documents`. Tetapi cap
-- DICABUT mencetak **nama pencabut**, dan nama itu dibaca dari `users.name`
-- pada saat salinan dicap. Begitu akun pencabut diganti nama, salinan yang
-- diunduh setelahnya memuat nama baru sementara hash tersimpan menghitung nama
-- lama — sehingga salinan resmi sistem sendiri dijawab "tidak terdaftar".
--
-- `revoked_by_name` membekukan nama itu pada baris tanda tangan, dan
-- `revoked_sha256` pindah ke sini supaya keduanya — nama dan hash yang
-- diturunkan darinya — berada di satu baris yang sama dan tidak dapat
-- berselisih.
ALTER TABLE "letter_signatures" ADD COLUMN "revoked_by_name" TEXT;
ALTER TABLE "letter_signatures" ADD COLUMN "revoked_sha256" TEXT;

-- Backfill hash salinan bercap untuk pencabutan yang sudah tercatat. Namanya
-- dibaca dari `users.name` **sekarang**: baris inilah yang hash-nya tersimpan,
-- jadi nama itulah yang harus dipakai agar hash yang dihitung konsisten dengan
-- apa yang disajikan selama ini. Bila akun pencabut sudah diganti nama, baris
-- ini memakai nama yang sekarang — sama seperti perilaku jalur cadangan — dan
-- baris berikutnya membekukannya agar tidak berubah lagi.
UPDATE "letter_signatures" AS s
SET "revoked_sha256" = d."revoked_sha256"
FROM "letter_signed_documents" AS d
WHERE d."signature_id" = s."id" AND d."revoked_sha256" IS NOT NULL;

UPDATE "letter_signatures" AS s
SET "revoked_by_name" = u."name"
FROM "users" AS u
WHERE u."id" = s."revoked_by_id" AND s."revoked_at" IS NOT NULL;

DROP INDEX IF EXISTS "letter_signed_documents_revoked_sha256_idx";
ALTER TABLE "letter_signed_documents" DROP COLUMN IF EXISTS "revoked_sha256";

-- Pencocokan salinan bercap kini `letter_signatures.revoked_sha256 = ?`.
CREATE INDEX "letter_signatures_revoked_sha256_idx"
  ON "letter_signatures"("revoked_sha256");
