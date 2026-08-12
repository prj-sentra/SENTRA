ALTER TABLE "mt5_sync_status"
  ADD COLUMN "last_successful_snapshot_msc" BIGINT,
  ADD COLUMN "mode" TEXT,
  ADD COLUMN "snapshot_to_msc" BIGINT,
  ADD COLUMN "page_cursor" TEXT,
  ADD COLUMN "changed_since_msc" BIGINT,
  ADD COLUMN "open_position_ids" JSONB;

UPDATE "mt5_sync_status"
SET "last_successful_snapshot_msc" = FLOOR(EXTRACT(EPOCH FROM "last_sync_at") * 1000)::BIGINT
WHERE "last_sync_at" IS NOT NULL;

ALTER TABLE "mt5_sync_status" DROP COLUMN "cursor";
