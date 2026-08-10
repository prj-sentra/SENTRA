-- Forward-only redesign. Complete every incompatible ALTER before backfill DML: PostgreSQL
-- rejects ALTER TABLE while deferred trigger events from preceding DML are pending.
ALTER TABLE "trades" ADD COLUMN "mt5_server_canonical" TEXT;
ALTER TABLE "mt5_accounts" ADD COLUMN "server" TEXT NOT NULL DEFAULT '';
ALTER TABLE "trade_analyses" ADD COLUMN "note" TEXT DEFAULT E'진입 근거:\n청산 근거:\nTP 설정 근거:\nSL 설정 근거:';
-- The temporary default makes the column non-null before legacy rows are backfilled.
-- Product writes always provide a UUID, and the post-backfill unique index prevents reuse.
ALTER TABLE "trade_campaign_images" ADD COLUMN "upload_id" TEXT NOT NULL DEFAULT '', ADD COLUMN "published_at" TIMESTAMP(3);

CREATE TABLE "trade_analysis_archives" (
  "id" TEXT NOT NULL, "trade_id" TEXT NOT NULL, "source" TEXT NOT NULL, "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_analysis_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trade_analysis_archives_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "trade_analyses"
    WHERE ("base_timeframe" IS NOT NULL AND lower(btrim("base_timeframe")) NOT IN ('m1','1m','m5','5m','m15','15m','m30','30m','h1','1h','h4','4h','d1','1d','w1','1w','mn1','1mn'))
       OR ("chart_pattern_timeframe" IS NOT NULL AND lower(btrim("chart_pattern_timeframe")) NOT IN ('m1','1m','m5','5m','m15','15m','m30','30m','h1','1h','h4','4h','d1','1d','w1','1w','mn1','1mn'))
  ) THEN
    RAISE EXCEPTION 'Unknown analysis timeframe mapping';
  END IF;
END $$;
UPDATE "trade_analyses"
SET "base_timeframe" = CASE lower(btrim("base_timeframe"))
  WHEN 'm1' THEN '1m' WHEN '1m' THEN '1m'
  WHEN 'm5' THEN '5m' WHEN '5m' THEN '5m'
  WHEN 'm15' THEN '15m' WHEN '15m' THEN '15m'
  WHEN 'm30' THEN '30m' WHEN '30m' THEN '30m'
  WHEN 'h1' THEN '1h' WHEN '1h' THEN '1h'
  WHEN 'h4' THEN '4h' WHEN '4h' THEN '4h'
  WHEN 'd1' THEN '1D' WHEN '1d' THEN '1D'
  WHEN 'w1' THEN '1W' WHEN '1w' THEN '1W'
  WHEN 'mn1' THEN '1MN' WHEN '1mn' THEN '1MN'
END,
"chart_pattern_timeframe" = CASE lower(btrim("chart_pattern_timeframe"))
  WHEN 'm1' THEN '1m' WHEN '1m' THEN '1m'
  WHEN 'm5' THEN '5m' WHEN '5m' THEN '5m'
  WHEN 'm15' THEN '15m' WHEN '15m' THEN '15m'
  WHEN 'm30' THEN '30m' WHEN '30m' THEN '30m'
  WHEN 'h1' THEN '1h' WHEN '1h' THEN '1h'
  WHEN 'h4' THEN '4h' WHEN '4h' THEN '4h'
  WHEN 'd1' THEN '1D' WHEN '1d' THEN '1D'
  WHEN 'w1' THEN '1W' WHEN '1w' THEN '1W'
  WHEN 'mn1' THEN '1MN' WHEN '1mn' THEN '1MN'
