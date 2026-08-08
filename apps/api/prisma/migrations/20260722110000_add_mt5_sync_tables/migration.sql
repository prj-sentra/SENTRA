CREATE TABLE "mt5_deals" (
    "server" TEXT NOT NULL,
    "account_login" BIGINT NOT NULL,
    "ticket" BIGINT NOT NULL,
    "order" BIGINT NOT NULL,
    "position_id" BIGINT NOT NULL,
    "time" BIGINT NOT NULL,
    "time_msc" BIGINT NOT NULL,
    "time_utc" TIMESTAMP(3) NOT NULL,
    "time_msc_utc" TIMESTAMP(3) NOT NULL,
    "type" INTEGER NOT NULL,
    "entry" INTEGER NOT NULL,
    "magic" BIGINT NOT NULL,
    "reason" INTEGER NOT NULL,
    "volume" DECIMAL(65,30) NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "commission" DECIMAL(65,30) NOT NULL,
    "swap" DECIMAL(65,30) NOT NULL,
    "profit" DECIMAL(65,30) NOT NULL,
    "fee" DECIMAL(65,30) NOT NULL,
    "symbol" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "raw_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mt5_deals_pkey" PRIMARY KEY ("server", "account_login", "ticket")
);

CREATE TABLE "mt5_sync_status" (
    "server" TEXT NOT NULL,
    "account_login" BIGINT NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "last_deal_time" TIMESTAMP(3),
    "last_received_deal_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mt5_sync_status_pkey" PRIMARY KEY ("server", "account_login")
);
