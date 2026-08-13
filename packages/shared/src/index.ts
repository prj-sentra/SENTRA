export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';
export type TradeAnalysisPrimaryTrend = 'up' | 'up_sideways' | 'down' | 'down_sideways';
export type TradeAnalysisBollingerBandCount = 'no_touch' | 'one_band' | 'two_band';
export type TradeAnalysisBollingerDirection = 'normal' | 'reverse' | 'chase';
export type TradeAnalysisMaArrangement = 'bullish' | 'bearish' | 'congested';
export type TradeAnalysisCrossDirection = 'none' | 'golden' | 'dead';
export type TradeAnalysisChartPatternType = 'double_top' | 'double_bottom' | 'head_shoulders' | 'inverse_head_shoulders';
export type TradeAnalysisEconomicIndicatorImpact = 'positive' | 'negative';
export type TradeExecutionEvaluation = 'as_planned' | 'plan_violated';

export interface TradeAnalysisEconomicIndicator { id: string; type: string; impact: TradeAnalysisEconomicIndicatorImpact; announcedAt?: string; position: number; }
export type TradeAnalysisMaTimeframe = '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1MN';
export interface TradeAnalysisMaReading { arrangement?: TradeAnalysisMaArrangement; cross20_60?: TradeAnalysisCrossDirection; cross20_120?: TradeAnalysisCrossDirection; chartPattern?: TradeAnalysisChartPatternType; }
export type TradeAnalysisMaTimeframes = Partial<Record<TradeAnalysisMaTimeframe, TradeAnalysisMaReading>>;
export interface TradeAnalysis {
  schemaVersion: 3; baseTimeframe?: string;
  bollingerBandCount?: TradeAnalysisBollingerBandCount; bollingerDirection?: TradeAnalysisBollingerDirection;
  executionEvaluation?: TradeExecutionEvaluation;
  unplannedAdditionalEntry?: boolean; excessiveSize?: boolean; stopLossViolation?: boolean; earlyExit?: boolean; lateExit?: boolean;
  otherViolation?: string;
  createdAt: string; updatedAt: string;
}
export interface TradeCampaignAnalysis {
  schemaVersion: 1; primaryTrend?: TradeAnalysisPrimaryTrend;
  maTimeframes: TradeAnalysisMaTimeframes;
  marketZoneEnabled: boolean; marketZoneHigh?: number; marketZoneLow?: number;
  retailPositionEnabled: boolean; retailBuyAveragePrice?: number; retailSellAveragePrice?: number; retailBuyRatio?: number;
  fibonacciEnabled: boolean; fibonacciStartPrice?: number; fibonacciEndPrice?: number;
  economicIndicators: TradeAnalysisEconomicIndicator[];
  entryReason?: string; invalidationCondition?: string; takeProfitCondition?: string; additionalEntryPlan?: string;
  tradeScore?: number; strengths?: string; weaknesses?: string;
  reviewUpdatedAt?: string;
  createdAt: string; updatedAt: string;
}
export interface TradeAnalysisEconomicIndicatorInput { id?: string; type: string; impact: TradeAnalysisEconomicIndicatorImpact; announcedAt?: string | null; }
export interface PatchTradeAnalysisRequest {
  expectedUpdatedAt: string; baseTimeframe?: string | null;
  bollingerBandCount?: TradeAnalysisBollingerBandCount | null; bollingerDirection?: TradeAnalysisBollingerDirection | null;
  executionEvaluation?: TradeExecutionEvaluation | null;
  unplannedAdditionalEntry?: boolean; excessiveSize?: boolean; stopLossViolation?: boolean; earlyExit?: boolean; lateExit?: boolean;
  otherViolation?: string | null;
  plannedTakeProfitPrice?: number | null; plannedStopLossPrice?: number | null;
}
export interface PatchTradeCampaignAnalysisRequest {
  expectedUpdatedAt: string; primaryTrend?: TradeAnalysisPrimaryTrend | null;
  maTimeframes?: TradeAnalysisMaTimeframes;
  marketZoneEnabled?: boolean; marketZoneHigh?: number | null; marketZoneLow?: number | null;
  retailPositionEnabled?: boolean; retailBuyAveragePrice?: number | null; retailSellAveragePrice?: number | null; retailBuyRatio?: number | null;
  fibonacciEnabled?: boolean; fibonacciStartPrice?: number | null; fibonacciEndPrice?: number | null;
  economicIndicators?: TradeAnalysisEconomicIndicatorInput[];
}
export interface PatchTradeCampaignReviewRequest {
  expectedReviewUpdatedAt: string;
  entryReason?: string | null; invalidationCondition?: string | null; takeProfitCondition?: string | null; additionalEntryPlan?: string | null;
  tradeScore?: number | null; strengths?: string | null; weaknesses?: string | null;
}
export interface PatchTradeCampaignMemoRequest { memo: string | null; expectedUpdatedAt: string; }
export interface TradeEntry { price: number; quantity?: number; occurredAt: string; note?: string; }
export type TradeExitReason = 'target_hit' | 'stop_loss' | 'manual' | 'forced_liquidation' | 'automated' | 'rollover' | 'variation_margin' | 'split' | 'corporate_action' | 'other' | 'invalidated' | 'time_exit';
export interface TradeExit { price: number; quantity?: number; occurredAt: string; reason?: TradeExitReason; note?: string; }
export interface TradeRecord { id: string; symbol: string; side: TradeSide; status: TradeStatus; accountId: string; mt5Server?: string; thesis?: string; entryRationale?: string; exitRationale?: string; takeProfitCriteria?: string; stopLossCriteria?: string; note?: string; accountCurrency?: string; quantityLots?: number; entryPrice?: number; exitPrice?: number; exitReason?: TradeExitReason; realizedPnl?: number; openedAt?: string; closedAt?: string; seedBalance?: number; plannedTakeProfitPrice?: number; plannedStopLossPrice?: number; riskAmount?: number; riskPercent?: number; returnPercent?: number; rr?: number; analysisComplete: boolean; analysis: TradeAnalysis; entry?: TradeEntry; exit?: TradeExit; excursion?: TradeExcursionResult; createdAt: string; updatedAt: string; }
export type CampaignMembershipSource = 'auto' | 'manual';
export type CampaignHeadSource = 'AUTO' | 'MANUAL';
export interface CampaignConflict { id: string; tradeId: string; candidateCampaignIds: string[]; status: 'unresolved' | 'resolved'; resolvedCampaignId?: string; createdAt: string; resolvedAt?: string; }
export interface TradeCampaign { id: string; rootTradeId: string; headSource: CampaignHeadSource; campaignVersion: number; tradingDate: string; accountId: string; symbol: string; side: TradeSide; status: 'open' | 'closed'; entryPrice?: number; exitPrice?: number; quantityLots: number; remainingQuantityLots: number; exitReason?: string; realizedPnl: number; openedAt: string; closedAt?: string; seedBalance?: number; images: TradeCampaignImage[]; memo?: string; updatedAt: string; analysisComplete: boolean; analysis: TradeCampaignAnalysis; members: TradeRecord[]; conflicts: CampaignConflict[]; excursion?: CampaignExcursionResult; }
export interface SetTradeCampaignHeadRequest { tradeId: string; campaignVersion: number; }
export interface UnsetTradeCampaignHeadRequest { campaignVersion: number; }
export interface CampaignHeadMutationResponse { previousCampaign?: TradeCampaign; campaign: TradeCampaign; }
export interface TradeCalendarDay { date: string; tradeCount: number; campaignCount: number; realizedPnl: number; }
export interface TradeCampaignDateResponse { date?: string; previousDate?: string; nextDate?: string; campaigns: TradeCampaign[]; calendarDays: TradeCalendarDay[]; diagnostics: { missingOpenedAtTradeIds: string[] }; }
export interface RelinkTradeCampaignRequest { accountId: string; tradeId: string; campaignId?: string; }
export interface ResolveCampaignConflictRequest { accountId: string; campaignId: string; }
export type ExcursionStatus = 'success' | 'stale' | 'failed' | 'unsupported';
export type ExcursionFailureReason =
  | 'HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE' | 'VALUATION_UNSUPPORTED' | 'UNSUPPORTED_DEAL_SEQUENCE'
  | 'TICK_SOURCE_LIMIT' | 'TICK_CURSOR_EXPIRED' | 'TICK_CAPACITY' | 'TICK_DEADLINE'
  | 'TICK_UNAVAILABLE' | 'TICK_INVALID_PAYLOAD' | 'TICK_IDENTITY_MISMATCH' | 'INPUT_CHANGED'
  | 'ACCOUNT_DEACTIVATED' | 'NO_SYNC_SNAPSHOT';
