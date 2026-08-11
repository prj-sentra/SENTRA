CREATE TYPE "TradeExecutionEvaluation" AS ENUM ('as_planned', 'plan_violated');

ALTER TABLE "trade_analyses"
  ADD COLUMN "execution_evaluation" "TradeExecutionEvaluation",
  ADD COLUMN "unplanned_additional_entry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "excessive_size" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stop_loss_violation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "early_exit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "late_exit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "other_violation" TEXT;

ALTER TABLE "trade_campaign_analyses"
  ADD COLUMN "entry_reason" TEXT,
  ADD COLUMN "invalidation_condition" TEXT,
  ADD COLUMN "take_profit_condition" TEXT,
  ADD COLUMN "additional_entry_plan" TEXT,
  ADD COLUMN "trade_score" INTEGER,
  ADD COLUMN "strengths" TEXT,
  ADD COLUMN "weaknesses" TEXT,
  ADD CONSTRAINT "trade_campaign_analyses_trade_score_check" CHECK ("trade_score" BETWEEN 1 AND 10);
