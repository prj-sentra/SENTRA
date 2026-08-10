ALTER TABLE "trade_campaigns" ADD COLUMN "memo" TEXT;

-- Consolidate every member's authored note/regret before removing the per-execution fields.
WITH member_memos AS (
  SELECT
    membership."campaign_id",
    membership."created_at",
    membership."trade_id",
    NULLIF(concat_ws(E'\n\n',
      CASE
        WHEN NULLIF(btrim(regexp_replace(analysis."note", '(진입 근거:|청산 근거:|TP 설정 근거:|SL 설정 근거:|\\s)', '', 'g')), '') IS NOT NULL
          THEN btrim(analysis."note")
      END,
      CASE WHEN NULLIF(btrim(analysis."regret"), '') IS NOT NULL
        THEN E'아쉬운 점:\n' || btrim(analysis."regret") END
    ), '') AS content
  FROM "campaign_memberships" membership
  JOIN "trade_analyses" analysis ON analysis."trade_id" = membership."trade_id"
), numbered AS (
  SELECT *, row_number() OVER (PARTITION BY "campaign_id" ORDER BY "created_at", "trade_id") AS position,
    count(*) OVER (PARTITION BY "campaign_id") AS total_count
  FROM member_memos
  WHERE content IS NOT NULL
), consolidated AS (
  SELECT "campaign_id", string_agg(
    CASE WHEN position = 1 AND total_count = 1
      THEN content
      ELSE position::text || E'번째 매매\n' || content END,
    E'\n\n' ORDER BY position
  ) AS memo
  FROM numbered
  GROUP BY "campaign_id"
)
UPDATE "trade_campaigns" campaign
SET "memo" = consolidated.memo
FROM consolidated
WHERE consolidated."campaign_id" = campaign."id";

ALTER TABLE "trade_analyses" DROP COLUMN "note", DROP COLUMN "regret";
