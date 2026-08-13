CREATE TYPE "ExcursionStatus" AS ENUM ('SUCCESS', 'STALE', 'FAILED', 'UNSUPPORTED');
CREATE TYPE "ExcursionScope" AS ENUM ('TRADE', 'CAMPAIGN');
CREATE TYPE "ExcursionWorkState" AS ENUM ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'BLOCKED', 'CANCELLED');

CREATE TABLE "trade_excursion_results" (
  "trade_id" TEXT NOT NULL PRIMARY KEY,
  "status" "ExcursionStatus" NOT NULL,
  "attempt_calculation_version" INTEGER NOT NULL,
  "attempt_input_fingerprint" TEXT NOT NULL,
  "last_attempted_at" TIMESTAMP(3) NOT NULL,
  "failure_reason" TEXT,
  "success_calculation_version" INTEGER,
  "success_input_fingerprint" TEXT,
  "last_succeeded_at" TIMESTAMP(3),
  "raw_from_msc" BIGINT, "raw_to_msc" BIGINT,
  "display_from_at" TIMESTAMP(3), "display_to_at" TIMESTAMP(3),
  "tick_snapshot_to_msc" BIGINT, "price_source" TEXT, "path_digest" TEXT,
  "tick_count" INTEGER, "valuation_version" INTEGER, "valuation_digests" JSONB,
  "portfolio_mark_policy" TEXT,
  "mfe_price" NUMERIC(65,30), "mfe_price_mark_price" NUMERIC(65,30), "mfe_price_occurred_at" TIMESTAMP(3),
  "mae_price" NUMERIC(65,30), "mae_price_mark_price" NUMERIC(65,30), "mae_price_occurred_at" TIMESTAMP(3),
  "mfe_percent" NUMERIC(65,30), "mfe_percent_mark_price" NUMERIC(65,30), "mfe_percent_occurred_at" TIMESTAMP(3),
  "mae_percent" NUMERIC(65,30), "mae_percent_mark_price" NUMERIC(65,30), "mae_percent_occurred_at" TIMESTAMP(3),
  "mfe_unrealized_pnl" NUMERIC(65,30), "mfe_unrealized_pnl_occurred_at" TIMESTAMP(3),
  "mae_unrealized_pnl" NUMERIC(65,30), "mae_unrealized_pnl_occurred_at" TIMESTAMP(3),
  "mfe_r" NUMERIC(65,30), "mfe_r_occurred_at" TIMESTAMP(3),
  "mae_r" NUMERIC(65,30), "mae_r_occurred_at" TIMESTAMP(3),
  "capture_rate" NUMERIC(65,30),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trade_excursion_results_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trade_excursion_results_success_provenance_check" CHECK (("success_calculation_version" IS NULL AND "success_input_fingerprint" IS NULL AND "last_succeeded_at" IS NULL) OR ("success_calculation_version" IS NOT NULL AND "success_input_fingerprint" IS NOT NULL AND "last_succeeded_at" IS NOT NULL)),
  CONSTRAINT "trade_excursion_results_status_check" CHECK (("status" = 'SUCCESS' AND "failure_reason" IS NULL AND "success_calculation_version" IS NOT NULL) OR ("status" = 'STALE' AND "failure_reason" IS NOT NULL AND "success_calculation_version" IS NOT NULL) OR ("status" IN ('FAILED', 'UNSUPPORTED') AND "failure_reason" IS NOT NULL AND "success_calculation_version" IS NULL)),
  CONSTRAINT "trade_excursion_results_failed_metrics_check" CHECK ("status" NOT IN ('FAILED', 'UNSUPPORTED') OR ("mfe_price" IS NULL AND "mfe_price_mark_price" IS NULL AND "mae_price" IS NULL AND "mae_price_mark_price" IS NULL AND "mfe_percent" IS NULL AND "mfe_percent_mark_price" IS NULL AND "mae_percent" IS NULL AND "mae_percent_mark_price" IS NULL AND "mfe_unrealized_pnl" IS NULL AND "mae_unrealized_pnl" IS NULL AND "mfe_r" IS NULL AND "mae_r" IS NULL AND "capture_rate" IS NULL)),
  CONSTRAINT "trade_excursion_results_extrema_check" CHECK (("mfe_price" IS NULL) = ("mfe_price_mark_price" IS NULL) AND ("mfe_price" IS NULL) = ("mfe_price_occurred_at" IS NULL) AND ("mae_price" IS NULL) = ("mae_price_mark_price" IS NULL) AND ("mae_price" IS NULL) = ("mae_price_occurred_at" IS NULL) AND ("mfe_percent" IS NULL) = ("mfe_percent_mark_price" IS NULL) AND ("mfe_percent" IS NULL) = ("mfe_percent_occurred_at" IS NULL) AND ("mae_percent" IS NULL) = ("mae_percent_mark_price" IS NULL) AND ("mae_percent" IS NULL) = ("mae_percent_occurred_at" IS NULL) AND ("mfe_unrealized_pnl" IS NULL) = ("mfe_unrealized_pnl_occurred_at" IS NULL) AND ("mae_unrealized_pnl" IS NULL) = ("mae_unrealized_pnl_occurred_at" IS NULL) AND ("mfe_r" IS NULL) = ("mfe_r_occurred_at" IS NULL) AND ("mae_r" IS NULL) = ("mae_r_occurred_at" IS NULL))
);
CREATE INDEX "trade_excursion_results_status_idx" ON "trade_excursion_results"("status");

