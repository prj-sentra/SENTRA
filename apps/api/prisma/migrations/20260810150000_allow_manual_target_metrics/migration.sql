ALTER TABLE "trades" DROP CONSTRAINT "trades_initial_plan_metric_pair_check";

ALTER TABLE "trades" ADD CONSTRAINT "trades_initial_plan_metric_pair_check" CHECK (
  ("risk_amount" IS NULL AND "risk_percent" IS NULL AND "return_percent" IS NULL
    AND "initial_plan_id" IS NULL AND "initial_plan_metric_contract_version" IS NULL)
  OR
  ("risk_amount" IS NOT NULL AND "risk_percent" IS NOT NULL AND "return_percent" IS NOT NULL
    AND (
      ("initial_plan_id" IS NOT NULL AND "initial_plan_metric_contract_version" IS NOT NULL)
      OR
      ("planned_take_profit_price" IS NOT NULL AND "planned_stop_loss_price" IS NOT NULL
        AND "initial_plan_id" IS NULL AND "initial_plan_metric_contract_version" IS NULL)
    ))
);
