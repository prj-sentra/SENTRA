ALTER TABLE "excursion_work_items"
  DROP CONSTRAINT "excursion_work_items_scope_target_check";

ALTER TABLE "excursion_work_items"
  ADD CONSTRAINT "excursion_work_items_scope_target_check" CHECK (
    ("scope" = 'TRADE' AND "trade_id" IS NOT NULL AND "trade_id" = "target_id" AND "campaign_id" IS NULL)
    OR
    ("scope" = 'CAMPAIGN' AND "campaign_id" IS NOT NULL AND "campaign_id" = "target_id" AND "trade_id" IS NULL)
  );