CREATE TABLE "trade_campaign_excursion_results" (
  "campaign_id" TEXT NOT NULL PRIMARY KEY,
  "status" "ExcursionStatus" NOT NULL,
  "attempt_calculation_version" INTEGER NOT NULL,
  "attempt_input_fingerprint" TEXT NOT NULL,
  "last_attempted_at" TIMESTAMP(3) NOT NULL,
  "failure_reason" TEXT,
  "success_calculation_version" INTEGER, "success_input_fingerprint" TEXT, "last_succeeded_at" TIMESTAMP(3),
  "raw_from_msc" BIGINT, "raw_to_msc" BIGINT, "display_from_at" TIMESTAMP(3), "display_to_at" TIMESTAMP(3),
  "tick_snapshot_to_msc" BIGINT, "price_source" TEXT, "path_digest" TEXT, "tick_count" INTEGER, "valuation_version" INTEGER, "valuation_digests" JSONB, "portfolio_mark_policy" TEXT,
  "price_family_status" "ExcursionStatus" NOT NULL, "price_family_reason" TEXT,
  "pnl_family_status" "ExcursionStatus" NOT NULL, "pnl_family_reason" TEXT, "r_availability" TEXT,
  "mfe_price" NUMERIC(65,30), "mfe_price_mark_price" NUMERIC(65,30), "mfe_price_occurred_at" TIMESTAMP(3), "mae_price" NUMERIC(65,30), "mae_price_mark_price" NUMERIC(65,30), "mae_price_occurred_at" TIMESTAMP(3),
  "mfe_percent" NUMERIC(65,30), "mfe_percent_mark_price" NUMERIC(65,30), "mfe_percent_occurred_at" TIMESTAMP(3), "mae_percent" NUMERIC(65,30), "mae_percent_mark_price" NUMERIC(65,30), "mae_percent_occurred_at" TIMESTAMP(3),
  "mfe_unrealized_pnl" NUMERIC(65,30), "mfe_unrealized_pnl_occurred_at" TIMESTAMP(3), "mae_unrealized_pnl" NUMERIC(65,30), "mae_unrealized_pnl_occurred_at" TIMESTAMP(3),
  "mfe_r" NUMERIC(65,30), "mfe_r_occurred_at" TIMESTAMP(3), "mae_r" NUMERIC(65,30), "mae_r_occurred_at" TIMESTAMP(3), "capture_rate" NUMERIC(65,30),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trade_campaign_excursion_results_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "trade_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trade_campaign_excursion_results_success_provenance_check" CHECK (("success_calculation_version" IS NULL AND "success_input_fingerprint" IS NULL AND "last_succeeded_at" IS NULL) OR ("success_calculation_version" IS NOT NULL AND "success_input_fingerprint" IS NOT NULL AND "last_succeeded_at" IS NOT NULL)),
  CONSTRAINT "trade_campaign_excursion_results_status_check" CHECK (("status" = 'SUCCESS' AND "failure_reason" IS NULL AND "success_calculation_version" IS NOT NULL) OR ("status" = 'STALE' AND "failure_reason" IS NOT NULL AND "success_calculation_version" IS NOT NULL) OR ("status" IN ('FAILED', 'UNSUPPORTED') AND "failure_reason" IS NOT NULL AND "success_calculation_version" IS NULL)),
  CONSTRAINT "trade_campaign_excursion_results_failed_metrics_check" CHECK ("status" NOT IN ('FAILED', 'UNSUPPORTED') OR ("mfe_price" IS NULL AND "mfe_price_mark_price" IS NULL AND "mae_price" IS NULL AND "mae_price_mark_price" IS NULL AND "mfe_percent" IS NULL AND "mfe_percent_mark_price" IS NULL AND "mae_percent" IS NULL AND "mae_percent_mark_price" IS NULL AND "mfe_unrealized_pnl" IS NULL AND "mae_unrealized_pnl" IS NULL AND "mfe_r" IS NULL AND "mae_r" IS NULL AND "capture_rate" IS NULL)),
  CONSTRAINT "trade_campaign_excursion_results_extrema_check" CHECK (("mfe_price" IS NULL) = ("mfe_price_mark_price" IS NULL) AND ("mfe_price" IS NULL) = ("mfe_price_occurred_at" IS NULL) AND ("mae_price" IS NULL) = ("mae_price_mark_price" IS NULL) AND ("mae_price" IS NULL) = ("mae_price_occurred_at" IS NULL) AND ("mfe_percent" IS NULL) = ("mfe_percent_mark_price" IS NULL) AND ("mfe_percent" IS NULL) = ("mfe_percent_occurred_at" IS NULL) AND ("mae_percent" IS NULL) = ("mae_percent_mark_price" IS NULL) AND ("mae_percent" IS NULL) = ("mae_percent_occurred_at" IS NULL) AND ("mfe_unrealized_pnl" IS NULL) = ("mfe_unrealized_pnl_occurred_at" IS NULL) AND ("mae_unrealized_pnl" IS NULL) = ("mae_unrealized_pnl_occurred_at" IS NULL) AND ("mfe_r" IS NULL) = ("mfe_r_occurred_at" IS NULL) AND ("mae_r" IS NULL) = ("mae_r_occurred_at" IS NULL)),
  CONSTRAINT "trade_campaign_excursion_results_r_availability_check" CHECK (("r_availability" = 'available' AND "mfe_r" IS NOT NULL AND "mae_r" IS NOT NULL) OR ("r_availability" = 'risk_unavailable' AND "mfe_r" IS NULL AND "mae_r" IS NULL) OR ("r_availability" IS NULL AND "mfe_r" IS NULL AND "mae_r" IS NULL)),
  CONSTRAINT "trade_campaign_excursion_results_price_family_check" CHECK (("price_family_status" IN ('FAILED', 'UNSUPPORTED') AND "mfe_price" IS NULL AND "mfe_price_mark_price" IS NULL AND "mae_price" IS NULL AND "mae_price_mark_price" IS NULL AND "mfe_percent" IS NULL AND "mfe_percent_mark_price" IS NULL AND "mae_percent" IS NULL AND "mae_percent_mark_price" IS NULL) OR "price_family_status" IN ('SUCCESS', 'STALE')),
  CONSTRAINT "trade_campaign_excursion_results_pnl_family_check" CHECK (("pnl_family_status" IN ('FAILED', 'UNSUPPORTED') AND "mfe_unrealized_pnl" IS NULL AND "mae_unrealized_pnl" IS NULL) OR "pnl_family_status" IN ('SUCCESS', 'STALE'))
);
CREATE INDEX "trade_campaign_excursion_results_status_idx" ON "trade_campaign_excursion_results"("status");
CREATE INDEX "trade_campaign_excursion_results_price_family_status_idx" ON "trade_campaign_excursion_results"("price_family_status");
CREATE INDEX "trade_campaign_excursion_results_pnl_family_status_idx" ON "trade_campaign_excursion_results"("pnl_family_status");

