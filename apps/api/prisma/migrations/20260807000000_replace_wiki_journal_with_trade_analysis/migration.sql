-- Forward-only replacement of Wiki-derived trade journal/tag data with user-owned analysis.
CREATE TYPE "TradeAnalysisPrimaryTrend" AS ENUM ('up', 'sideways', 'down');
CREATE TYPE "TradeAnalysisBollingerBandCount" AS ENUM ('one_band', 'two_band');
CREATE TYPE "TradeAnalysisBollingerDirection" AS ENUM ('normal', 'reverse', 'chase');
CREATE TYPE "TradeAnalysisMaArrangement" AS ENUM ('bullish', 'bearish', 'congested');
CREATE TYPE "TradeAnalysisCross" AS ENUM ('none', 'golden_20_60', 'golden_20_120', 'dead_20_60', 'dead_20_120');
CREATE TYPE "TradeAnalysisChartPatternType" AS ENUM ('double_top', 'double_bottom', 'head_shoulders', 'inverse_head_shoulders');
CREATE TYPE "TradeAnalysisEconomicIndicatorImpact" AS ENUM ('positive', 'negative');

ALTER TABLE "trades" ADD COLUMN "initial_trade_id" TEXT;
CREATE TABLE "trade_analyses" (
  "id" TEXT NOT NULL, "trade_id" TEXT NOT NULL, "schema_version" INTEGER NOT NULL DEFAULT 1,
  "base_timeframe" TEXT, "primary_trend" "TradeAnalysisPrimaryTrend", "bollinger_band_count" "TradeAnalysisBollingerBandCount", "bollinger_direction" "TradeAnalysisBollingerDirection", "ma_arrangement" "TradeAnalysisMaArrangement", "cross" "TradeAnalysisCross", "stop_loss_line" DECIMAL(65,30),
  "market_zone_enabled" BOOLEAN NOT NULL DEFAULT false, "market_zone_high" DECIMAL(65,30), "market_zone_low" DECIMAL(65,30),
  "chart_pattern_observed" BOOLEAN NOT NULL DEFAULT false, "chart_pattern_timeframe" TEXT, "chart_pattern_type" "TradeAnalysisChartPatternType",
  "retail_position_enabled" BOOLEAN NOT NULL DEFAULT false, "retail_buy_average_price" DECIMAL(65,30), "retail_sell_average_price" DECIMAL(65,30), "retail_buy_ratio" DECIMAL(65,30),
  "fibonacci_enabled" BOOLEAN NOT NULL DEFAULT false, "fibonacci_start_price" DECIMAL(65,30), "fibonacci_end_price" DECIMAL(65,30), "regret" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trade_analyses_pkey" PRIMARY KEY ("id"), CONSTRAINT "trade_analyses_trade_id_key" UNIQUE ("trade_id"),
  CONSTRAINT "trade_analyses_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trade_analyses_stop_loss_positive" CHECK ("stop_loss_line" IS NULL OR "stop_loss_line" > 0),
  CONSTRAINT "trade_analyses_market_zone" CHECK ((NOT "market_zone_enabled" AND "market_zone_high" IS NULL AND "market_zone_low" IS NULL) OR ("market_zone_enabled" AND "market_zone_high" > 0 AND "market_zone_low" > 0 AND "market_zone_high" > "market_zone_low")),
  CONSTRAINT "trade_analyses_chart_pattern" CHECK ((NOT "chart_pattern_observed" AND "chart_pattern_timeframe" IS NULL AND "chart_pattern_type" IS NULL) OR ("chart_pattern_observed" AND "chart_pattern_timeframe" IS NOT NULL AND btrim("chart_pattern_timeframe") <> '' AND "chart_pattern_type" IS NOT NULL)),
  CONSTRAINT "trade_analyses_retail_position" CHECK ((NOT "retail_position_enabled" AND "retail_buy_average_price" IS NULL AND "retail_sell_average_price" IS NULL AND "retail_buy_ratio" IS NULL) OR ("retail_position_enabled" AND "retail_buy_average_price" > 0 AND "retail_sell_average_price" > 0 AND "retail_buy_ratio" BETWEEN 0 AND 100)),
  CONSTRAINT "trade_analyses_fibonacci" CHECK ((NOT "fibonacci_enabled" AND "fibonacci_start_price" IS NULL AND "fibonacci_end_price" IS NULL) OR ("fibonacci_enabled" AND "fibonacci_start_price" > 0 AND "fibonacci_end_price" > 0 AND "fibonacci_start_price" <> "fibonacci_end_price"))
);
CREATE TABLE "trade_analysis_economic_indicators" (
 "id" TEXT NOT NULL, "analysis_id" TEXT NOT NULL, "type" TEXT NOT NULL, "impact" "TradeAnalysisEconomicIndicatorImpact" NOT NULL, "position" INTEGER NOT NULL,
 CONSTRAINT "trade_analysis_economic_indicators_pkey" PRIMARY KEY ("id"), CONSTRAINT "trade_analysis_economic_indicators_analysis_position_key" UNIQUE ("analysis_id", "position"),
 CONSTRAINT "trade_analysis_economic_indicators_type_nonblank" CHECK (btrim("type") <> ''),
 CONSTRAINT "trade_analysis_economic_indicators_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "trade_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "trade_analysis_economic_indicators_analysis_id_position_idx" ON "trade_analysis_economic_indicators"("analysis_id", "position");

INSERT INTO "trade_analyses" ("id", "trade_id", "base_timeframe", "primary_trend", "updated_at")
SELECT md5("id" || clock_timestamp()::text || random()::text), "id", NULLIF(btrim("timeframe"), ''), CASE "primary_trend" WHEN '상승' THEN 'up'::"TradeAnalysisPrimaryTrend" WHEN '횡보' THEN 'sideways'::"TradeAnalysisPrimaryTrend" WHEN '하락' THEN 'down'::"TradeAnalysisPrimaryTrend" ELSE NULL END, CURRENT_TIMESTAMP FROM "trades";
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "trades" t LEFT JOIN "trade_analyses" a ON a."trade_id"=t."id" WHERE a."id" IS NULL) OR EXISTS (SELECT "trade_id" FROM "trade_analyses" GROUP BY "trade_id" HAVING count(*) <> 1) THEN RAISE EXCEPTION 'trade analysis backfill incomplete'; END IF;
END $$;
ALTER TABLE "trades" ADD CONSTRAINT "trades_initial_trade_not_self" CHECK ("initial_trade_id" IS NULL OR "initial_trade_id" <> "id");
ALTER TABLE "trades" ADD CONSTRAINT "trades_initial_trade_id_fkey" FOREIGN KEY ("initial_trade_id") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "trades_initial_trade_id_idx" ON "trades"("initial_trade_id");

