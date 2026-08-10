ALTER TABLE "mt5_account_balance_ledger_states"
ADD COLUMN "currency_digits" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "mt5_account_balance_ledger_states"
ALTER COLUMN "currency_digits" DROP DEFAULT;
