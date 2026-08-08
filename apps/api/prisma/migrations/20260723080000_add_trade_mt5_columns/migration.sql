ALTER TABLE "trades"
  ADD COLUMN "account_currency" TEXT,
  ADD COLUMN "quantity_lots" DECIMAL(65,30),
  ADD COLUMN "entry_price" DECIMAL(65,30),
  ADD COLUMN "exit_price" DECIMAL(65,30),
  ADD COLUMN "exit_reason" TEXT,
  ADD COLUMN "realized_pnl" DECIMAL(65,30),
  ADD COLUMN "take_profit_price" DECIMAL(65,30),
  ADD COLUMN "stop_loss_price" DECIMAL(65,30),
  ADD COLUMN "opened_at" TIMESTAMP(3),
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "seed_balance" DECIMAL(65,30),
  ADD COLUMN "risk_amount" DECIMAL(65,30),
  ADD COLUMN "risk_percent" DECIMAL(65,30);
