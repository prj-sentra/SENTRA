ALTER TABLE "trades"
    ADD COLUMN "mt5_server" TEXT,
    ADD COLUMN "mt5_account_login" BIGINT,
    ADD COLUMN "mt5_position_id" BIGINT;

CREATE UNIQUE INDEX "trades_mt5_server_mt5_account_login_mt5_position_id_key"
    ON "trades"("mt5_server", "mt5_account_login", "mt5_position_id");

CREATE INDEX "trades_mt5_server_mt5_account_login_idx"
    ON "trades"("mt5_server", "mt5_account_login");
