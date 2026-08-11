ALTER TABLE "trade_analysis_economic_indicators"
ADD COLUMN "announced_at" TIMESTAMPTZ;

ALTER TABLE "trade_analysis_economic_indicators"
DROP CONSTRAINT IF EXISTS "trade_analysis_economic_indicators_analysis_id_position_key";
ALTER TABLE "trade_analysis_economic_indicators"
DROP CONSTRAINT IF EXISTS "trade_analysis_economic_indicators_analysis_position_key";

WITH indicator_targets AS (
  SELECT indicator."id" AS indicator_id, root_analysis."id" AS root_analysis_id
  FROM "trade_analysis_economic_indicators" indicator
  JOIN "trade_analyses" analysis ON analysis."id" = indicator."analysis_id"
  LEFT JOIN "trade_campaigns" root_campaign ON root_campaign."root_trade_id" = analysis."trade_id"
  LEFT JOIN "campaign_memberships" membership ON membership."trade_id" = analysis."trade_id"
  JOIN "trade_campaigns" campaign ON campaign."id" = COALESCE(root_campaign."id", membership."campaign_id")
  JOIN "trade_analyses" root_analysis ON root_analysis."trade_id" = campaign."root_trade_id"
)
UPDATE "trade_analysis_economic_indicators" indicator
SET "analysis_id" = target.root_analysis_id
FROM indicator_targets target
WHERE indicator."id" = target.indicator_id;

WITH ordered AS (
  SELECT "id", row_number() OVER (PARTITION BY "analysis_id" ORDER BY "position", "id") - 1 AS next_position
  FROM "trade_analysis_economic_indicators"
)
UPDATE "trade_analysis_economic_indicators" indicator
SET "position" = ordered.next_position
FROM ordered
WHERE indicator."id" = ordered."id";

ALTER TABLE "trade_analysis_economic_indicators"
ADD CONSTRAINT "trade_analysis_economic_indicators_analysis_id_position_key"
UNIQUE ("analysis_id", "position");
