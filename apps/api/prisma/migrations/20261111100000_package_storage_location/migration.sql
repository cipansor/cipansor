-- Simpan "Lokasi Simpan" paket santri (#749).
--
-- Formulir Resepsi → Paket punya ruas "Lokasi Simpan" (`storageLocation`), dan
-- DTO bersama `CreateStudentPackageInput` sudah memuatnya, tetapi model
-- `StudentPackage` tidak punya kolomnya: nilai yang diisi petugas dibuang tanpa
-- pesan, dan halaman tak dapat menampilkannya kembali. Tambah kolomnya agar
-- formulir benar-benar menyimpan apa yang diketik.
--
-- Kolom nullable tanpa default, jadi baris lama tetap valid. Tanpa ekstensi.
ALTER TABLE "student_packages" ADD COLUMN "storage_location" TEXT;