export type ExcursionSuccessfulAttempt = { calculationVersion: number; inputFingerprint: string; attemptedAt: string; failureReason?: never; };
export type ExcursionFailedAttempt = { calculationVersion: number; inputFingerprint: string; attemptedAt: string; failureReason: ExcursionFailureReason; };
export type PricedExcursionExtremum = { value: number; occurredAt: string; markPrice: number; };
export type PortfolioExcursionExtremum = { value: number; occurredAt: string; };
export type PricedExcursionPair = { mfe: PricedExcursionExtremum; mae: PricedExcursionExtremum; };
export type PortfolioExcursionPair = { mfe: PortfolioExcursionExtremum; mae: PortfolioExcursionExtremum; };
export type ExcursionSuccessProvenance = {
  calculationVersion: number; inputFingerprint: string; succeededAt: string; priceSource: 'mt5_copy_ticks_range';
  rawRange: { fromMsc: number; toMsc: number }; displayRange: { fromAt: string; toAt: string };
  tickSnapshotToMsc: number; pathDigest: string; tickCount: number; valuationVersion: number;
  valuationDigest: string; accountCurrency: string;
};
export type TradeExcursionMetrics =
  | { price: PricedExcursionPair; percent: PricedExcursionPair; unrealizedPnl: PortfolioExcursionPair; captureRate?: number; rAvailability: 'available'; r: PortfolioExcursionPair; }
  | { price: PricedExcursionPair; percent: PricedExcursionPair; unrealizedPnl: PortfolioExcursionPair; captureRate?: number; rAvailability: 'risk_unavailable'; r?: never; };
