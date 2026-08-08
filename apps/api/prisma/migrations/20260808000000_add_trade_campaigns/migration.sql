CREATE TYPE "CampaignMembershipSource" AS ENUM ('auto', 'manual');
CREATE TYPE "CampaignConflictStatus" AS ENUM ('unresolved', 'resolved');

CREATE TABLE "trade_campaigns" (
  "id" TEXT NOT NULL,
  "root_trade_id" TEXT NOT NULL,
  "trading_date" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trade_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trade_campaigns_root_trade_id_key" ON "trade_campaigns"("root_trade_id");
CREATE INDEX "trade_campaigns_trading_date_idx" ON "trade_campaigns"("trading_date");

CREATE TABLE "campaign_memberships" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "source" "CampaignMembershipSource" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaign_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaign_memberships_trade_id_key" ON "campaign_memberships"("trade_id");
CREATE INDEX "campaign_memberships_campaign_id_idx" ON "campaign_memberships"("campaign_id");

CREATE TABLE "campaign_conflicts" (
  "id" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "candidate_campaign_ids" JSONB NOT NULL,
  "status" "CampaignConflictStatus" NOT NULL DEFAULT 'unresolved',
  "resolved_campaign_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "campaign_conflicts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "campaign_conflicts_trade_id_status_idx" ON "campaign_conflicts"("trade_id", "status");
CREATE UNIQUE INDEX "campaign_conflicts_trade_id_key" ON "campaign_conflicts"("trade_id");

-- Legacy scale-in links are user-authored grouping intent, so preserve them as MANUAL.
WITH roots AS (
  SELECT t."id", t."opened_at"
  FROM "trades" t
  WHERE t."initial_trade_id" IS NULL
), campaigns AS (
  INSERT INTO "trade_campaigns" ("id", "root_trade_id", "trading_date", "created_at", "updated_at")
  SELECT md5(r."id"), r."id", ((r."opened_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM roots r
  WHERE r."opened_at" IS NOT NULL
  RETURNING "id", "root_trade_id"
)
INSERT INTO "campaign_memberships" ("id", "campaign_id", "trade_id", "source", "created_at", "updated_at")
SELECT
  md5(t."id" || ':campaign'),
  c."id",
  t."id",
  CASE
    WHEN t."initial_trade_id" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "trades" child WHERE child."initial_trade_id" = t."id")
    THEN 'manual'::"CampaignMembershipSource"
    ELSE 'auto'::"CampaignMembershipSource"
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "trades" t
JOIN campaigns c ON c."root_trade_id" = COALESCE(t."initial_trade_id", t."id")
ON CONFLICT ("trade_id") DO NOTHING;

ALTER TABLE "trade_campaigns" ADD CONSTRAINT "trade_campaigns_root_trade_id_fkey" FOREIGN KEY ("root_trade_id") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaign_memberships" ADD CONSTRAINT "campaign_memberships_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "trade_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_memberships" ADD CONSTRAINT "campaign_memberships_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_conflicts" ADD CONSTRAINT "campaign_conflicts_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_conflicts" ADD CONSTRAINT "campaign_conflicts_resolved_campaign_id_fkey" FOREIGN KEY ("resolved_campaign_id") REFERENCES "trade_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "trades_initial_trade_id_idx";
DROP TRIGGER IF EXISTS "trades_initial_trade_must_be_root" ON "trades";
DROP TRIGGER IF EXISTS "trades_initial_trade_immutable" ON "trades";
DROP FUNCTION IF EXISTS public.trade_analysis_require_root_target();
DROP FUNCTION IF EXISTS public.trade_analysis_initial_trade_immutable();
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_initial_trade_id_fkey";
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_initial_trade_not_self";
ALTER TABLE "trades" DROP COLUMN "initial_trade_id";
