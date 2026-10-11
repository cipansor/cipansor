-- AlterTable
-- Simpan sidik jari kunci publik agar layanan status kunci (AATL ICA7) dapat
-- mencarinya langsung. Baris lama diberi nilai; baris berikutnya menulisnya
-- saat kunci diterbitkan atau diperpanjang.
--
-- IF NOT EXISTS: versi pertama migrasi ini memasang pgcrypto, yang tidak
-- di-allow-list Azure Database for PostgreSQL. Di staging ia gagal sesudah
-- kolom ini dibuat, jadi saat diterapkan ulang kolomnya sudah ada.
ALTER TABLE "user_signing_keys" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;

-- Backfill: sidik jari = SHA-256 atas subjectPublicKeyInfo (DER) yang didekode
-- dari base64 di kolom public_key. `sha256(bytea)` bawaan PostgreSQL sejak
-- versi 11 — tanpa ekstensi, sehingga berjalan juga di server terkelola Azure
-- yang menolak `CREATE EXTENSION pgcrypto`. Hasilnya sama byte demi byte
-- dengan `digest(…, 'sha256')`.
UPDATE "user_signing_keys"
SET "fingerprint" = upper(
  regexp_replace(
    encode(sha256(decode("public_key", 'base64')), 'hex'),
    '(..)(?!$)',
    '\1:',
    'g'
  )
)
WHERE "fingerprint" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_signing_keys_fingerprint_key" ON "user_signing_keys"("fingerprint");