export type ExcursionCurrent<T> = { status: 'success'; attempt: ExcursionSuccessfulAttempt; success: ExcursionSuccessProvenance; metrics: T; };
export type ExcursionStale<T> = { status: 'stale'; attempt: ExcursionFailedAttempt; success: ExcursionSuccessProvenance; metrics: T; };
export type ExcursionUnavailable = { status: 'failed' | 'unsupported'; attempt: ExcursionFailedAttempt; success?: never; metrics?: never; };
export type TradeExcursionResult = { scope: 'trade' } & (ExcursionCurrent<TradeExcursionMetrics> | ExcursionStale<TradeExcursionMetrics> | ExcursionUnavailable);
export type CampaignPriceMetrics = { price: PricedExcursionPair; percent: PricedExcursionPair; };
export type CampaignPnlBaseMetrics = { unrealizedPnl: PortfolioExcursionPair; captureRate?: number; };
export type CampaignPnlMetrics =
  | (CampaignPnlBaseMetrics & { rAvailability: 'available'; r: PortfolioExcursionPair; })
  | (CampaignPnlBaseMetrics & { rAvailability: 'risk_unavailable'; r?: never; });
export type CampaignPriceFamily = { family: 'campaign_price' } & (ExcursionCurrent<CampaignPriceMetrics> | ExcursionStale<CampaignPriceMetrics> | ExcursionUnavailable);
export type CampaignPnlFamily = { family: 'campaign_unrealized_pnl' } & (ExcursionCurrent<CampaignPnlMetrics> | ExcursionStale<CampaignPnlMetrics> | ExcursionUnavailable);
export type CampaignExcursionResult = { scope: 'campaign'; price: CampaignPriceFamily; unrealizedPnl: CampaignPnlFamily; };
export type ExcursionDistribution = { sampleCount: number; mean?: number; median?: number; q1?: number; q3?: number; bins: Array<{ min: number; max: number; includeMax: boolean; count: number }>; };
export type ExcursionPair = { mfe: ExcursionDistribution; mae: ExcursionDistribution; };
export type ExcursionStatusCounts = { success: number; stale: number; failed: number; missing: number; unsupported: number; };
export type TradeExcursionStatsFamily = { family: 'trade'; status: ExcursionStatusCounts; price: ExcursionPair; percent: ExcursionPair; unrealizedPnl: ExcursionPair; r: ExcursionPair; captureRate: ExcursionDistribution; counts: { eligibleSuccessCount: number; riskUnavailableCount: number; captureEligibleCount: number; }; };
export type CampaignPriceExcursionStatsFamily = { family: 'campaign_price'; status: ExcursionStatusCounts; price: ExcursionPair; percent: ExcursionPair; counts: { eligibleSuccessCount: number; heterogeneousUnavailableCount: number; }; };
export type CampaignUnrealizedPnlExcursionStatsFamily = { family: 'campaign_unrealized_pnl'; status: ExcursionStatusCounts; unrealizedPnl: ExcursionPair; r: ExcursionPair; captureRate: ExcursionDistribution; counts: { eligibleSuccessCount: number; riskUnavailableCount: number; captureEligibleCount: number; valuationUnavailableCount: number; }; };
export type TradeStatsExcursions = { unit: 'trade'; families: [TradeExcursionStatsFamily]; } | { unit: 'campaign'; families: [CampaignPriceExcursionStatsFamily, CampaignUnrealizedPnlExcursionStatsFamily]; };
export type TradeStatsUnit = 'campaign' | 'trade';
export type TradeStatsSession = 'asia' | 'london' | 'new-york' | 'off-session';
export type TradeStatsOutcome = 'win' | 'loss' | 'breakeven' | 'unclassified';
export type TradeStatsDimension = 'symbol' | 'side' | 'exitReason' | 'entryWeekday' | 'session' | 'baseTimeframe' | 'bollingerSetup' | 'executionEvaluation' | 'violationFlags' | 'holdDuration' | 'analysisCompleteness';
export interface TradeStatsSessionPreference { startMinutes: number; endMinutes: number; }
export interface TradeStatsPreferences { breakevenPercent: number; timeZone: string; tradingDayStartMinutes: number; sessions: Record<'asia' | 'london' | 'new-york', TradeStatsSessionPreference>; display: { timeZone: 'Asia/Seoul'; utcOffsetMinutes: number; tradingDayStartLabel: string; sessions: Record<'asia' | 'london' | 'new-york', { startLabel: string; endLabel: string }> }; }
export interface PatchTradeStatsPreferencesRequest { breakevenPercent?: number; timeZone?: string; tradingDayStartMinutes?: number; sessions?: Partial<Record<'asia' | 'london' | 'new-york', Partial<TradeStatsSessionPreference>>>; }
export interface TradeStatsQuery { accountId: string; unit?: TradeStatsUnit; from?: string; to?: string; symbols?: string[]; sides?: TradeSide[]; sessions?: TradeStatsSession[]; baseTimeframes?: string[]; outcomes?: TradeStatsOutcome[]; evaluations?: TradeExecutionEvaluation[]; violations?: string[]; exitReasons?: string[]; entryWeekdays?: string[]; bollingerSetups?: string[]; analysisCompleteness?: Array<'complete' | 'incomplete'>; holdDurationBands?: string[]; groupDimensions?: TradeStatsDimension[]; rowDimension?: TradeStatsDimension; columnDimension?: TradeStatsDimension; }
export interface TradeStatsMetric { value?: number; count: number; missingCount: number; }
export interface TradeStatsBucket { key: string; label: string; count: number; classifiedCount: number; winRate?: number; realizedPnl: number; oneLotPnl?: number; sufficiency: '1-9' | '10-29' | '30+'; }
export interface TradeStatsFilterOption { key: string; label: string; }
export interface TradeStatsOverview { totalTrades: number; totalRealizedPnl: number; totalProfitPnl?: number; totalLossPnl?: number; averageRealizedPnl: number; oneLotPnl?: number; winRate?: number; breakevenRate?: number; profitFactor?: number; payoff?: number; expectancy?: number; wins: number; losses: number; breakevens: number; classifiedCount: number; averageWin?: number; averageLoss?: number; maxWinStreak: number; currentWinStreak: number; maxLossStreak: number; currentLossStreak: number; totalRiskAmount: number; riskAmountCount: number; averageRiskPercent?: number; riskPercentCount: number; r: TradeStatsMetric & { total?: number; expectancy?: number }; }
export interface TradeStatsComparison { from?: string; to?: string; priorFrom?: string; priorTo?: string; current: TradeStatsOverview; prior: TradeStatsOverview; }
export type TradeStatsGranularity = 'sequence' | 'day' | 'week' | 'month' | 'year';
export interface TradeStatsSeriesPoint { key: string; label: string; timestamp: number; count: number; realizedPnl: number; equity: number; winRate?: number; }
export interface TradeStatsSeries { granularity: TradeStatsGranularity; points: TradeStatsSeriesPoint[]; activeBucketAverage: number; calendarBucketAverage: number; }
export interface TradeStatsPredicate { dimension: TradeStatsDimension; key: string; }
export interface TradeStatsCrosstabCell extends TradeStatsBucket { predicates: TradeStatsPredicate[]; }
export interface TradeStatsCrosstab { rowDimension: TradeStatsDimension; columnDimension: TradeStatsDimension; columns: Array<{ key: string; label: string; predicate: TradeStatsPredicate }>; rows: Array<{ key: string; label: string; predicate: TradeStatsPredicate; cells: TradeStatsCrosstabCell[] }>; }
export interface TradeStatsPerformanceGroup { key: string; labels: string[]; predicates: TradeStatsPredicate[]; count: number; classifiedCount: number; winRate?: number; totalPnl: number; averagePnl: number; averagePoint?: number; }
export interface TradeStatsDrawdown { money?: number; percent?: number; r?: number; }
export interface TradeStatsDistributionBin { key: string; min?: number; max?: number; count: number; }
export interface TradeStatsDistribution { metric: 'realizedPnl' | 'oneLotPnl' | 'r'; bins: TradeStatsDistributionBin[]; }
export interface TradeStatsDiagnostics { missingSeedCount: number; missingSeedIds: string[]; unclassifiedCount: number; missingLotsCount: number; missingLotsIds: string[]; missingRiskCount: number; missingRiskIds: string[]; incompleteCampaignCount: number; incompleteCampaignIds: string[]; }
export interface TradeStatsDrilldownRecord { id: string; targetId: string; type: 'campaign' | 'trade'; tradeIds: string[]; campaignId?: string; journalDate: string; accountId: string; symbol: string; side: TradeSide; openedAt: string; closedAt: string; realizedPnl: number; lots: number; outcome: TradeStatsOutcome; }
export interface TradeStatsResponse { preferences: TradeStatsPreferences; query: TradeStatsQuery; overview: TradeStatsOverview; comparison: TradeStatsComparison; timeSeries: Record<TradeStatsGranularity, TradeStatsSeries>; breakdowns: Partial<Record<TradeStatsDimension, TradeStatsBucket[]>>; filterOptions?: Partial<Record<TradeStatsDimension, TradeStatsFilterOption[]>>; performanceGroups: TradeStatsPerformanceGroup[]; crosstab: TradeStatsCrosstab; drawdown: TradeStatsDrawdown; diagnostics: TradeStatsDiagnostics; drilldown: TradeStatsDrilldownRecord[]; excursions?: TradeStatsExcursions; }
export interface TradeLogAssistantActionPatchAnalysis { type: 'patch_trade_analysis'; tradeId: string; payload: PatchTradeAnalysisRequest; }
export type TradeLogAssistantAction = TradeLogAssistantActionPatchAnalysis;
export interface TradeLogAssistantActionsRequest { accountId: string; rawText: string; source: 'telegram' | 'manual' | 'api'; actions: TradeLogAssistantAction[]; }
export interface TradeLogAssistantActionsResponse { rawText: string; source: 'telegram' | 'manual' | 'api'; trades: TradeRecord[]; }
export interface HealthResponse { status: 'ok'; service: string; timestamp: string; }
export type AppUserStatus = 'PENDING' | 'ACTIVE' | 'DISABLED';

