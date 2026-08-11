UPDATE "trade_campaign_analyses" analysis
SET "ma_timeframes" = (
  SELECT jsonb_object_agg(
    timeframe,
    jsonb_build_object(
      'arrangement', COALESCE(analysis."ma_timeframes" -> timeframe ->> 'arrangement', 'congested'),
      'cross20_60', CASE analysis."ma_timeframes" -> timeframe ->> 'cross'
        WHEN 'golden_20_60' THEN 'golden'
        WHEN 'dead_20_60' THEN 'dead'
        ELSE 'none'
      END,
      'cross20_120', CASE analysis."ma_timeframes" -> timeframe ->> 'cross'
        WHEN 'golden_20_120' THEN 'golden'
        WHEN 'dead_20_120' THEN 'dead'
        ELSE 'none'
      END
    )
  )
  FROM unnest(ARRAY['15m', '30m', '1h', '4h', '1D', '1W', '1MN']) AS timeframe
);
