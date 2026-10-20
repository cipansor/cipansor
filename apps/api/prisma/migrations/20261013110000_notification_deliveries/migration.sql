-- Durable per-channel delivery markers for recurring notifications (#802).
--
-- The first cut used the bell row itself as the delivery guard (a unique
-- (user_id, dedupe_key) index). Two review findings showed why a row cannot be
-- the guard: a user deleting the bell row left no marker (the reminder returned
-- and re-emailed on the next run), and a transport failure that fired after the
-- insert left a marker that blocked every retry. Both lose state the scheduler
-- needs to tell "already delivered" from "still owed".
--
-- `notification_deliveries` is that state: one row per (user, key) holding a
-- per-channel map, so a failed EMAIL is retried while a delivered channel is
-- not. The marker is created before the in-app row, so it outlives a deletion;
-- it is removed only when the subject recovers (a plan back under 120%), never
-- by a user action.
--
-- `notifications` keeps `dedupe_key` as the in-app copy's own key, but the
-- unique index that made the row the guard is dropped. The guard now lives in
-- the deliveries table.
BEGIN;

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "notification_deliveries_user_id_dedupe_key_key"
    ON "notification_deliveries"("user_id", "dedupe_key");
CREATE INDEX "notification_deliveries_dedupe_key_idx"
    ON "notification_deliveries"("dedupe_key");

-- Preserve the deliveries the old code already made: a keyed notification row
-- means that slot was delivered. Enabling the bootstrap must not re-send every
-- reminder a second time. The rows predate per-channel tracking, so each
-- channel the notification listed is marked SENT (the in-app row exists and the
-- external best-effort already ran).
INSERT INTO "notification_deliveries" ("id", "user_id", "dedupe_key", "channels", "updated_at")
SELECT
    gen_random_uuid()::text,
    n."user_id",
    n."dedupe_key",
    COALESCE(
        (
            SELECT jsonb_object_agg(c, 'SENT')
            FROM jsonb_array_elements_text(n."data" -> 'channels') AS c
        ),
        '{}'::jsonb
    ),
    now()
FROM "notifications" n
WHERE n."dedupe_key" IS NOT NULL
ON CONFLICT ("user_id", "dedupe_key") DO NOTHING;

-- The row is no longer load-bearing for delivery state.
DROP INDEX "notifications_user_id_dedupe_key_key";
CREATE INDEX "notifications_user_id_dedupe_key_idx"
    ON "notifications"("user_id", "dedupe_key");

COMMIT;