CREATE TABLE "excursion_work_items" (
  "id" TEXT NOT NULL PRIMARY KEY, "scope" "ExcursionScope" NOT NULL, "target_id" TEXT NOT NULL,
  "trade_id" TEXT, "campaign_id" TEXT, "account_id" TEXT NOT NULL, "generation" INTEGER NOT NULL DEFAULT 1,
  "tick_snapshot_to_msc" BIGINT, "base_input_fingerprint" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "state" "ExcursionWorkState" NOT NULL DEFAULT 'PENDING', "not_before" TIMESTAMP(3), "claim_id" TEXT, "claim_expires_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0, "consecutive_failures" INTEGER NOT NULL DEFAULT 0, "manual_retry_epoch" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "excursion_work_items_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "excursion_work_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "trade_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "excursion_work_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "excursion_work_items_scope_target_check" CHECK (("scope" = 'TRADE' AND "trade_id" = "target_id" AND "campaign_id" IS NULL) OR ("scope" = 'CAMPAIGN' AND "campaign_id" = "target_id" AND "trade_id" IS NULL)),
  CONSTRAINT "excursion_work_items_claim_check" CHECK (("state" = 'CLAIMED' AND "claim_id" IS NOT NULL AND "claim_expires_at" IS NOT NULL) OR ("state" <> 'CLAIMED' AND "claim_id" IS NULL AND "claim_expires_at" IS NULL))
);
CREATE UNIQUE INDEX "excursion_work_items_scope_target_id_key" ON "excursion_work_items"("scope", "target_id");
CREATE UNIQUE INDEX "excursion_work_items_claim_id_key" ON "excursion_work_items"("claim_id");
CREATE INDEX "excursion_work_items_state_not_before_claim_expires_at_idx" ON "excursion_work_items"("state", "not_before", "claim_expires_at");
CREATE INDEX "excursion_work_items_account_id_state_idx" ON "excursion_work_items"("account_id", "state");

