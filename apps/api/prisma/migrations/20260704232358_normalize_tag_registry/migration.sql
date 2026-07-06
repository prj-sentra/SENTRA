CREATE TYPE "TradeSide" AS ENUM ('long', 'short');
CREATE TYPE "TradeStatus" AS ENUM ('planned', 'open', 'closed', 'cancelled');
CREATE TYPE "TradeTagField" AS ENUM ('setup', 'rule-violation', 'lesson', 'result-label');

ALTER TABLE "trades"
  ALTER COLUMN "side" TYPE "TradeSide" USING ("side"::"TradeSide"),
  ALTER COLUMN "status" TYPE "TradeStatus" USING ("status"::"TradeStatus"),
  ADD COLUMN "resultLabelTagId" INTEGER;

CREATE TABLE "setup_tag_definitions" (
  "id" SERIAL NOT NULL,
  "field" "TradeTagField" NOT NULL DEFAULT 'setup',
  "label" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "systemDefined" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "setup_tag_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rule_violation_tag_definitions" (
  "id" SERIAL NOT NULL,
  "field" "TradeTagField" NOT NULL DEFAULT 'rule-violation',
  "label" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "systemDefined" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rule_violation_tag_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lesson_tag_definitions" (
  "id" SERIAL NOT NULL,
  "field" "TradeTagField" NOT NULL DEFAULT 'lesson',
  "label" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "systemDefined" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_tag_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "result_label_tag_definitions" (
  "id" SERIAL NOT NULL,
  "field" "TradeTagField" NOT NULL DEFAULT 'result-label',
  "label" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "systemDefined" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "result_label_tag_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trade_setup_tag_links" (
  "id" SERIAL NOT NULL,
  "tradeId" TEXT NOT NULL,
  "tagId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_setup_tag_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trade_rule_violation_tag_links" (
  "id" SERIAL NOT NULL,
  "tradeId" TEXT NOT NULL,
  "tagId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_rule_violation_tag_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trade_lesson_tag_links" (
  "id" SERIAL NOT NULL,
  "tradeId" TEXT NOT NULL,
  "tagId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_lesson_tag_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "setup_tag_definitions_normalizedLabel_key" ON "setup_tag_definitions"("normalizedLabel");
CREATE UNIQUE INDEX "setup_tag_definitions_field_label_key" ON "setup_tag_definitions"("field", "label");
CREATE INDEX "setup_tag_definitions_label_idx" ON "setup_tag_definitions"("label");

CREATE UNIQUE INDEX "rule_violation_tag_definitions_normalizedLabel_key" ON "rule_violation_tag_definitions"("normalizedLabel");
CREATE UNIQUE INDEX "rule_violation_tag_definitions_field_label_key" ON "rule_violation_tag_definitions"("field", "label");
CREATE INDEX "rule_violation_tag_definitions_label_idx" ON "rule_violation_tag_definitions"("label");

CREATE UNIQUE INDEX "lesson_tag_definitions_normalizedLabel_key" ON "lesson_tag_definitions"("normalizedLabel");
CREATE UNIQUE INDEX "lesson_tag_definitions_field_label_key" ON "lesson_tag_definitions"("field", "label");
CREATE INDEX "lesson_tag_definitions_label_idx" ON "lesson_tag_definitions"("label");

CREATE UNIQUE INDEX "result_label_tag_definitions_normalizedLabel_key" ON "result_label_tag_definitions"("normalizedLabel");
CREATE UNIQUE INDEX "result_label_tag_definitions_field_label_key" ON "result_label_tag_definitions"("field", "label");
CREATE INDEX "result_label_tag_definitions_label_idx" ON "result_label_tag_definitions"("label");

CREATE UNIQUE INDEX "trade_setup_tag_links_tradeId_tagId_key" ON "trade_setup_tag_links"("tradeId", "tagId");
CREATE INDEX "trade_setup_tag_links_tagId_idx" ON "trade_setup_tag_links"("tagId");

CREATE UNIQUE INDEX "trade_rule_violation_tag_links_tradeId_tagId_key" ON "trade_rule_violation_tag_links"("tradeId", "tagId");
CREATE INDEX "trade_rule_violation_tag_links_tagId_idx" ON "trade_rule_violation_tag_links"("tagId");

CREATE UNIQUE INDEX "trade_lesson_tag_links_tradeId_tagId_key" ON "trade_lesson_tag_links"("tradeId", "tagId");
CREATE INDEX "trade_lesson_tag_links_tagId_idx" ON "trade_lesson_tag_links"("tagId");

CREATE INDEX "trades_resultLabelTagId_idx" ON "trades"("resultLabelTagId");

ALTER TABLE "trade_setup_tag_links"
  ADD CONSTRAINT "trade_setup_tag_links_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "trade_setup_tag_links_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "setup_tag_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_rule_violation_tag_links"
  ADD CONSTRAINT "trade_rule_violation_tag_links_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "trade_rule_violation_tag_links_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "rule_violation_tag_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_lesson_tag_links"
  ADD CONSTRAINT "trade_lesson_tag_links_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "trade_lesson_tag_links_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "lesson_tag_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trades"
  ADD CONSTRAINT "trades_resultLabelTagId_fkey"
  FOREIGN KEY ("resultLabelTagId") REFERENCES "result_label_tag_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH setup_sources AS (
  SELECT DISTINCT label
  FROM (
    SELECT btrim("tag") AS label
    FROM "trade_setup_tags"
    UNION ALL
    SELECT btrim("journal"->'plan'->>'setupTag') AS label
    FROM "trades"
    WHERE "journal"->'plan'->>'setupTag' IS NOT NULL
    UNION ALL
    SELECT btrim(value) AS label
    FROM "trades",
    LATERAL jsonb_array_elements_text(COALESCE("journal"->'plan'->'setupTags', '[]'::jsonb)) AS value
  ) s
  WHERE label IS NOT NULL AND label <> ''
)
INSERT INTO "setup_tag_definitions" ("field", "label", "normalizedLabel", "systemDefined")
SELECT
  'setup',
  label,
  lower(regexp_replace(label, '[\s_-]+', '', 'g')),
  CASE WHEN label IN ('원볼', '투볼', '정볼', '역볼', '원볼 정볼', '원볼 역볼', '투볼 정볼', '투볼 역볼', '추세 눌림', '돌파', '테스트', '없음', '기타')
    THEN true ELSE false END
FROM setup_sources
ON CONFLICT ("normalizedLabel") DO NOTHING;

WITH violation_sources AS (
  SELECT DISTINCT label
  FROM (
    SELECT btrim("tag") AS label
    FROM "trade_review_tags"
    WHERE "kind" = 'rule-violation'
    UNION ALL
    SELECT btrim(value) AS label
    FROM "trades",
    LATERAL jsonb_array_elements_text(COALESCE("journal"->'review'->'ruleViolationTags', '[]'::jsonb)) AS value
  ) s
  WHERE label IS NOT NULL AND label <> ''
)
INSERT INTO "rule_violation_tag_definitions" ("field", "label", "normalizedLabel", "systemDefined")
SELECT
  'rule-violation',
  label,
  lower(regexp_replace(label, '[\s_-]+', '', 'g')),
  CASE WHEN label IN ('기준봉/관리봉 불일치', '목표 계획 정합성 부족', '하위 타임프레임 과신', '손절 폭 과도하게 짧음', 'SL 조기 이동', '추세 해석 오류', '상위 저항 반영 부족', 'setup 대비 관리 방식 불일치', '재진입 전 재검증 부족', '보유 중 판단 품질 저하', '봉마감 확인 없이 진입', '필수 진입 확인 부재', '하위 setup 독립 검증 부재', '손절 위치 부적절', '자본 보호 우선 관리', '기타 리뷰 이슈')
    THEN true ELSE false END
FROM violation_sources
ON CONFLICT ("normalizedLabel") DO NOTHING;

WITH lesson_sources AS (
  SELECT DISTINCT label
  FROM (
    SELECT btrim("tag") AS label
    FROM "trade_review_tags"
    WHERE "kind" = 'lesson'
    UNION ALL
    SELECT btrim(value) AS label
    FROM "trades",
    LATERAL jsonb_array_elements_text(COALESCE("journal"->'review'->'lessonTags', '[]'::jsonb)) AS value
  ) s
  WHERE label IS NOT NULL AND label <> ''
)
INSERT INTO "lesson_tag_definitions" ("field", "label", "normalizedLabel", "systemDefined")
SELECT
  'lesson',
  label,
  lower(regexp_replace(label, '[\s_-]+', '', 'g')),
  CASE WHEN label IN ('구조 기준 손절 사용', '진입 기준봉으로 관리 유지', '목표를 구조 합치로 정의', '필수 진입 확인 조건 유지', '재진입 전 추세 재검증', '독립 trade 분리 유지', '테스트성 거래 분리 관리', '역추세는 빠른 익절 우선', '결과로 나쁜 프로세스 정당화 금지', '상위 타임프레임 합치 확인', '무효화 기준 명확화', '자본 보호 우선 관리', '기타 리뷰 교훈')
    THEN true ELSE false END
FROM lesson_sources
ON CONFLICT ("normalizedLabel") DO NOTHING;

WITH result_sources AS (
  SELECT DISTINCT btrim("journal"->'review'->>'resultLabel') AS label
  FROM "trades"
  WHERE "journal"->'review'->>'resultLabel' IS NOT NULL
)
INSERT INTO "result_label_tag_definitions" ("field", "label", "normalizedLabel", "systemDefined")
SELECT
  'result-label',
  label,
  lower(regexp_replace(label, '[\s_-]+', '', 'g')),
  CASE WHEN label IN ('익절', '손절', '본절 청산', '부분 익절', '부분 손절', '취소') THEN true ELSE false END
FROM result_sources
WHERE label <> ''
ON CONFLICT ("normalizedLabel") DO NOTHING;

WITH setup_trade_tags AS (
  SELECT DISTINCT trade_id, label
  FROM (
    SELECT "tradeId" AS trade_id, btrim("tag") AS label
    FROM "trade_setup_tags"
    UNION ALL
    SELECT "id" AS trade_id, btrim("journal"->'plan'->>'setupTag') AS label
    FROM "trades"
    WHERE "journal"->'plan'->>'setupTag' IS NOT NULL
    UNION ALL
    SELECT "id" AS trade_id, btrim(value) AS label
    FROM "trades",
    LATERAL jsonb_array_elements_text(COALESCE("journal"->'plan'->'setupTags', '[]'::jsonb)) AS value
  ) s
  WHERE label IS NOT NULL AND label <> ''
)
INSERT INTO "trade_setup_tag_links" ("tradeId", "tagId")
SELECT st.trade_id, d."id"
FROM setup_trade_tags st
JOIN "setup_tag_definitions" d
  ON d."normalizedLabel" = lower(regexp_replace(st.label, '[\s_-]+', '', 'g'))
ON CONFLICT ("tradeId", "tagId") DO NOTHING;

WITH violation_trade_tags AS (
  SELECT DISTINCT trade_id, label
  FROM (
    SELECT "tradeId" AS trade_id, btrim("tag") AS label
    FROM "trade_review_tags"
    WHERE "kind" = 'rule-violation'
    UNION ALL
    SELECT "id" AS trade_id, btrim(value) AS label
    FROM "trades",
    LATERAL jsonb_array_elements_text(COALESCE("journal"->'review'->'ruleViolationTags', '[]'::jsonb)) AS value
  ) s
  WHERE label IS NOT NULL AND label <> ''
)
INSERT INTO "trade_rule_violation_tag_links" ("tradeId", "tagId")
SELECT st.trade_id, d."id"
FROM violation_trade_tags st
JOIN "rule_violation_tag_definitions" d
  ON d."normalizedLabel" = lower(regexp_replace(st.label, '[\s_-]+', '', 'g'))
ON CONFLICT ("tradeId", "tagId") DO NOTHING;

WITH lesson_trade_tags AS (
  SELECT DISTINCT trade_id, label
  FROM (
    SELECT "tradeId" AS trade_id, btrim("tag") AS label
    FROM "trade_review_tags"
    WHERE "kind" = 'lesson'
    UNION ALL
    SELECT "id" AS trade_id, btrim(value) AS label
    FROM "trades",
    LATERAL jsonb_array_elements_text(COALESCE("journal"->'review'->'lessonTags', '[]'::jsonb)) AS value
  ) s
  WHERE label IS NOT NULL AND label <> ''
)
INSERT INTO "trade_lesson_tag_links" ("tradeId", "tagId")
SELECT st.trade_id, d."id"
FROM lesson_trade_tags st
JOIN "lesson_tag_definitions" d
  ON d."normalizedLabel" = lower(regexp_replace(st.label, '[\s_-]+', '', 'g'))
ON CONFLICT ("tradeId", "tagId") DO NOTHING;

UPDATE "trades" t
SET "resultLabelTagId" = d."id"
FROM "result_label_tag_definitions" d
WHERE d."normalizedLabel" = lower(regexp_replace(btrim(t."journal"->'review'->>'resultLabel'), '[\s_-]+', '', 'g'));

DROP TABLE "trade_setup_tags";
DROP TABLE "trade_review_tags";
