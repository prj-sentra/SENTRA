CREATE TYPE "Mt5BalanceLedgerStatus" AS ENUM ('VERIFIED', 'DIVERGED');

-- v3 assertions were produced by a bridge-local, single-account proof. Rebuild all
-- MT5-derived seed values from the account-scoped v4 ledger on the next sync.
UPDATE "trades"
SET "seed_balance" = NULL
WHERE "mt5_account_id" IS NOT NULL;

DELETE FROM "mt5_position_entry_balances";

CREATE TABLE "mt5_account_balance_events" (
  "account_id" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "account_login" BIGINT NOT NULL,
  "deal_ticket" BIGINT NOT NULL,
  "occurred_at_msc" BIGINT NOT NULL,
  "occurred_at_utc" TIMESTAMP(3) NOT NULL,
  "balance_delta" DECIMAL(65,30) NOT NULL,
  "balance_before" DECIMAL(65,30) NOT NULL,
  "balance_after" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL,
  "ledger_version" INTEGER NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mt5_account_balance_events_pkey" PRIMARY KEY ("server", "account_login", "deal_ticket"),
  CONSTRAINT "mt5_account_balance_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mt5_account_balance_events_deal_fkey" FOREIGN KEY ("server", "account_login", "deal_ticket") REFERENCES "mt5_deals"("server", "account_login", "ticket") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "mt5_account_balance_events_account_id_occurred_at_msc_deal_ticket_idx"
  ON "mt5_account_balance_events"("account_id", "occurred_at_msc", "deal_ticket");

CREATE TABLE "mt5_account_balance_ledger_states" (
  "account_id" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "account_login" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "calculated_balance" DECIMAL(65,30) NOT NULL,
  "current_balance" DECIMAL(65,30) NOT NULL,
  "history_from_msc" BIGINT NOT NULL,
  "history_to_msc" BIGINT NOT NULL,
  "ledger_version" INTEGER NOT NULL,
  "status" "Mt5BalanceLedgerStatus" NOT NULL,
  "last_verified_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mt5_account_balance_ledger_states_pkey" PRIMARY KEY ("account_id"),
  CONSTRAINT "mt5_account_balance_ledger_states_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mt5_account_balance_ledger_states_server_account_login_key"
  ON "mt5_account_balance_ledger_states"("server", "account_login");
