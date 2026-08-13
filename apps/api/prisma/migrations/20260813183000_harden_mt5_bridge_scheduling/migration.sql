ALTER TABLE "mt5_bridge_activity" DROP CONSTRAINT "mt5_bridge_activity_kind_check";
ALTER TABLE "mt5_bridge_activity" DROP CONSTRAINT "mt5_bridge_activity_shape_check";
ALTER TABLE "mt5_bridge_activity"
  ADD CONSTRAINT "mt5_bridge_activity_kind_check" CHECK ("kind" IN ('SYNC', 'WORKER', 'HALT', 'BACKOFF'));
ALTER TABLE "mt5_bridge_activity"
  ADD CONSTRAINT "mt5_bridge_activity_shape_check" CHECK (
    ("kind" IN ('SYNC', 'WORKER') AND "lease_id" IS NOT NULL AND "expires_at" IS NOT NULL)
    OR ("kind" = 'BACKOFF' AND "lease_id" IS NULL AND "expires_at" IS NOT NULL)
    OR ("kind" = 'HALT' AND "lease_id" IS NULL AND "expires_at" IS NULL)
  );

CREATE TABLE "mt5_excursion_account_schedule" (
  "account_id" TEXT NOT NULL PRIMARY KEY,
  "last_served_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "mt5_excursion_account_schedule_last_served_at_idx"
  ON "mt5_excursion_account_schedule"("last_served_at");
