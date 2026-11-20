-- Agenda berulang disimpan termaterialisasi, #1155.
--
-- Setiap kemunculan adalah barisnya sendiri: yang pertama menjadi induk
-- (`is_recurring`, `recurrence_rule` berisi RRULE), kemunculan berikutnya
-- menunjuk induk lewat `recurrence_parent_id`. Alternatifnya — mengembangkan
-- seri saat dibaca — menuntut enam pembaca `calendar_events` (daftar, hari ini,
-- statistik, pengingat kehadiran, kalender kerja, penjadwal notifikasi) masing-
-- masing memahami RRULE, dan satu yang lupa akan diam-diam melewatkan agenda.
--
-- `ON DELETE CASCADE` hanya berlaku pada hapus keras. Hapus di aplikasi adalah
-- soft delete (`deleted_at`), jadi menghapus "seluruh seri" menandai induk dan
-- semua anaknya dalam satu transaksi, bukan mengandalkan cascade.
ALTER TABLE "calendar_events" ADD COLUMN "recurrence_parent_id" TEXT;

CREATE INDEX "calendar_events_recurrence_parent_id_idx"
  ON "calendar_events"("recurrence_parent_id");

ALTER TABLE "calendar_events"
  ADD CONSTRAINT "calendar_events_recurrence_parent_id_fkey"
  FOREIGN KEY ("recurrence_parent_id") REFERENCES "calendar_events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