CREATE FUNCTION public.trade_analysis_require_root_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."initial_trade_id" IS NOT NULL THEN
   PERFORM 1 FROM public.trades WHERE id = NEW."initial_trade_id" AND initial_trade_id IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'initial_trade_id must reference an extant root trade'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "trades_initial_trade_must_be_root" AFTER INSERT OR UPDATE OF "initial_trade_id" ON public.trades DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trade_analysis_require_root_target();
CREATE FUNCTION public.trade_analysis_initial_trade_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."initial_trade_id" IS DISTINCT FROM OLD."initial_trade_id" THEN RAISE EXCEPTION 'initial_trade_id is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER "trades_initial_trade_immutable" BEFORE UPDATE OF "initial_trade_id" ON public.trades FOR EACH ROW EXECUTE FUNCTION public.trade_analysis_initial_trade_immutable();
CREATE FUNCTION public.trade_analysis_require_after_trade_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.trade_analyses WHERE trade_id=NEW."id") THEN RAISE EXCEPTION 'every trade requires exactly one analysis'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.trade_analysis_preserve_after_analysis_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trade_key text;
BEGIN
 trade_key := COALESCE(NEW."trade_id", OLD."trade_id");
 IF EXISTS (SELECT 1 FROM public.trades WHERE id=trade_key) AND NOT EXISTS (SELECT 1 FROM public.trade_analyses WHERE trade_id=trade_key) THEN RAISE EXCEPTION 'every trade requires exactly one analysis'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "trades_require_analysis" AFTER INSERT ON public.trades DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trade_analysis_require_after_trade_insert();
CREATE CONSTRAINT TRIGGER "analyses_preserve_one_per_trade" AFTER INSERT OR UPDATE OR DELETE ON public.trade_analyses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trade_analysis_preserve_after_analysis_change();
CREATE FUNCTION public.trade_analysis_trade_id_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."trade_id" IS DISTINCT FROM OLD."trade_id" THEN
   RAISE EXCEPTION 'trade_analyses.trade_id is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "trade_analyses_trade_id_immutable"
  BEFORE UPDATE OF "trade_id" ON public.trade_analyses
  FOR EACH ROW EXECUTE FUNCTION public.trade_analysis_trade_id_immutable();

ALTER TABLE "trades" DROP COLUMN "timeframe", DROP COLUMN "primary_trend", DROP COLUMN "journal", DROP COLUMN "resultLabelTagId";
DROP TABLE "trade_setup_tag_links", "trade_rule_violation_tag_links", "trade_lesson_tag_links", "setup_tag_definitions", "rule_violation_tag_definitions", "lesson_tag_definitions", "result_label_tag_definitions";
DROP TYPE "TradeTagField";
