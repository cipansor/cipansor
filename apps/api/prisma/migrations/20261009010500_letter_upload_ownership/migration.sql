-- Indeks kepemilikan berkas naskah yang diunggah (CWE-639).
--
-- `Letter.fileUrl` dapat menunjuk URL unggahan milik orang lain; penandatanganan
-- membaca byte-nya tanpa memeriksa pemiliknya, lalu menandatangani dan
-- mengarsipkannya sebagai naskah penanda tangan. Tabel ini mencatat pemilik
-- setiap unggahan yang sah, supaya penandatanganan dapat menolak berkas yang
-- bukan miliknya.
--
-- Baris yang sudah ada (diunggah sebelum tabel ini ada) tidak diketahui
-- pemiliknya; penandatanganan memperlakukannya sebagai "belum tercatat" dan
-- menolak berkas yang tidak dapat dibuktikan kepemilikannya.
CREATE TABLE "letter_uploads" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_uploads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "letter_uploads_filename_key" ON "letter_uploads"("filename");
CREATE INDEX "letter_uploads_user_id_idx" ON "letter_uploads"("user_id");

ALTER TABLE "letter_uploads"
  ADD CONSTRAINT "letter_uploads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
