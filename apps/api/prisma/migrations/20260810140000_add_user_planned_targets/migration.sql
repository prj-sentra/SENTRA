ALTER TABLE "trades"
  ADD COLUMN "planned_take_profit_price" DECIMAL(65,30),
  ADD COLUMN "planned_stop_loss_price" DECIMAL(65,30);

ALTER TABLE "trades"
  ADD CONSTRAINT "trades_planned_targets_pair" CHECK (
    ("planned_take_profit_price" IS NULL AND "planned_stop_loss_price" IS NULL)
    OR ("planned_take_profit_price" > 0 AND "planned_stop_loss_price" > 0)
  );
