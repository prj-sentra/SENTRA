CREATE TABLE "trade_chart_images" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "original_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_chart_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_chart_images_trade_id_key" ON "trade_chart_images"("trade_id");

ALTER TABLE "trade_chart_images"
ADD CONSTRAINT "trade_chart_images_trade_id_fkey"
FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