CREATE TABLE "excursion_work_progress" (
  "work_item_id" TEXT NOT NULL PRIMARY KEY, "generation" INTEGER NOT NULL, "raw_from_msc" BIGINT NOT NULL, "raw_to_msc" BIGINT NOT NULL,
  "next_raw_from_msc" BIGINT NOT NULL, "segment_number" INTEGER NOT NULL DEFAULT 0, "fifo_state" JSONB NOT NULL, "extrema_state" JSONB NOT NULL,
  "portfolio_marks" JSONB, "path_digest_state" TEXT NOT NULL, "completed_chunk_count" INTEGER NOT NULL DEFAULT 0,
  "completed_page_count" INTEGER NOT NULL DEFAULT 0, "completed_tick_count" INTEGER NOT NULL DEFAULT 0, "valuation_digests" JSONB NOT NULL,
  "checkpointed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excursion_work_progress_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "excursion_work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "excursion_work_progress_range_check" CHECK ("raw_from_msc" <= "next_raw_from_msc" AND "next_raw_from_msc" <= "raw_to_msc" + 1)
);
CREATE INDEX "excursion_work_progress_generation_idx" ON "excursion_work_progress"("generation");

CREATE FUNCTION "mark_trade_excursion_stale"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "trade_excursion_results"
  SET "status"='STALE', "failure_reason"='INPUT_MUTATED',
      "last_attempted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
  WHERE "trade_id"=NEW."id" AND "success_calculation_version" IS NOT NULL;
  UPDATE "trade_campaign_excursion_results" r
  SET "status"='STALE', "price_family_status"='STALE', "pnl_family_status"='STALE',
      "failure_reason"='MEMBER_INPUT_MUTATED',
      "price_family_reason"='MEMBER_INPUT_MUTATED', "pnl_family_reason"='MEMBER_INPUT_MUTATED',
      "last_attempted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
  FROM "campaign_memberships" m
  WHERE m."trade_id"=NEW."id" AND r."campaign_id"=m."campaign_id"
    AND r."success_calculation_version" IS NOT NULL;
  INSERT INTO "excursion_work_items"
    ("id","scope","target_id","trade_id","campaign_id","account_id","generation",
     "tick_snapshot_to_msc","base_input_fingerprint","reason","state","created_at","updated_at")
  SELECT md5(random()::text || clock_timestamp()::text), 'TRADE', NEW."id", NEW."id", NULL,
         NEW."mt5_account_id", 1, s."last_successful_snapshot_msc",
         md5(row_to_json(NEW)::text), 'INPUT_MUTATED', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "mt5_sync_status" s
  WHERE s."account_id"=NEW."mt5_account_id" AND s."last_successful_snapshot_msc" IS NOT NULL
  ON CONFLICT ("scope","target_id") DO UPDATE SET
    "generation"="excursion_work_items"."generation"+1,
    "tick_snapshot_to_msc"=EXCLUDED."tick_snapshot_to_msc",
    "base_input_fingerprint"=EXCLUDED."base_input_fingerprint",
    "reason"='INPUT_MUTATED',"state"='PENDING',"not_before"=NULL,
    "claim_id"=NULL,"claim_expires_at"=NULL,"updated_at"=CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;
