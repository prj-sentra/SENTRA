-- Initial-plan metrics are only valid when their immutable entry-plan provenance is complete.
CREATE TABLE "mt5_position_entry_plans" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "account_login" BIGINT NOT NULL,
  "position_id" BIGINT NOT NULL,
  "side" "TradeSide" NOT NULL,
  "entry_at" TIMESTAMP(3) NOT NULL,
  "entry_price" DECIMAL(65,30) NOT NULL,
  "quantity_lots" DECIMAL(65,30) NOT NULL,
  "take_profit_price" DECIMAL(65,30) NOT NULL,
  "stop_loss_price" DECIMAL(65,30) NOT NULL,
  "pre_entry_balance" DECIMAL(65,30) NOT NULL,
  "account_currency" TEXT NOT NULL,
  "tick_size" DECIMAL(65,30) NOT NULL,
  "tick_value_profit" DECIMAL(65,30) NOT NULL,
  "tick_value_loss" DECIMAL(65,30) NOT NULL,
  "metric_contract_version" INTEGER NOT NULL DEFAULT 1,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mt5_position_entry_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mt5_position_entry_plans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mt5_position_entry_plans_id_metric_contract_version_key" ON "mt5_position_entry_plans"("id", "metric_contract_version");
CREATE UNIQUE INDEX "mt5_position_entry_plans_server_account_login_position_id_key" ON "mt5_position_entry_plans"("server", "account_login", "position_id");
CREATE INDEX "mt5_position_entry_plans_account_id_idx" ON "mt5_position_entry_plans"("account_id");

CREATE TABLE "trade_legacy_metric_quarantine" (
  "id" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "original_risk_percent" DECIMAL(65,30),
  "original_return_percent" DECIMAL(65,30),
  "reason" TEXT NOT NULL,
  "source_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_legacy_metric_quarantine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trade_legacy_metric_quarantine_trade_id_idx" ON "trade_legacy_metric_quarantine"("trade_id");

ALTER TABLE "trades"
  ADD COLUMN "return_percent" DECIMAL(65,30),
  ADD COLUMN "initial_plan_id" TEXT,
  ADD COLUMN "initial_plan_metric_contract_version" INTEGER;

-- Legacy values have no immutable entry-plan provenance. Preserve the auditable pair
-- before clearing every live metric/provenance field that the new contract governs.
INSERT INTO "trade_legacy_metric_quarantine" (
  "id", "trade_id", "original_risk_percent", "original_return_percent", "reason", "source_at"
)
SELECT
  md5("id" || ':initial-plan-metric-pair'),
  "id",
  "risk_percent",
  "return_percent",
  'missing_initial_plan_provenance',
  "updatedAt"
FROM "trades"
WHERE "risk_amount" IS NOT NULL
   OR "risk_percent" IS NOT NULL
   OR "return_percent" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "trades"
SET "risk_amount" = NULL,
    "risk_percent" = NULL,
    "return_percent" = NULL,
    "initial_plan_id" = NULL,
    "initial_plan_metric_contract_version" = NULL;

ALTER TABLE "trades"
  ADD CONSTRAINT "trades_initial_plan_id_initial_plan_metric_contract_version_fkey"
  FOREIGN KEY ("initial_plan_id", "initial_plan_metric_contract_version")
  REFERENCES "mt5_position_entry_plans"("id", "metric_contract_version")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "trades_initial_plan_metric_pair_check"
  CHECK (
    ("risk_amount" IS NULL AND "risk_percent" IS NULL AND "return_percent" IS NULL
      AND "initial_plan_id" IS NULL AND "initial_plan_metric_contract_version" IS NULL)
    OR
    ("risk_amount" IS NOT NULL AND "risk_percent" IS NOT NULL AND "return_percent" IS NOT NULL
      AND "initial_plan_id" IS NOT NULL AND "initial_plan_metric_contract_version" IS NOT NULL)
  );

CREATE INDEX "trades_initial_plan_id_initial_plan_metric_contract_version_idx"
  ON "trades"("initial_plan_id", "initial_plan_metric_contract_version");
