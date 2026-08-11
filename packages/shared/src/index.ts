export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';
export type TradeAnalysisPrimaryTrend = 'up' | 'up_sideways' | 'down' | 'down_sideways';
export type TradeAnalysisBollingerBandCount = 'one_band' | 'two_band';
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
  entryReason?: string | null; invalidationCondition?: string | null; takeProfitCondition?: string | null; additionalEntryPlan?: string | null;
  tradeScore?: number | null; strengths?: string | null; weaknesses?: string | null;
}
export interface PatchTradeCampaignMemoRequest { memo: string | null; expectedUpdatedAt: string; }
export interface TradeEntry { price: number; quantity?: number; occurredAt: string; note?: string; }
export type TradeExitReason = 'target_hit' | 'stop_loss' | 'manual' | 'forced_liquidation' | 'automated' | 'rollover' | 'variation_margin' | 'split' | 'corporate_action' | 'other' | 'invalidated' | 'time_exit';
export interface TradeExit { price: number; quantity?: number; occurredAt: string; reason?: TradeExitReason; note?: string; }
export interface TradeRecord { id: string; symbol: string; side: TradeSide; status: TradeStatus; accountId: string; mt5Server?: string; strategy?: string; thesis?: string; entryRationale?: string; exitRationale?: string; takeProfitCriteria?: string; stopLossCriteria?: string; note?: string; accountCurrency?: string; quantityLots?: number; entryPrice?: number; exitPrice?: number; exitReason?: TradeExitReason; realizedPnl?: number; openedAt?: string; closedAt?: string; seedBalance?: number; plannedTakeProfitPrice?: number; plannedStopLossPrice?: number; riskAmount?: number; riskPercent?: number; returnPercent?: number; rr?: number; analysisComplete: boolean; analysis: TradeAnalysis; entry?: TradeEntry; exit?: TradeExit; createdAt: string; updatedAt: string; }
export type CampaignMembershipSource = 'auto' | 'manual';
export interface CampaignConflict { id: string; tradeId: string; candidateCampaignIds: string[]; status: 'unresolved' | 'resolved'; resolvedCampaignId?: string; createdAt: string; resolvedAt?: string; }
export interface TradeCampaign { id: string; rootTradeId: string; tradingDate: string; accountId: string; symbol: string; side: TradeSide; status: 'open' | 'closed'; entryPrice?: number; exitPrice?: number; quantityLots: number; remainingQuantityLots: number; exitReason?: string; realizedPnl: number; openedAt: string; closedAt?: string; seedBalance?: number; images: TradeCampaignImage[]; memo?: string; updatedAt: string; analysisComplete: boolean; analysis: TradeCampaignAnalysis; members: TradeRecord[]; conflicts: CampaignConflict[]; }
export interface TradeCampaignDateResponse { date?: string; previousDate?: string; nextDate?: string; campaigns: TradeCampaign[]; diagnostics: { missingOpenedAtTradeIds: string[] }; }
export interface RelinkTradeCampaignRequest { accountId: string; tradeId: string; campaignId?: string; }
export interface ResolveCampaignConflictRequest { accountId: string; campaignId: string; }
export interface TradeStatsBucket { key: string; label: string; count: number; winRate: number; realizedPnl: number; }
export interface TradeOverviewStats { totalTrades: number; totalRealizedPnl: number; averageRealizedPnl: number; winRate: number; totalRiskAmount: number; riskAmountCount: number; averageRiskPercent: number; riskPercentCount: number; }
export interface TradeStatsResponse { overview: TradeOverviewStats; bySession: TradeStatsBucket[]; byBaseTimeframe: TradeStatsBucket[]; }
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
  cursor?: string;
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
