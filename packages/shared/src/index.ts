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
  schemaVersion: 1; baseTimeframe?: string; primaryTrend?: TradeAnalysisPrimaryTrend;
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
  expectedUpdatedAt: string; baseTimeframe?: string | null; primaryTrend?: TradeAnalysisPrimaryTrend | null;
  bollingerBandCount?: TradeAnalysisBollingerBandCount | null; bollingerDirection?: TradeAnalysisBollingerDirection | null;
  maArrangement?: TradeAnalysisMaArrangement | null; cross?: TradeAnalysisCross | null; stopLossLine?: number | null;
  marketZoneEnabled?: boolean; marketZoneHigh?: number | null; marketZoneLow?: number | null;
  chartPatternObserved?: boolean; chartPatternTimeframe?: string | null; chartPatternType?: TradeAnalysisChartPatternType | null;
  retailPositionEnabled?: boolean; retailBuyAveragePrice?: number | null; retailSellAveragePrice?: number | null; retailBuyRatio?: number | null;
  fibonacciEnabled?: boolean; fibonacciStartPrice?: number | null; fibonacciEndPrice?: number | null; regret?: string | null;
  economicIndicators?: TradeAnalysisEconomicIndicatorInput[];
}
export interface UpdateTradeRequest { strategy?: string | null; thesis?: string | null; entryRationale?: string | null; exitRationale?: string | null; takeProfitCriteria?: string | null; stopLossCriteria?: string | null; note?: string | null; }
export interface UpdateTradeExecutionNoteRequest { note?: string | null; }
export interface TradeEntry { price: number; quantity?: number; occurredAt: string; note?: string; }
export interface TradeExit { price: number; quantity?: number; occurredAt: string; reason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit'; note?: string; }
export interface TradeChartImage { mimeType: string; byteSize: number; width: number; height: number; originalName?: string; updatedAt: string; }
export interface TradeRecord { id: string; symbol: string; side: TradeSide; status: TradeStatus; strategy?: string; thesis?: string; entryRationale?: string; exitRationale?: string; takeProfitCriteria?: string; stopLossCriteria?: string; note?: string; accountCurrency?: string; quantityLots?: number; entryPrice?: number; exitPrice?: number; exitReason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit'; realizedPnl?: number; takeProfitPrice?: number; stopLossPrice?: number; openedAt?: string; closedAt?: string; seedBalance?: number; riskAmount?: number; riskPercent?: number; analysis: TradeAnalysis; entry?: TradeEntry; exit?: TradeExit; chartImage?: TradeChartImage; createdAt: string; updatedAt: string; }
export type CampaignMembershipSource = 'auto' | 'manual';
export interface CampaignConflict { id: string; tradeId: string; candidateCampaignIds: string[]; status: 'unresolved' | 'resolved'; resolvedCampaignId?: string; createdAt: string; resolvedAt?: string; }
export interface TradeCampaign { id: string; rootTradeId: string; tradingDate: string; symbol: string; side: TradeSide; status: 'open' | 'closed'; entryPrice?: number; exitPrice?: number; quantityLots: number; remainingQuantityLots: number; exitReason?: string; realizedPnl: number; openedAt: string; closedAt?: string; takeProfitPrice?: number; stopLossPrice?: number; seedBalance?: number; riskAmount?: number; riskPercent?: number; chartImage?: TradeChartImage; regret?: string; members: TradeRecord[]; conflicts: CampaignConflict[]; }
export interface TradeCampaignDateResponse { date?: string; previousDate?: string; nextDate?: string; campaigns: TradeCampaign[]; diagnostics: { missingOpenedAtTradeIds: string[] }; }
export interface RelinkTradeCampaignRequest { tradeId: string; campaignId?: string; }
export interface ResolveCampaignConflictRequest { campaignId: string; }
export interface TradeStatsBucket { key: string; label: string; count: number; winRate: number; realizedPoints: number; }
export interface TradeOverviewStats { totalTrades: number; totalRealizedPoints: number; averageRealizedPoints: number; winRate: number; totalRiskAmount: number; riskAmountCount: number; averageRiskPercent: number; riskPercentCount: number; }
export interface TradeStatsResponse { overview: TradeOverviewStats; bySession: TradeStatsBucket[]; byBaseTimeframe: TradeStatsBucket[]; }
export interface TradeLogAssistantActionPatchAnalysis { type: 'patch_trade_analysis'; tradeId: string; payload: PatchTradeAnalysisRequest; }
export type TradeLogAssistantAction = TradeLogAssistantActionPatchAnalysis;
export interface TradeLogAssistantActionsRequest { rawText: string; source: 'telegram' | 'manual' | 'api'; actions: TradeLogAssistantAction[]; }
export interface TradeLogAssistantActionsResponse { rawText: string; source: 'telegram' | 'manual' | 'api'; trades: TradeRecord[]; }
export interface TradeLogMt5SyncResponse { source: 'mt5'; syncedAt: string; importedCount: number; receivedCount?: number; server?: string; accountLogin?: number; from?: string; to?: string; lastDealTime?: string | null; trades: TradeRecord[]; }
export interface HealthResponse { status: 'ok'; service: string; timestamp: string; }
export type AppUserStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';

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
  active?: boolean;
}

export type TradeAccountScope =
  | { scope: 'all' }
  | { scope: 'manual' }
  | { scope: 'account'; accountId: string };

export type Mt5SyncState = 'in_progress' | 'completed' | 'failed';

export interface Mt5SyncResponse {
  state: Mt5SyncState;
  accountId: string;
  importedCount?: number;
  receivedCount?: number;
  cursor?: string;
  syncedAt?: string;
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
  createdAt: string;
  streamUrl: string;
}

export interface ReorderTradeCampaignImagesRequest {
  imageIds: string[];
}
