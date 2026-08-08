-- Secure multi-owner MT5 identity and lossless campaign-gallery cutover.
CREATE TYPE "AppUserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');
CREATE TYPE "UserStateAuditAction" AS ENUM ('APPROVE', 'REJECT', 'DISABLE', 'ENABLE', 'RESET_PASSWORD', 'BOOTSTRAP');

CREATE TABLE "app_users" (
  "id" TEXT NOT NULL, "username" TEXT NOT NULL, "normalized_username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL, "status" "AppUserStatus" NOT NULL DEFAULT 'PENDING',
  "is_admin" BOOLEAN NOT NULL DEFAULT false, "legacy_owner" BOOLEAN NOT NULL DEFAULT false,
  "bootstrap_completed_at" TIMESTAMP(3), "approved_at" TIMESTAMP(3), "approved_by_id" TEXT,
  "disabled_at" TIMESTAMP(3), "disabled_by_id" TEXT, "state_version" INTEGER NOT NULL DEFAULT 0,
  "credential_version" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_users_normalized_username_key" ON "app_users"("normalized_username");
CREATE INDEX "app_users_status_created_at_idx" ON "app_users"("status", "created_at");
INSERT INTO "app_users" ("id", "username", "normalized_username", "password_hash", "status", "legacy_owner", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', '__legacy_owner__', '__legacy_owner__', '!unusable!', 'DISABLED', true, CURRENT_TIMESTAMP);
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT;
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_disabled_by_id_fkey" FOREIGN KEY ("disabled_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT;

CREATE TABLE "app_sessions" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "token_digest" BYTEA NOT NULL, "user_state_version" INTEGER NOT NULL, "credential_version" INTEGER NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "revoked_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "app_sessions_token_digest_key" ON "app_sessions"("token_digest");
CREATE INDEX "app_sessions_user_id_expires_at_idx" ON "app_sessions"("user_id", "expires_at");
CREATE INDEX "app_sessions_expires_at_revoked_at_idx" ON "app_sessions"("expires_at", "revoked_at");
CREATE TABLE "login_throttles" ("key_digest" BYTEA PRIMARY KEY, "failures" INTEGER NOT NULL DEFAULT 0, "blocked_until" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL);
CREATE TABLE "signup_throttles" ("key_digest" BYTEA PRIMARY KEY, "attempts" INTEGER NOT NULL DEFAULT 0, "blocked_until" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL);
CREATE TABLE "user_state_audits" ("id" TEXT PRIMARY KEY, "actor_id" TEXT NOT NULL, "subject_id" TEXT NOT NULL, "action" "UserStateAuditAction" NOT NULL, "from_status" "AppUserStatus", "to_status" "AppUserStatus", "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE RESTRICT, FOREIGN KEY ("subject_id") REFERENCES "app_users"("id") ON DELETE RESTRICT);
CREATE INDEX "user_state_audits_subject_id_created_at_idx" ON "user_state_audits"("subject_id", "created_at");
CREATE INDEX "user_state_audits_actor_id_created_at_idx" ON "user_state_audits"("actor_id", "created_at");

-- Canonical identity contract (kept in lockstep with canonicalizeServer):
-- trim, collapse SQL whitespace to one ASCII space, then lowercase.  The
-- migration rejects distinct legacy spellings that collapse to one identity
-- instead of silently coalescing their histories.
CREATE FUNCTION canonical_mt5_server(TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN translate(btrim(regexp_replace(normalize($1, NFKC), E'[\t\n\f\r ]+', ' ', 'g'), E' \t\n\f\r'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
-- Fail closed before rewriting any broker identity.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "trades" WHERE "mt5_account_login" IS NOT NULL AND ("mt5_account_login" <= 0 OR "mt5_account_login" > 9007199254740991 OR "mt5_server" IS NULL OR btrim("mt5_server") = ''))
    OR EXISTS (SELECT 1 FROM "mt5_deals" WHERE "account_login" <= 0 OR "account_login" > 9007199254740991 OR btrim("server") = '')
    OR EXISTS (SELECT 1 FROM "mt5_orders" WHERE "account_login" <= 0 OR "account_login" > 9007199254740991 OR btrim("server") = '')
    OR EXISTS (SELECT 1 FROM "mt5_sync_status" WHERE "account_login" <= 0 OR "account_login" > 9007199254740991 OR btrim("server") = '') THEN
    RAISE EXCEPTION 'invalid MT5 identity requires remediation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT canonical_mt5_server("server") canonical_server, "account_login", count(DISTINCT "server") spellings
      FROM (
        SELECT "server", "account_login" FROM "mt5_deals"
        UNION ALL SELECT "server", "account_login" FROM "mt5_orders"
        UNION ALL SELECT "server", "account_login" FROM "mt5_sync_status"
        UNION ALL SELECT "mt5_server", "mt5_account_login" FROM "trades"
          WHERE "mt5_server" IS NOT NULL AND "mt5_account_login" IS NOT NULL
      ) identities
      GROUP BY 1, 2
      HAVING count(DISTINCT "server") > 1
    ) collision
  ) THEN
    RAISE EXCEPTION 'canonical MT5 identity collision requires remediation';
  END IF;
END $$;
ALTER TABLE "mt5_sync_status" ADD COLUMN "cursor" TEXT;

CREATE TABLE "mt5_accounts" ("id" TEXT PRIMARY KEY, "owner_id" TEXT NOT NULL, "nickname" TEXT NOT NULL, "canonical_server" TEXT NOT NULL, "account_login" BIGINT NOT NULL, "credential_ciphertext" BYTEA NOT NULL, "credential_iv" BYTEA NOT NULL, "credential_tag" BYTEA NOT NULL, "credential_version" INTEGER NOT NULL DEFAULT 1, "active" BOOLEAN NOT NULL DEFAULT true, "replaced_by_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CHECK ("account_login" > 0 AND "account_login" <= 9007199254740991), CHECK ("canonical_server" = canonical_mt5_server("canonical_server") AND "canonical_server" <> ''), FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT, FOREIGN KEY ("replaced_by_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT);
CREATE UNIQUE INDEX "mt5_accounts_canonical_server_account_login_key" ON "mt5_accounts"("canonical_server", "account_login");
CREATE INDEX "mt5_accounts_owner_id_active_idx" ON "mt5_accounts"("owner_id", "active");
INSERT INTO "mt5_accounts" ("id", "owner_id", "nickname", "canonical_server", "account_login", "credential_ciphertext", "credential_iv", "credential_tag", "active", "updated_at")
SELECT md5(s || ':' || l::text), '00000000-0000-0000-0000-000000000001', s || ' ' || l::text, s, l, '\x00', '\x00', '\x00', false, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT canonical_mt5_server("server") s, "account_login" l FROM (SELECT "server", "account_login" FROM "mt5_deals" UNION ALL SELECT "server", "account_login" FROM "mt5_orders" UNION ALL SELECT "server", "account_login" FROM "mt5_sync_status" UNION ALL SELECT "mt5_server", "mt5_account_login" FROM "trades" WHERE "mt5_server" IS NOT NULL AND "mt5_account_login" IS NOT NULL) identities) i;
CREATE TABLE "mt5_sync_leases" ("account_id" TEXT PRIMARY KEY, "lease_id" TEXT NOT NULL UNIQUE, "claimed_at" TIMESTAMP(3) NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, CHECK ("expires_at" > "claimed_at"), FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE CASCADE);
CREATE INDEX "mt5_sync_leases_expires_at_idx" ON "mt5_sync_leases"("expires_at");

ALTER TABLE "trades" ADD COLUMN "owner_id" TEXT;
ALTER TABLE "trades" ADD COLUMN "mt5_account_id" TEXT;
UPDATE "trades" t SET "owner_id" = '00000000-0000-0000-0000-000000000001', "mt5_account_id" = a."id" FROM "mt5_accounts" a WHERE a."canonical_server" = canonical_mt5_server(t."mt5_server") AND a."account_login" = t."mt5_account_login";
UPDATE "trades" SET "owner_id" = '00000000-0000-0000-0000-000000000001' WHERE "owner_id" IS NULL;
ALTER TABLE "trades" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "trades" ADD FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT;
ALTER TABLE "trades" ADD FOREIGN KEY ("mt5_account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT;
CREATE INDEX "trades_owner_id_mt5_account_id_idx" ON "trades"("owner_id", "mt5_account_id");

ALTER TABLE "mt5_deals" ADD COLUMN "account_id" TEXT;
UPDATE "mt5_deals" d SET "server" = a."canonical_server", "account_id" = a."id" FROM "mt5_accounts" a WHERE a."canonical_server" = canonical_mt5_server(d."server") AND a."account_login" = d."account_login";
ALTER TABLE "mt5_deals" ALTER COLUMN "account_id" SET NOT NULL; ALTER TABLE "mt5_deals" ADD FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT; CREATE INDEX "mt5_deals_account_id_idx" ON "mt5_deals"("account_id");
ALTER TABLE "mt5_orders" ADD COLUMN "account_id" TEXT;
UPDATE "mt5_orders" o SET "server" = a."canonical_server", "account_id" = a."id" FROM "mt5_accounts" a WHERE a."canonical_server" = canonical_mt5_server(o."server") AND a."account_login" = o."account_login";
ALTER TABLE "mt5_orders" ALTER COLUMN "account_id" SET NOT NULL; ALTER TABLE "mt5_orders" ADD FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT; CREATE INDEX "mt5_orders_account_id_idx" ON "mt5_orders"("account_id");
ALTER TABLE "mt5_sync_status" ADD COLUMN "account_id" TEXT;
UPDATE "mt5_sync_status" s SET "server" = a."canonical_server", "account_id" = a."id" FROM "mt5_accounts" a WHERE a."canonical_server" = canonical_mt5_server(s."server") AND a."account_login" = s."account_login";
ALTER TABLE "mt5_sync_status" ALTER COLUMN "account_id" SET NOT NULL; ALTER TABLE "mt5_sync_status" ADD FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT; CREATE UNIQUE INDEX "mt5_sync_status_account_id_key" ON "mt5_sync_status"("account_id");

ALTER TABLE "trade_campaigns" ADD COLUMN "owner_id" TEXT; ALTER TABLE "trade_campaigns" ADD COLUMN "mt5_account_id" TEXT;
UPDATE "trade_campaigns" c SET "owner_id" = t."owner_id", "mt5_account_id" = t."mt5_account_id" FROM "trades" t WHERE t."id" = c."root_trade_id";
ALTER TABLE "trade_campaigns" ALTER COLUMN "owner_id" SET NOT NULL; ALTER TABLE "trade_campaigns" ADD FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT; ALTER TABLE "trade_campaigns" ADD FOREIGN KEY ("mt5_account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT;
CREATE INDEX "trade_campaigns_owner_id_mt5_account_id_trading_date_idx" ON "trade_campaigns"("owner_id", "mt5_account_id", "trading_date");

-- Resolve each legacy image to exactly one campaign. Timestamped zero mappings get a deterministic singleton.
CREATE TEMP TABLE image_map AS
SELECT i."id" image_id, i."trade_id", count(DISTINCT candidate.campaign_id) campaign_count, min(candidate.campaign_id) campaign_id
FROM "trade_chart_images" i
LEFT JOIN LATERAL (
  SELECT c."id" campaign_id FROM "trade_campaigns" c WHERE c."root_trade_id"=i."trade_id"
  UNION
  SELECT m."campaign_id" FROM "campaign_memberships" m WHERE m."trade_id"=i."trade_id"
) candidate ON true
GROUP BY i."id", i."trade_id";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM image_map WHERE campaign_count > 1) THEN RAISE EXCEPTION 'legacy image maps to multiple campaigns'; END IF;
  IF EXISTS (SELECT 1 FROM image_map im JOIN "trades" t ON t."id"=im.trade_id WHERE campaign_count=0 AND t."opened_at" IS NULL) THEN RAISE EXCEPTION 'legacy image has no campaign and no opened_at'; END IF;
  IF to_regclass('public.legacy_trade_chart_image_file_manifest') IS NULL THEN RAISE EXCEPTION 'legacy image file manifest required'; END IF;
  IF to_regclass('public.legacy_trade_chart_image_file_manifest') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM "trade_chart_images" i
      FULL JOIN "legacy_trade_chart_image_file_manifest" f ON f."image_id"=i."id"
      WHERE i."id" IS NULL OR f."image_id" IS NULL
        OR f."file_name" IS DISTINCT FROM i."file_name"
        OR f."byte_size" IS DISTINCT FROM i."byte_size"
        OR f."sha256" !~ '^[0-9a-f]{64}$'
    ) THEN RAISE EXCEPTION 'legacy image file manifest reconciliation failed'; END IF;
    IF EXISTS (SELECT 1 FROM "legacy_trade_chart_image_file_manifest" GROUP BY "image_id" HAVING count(*) <> 1)
      THEN RAISE EXCEPTION 'legacy image file manifest reconciliation failed'; END IF;
  END IF;
END $$;
INSERT INTO "trade_campaigns" ("id", "root_trade_id", "trading_date", "owner_id", "mt5_account_id", "created_at", "updated_at") SELECT md5(im.trade_id || ':secure-gallery'), im.trade_id, ((t."opened_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date, t."owner_id", t."mt5_account_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM image_map im JOIN "trades" t ON t."id"=im.trade_id WHERE im.campaign_count=0;
INSERT INTO "campaign_memberships" ("id", "campaign_id", "trade_id", "source", "created_at", "updated_at") SELECT md5(im.trade_id || ':secure-gallery-member'), md5(im.trade_id || ':secure-gallery'), im.trade_id, 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM image_map im WHERE im.campaign_count=0 ON CONFLICT ("trade_id") DO NOTHING;
UPDATE image_map im SET campaign_id = COALESCE((SELECT c."id" FROM "trade_campaigns" c WHERE c."root_trade_id"=im.trade_id), (SELECT m."campaign_id" FROM "campaign_memberships" m WHERE m."trade_id"=im.trade_id));
CREATE TABLE "trade_campaign_images" ("id" TEXT PRIMARY KEY, "campaign_id" TEXT NOT NULL, "position" INTEGER NOT NULL, "file_name" TEXT NOT NULL, "mime_type" TEXT NOT NULL, "byte_size" INTEGER NOT NULL, "content_sha256" TEXT NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "original_name" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CHECK ("position" >= 0 AND "position" < 10), CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'), FOREIGN KEY ("campaign_id") REFERENCES "trade_campaigns"("id") ON DELETE CASCADE);
ALTER TABLE "trade_campaign_images" ADD CONSTRAINT "trade_campaign_images_campaign_id_position_key" UNIQUE ("campaign_id", "position") DEFERRABLE INITIALLY DEFERRED;
INSERT INTO "trade_campaign_images" SELECT i."id", im.campaign_id, row_number() OVER (PARTITION BY im.campaign_id ORDER BY CASE WHEN c."root_trade_id"=i."trade_id" THEN 0 ELSE 1 END, i."created_at", i."id")-1, i."file_name", i."mime_type", i."byte_size", f."sha256", i."width", i."height", i."original_name", i."created_at", i."updated_at" FROM "trade_chart_images" i JOIN image_map im ON im.image_id=i."id" JOIN "trade_campaigns" c ON c."id"=im.campaign_id JOIN "legacy_trade_chart_image_file_manifest" f ON f."image_id"=i."id";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "trade_campaign_images" GROUP BY "campaign_id" HAVING count(*)>10) THEN RAISE EXCEPTION 'campaign gallery exceeds ten images'; END IF;
  IF (SELECT count(*) FROM "trade_chart_images") <> (SELECT count(*) FROM "trade_campaign_images") THEN RAISE EXCEPTION 'image count reconciliation failed'; END IF;
  IF EXISTS (SELECT 1 FROM "trade_chart_images" s JOIN "legacy_trade_chart_image_file_manifest" f ON f."image_id"=s."id" LEFT JOIN "trade_campaign_images" d ON d."id"=s."id" WHERE d."id" IS NULL OR (s."file_name",s."mime_type",s."byte_size",f."sha256",s."width",s."height",s."original_name",s."created_at",s."updated_at") IS DISTINCT FROM (d."file_name",d."mime_type",d."byte_size",d."content_sha256",d."width",d."height",d."original_name",d."created_at",d."updated_at")) THEN RAISE EXCEPTION 'image metadata reconciliation failed'; END IF;
END $$;
ALTER TABLE "legacy_trade_chart_image_file_manifest" RENAME TO "secure_gallery_file_migration_audit";
DROP TABLE "trade_chart_images";

CREATE FUNCTION enforce_campaign_trade_scope() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE co TEXT; ca TEXT; tor TEXT; ta TEXT; BEGIN IF TG_TABLE_NAME='trade_campaigns' THEN SELECT "owner_id","mt5_account_id" INTO tor,ta FROM "trades" WHERE "id"=NEW."root_trade_id"; IF (tor,ta) IS DISTINCT FROM (NEW."owner_id",NEW."mt5_account_id") THEN RAISE EXCEPTION 'campaign root scope mismatch'; END IF; ELSE SELECT "owner_id","mt5_account_id" INTO co,ca FROM "trade_campaigns" WHERE "id"=NEW."campaign_id"; SELECT "owner_id","mt5_account_id" INTO tor,ta FROM "trades" WHERE "id"=NEW."trade_id"; IF (tor,ta) IS DISTINCT FROM (co,ca) THEN RAISE EXCEPTION 'campaign member scope mismatch'; END IF; END IF; RETURN NEW; END $$;
CREATE TRIGGER campaign_scope BEFORE INSERT OR UPDATE ON "trade_campaigns" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_trade_scope();
CREATE TRIGGER campaign_member_scope BEFORE INSERT OR UPDATE ON "campaign_memberships" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_trade_scope();
