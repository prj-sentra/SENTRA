CREATE TABLE "trade_setup_tags" (
  "id" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trade_setup_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trade_review_tags" (
  "id" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trade_review_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_setup_tags_tradeId_tag_key" ON "trade_setup_tags"("tradeId", "tag");
CREATE INDEX "trade_setup_tags_tag_idx" ON "trade_setup_tags"("tag");

CREATE UNIQUE INDEX "trade_review_tags_tradeId_kind_tag_key" ON "trade_review_tags"("tradeId", "kind", "tag");
CREATE INDEX "trade_review_tags_kind_tag_idx" ON "trade_review_tags"("kind", "tag");

ALTER TABLE "trade_setup_tags"
ADD CONSTRAINT "trade_setup_tags_tradeId_fkey"
FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_review_tags"
ADD CONSTRAINT "trade_review_tags_tradeId_fkey"
FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
