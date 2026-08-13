CREATE TABLE "mt5_bridge_activity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "account_id" TEXT,
  "lease_id" TEXT,
  "reason" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mt5_bridge_activity_kind_check" CHECK ("kind" IN ('SYNC', 'WORKER', 'HALT')),
  CONSTRAINT "mt5_bridge_activity_shape_check" CHECK (
    ("kind" IN ('SYNC', 'WORKER') AND "lease_id" IS NOT NULL AND "expires_at" IS NOT NULL)
    OR ("kind" = 'HALT' AND "lease_id" IS NULL AND "expires_at" IS NULL)
  )
);
CREATE UNIQUE INDEX "mt5_bridge_activity_lease_id_key" ON "mt5_bridge_activity"("lease_id");
CREATE INDEX "mt5_bridge_activity_kind_expires_at_idx" ON "mt5_bridge_activity"("kind", "expires_at");
