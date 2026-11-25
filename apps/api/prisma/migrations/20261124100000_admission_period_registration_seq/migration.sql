-- Nomor pendaftaran tidak boleh dipakai ulang sesudah retensi menghapus baris
-- awal. Sebelum ini nomornya `count(*) + 1`; begitu retensi menghapus
-- pendaftar gelombang lama sementara gelombang berikutnya masih terbuka,
-- hitungannya turun dan nomor yang masih dipakai pendaftar lain terbit lagi.
--
-- Pencacah per periode ini hanya bertambah, dan `generateRegistrationNo`
-- menaikkannya secara atomik (`UPDATE ... RETURNING`) sehingga dua pendaftaran
-- bersamaan tidak mendapat nomor yang sama.
ALTER TABLE "admission_periods" ADD COLUMN "registration_seq" INTEGER NOT NULL DEFAULT 0;

-- Inisialisasi di atas nomor tertinggi yang sudah terbit. `registration_no`
-- lama punya beberapa bentuk (`REG-2024-00011`, `REG-2024-ABCD-00011`,
-- `SPMB26-SDIT-0001`), jadi yang aman adalah ekor angka terakhir; `count(*)`
-- menjadi lantai bila sebuah periode tidak punya nomor berakhiran angka.
UPDATE "admission_periods" AS p
SET "registration_seq" = GREATEST(
  (
    SELECT COALESCE(MAX((regexp_match(r."registration_no", '([0-9]+)$'))[1]::integer), 0)
    FROM "registrants" AS r
    WHERE r."admission_period_id" = p."id"
  ),
  (
    SELECT COUNT(*)::integer
    FROM "registrants" AS r
    WHERE r."admission_period_id" = p."id"
  )
);
