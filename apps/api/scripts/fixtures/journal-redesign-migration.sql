-- Deterministic predecessor state for verify-journal-redesign-migration.ts.
INSERT INTO "app_users" ("id","username","normalized_username","password_hash","status","is_admin","legacy_owner","created_at","updated_at") VALUES
  ('journal-owner','journal-owner','journal-owner','fixture','ACTIVE',false,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO "trades" ("id","symbol","side","status","owner_id","createdAt","updatedAt","opened_at","strategy","note") VALUES
  ('legacy-cross-none','EURUSD','long','closed','journal-owner',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'breakout','retain prose');
INSERT INTO "trade_analyses" ("id","trade_id","base_timeframe","cross","updated_at") VALUES
  ('journal-analysis','legacy-cross-none',' H1 ','none',CURRENT_TIMESTAMP);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "trade_analyses" WHERE "trade_id" = 'legacy-cross-none' AND "cross" = 'none') THEN
    RAISE EXCEPTION 'legacy cross NONE fixture was not applied';
  END IF;
END $$;
