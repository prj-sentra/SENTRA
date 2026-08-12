CREATE TYPE "CampaignHeadSource" AS ENUM ('auto', 'manual');

ALTER TABLE "trade_campaigns"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "campaign_memberships"
  ADD COLUMN "head_source" "CampaignHeadSource" NOT NULL DEFAULT 'auto';

-- Existing manually authored groups retain their boundary at the campaign root.
UPDATE "campaign_memberships" membership
SET "head_source" = 'manual'
FROM "trade_campaigns" campaign
WHERE membership."campaign_id" = campaign."id"
  AND membership."trade_id" = campaign."root_trade_id"
  AND membership."source" = 'manual';
