ALTER TABLE "trade_analyses"
ADD COLUMN "ma_timeframes" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "trade_analyses"
SET "ma_timeframes" = jsonb_build_object(
  "base_timeframe",
  jsonb_strip_nulls(jsonb_build_object(
    'arrangement', "ma_arrangement",
    'cross', "cross"
  ))
)
WHERE "base_timeframe" IN ('15m', '30m', '1h', '4h', '1D', '1W', '1MN')
  AND ("ma_arrangement" IS NOT NULL OR "cross" IS NOT NULL);

ALTER TABLE "trade_analyses"
  DROP COLUMN "ma_arrangement",
  DROP COLUMN "cross",
  ALTER COLUMN "schema_version" SET DEFAULT 2;

UPDATE "trade_analyses" SET "schema_version" = 2;