CREATE TRIGGER "trades_excursion_stale_after_update" AFTER UPDATE ON "trades"
FOR EACH ROW EXECUTE FUNCTION "mark_trade_excursion_stale"();

CREATE FUNCTION "mark_membership_excursion_stale"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE "trade_campaign_excursion_results"
    SET "status"='STALE', "price_family_status"='STALE', "pnl_family_status"='STALE',
        "failure_reason"='MEMBERSHIP_MUTATED',
        "price_family_reason"='MEMBERSHIP_MUTATED', "pnl_family_reason"='MEMBERSHIP_MUTATED',
        "last_attempted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
    WHERE "campaign_id"=OLD."campaign_id" AND "success_calculation_version" IS NOT NULL;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    UPDATE "trade_campaign_excursion_results"
    SET "status"='STALE', "price_family_status"='STALE', "pnl_family_status"='STALE',
        "failure_reason"='MEMBERSHIP_MUTATED',
        "price_family_reason"='MEMBERSHIP_MUTATED', "pnl_family_reason"='MEMBERSHIP_MUTATED',
        "last_attempted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
    WHERE "campaign_id"=NEW."campaign_id" AND "success_calculation_version" IS NOT NULL;
  END IF;
    INSERT INTO "excursion_work_items"
      ("id","scope","target_id","trade_id","campaign_id","account_id","generation",
       "tick_snapshot_to_msc","base_input_fingerprint","reason","state","created_at","updated_at")
    SELECT md5(random()::text || clock_timestamp()::text), 'CAMPAIGN', c."id", NULL, c."id",
           c."mt5_account_id", 1, s."last_successful_snapshot_msc",
           md5(row_to_json(c)::text || clock_timestamp()::text), 'MEMBERSHIP_MUTATED',
           'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "trade_campaigns" c
    JOIN "mt5_sync_status" s ON s."account_id"=c."mt5_account_id"
    JOIN (
      SELECT OLD."campaign_id" AS "campaign_id" WHERE TG_OP <> 'INSERT'
      UNION
      SELECT NEW."campaign_id" AS "campaign_id" WHERE TG_OP <> 'DELETE'
    ) affected ON affected."campaign_id"=c."id"
    WHERE s."last_successful_snapshot_msc" IS NOT NULL
    ON CONFLICT ("scope","target_id") DO UPDATE SET
      "generation"="excursion_work_items"."generation"+1,
      "tick_snapshot_to_msc"=EXCLUDED."tick_snapshot_to_msc",
      "base_input_fingerprint"=EXCLUDED."base_input_fingerprint",
      "reason"='MEMBERSHIP_MUTATED',"state"='PENDING',"not_before"=NULL,
      "claim_id"=NULL,"claim_expires_at"=NULL,"updated_at"=CURRENT_TIMESTAMP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "campaign_memberships_excursion_stale_after_update" AFTER INSERT OR UPDATE OR DELETE ON "campaign_memberships"
