ALTER TABLE "trades"
  ADD COLUMN "entry_rationale" TEXT,
  ADD COLUMN "exit_rationale" TEXT,
  ADD COLUMN "take_profit_criteria" TEXT,
  ADD COLUMN "stop_loss_criteria" TEXT,
  ADD COLUMN "primary_trend" TEXT;
