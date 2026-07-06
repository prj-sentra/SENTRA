WITH violation_mapping(source_norm, target_label) AS (
  VALUES
    ('timeframeinconsistency', '기준봉/관리봉 불일치'),
    ('targetplanninggap', '목표 계획 정합성 부족'),
    ('lowertimeframeoverweight', '하위 타임프레임 과신'),
    ('stoptootight', '손절 폭 과도하게 짧음'),
    ('trendmisread', '추세 해석 오류'),
    ('resistanceignored', '상위 저항 반영 부족'),
    ('managementmodelmismatch', 'setup 대비 관리 방식 불일치'),
    ('reentrywithoutrevalidation', '재진입 전 재검증 부족'),
    ('decisionqualitydegradedinposition', '보유 중 판단 품질 저하'),
    ('nocloseconfirmation', '봉마감 확인 없이 진입'),
    ('noindependentsetupvalidation', '하위 setup 독립 검증 부재'),
    ('invalidstoplocation', '손절 위치 부적절')
),
insert_violation_targets AS (
  INSERT INTO "rule_violation_tag_definitions" ("field", "label", "normalizedLabel", "systemDefined")
  SELECT 'rule-violation', target_label, lower(regexp_replace(target_label, '[\s_-]+', '', 'g')), true
  FROM violation_mapping
  ON CONFLICT ("normalizedLabel") DO UPDATE SET
    "label" = EXCLUDED."label",
    "systemDefined" = true,
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING 1
),
violation_sources AS (
  SELECT source."id" AS source_id, target."id" AS target_id
  FROM "rule_violation_tag_definitions" source
  JOIN violation_mapping mapping ON source."normalizedLabel" = mapping.source_norm
  JOIN "rule_violation_tag_definitions" target
    ON target."normalizedLabel" = lower(regexp_replace(mapping.target_label, '[\s_-]+', '', 'g'))
  WHERE source."id" <> target."id"
),
violation_link_copy AS (
  INSERT INTO "trade_rule_violation_tag_links" ("tradeId", "tagId")
  SELECT link."tradeId", source_map.target_id
  FROM "trade_rule_violation_tag_links" link
  JOIN violation_sources source_map ON source_map.source_id = link."tagId"
  ON CONFLICT ("tradeId", "tagId") DO NOTHING
  RETURNING 1
),
violation_link_delete AS (
  DELETE FROM "trade_rule_violation_tag_links" link
  USING violation_sources source_map
  WHERE link."tagId" = source_map.source_id
  RETURNING 1
)
DELETE FROM "rule_violation_tag_definitions" definition
USING violation_sources source_map
WHERE definition."id" = source_map.source_id;

WITH lesson_mapping(source_norm, target_label) AS (
  VALUES
    ('avoidresultbasedjustification', '결과로 나쁜 프로세스 정당화 금지'),
    ('defineinvalidationclearly', '무효화 기준 명확화'),
    ('definetargetwithconfluence', '목표를 구조 합치로 정의'),
    ('fastprofitoncountertrend', '역추세는 빠른 익절 우선'),
    ('keepmanagementtimeframe', '진입 기준봉으로 관리 유지'),
    ('preserveindependenttrades', '독립 trade 분리 유지'),
    ('requireentryconfirmation', '필수 진입 확인 조건 유지'),
    ('requirehighertimeframeconfluence', '상위 타임프레임 합치 확인'),
    ('revalidatetrendbeforereentry', '재진입 전 추세 재검증'),
    ('separatetesttrades', '테스트성 거래 분리 관리'),
    ('usestructuralstop', '구조 기준 손절 사용')
),
insert_lesson_targets AS (
  INSERT INTO "lesson_tag_definitions" ("field", "label", "normalizedLabel", "systemDefined")
  SELECT 'lesson', target_label, lower(regexp_replace(target_label, '[\s_-]+', '', 'g')), true
  FROM lesson_mapping
  ON CONFLICT ("normalizedLabel") DO UPDATE SET
    "label" = EXCLUDED."label",
    "systemDefined" = true,
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING 1
),
lesson_sources AS (
  SELECT source."id" AS source_id, target."id" AS target_id
  FROM "lesson_tag_definitions" source
  JOIN lesson_mapping mapping ON source."normalizedLabel" = mapping.source_norm
  JOIN "lesson_tag_definitions" target
    ON target."normalizedLabel" = lower(regexp_replace(mapping.target_label, '[\s_-]+', '', 'g'))
  WHERE source."id" <> target."id"
),
lesson_link_copy AS (
  INSERT INTO "trade_lesson_tag_links" ("tradeId", "tagId")
  SELECT link."tradeId", source_map.target_id
  FROM "trade_lesson_tag_links" link
  JOIN lesson_sources source_map ON source_map.source_id = link."tagId"
  ON CONFLICT ("tradeId", "tagId") DO NOTHING
  RETURNING 1
),
lesson_link_delete AS (
  DELETE FROM "trade_lesson_tag_links" link
  USING lesson_sources source_map
  WHERE link."tagId" = source_map.source_id
  RETURNING 1
)
DELETE FROM "lesson_tag_definitions" definition
USING lesson_sources source_map
WHERE definition."id" = source_map.source_id;
