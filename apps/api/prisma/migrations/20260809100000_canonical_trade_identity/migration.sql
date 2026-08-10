-- Canonical server identity is the MT5 fact key; exact server remains a display/bridge value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "trades"
    WHERE "mt5_server_canonical" IS NOT NULL AND "mt5_account_login" IS NOT NULL AND "mt5_position_id" IS NOT NULL
    GROUP BY "mt5_server_canonical", "mt5_account_login", "mt5_position_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize Trade identity: canonical server/login/position collisions exist';
  END IF;
END $$;
DROP INDEX IF EXISTS "trades_mt5_server_mt5_account_login_mt5_position_id_key";
CREATE UNIQUE INDEX "trades_mt5_server_canonical_mt5_account_login_mt5_position_id_key"
  ON "trades"("mt5_server_canonical", "mt5_account_login", "mt5_position_id");
