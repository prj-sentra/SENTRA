BEGIN;
DO $$
DECLARE legacy_id TEXT := '00000000-0000-0000-0000-000000000001'; trade_id TEXT := md5(random()::text); campaign_key TEXT := md5(random()::text);
BEGIN
  IF (SELECT count(*) FROM "app_users" WHERE "id"=legacy_id AND "legacy_owner" AND "status"='DISABLED') <> 1 THEN RAISE EXCEPTION 'legacy sentinel invalid'; END IF;
  INSERT INTO "trades" ("id","symbol","side","status","createdAt","updatedAt","owner_id") VALUES (trade_id,'MANUAL','long','planned',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,legacy_id);
  IF (SELECT "mt5_account_id" FROM "trades" WHERE "id"=trade_id) IS NOT NULL THEN RAISE EXCEPTION 'manual account must remain null'; END IF;
  INSERT INTO "trade_campaigns" ("id","root_trade_id","trading_date","owner_id","created_at","updated_at") VALUES (campaign_key,trade_id,CURRENT_DATE,legacy_id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  INSERT INTO "campaign_memberships" ("id","campaign_id","trade_id","source","created_at","updated_at") VALUES (md5(trade_id||'m'),campaign_key,trade_id,'manual',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  FOR i IN 0..9 LOOP INSERT INTO "trade_campaign_images" ("id","campaign_id","position","file_name","mime_type","byte_size","content_sha256","width","height","created_at","updated_at") VALUES (md5(i::text||trade_id),campaign_key,i,i||'.png','image/png',i+1,repeat('0',64),1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP); END LOOP;
  UPDATE "trade_campaign_images" image
  SET "position" = CASE image."position" WHEN 0 THEN 1 WHEN 1 THEN 0 ELSE image."position" END
  WHERE image."campaign_id"=campaign_key;
  IF (SELECT image."position" FROM "trade_campaign_images" image WHERE image."campaign_id"=campaign_key AND image."id"=md5('0'||trade_id)) <> 1
    OR (SELECT image."position" FROM "trade_campaign_images" image WHERE image."campaign_id"=campaign_key AND image."id"=md5('1'||trade_id)) <> 0
    THEN RAISE EXCEPTION 'gallery reorder failed'; END IF;
  BEGIN INSERT INTO "trade_campaign_images" ("id","campaign_id","position","file_name","mime_type","byte_size","content_sha256","width","height","created_at","updated_at") VALUES (md5('overflow'||trade_id),campaign_key,10,'overflow.png','image/png',1,repeat('0',64),1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP); RAISE EXCEPTION 'accepted >10 images'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO "mt5_accounts" ("id","owner_id","nickname","canonical_server","account_login","credential_ciphertext","credential_iv","credential_tag","updated_at") VALUES (md5('bad'||trade_id),legacy_id,'bad',' Broker  Server ',1,'\\x01','\\x02','\\x03',CURRENT_TIMESTAMP); RAISE EXCEPTION 'accepted noncanonical server'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
