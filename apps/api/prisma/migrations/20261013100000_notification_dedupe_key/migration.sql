-- Idempotent recurring notifications (#802).
--
-- A scheduled task that reruns (a due invoice reminded daily, an over-budget
-- plan alerted every Monday) must send each recipient/subject once per slot.
-- `dedupe_key` carries a durable per-recipient/per-subject key; the unique
-- index on (user_id, dedupe_key) makes a redelivery for the same slot a no-op
-- at the database, so a lost race between two scheduler ticks cannot duplicate.
--
-- One-shot notifications leave the column NULL. Postgres compares NULLs as
-- distinct under a UNIQUE index, so any number of keyless rows coexist.
BEGIN;

ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key"
    ON "notifications"("user_id", "dedupe_key");

COMMIT;
