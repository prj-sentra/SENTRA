-- Membership changes can occur while a campaign is still open. Keep its cached
-- result stale, but do not create worker work until every member is closed.
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
    AND EXISTS (
      SELECT 1 FROM "campaign_memberships" m WHERE m."campaign_id"=c."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "campaign_memberships" m
      JOIN "trades" t ON t."id"=m."trade_id"
      WHERE m."campaign_id"=c."id" AND t."closed_at" IS NULL
    )
  ON CONFLICT ("scope","target_id") DO UPDATE SET
    "generation"="excursion_work_items"."generation"+1,
    "tick_snapshot_to_msc"=EXCLUDED."tick_snapshot_to_msc",
    "base_input_fingerprint"=EXCLUDED."base_input_fingerprint",
    "reason"='MEMBERSHIP_MUTATED',"state"='PENDING',"not_before"=NULL,
    "claim_id"=NULL,"claim_expires_at"=NULL,"updated_at"=CURRENT_TIMESTAMP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
