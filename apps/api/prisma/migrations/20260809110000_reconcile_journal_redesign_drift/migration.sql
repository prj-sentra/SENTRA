-- Reconcile deployments that applied the journal redesign before its final schema additions.
ALTER TABLE "trade_campaign_images" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);
ALTER TABLE "trade_campaign_images" ALTER COLUMN "upload_id" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "mt5_position_balances" (
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

CREATE INDEX IF NOT EXISTS "mt5_position_balances_account_id_idx" ON "mt5_position_balances"("account_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"mt5_position_balances"'::regclass
      AND conname = 'mt5_position_balances_account_id_fkey'
  ) THEN
    ALTER TABLE "mt5_position_balances"
      ADD CONSTRAINT "mt5_position_balances_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
