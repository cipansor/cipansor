-- Garis kewenangan penandatanganan naskah dinas (a.n./u.b./Plt./Plh.).
--
-- Empat bentuk ini mengikuti Peraturan BKN 16/2020 Pasal 241-243 dan pedoman
-- tata naskah dinas instansi pemerintah (Permenhut P.69/2013 Lampiran V).
-- Disimpan pada baris tanda tangan, bukan pada surat: ia milik perbuatan
-- menandatangani, dan nilainya ikut ditandatangani (`canonicalPayload`) supaya
-- mengubahnya membatalkan tanda tangannya.
--
-- NONE berarti "atas nama jabatan penanda tangan sendiri" - nilai bawaan bagi
-- baris yang sudah ada, dan keadaan hampir semua naskah.

CREATE TYPE "SigningAuthorityForm" AS ENUM (
  'NONE',
  'ATAS_NAMA',
  'UNTUK_BELIAU',
  'PELAKSANA_TUGAS',
  'PELAKSANA_HARIAN'
);

ALTER TABLE "letter_signatures"
  ADD COLUMN "signing_authority_form" "SigningAuthorityForm" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "represented_office" TEXT;
