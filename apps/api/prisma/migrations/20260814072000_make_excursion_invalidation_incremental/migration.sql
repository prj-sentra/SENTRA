-- MT5 projection upserts every historical trade after a verified ledger rebuild.
-- Only excursion inputs, not a no-op UPDATE or updated_at churn, invalidate results.
ALTER TABLE "mt5_sync_status"
ADD COLUMN "excursion_dirty_position_ids" JSONB;

-- Sync records dirty position ids durably across pages and publishes canonical
-- versioned work at the final page. The trigger only invalidates cached results;
-- it must not race the sync with an incompatible row_to_json/MD5 work key.
CREATE OR REPLACE FUNCTION "mark_trade_excursion_stale"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "trades_excursion_stale_after_update" ON "trades";

CREATE TRIGGER "trades_excursion_stale_after_update"
AFTER UPDATE OF
  "mt5_account_id",
  "mt5_position_id",
  "symbol",
  "side",
  "status",
  "quantity_lots",
  "entry_price",
  "exit_price",
  "realized_pnl",
  "opened_at",
  "closed_at",
  "risk_amount",
  "risk_percent",
  "initial_plan_id",
  "initial_plan_metric_contract_version",
  "mt5_source_missing_at"
ON "trades"
FOR EACH ROW
WHEN (
  OLD."mt5_account_id" IS DISTINCT FROM NEW."mt5_account_id"
  OR OLD."mt5_position_id" IS DISTINCT FROM NEW."mt5_position_id"
  OR OLD."symbol" IS DISTINCT FROM NEW."symbol"
  OR OLD."side" IS DISTINCT FROM NEW."side"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."quantity_lots" IS DISTINCT FROM NEW."quantity_lots"
  OR OLD."entry_price" IS DISTINCT FROM NEW."entry_price"
  OR OLD."exit_price" IS DISTINCT FROM NEW."exit_price"
  OR OLD."realized_pnl" IS DISTINCT FROM NEW."realized_pnl"
  OR OLD."opened_at" IS DISTINCT FROM NEW."opened_at"
  OR OLD."closed_at" IS DISTINCT FROM NEW."closed_at"
  OR OLD."risk_amount" IS DISTINCT FROM NEW."risk_amount"
  OR OLD."risk_percent" IS DISTINCT FROM NEW."risk_percent"
  OR OLD."initial_plan_id" IS DISTINCT FROM NEW."initial_plan_id"
  OR OLD."initial_plan_metric_contract_version" IS DISTINCT FROM NEW."initial_plan_metric_contract_version"
  OR OLD."mt5_source_missing_at" IS DISTINCT FROM NEW."mt5_source_missing_at"
)
EXECUTE FUNCTION "mark_trade_excursion_stale"();

-- Membership edits may happen outside MT5 synchronization, so they still queue
-- immediate work. Use a versioned fingerprint namespace that the worker and
-- final sync both recognize, rather than an unversioned MD5 cache key.
CREATE OR REPLACE FUNCTION "mark_membership_excursion_stale"() RETURNS trigger LANGUAGE plpgsql AS $$
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
         'excursion-trigger-v1:calc-1:' || md5(row_to_json(c)::text || clock_timestamp()::text),
         'MEMBERSHIP_MUTATED', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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

-- Account metadata and credential updates do not change historical price paths.
-- Time-correction changes are projected onto trades/deals and are invalidated by
-- the relevant-column trade trigger plus final-sync dirty-position tracking.
DROP TRIGGER IF EXISTS "mt5_accounts_excursion_stale_after_update" ON "mt5_accounts";
