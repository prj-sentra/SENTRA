ALTER TYPE "TradeAnalysisPrimaryTrend" RENAME TO "TradeAnalysisPrimaryTrend_old";

CREATE TYPE "TradeAnalysisPrimaryTrend" AS ENUM ('up', 'up_sideways', 'down', 'down_sideways');

ALTER TABLE "trade_campaign_analyses"
  ALTER COLUMN "primary_trend" TYPE "TradeAnalysisPrimaryTrend"
  USING (
    CASE "primary_trend"::text
      WHEN 'sideways' THEN 'up_sideways'
      ELSE "primary_trend"::text
    END
  )::"TradeAnalysisPrimaryTrend";

DROP TYPE "TradeAnalysisPrimaryTrend_old";
