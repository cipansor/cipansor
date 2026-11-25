-- Kapan uang laundry diterima, terpisah dari kapan pesanan dibuat (#1010).
--
-- Sebelum ini `getStats` membatasi pendapatan dengan `created_at`, sehingga
-- tagihan lama yang dilunasi hari ini tidak masuk ringkasan hari ini, dan
-- ringkasan hari pesanan berubah setelah pelunasan. `paid_at` dicatat sekali
-- saat pembayaran (langsung atau pelunasan) dan tidak berubah ketika status
-- cucian bergerak.
--
-- Baris lama yang sudah PAID tidak punya tanggal terverifikasi. Diisi
-- `created_at` supaya laporan historis tetap sama dengan yang selama ini
-- dibaca; baris UNPAID tetap NULL sampai benar-benar dibayar.

ALTER TABLE "laundry_transactions" ADD COLUMN "paid_at" TIMESTAMP(3);

UPDATE "laundry_transactions"
SET "paid_at" = "created_at"
WHERE "payment_status" = 'PAID';

CREATE INDEX "laundry_transactions_paid_at_idx" ON "laundry_transactions"("paid_at");
