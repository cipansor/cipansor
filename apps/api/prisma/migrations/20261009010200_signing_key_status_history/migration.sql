-- CreateTable
-- Jejak status kunci yang sudah tidak aktif. Penerbitan ulang menghapus baris
-- di user_signing_keys, dan tanpa riwayat ini sidik jari yang tercetak pada
-- surat lama akan dijawab "tidak dikenal" oleh layanan status publik.
CREATE TABLE "signing_key_status_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "approved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "revocation_code" "SigningKeyRevocationCode",
    "superseded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signing_key_status_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signing_key_status_records_fingerprint_key" ON "signing_key_status_records"("fingerprint");
CREATE INDEX "signing_key_status_records_user_id_idx" ON "signing_key_status_records"("user_id");
