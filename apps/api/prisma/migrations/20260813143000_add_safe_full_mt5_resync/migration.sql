ALTER TABLE "trades" ADD COLUMN "mt5_source_missing_at" TIMESTAMP(3);
ALTER TABLE "mt5_sync_status" ADD COLUMN "rebuild_started_at" TIMESTAMP(3);
