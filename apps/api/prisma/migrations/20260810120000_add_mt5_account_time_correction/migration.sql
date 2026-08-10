ALTER TABLE "mt5_accounts"
ADD COLUMN "time_correction_hours" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "mt5_accounts"
ADD CONSTRAINT "mt5_accounts_time_correction_hours_check"
CHECK ("time_correction_hours" BETWEEN -23 AND 23);
