CREATE TABLE "trade_campaign_analyses" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "primary_trend" "TradeAnalysisPrimaryTrend",
  "ma_timeframes" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "market_zone_enabled" BOOLEAN NOT NULL DEFAULT false,
  "market_zone_high" DECIMAL(65,30),
  "market_zone_low" DECIMAL(65,30),
  "chart_pattern_observed" BOOLEAN NOT NULL DEFAULT false,
  "chart_pattern_timeframe" TEXT,
  "chart_pattern_type" "TradeAnalysisChartPatternType",
  "retail_position_enabled" BOOLEAN NOT NULL DEFAULT false,
  "retail_buy_average_price" DECIMAL(65,30),
  "retail_sell_average_price" DECIMAL(65,30),
  "retail_buy_ratio" DECIMAL(65,30),
  "fibonacci_enabled" BOOLEAN NOT NULL DEFAULT false,
  "fibonacci_start_price" DECIMAL(65,30),
  "fibonacci_end_price" DECIMAL(65,30),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_campaign_analyses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_analysis_campaign_key" UNIQUE ("campaign_id"),
  CONSTRAINT "campaign_analysis_campaign_fkey" FOREIGN KEY ("campaign_id") REFERENCES "trade_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "trade_campaign_analyses" (
  "id", "campaign_id", "primary_trend", "ma_timeframes",
  "market_zone_enabled", "market_zone_high", "market_zone_low",
  "chart_pattern_observed", "chart_pattern_timeframe", "chart_pattern_type",
  "retail_position_enabled", "retail_buy_average_price", "retail_sell_average_price", "retail_buy_ratio",
  "fibonacci_enabled", "fibonacci_start_price", "fibonacci_end_price", "created_at", "updated_at"
)
SELECT campaign."id", campaign."id", analysis."primary_trend", analysis."ma_timeframes",
  analysis."market_zone_enabled", analysis."market_zone_high", analysis."market_zone_low",
  analysis."chart_pattern_observed", analysis."chart_pattern_timeframe", analysis."chart_pattern_type",
  analysis."retail_position_enabled", analysis."retail_buy_average_price", analysis."retail_sell_average_price", analysis."retail_buy_ratio",
  analysis."fibonacci_enabled", analysis."fibonacci_start_price", analysis."fibonacci_end_price", analysis."created_at", analysis."updated_at"
FROM "trade_campaigns" campaign
JOIN "trade_analyses" analysis ON analysis."trade_id" = campaign."root_trade_id";

ALTER TABLE "trade_analysis_economic_indicators"
  DROP CONSTRAINT IF EXISTS "trade_analysis_economic_indicators_analysis_id_fkey",
  DROP CONSTRAINT IF EXISTS "trade_analysis_economic_indicators_analysis_id_position_key",
  DROP CONSTRAINT IF EXISTS "trade_analysis_economic_indicators_analysis_position_key";
DROP INDEX IF EXISTS "trade_analysis_economic_indicators_analysis_id_position_idx";

UPDATE "trade_analysis_economic_indicators" indicator
SET "analysis_id" = campaign."id"
FROM "trade_analyses" analysis
JOIN "trade_campaigns" campaign ON campaign."root_trade_id" = analysis."trade_id"
WHERE indicator."analysis_id" = analysis."id";

ALTER TABLE "trade_analysis_economic_indicators" RENAME TO "trade_campaign_analysis_economic_indicators";
ALTER TABLE "trade_campaign_analysis_economic_indicators" RENAME COLUMN "analysis_id" TO "campaign_analysis_id";
ALTER TABLE "trade_campaign_analysis_economic_indicators"
  ADD CONSTRAINT "campaign_indicator_analysis_fkey"
    FOREIGN KEY ("campaign_analysis_id") REFERENCES "trade_campaign_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "campaign_indicator_analysis_position_key"
    UNIQUE ("campaign_analysis_id", "position");
CREATE INDEX "campaign_indicator_analysis_position_idx"
  ON "trade_campaign_analysis_economic_indicators"("campaign_analysis_id", "position");

ALTER TABLE "trade_analyses"
  DROP COLUMN "primary_trend",
  DROP COLUMN "ma_timeframes",
  DROP COLUMN "market_zone_enabled",
  DROP COLUMN "market_zone_high",
  DROP COLUMN "market_zone_low",
  DROP COLUMN "chart_pattern_observed",
  DROP COLUMN "chart_pattern_timeframe",
  DROP COLUMN "chart_pattern_type",
  DROP COLUMN "retail_position_enabled",
  DROP COLUMN "retail_buy_average_price",
  DROP COLUMN "retail_sell_average_price",
  DROP COLUMN "retail_buy_ratio",
  DROP COLUMN "fibonacci_enabled",
  DROP COLUMN "fibonacci_start_price",
  DROP COLUMN "fibonacci_end_price",
  ALTER COLUMN "schema_version" SET DEFAULT 3;
UPDATE "trade_analyses" SET "schema_version" = 3;
