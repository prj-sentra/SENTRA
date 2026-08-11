CREATE TABLE "trade_campaign_analysis_archives" (
  "id" TEXT NOT NULL,
  "campaign_analysis_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_campaign_analysis_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_analysis_archive_source_key" UNIQUE ("campaign_analysis_id", "source"),
  CONSTRAINT "campaign_analysis_archive_analysis_fkey" FOREIGN KEY ("campaign_analysis_id") REFERENCES "trade_campaign_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "trade_campaign_analysis_archives" ("id", "campaign_analysis_id", "source", "content")
SELECT md5(analysis."id" || ':legacy_chart_pattern'), analysis."id", 'legacy_chart_pattern',
  jsonb_build_object(
    'observed', analysis."chart_pattern_observed",
    'timeframe', analysis."chart_pattern_timeframe",
    'type', analysis."chart_pattern_type"
  )
FROM "trade_campaign_analyses" analysis
WHERE analysis."chart_pattern_observed"
   OR analysis."chart_pattern_timeframe" IS NOT NULL
   OR analysis."chart_pattern_type" IS NOT NULL;

UPDATE "trade_campaign_analyses" analysis
SET "ma_timeframes" = (
  SELECT jsonb_object_agg(
    timeframe,
    COALESCE(analysis."ma_timeframes" -> timeframe, '{}'::jsonb)
      || CASE
        WHEN analysis."chart_pattern_observed"
         AND analysis."chart_pattern_timeframe" = timeframe
         AND analysis."chart_pattern_type" IS NOT NULL
        THEN jsonb_build_object('chartPattern', analysis."chart_pattern_type")
        ELSE '{}'::jsonb
      END
  )
  FROM unnest(ARRAY['15m', '30m', '1h', '4h', '1D', '1W', '1MN']) AS timeframe
);

ALTER TABLE "trade_campaign_analyses"
  DROP COLUMN "chart_pattern_observed",
  DROP COLUMN "chart_pattern_timeframe",
  DROP COLUMN "chart_pattern_type";
