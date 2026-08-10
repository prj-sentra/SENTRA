-- Replace v2 balance estimates with immutable v3 position-entry assertions.
CREATE TYPE "Mt5PositionEntryBalanceState" AS ENUM ('PROVEN', 'UNSUPPORTED_ANCHORED', 'UNSUPPORTED_UNANCHORED');
CREATE TYPE "Mt5PositionEntryBalanceReason" AS ENUM ('UNSUPPORTED_INOUT', 'UNSUPPORTED_ACCOUNT_NOT_APPROVED', 'UNSUPPORTED_CHECKPOINT', 'OPENING_DEAL_OUTSIDE_HISTORY');

-- A legacy MT5 seed has no v3 anchor.  Preserve manual/non-MT5 seeds and all identity rows.
UPDATE "trades"
SET "seed_balance" = NULL
WHERE "mt5_server_canonical" IS NOT NULL
  AND "mt5_account_login" IS NOT NULL
  AND "mt5_position_id" IS NOT NULL;

DROP TABLE IF EXISTS "mt5_position_balances";

CREATE TABLE "mt5_position_entry_balances" (
  "account_id" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "account_login" BIGINT NOT NULL,
  "position_id" BIGINT NOT NULL,
  "entry_deal_ticket" BIGINT,
  "entry_order_ticket" BIGINT,
  "entry_time_msc" BIGINT,
  "entry_time_msc_utc" TIMESTAMP(3),
  "ledger_semantics_version" INTEGER NOT NULL,
  "state" "Mt5PositionEntryBalanceState" NOT NULL,
  "pre_entry_balance" DECIMAL(65,30),
  "reason" "Mt5PositionEntryBalanceReason",
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mt5_position_entry_balances_pkey" PRIMARY KEY ("server", "account_login", "position_id"),
  CONSTRAINT "mt5_position_entry_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mt5_position_entry_balances_anchor_fkey" FOREIGN KEY ("server", "account_login", "entry_deal_ticket") REFERENCES "mt5_deals"("server", "account_login", "ticket") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mt5_position_entry_balances_state_check" CHECK (
    ("state" = 'PROVEN' AND "entry_deal_ticket" IS NOT NULL AND "entry_order_ticket" IS NOT NULL AND "entry_time_msc" IS NOT NULL AND "entry_time_msc_utc" IS NOT NULL AND "pre_entry_balance" IS NOT NULL AND "reason" IS NULL)
    OR ("state" = 'UNSUPPORTED_ANCHORED' AND "entry_deal_ticket" IS NOT NULL AND "entry_order_ticket" IS NOT NULL AND "entry_time_msc" IS NOT NULL AND "entry_time_msc_utc" IS NOT NULL AND "pre_entry_balance" IS NULL AND "reason" IS NOT NULL AND "reason" <> 'OPENING_DEAL_OUTSIDE_HISTORY')
    OR ("state" = 'UNSUPPORTED_UNANCHORED' AND "entry_deal_ticket" IS NULL AND "entry_order_ticket" IS NULL AND "entry_time_msc" IS NULL AND "entry_time_msc_utc" IS NULL AND "pre_entry_balance" IS NULL AND "reason" = 'OPENING_DEAL_OUTSIDE_HISTORY')
  )
);
CREATE INDEX "mt5_position_entry_balances_account_id_idx" ON "mt5_position_entry_balances"("account_id");
CREATE INDEX "mt5_position_entry_balances_anchor_idx" ON "mt5_position_entry_balances"("server", "account_login", "entry_deal_ticket");
