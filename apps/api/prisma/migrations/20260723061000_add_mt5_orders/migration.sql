CREATE TABLE "mt5_orders" (
  "server" TEXT NOT NULL,
  "account_login" BIGINT NOT NULL,
  "ticket" BIGINT NOT NULL,
  "position_id" BIGINT NOT NULL,
  "time_setup" BIGINT NOT NULL,
  "time_setup_msc" BIGINT NOT NULL,
  "time_setup_utc" TIMESTAMP(3) NOT NULL,
  "time_setup_msc_utc" TIMESTAMP(3) NOT NULL,
  "time_done" BIGINT NOT NULL,
  "time_done_msc" BIGINT NOT NULL,
  "time_done_utc" TIMESTAMP(3) NOT NULL,
  "time_done_msc_utc" TIMESTAMP(3) NOT NULL,
  "type" INTEGER NOT NULL,
  "state" INTEGER NOT NULL,
  "reason" INTEGER NOT NULL,
  "volume_initial" DECIMAL(65,30) NOT NULL,
  "volume_current" DECIMAL(65,30) NOT NULL,
  "price_open" DECIMAL(65,30) NOT NULL,
  "sl" DECIMAL(65,30) NOT NULL,
  "tp" DECIMAL(65,30) NOT NULL,
  "price_current" DECIMAL(65,30) NOT NULL,
  "price_stoplimit" DECIMAL(65,30) NOT NULL,
  "symbol" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "raw_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mt5_orders_pkey" PRIMARY KEY ("server", "account_login", "ticket")
);

CREATE INDEX "mt5_orders_server_account_login_position_id_idx"
ON "mt5_orders"("server", "account_login", "position_id");