FOR EACH ROW EXECUTE FUNCTION "mark_membership_excursion_stale"();

CREATE FUNCTION "mark_account_excursions_stale"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "trade_excursion_results" r
  SET "status"='STALE', "failure_reason"='ACCOUNT_MUTATED',
      "last_attempted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
  FROM "trades" t
  WHERE t."mt5_account_id"=NEW."id" AND r."trade_id"=t."id"
    AND r."success_calculation_version" IS NOT NULL;
  UPDATE "trade_campaign_excursion_results" r
  SET "status"='STALE', "price_family_status"='STALE', "pnl_family_status"='STALE',
      "failure_reason"='ACCOUNT_MUTATED',
      "price_family_reason"='ACCOUNT_MUTATED', "pnl_family_reason"='ACCOUNT_MUTATED',
      "last_attempted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
  FROM "trade_campaigns" c
  WHERE c."mt5_account_id"=NEW."id" AND r."campaign_id"=c."id"
    AND r."success_calculation_version" IS NOT NULL;
  INSERT INTO "excursion_work_items"
    ("id","scope","target_id","trade_id","campaign_id","account_id","generation",
     "tick_snapshot_to_msc","base_input_fingerprint","reason","state","created_at","updated_at")
  SELECT md5(random()::text || clock_timestamp()::text), 'TRADE', t."id", t."id", NULL,
         NEW."id", 1, s."last_successful_snapshot_msc",
         md5(row_to_json(t)::text || row_to_json(NEW)::text), 'ACCOUNT_MUTATED',
         'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "trades" t JOIN "mt5_sync_status" s ON s."account_id"=NEW."id"
  WHERE t."mt5_account_id"=NEW."id" AND t."closed_at" IS NOT NULL
    AND s."last_successful_snapshot_msc" IS NOT NULL
  ON CONFLICT ("scope","target_id") DO UPDATE SET
    "generation"="excursion_work_items"."generation"+1,
    "tick_snapshot_to_msc"=EXCLUDED."tick_snapshot_to_msc",
    "base_input_fingerprint"=EXCLUDED."base_input_fingerprint",
    "reason"='ACCOUNT_MUTATED',"state"='PENDING',"not_before"=NULL,
    "claim_id"=NULL,"claim_expires_at"=NULL,"updated_at"=CURRENT_TIMESTAMP;
  INSERT INTO "excursion_work_items"
    ("id","scope","target_id","trade_id","campaign_id","account_id","generation",
     "tick_snapshot_to_msc","base_input_fingerprint","reason","state","created_at","updated_at")
  SELECT md5(random()::text || clock_timestamp()::text), 'CAMPAIGN', c."id", NULL, c."id",
         NEW."id", 1, s."last_successful_snapshot_msc",
         md5(row_to_json(c)::text || row_to_json(NEW)::text), 'ACCOUNT_MUTATED',
         'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "trade_campaigns" c JOIN "mt5_sync_status" s ON s."account_id"=NEW."id"
  WHERE c."mt5_account_id"=NEW."id" AND s."last_successful_snapshot_msc" IS NOT NULL
  ON CONFLICT ("scope","target_id") DO UPDATE SET
    "generation"="excursion_work_items"."generation"+1,
    "tick_snapshot_to_msc"=EXCLUDED."tick_snapshot_to_msc",
    "base_input_fingerprint"=EXCLUDED."base_input_fingerprint",
    "reason"='ACCOUNT_MUTATED',"state"='PENDING',"not_before"=NULL,
    "claim_id"=NULL,"claim_expires_at"=NULL,"updated_at"=CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;
CREATE TRIGGER "mt5_accounts_excursion_stale_after_update" AFTER UPDATE ON "mt5_accounts"
FOR EACH ROW EXECUTE FUNCTION "mark_account_excursions_stale"();