END;
-- Backfill only after all ALTER TABLE statements above. This remains lossless: every
-- non-null authored source is copied to its immutable source-labelled archive row.
UPDATE "trades" SET "mt5_server_canonical" = lower(btrim("mt5_server")) WHERE "mt5_server" IS NOT NULL;
UPDATE "mt5_accounts" SET "server" = "canonical_server" WHERE "server" = '';
UPDATE "trade_analyses" a
SET "note" = concat_ws(E'\n\n',
  CASE WHEN t."entry_rationale" IS NOT NULL THEN E'진입 근거:\n' || t."entry_rationale" END,
  CASE WHEN t."exit_rationale" IS NOT NULL THEN E'청산 근거:\n' || t."exit_rationale" END,
  CASE WHEN t."take_profit_criteria" IS NOT NULL THEN E'TP 설정 근거:\n' || t."take_profit_criteria" END,
  CASE WHEN t."stop_loss_criteria" IS NOT NULL THEN E'SL 설정 근거:\n' || t."stop_loss_criteria" END,
  CASE WHEN e."note" IS NOT NULL THEN E'진입 기록:\n' || e."note" END,
  CASE WHEN x."note" IS NOT NULL THEN E'청산 기록:\n' || x."note" END,
  CASE WHEN t."strategy" IS NOT NULL THEN E'전략:\n' || t."strategy" END,
  CASE WHEN t."thesis" IS NOT NULL THEN E'매매 가설:\n' || t."thesis" END,
  CASE WHEN t."note" IS NOT NULL THEN E'기타 기록:\n' || t."note" END,
  CASE WHEN a."cross" = 'none' THEN E'이동평균선 크로스:\n크로스 없음' END
) FROM "trades" t LEFT JOIN "trade_entries" e ON e."tradeId" = t."id" LEFT JOIN "trade_exits" x ON x."tradeId" = t."id"
WHERE a."trade_id" = t."id";
UPDATE "trade_analyses" SET "note" = E'진입 근거:\n청산 근거:\nTP 설정 근거:\nSL 설정 근거:' WHERE "note" IS NULL;
INSERT INTO "trade_analysis_archives" ("id", "trade_id", "source", "content")
SELECT md5(t."id" || ':' || src.source), t."id", src.source, src.content
FROM "trades" t CROSS JOIN LATERAL (VALUES
 ('strategy', t."strategy"), ('thesis', t."thesis"), ('entry_rationale', t."entry_rationale"), ('exit_rationale', t."exit_rationale"), ('take_profit_criteria', t."take_profit_criteria"), ('stop_loss_criteria', t."stop_loss_criteria"), ('note', t."note")
) AS src(source, content) WHERE src.content IS NOT NULL;
INSERT INTO "trade_analysis_archives" ("id", "trade_id", "source", "content")
SELECT md5(e."tradeId" || ':entry_note'), e."tradeId", 'entry_note', e."note"
FROM "trade_entries" e WHERE e."note" IS NOT NULL;
INSERT INTO "trade_analysis_archives" ("id", "trade_id", "source", "content")
SELECT md5(e."tradeId" || ':exit_note'), e."tradeId", 'exit_note', e."note"
FROM "trade_exits" e WHERE e."note" IS NOT NULL;
INSERT INTO "trade_analysis_archives" ("id", "trade_id", "source", "content")
SELECT md5(a."trade_id" || ':cross'), a."trade_id", 'cross', 'none'
FROM "trade_analyses" a WHERE a."cross" = 'none';
UPDATE "trade_analyses" SET "cross" = NULL WHERE "cross" = 'none';
UPDATE "trade_campaign_images" SET "upload_id" = "id" WHERE "upload_id" = '';
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "trade_campaign_images" ALTER COLUMN "upload_id" DROP DEFAULT;

CREATE TABLE "mt5_position_balances" (
  "account_id" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "account_login" BIGINT NOT NULL,
  "position_id" BIGINT NOT NULL,
  "pre_entry_balance" DECIMAL NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mt5_position_balances_pkey" PRIMARY KEY ("server","account_login","position_id"),
  CONSTRAINT "mt5_position_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "mt5_position_balances_account_id_idx" ON "mt5_position_balances"("account_id");
-- These are index builds, not ALTER TABLE; they run after every backfill row is unique.
CREATE UNIQUE INDEX "trade_analysis_archives_trade_id_source_key" ON "trade_analysis_archives"("trade_id", "source");
CREATE UNIQUE INDEX "trade_campaign_images_campaign_id_upload_id_key" ON "trade_campaign_images"("campaign_id", "upload_id");
CREATE UNIQUE INDEX "trade_campaign_images_file_name_key" ON "trade_campaign_images"("file_name");