export interface SignupRequest {
  username: string;
  password: string;
}

export interface SignupResponse {
  status: 'request_received';
}

export interface SafeUser {
  id: string;
  username: string;
  status: AppUserStatus;
  isAdmin: boolean;
  createdAt: string;
}

export interface SafeMt5AccountRef {
  id: string;
  nickname: string;
  server: string;
  accountLogin: number;
  timeCorrectionHours: number;
  active: boolean;
  replacedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMt5AccountRequest {
  nickname: string;
  server: string;
  accountLogin: number;
  password: string;
}

export interface UpdateMt5AccountRequest {
  nickname?: string;
  server?: string;
  accountLogin?: number;
  password?: string;
  timeCorrectionHours?: number;
  active?: boolean;
}

export interface AccountScopedRequest { accountId: string; }

export type Mt5SyncState = 'in_progress' | 'completed' | 'failed';

export interface Mt5SyncResponse {
  state: Mt5SyncState;
  accountId: string;
  importedCount?: number;
  receivedCount?: number;
  progress?: {
    mode: 'bootstrap' | 'incremental';
    snapshotToMsc: number;
    pageCursor?: string;
  };
  excursions?: {
    mode: 'disabled' | 'bridge_incompatible' | 'queued' | 'processed';
    queued: number; processed: number; succeeded: number; stale: number; failed: number; deferred: number;
    reasons: Array<{ reason: string; count: number }>;
  };
  syncedAt?: string;
  balanceLedger?: {
    status: 'verified' | 'diverged';
    currency: string;
    calculatedBalance: number;
    currentBalance: number;
  };
  message?: string;
}

export interface TradeCampaignImage {
  id: string;
  campaignId: string;
  position: number;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReorderTradeCampaignImagesRequest {
  imageIds: string[];
}
