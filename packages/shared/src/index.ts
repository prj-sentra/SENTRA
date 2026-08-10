export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';
export type TradeAnalysisPrimaryTrend = 'up' | 'sideways' | 'down';
export type TradeAnalysisBollingerBandCount = 'one_band' | 'two_band';
export type TradeAnalysisBollingerDirection = 'normal' | 'reverse' | 'chase';
export type TradeAnalysisMaArrangement = 'bullish' | 'bearish' | 'congested';
export type TradeAnalysisCross = 'none' | 'golden_20_60' | 'golden_20_120' | 'dead_20_60' | 'dead_20_120';
export type TradeAnalysisChartPatternType = 'double_top' | 'double_bottom' | 'head_shoulders' | 'inverse_head_shoulders';
export type TradeAnalysisEconomicIndicatorImpact = 'positive' | 'negative';

export interface TradeAnalysisEconomicIndicator { id: string; type: string; impact: TradeAnalysisEconomicIndicatorImpact; position: number; }
export interface TradeAnalysis {
  schemaVersion: 1; note?: string; baseTimeframe?: string; primaryTrend?: TradeAnalysisPrimaryTrend;
  bollingerBandCount?: TradeAnalysisBollingerBandCount; bollingerDirection?: TradeAnalysisBollingerDirection;
  maArrangement?: TradeAnalysisMaArrangement; cross?: TradeAnalysisCross; stopLossLine?: number;
  marketZoneEnabled: boolean; marketZoneHigh?: number; marketZoneLow?: number;
  chartPatternObserved: boolean; chartPatternTimeframe?: string; chartPatternType?: TradeAnalysisChartPatternType;
  retailPositionEnabled: boolean; retailBuyAveragePrice?: number; retailSellAveragePrice?: number; retailBuyRatio?: number;
  fibonacciEnabled: boolean; fibonacciStartPrice?: number; fibonacciEndPrice?: number; regret?: string;
  economicIndicators: TradeAnalysisEconomicIndicator[]; createdAt: string; updatedAt: string;
}
export interface TradeAnalysisEconomicIndicatorInput { id?: string; type: string; impact: TradeAnalysisEconomicIndicatorImpact; }
export interface PatchTradeAnalysisRequest {
  expectedUpdatedAt: string; note?: string | null; baseTimeframe?: string | null; primaryTrend?: TradeAnalysisPrimaryTrend | null;
  bollingerBandCount?: TradeAnalysisBollingerBandCount | null; bollingerDirection?: TradeAnalysisBollingerDirection | null;
  maArrangement?: TradeAnalysisMaArrangement | null; cross?: TradeAnalysisCross | null; stopLossLine?: number | null;
  marketZoneEnabled?: boolean; marketZoneHigh?: number | null; marketZoneLow?: number | null;
  chartPatternObserved?: boolean; chartPatternTimeframe?: string | null; chartPatternType?: TradeAnalysisChartPatternType | null;
  retailPositionEnabled?: boolean; retailBuyAveragePrice?: number | null; retailSellAveragePrice?: number | null; retailBuyRatio?: number | null;
  fibonacciEnabled?: boolean; fibonacciStartPrice?: number | null; fibonacciEndPrice?: number | null; regret?: string | null;
  economicIndicators?: TradeAnalysisEconomicIndicatorInput[];
}
export interface TradeEntry { price: number; quantity?: number; occurredAt: string; note?: string; }
export interface TradeExit { price: number; quantity?: number; occurredAt: string; reason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit'; note?: string; }
export interface TradeRecord { id: string; symbol: string; side: TradeSide; status: TradeStatus; accountId: string; mt5Server?: string; strategy?: string; thesis?: string; entryRationale?: string; exitRationale?: string; takeProfitCriteria?: string; stopLossCriteria?: string; note?: string; accountCurrency?: string; quantityLots?: number; entryPrice?: number; exitPrice?: number; exitReason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit'; realizedPnl?: number; openedAt?: string; closedAt?: string; seedBalance?: number; initialTakeProfitPrice?: number; initialStopLossPrice?: number; riskAmount?: number; riskPercent?: number; returnPercent?: number; analysisComplete: boolean; analysis: TradeAnalysis; entry?: TradeEntry; exit?: TradeExit; createdAt: string; updatedAt: string; }
export type CampaignMembershipSource = 'auto' | 'manual';
export interface CampaignConflict { id: string; tradeId: string; candidateCampaignIds: string[]; status: 'unresolved' | 'resolved'; resolvedCampaignId?: string; createdAt: string; resolvedAt?: string; }
export interface TradeCampaign { id: string; rootTradeId: string; tradingDate: string; accountId: string; symbol: string; side: TradeSide; status: 'open' | 'closed'; entryPrice?: number; exitPrice?: number; quantityLots: number; remainingQuantityLots: number; exitReason?: string; realizedPnl: number; openedAt: string; closedAt?: string; seedBalance?: number; images: TradeCampaignImage[]; regret?: string; analysisComplete: boolean; members: TradeRecord[]; conflicts: CampaignConflict[]; }
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
