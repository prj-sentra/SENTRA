ALTER TYPE "TradeAnalysisBollingerBandCount" ADD VALUE IF NOT EXISTS 'no_touch';

UPDATE "trade_analyses"
SET "bollinger_band_count" = NULL,
    "bollinger_direction" = NULL
WHERE "bollinger_band_count" IS NULL
  AND "bollinger_direction" IS NULL;
