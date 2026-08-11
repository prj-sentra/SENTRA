UPDATE "statistics_preferences"
SET
  "trading_day_start_minutes" = 0,
  "asia_end_minutes" = 930,
  "london_end_minutes" = 990,
  "new_york_start_minutes" = 570,
  "new_york_end_minutes" = 960
WHERE "trading_day_start_minutes" = 120
  AND "asia_start_minutes" = 540
  AND "asia_end_minutes" = 960
  AND "london_start_minutes" = 480
  AND "london_end_minutes" = 1020
  AND "new_york_start_minutes" = 480
  AND "new_york_end_minutes" = 1020;

ALTER TABLE "statistics_preferences"
  ALTER COLUMN "trading_day_start_minutes" SET DEFAULT 0,
  ALTER COLUMN "asia_end_minutes" SET DEFAULT 930,
  ALTER COLUMN "london_end_minutes" SET DEFAULT 990,
  ALTER COLUMN "new_york_start_minutes" SET DEFAULT 570,
  ALTER COLUMN "new_york_end_minutes" SET DEFAULT 960;
