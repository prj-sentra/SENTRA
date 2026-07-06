export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';
export type TradeProcessVerdict = 'good' | 'bad' | 'repeat-ban' | 'observe';
export type TradeSessionTag = 'asia' | 'london' | 'new-york' | 'off-session' | 'other';
export type TradeTimeframeTag = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | 'other';
export type TradeTagField = 'setup' | 'rule-violation' | 'lesson' | 'result-label';
export type TradeTagLabel = string;
export type TradeSetupTag = TradeTagLabel;
export type TradeReviewTag = TradeTagLabel;

export interface TradeTagDefinition {
  id: number;
  field: TradeTagField;
  label: string;
  normalizedLabel: string;
  systemDefined: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TradeTagCatalog {
  setup: TradeTagDefinition[];
  ruleViolation: TradeTagDefinition[];
  lesson: TradeTagDefinition[];
  resultLabel: TradeTagDefinition[];
}

export interface TradeJournalPlan {
  setupType?: string;
  setupTag?: TradeTagLabel;
  setupTags?: TradeTagLabel[];
  entryModel?: string;
  confirmations?: string[];
  invalidation?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  plannedLossAmount?: number;
  dailyLossLimit?: number;
  calmState?: boolean;
  checklistNotes?: string;
}

export interface TradeJournalManagement {
  breakevenRule?: string;
  additionRule?: string;
  exitTriggers?: string[];
  managementNotes?: string;
}

export interface TradeJournalReview {
  resultLabel?: string;
  processVerdict?: TradeProcessVerdict;
  ruleViolations?: string[];
  ruleViolationTags?: TradeTagLabel[];
  lessons?: string[];
  lessonTags?: TradeTagLabel[];
  realizedPnlText?: string;
  reviewNotes?: string;
}

export interface TradeJournalContext {
  plan?: TradeJournalPlan;
  management?: TradeJournalManagement;
  review?: TradeJournalReview;
}

export interface UpdateTradeJournalRequest extends TradeJournalContext {}

export interface CreateTradeRequest {
  symbol: string;
  side: TradeSide;
  timeframe?: string;
  session?: string;
  strategy?: string;
  thesis?: string;
  note?: string;
  journal?: TradeJournalContext;
}

export interface UpdateTradeRequest {
  symbol?: string;
  side?: TradeSide;
  timeframe?: string;
  session?: string;
  strategy?: string;
  thesis?: string;
  note?: string;
  journal?: TradeJournalContext;
}

export interface TradeEntryRequest {
  price: number;
  quantity?: number;
  occurredAt: string;
  note?: string;
}

export interface UpdateTradeEntryRequest {
  price?: number;
  quantity?: number;
  occurredAt?: string;
  note?: string;
}

export interface TradeExitRequest {
  price: number;
  quantity?: number;
  occurredAt: string;
  reason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit';
  note?: string;
}

export interface UpdateTradeExitRequest {
  price?: number;
  quantity?: number;
  occurredAt?: string;
  reason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit';
  note?: string;
}

export interface CreateTradeTagRequest {
  field: TradeTagField;
  label: string;
}

export interface TradeEntry extends TradeEntryRequest {}
export interface TradeExit extends TradeExitRequest {}

export interface TradeRecordTagRefs {
  setupTags: TradeTagDefinition[];
  ruleViolationTags: TradeTagDefinition[];
  lessonTags: TradeTagDefinition[];
  resultLabel?: TradeTagDefinition;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: TradeSide;
  status: TradeStatus;
  timeframe?: string;
  session?: string;
  strategy?: string;
  thesis?: string;
  note?: string;
  journal?: TradeJournalContext;
  tags?: TradeRecordTagRefs;
  entry?: TradeEntry;
  exit?: TradeExit;
  createdAt: string;
  updatedAt: string;
}

export interface TradeStatsBucket {
  key: string;
  label: string;
  count: number;
  winRate: number;
  realizedPoints: number;
  goodCount: number;
  observeCount: number;
  badCount: number;
  repeatBanCount: number;
}

export interface TradeTagCount {
  label: string;
  count: number;
}

export interface TradeChecklistRates {
  stopLossDefinedRate: number;
  takeProfitDefinedRate: number;
  confirmationsAtLeastThreeRate: number;
  calmStateRate: number;
  ruleViolationTaggedRate: number;
  lessonsTaggedRate: number;
}

export interface TradeOverviewStats {
  totalTrades: number;
  totalRealizedPoints: number;
  averageRealizedPoints: number;
  winRate: number;
  goodCount: number;
  observeCount: number;
  badCount: number;
  repeatBanCount: number;
}

export interface TradeStatsResponse {
  overview: TradeOverviewStats;
  checklistRates: TradeChecklistRates;
  topRuleViolations: TradeTagCount[];
  topLessons: TradeTagCount[];
  topResultLabels: TradeTagCount[];
  bySession: TradeStatsBucket[];
  byTimeframe: TradeStatsBucket[];
  bySetupType: TradeStatsBucket[];
}

export interface TradeLogAssistantActionCreateTrade {
  type: 'create_trade';
  payload: CreateTradeRequest;
}

export interface TradeLogAssistantActionRecordEntry {
  type: 'record_entry';
  tradeRef?: 'last_created';
  payload: TradeEntryRequest;
}

export interface TradeLogAssistantActionRecordExit {
  type: 'record_exit';
  tradeId: string;
  payload: TradeExitRequest;
}

export interface TradeLogAssistantActionPatchJournal {
  type: 'patch_trade_journal';
  tradeId: string;
  payload: UpdateTradeJournalRequest;
}

export type TradeLogAssistantAction =
  | TradeLogAssistantActionCreateTrade
  | TradeLogAssistantActionRecordEntry
  | TradeLogAssistantActionRecordExit
  | TradeLogAssistantActionPatchJournal;

export interface TradeLogAssistantActionsRequest {
  rawText: string;
  source: 'telegram' | 'manual' | 'api';
  actions: TradeLogAssistantAction[];
}

export interface TradeLogAssistantActionsResponse {
  rawText: string;
  source: 'telegram' | 'manual' | 'api';
  trades: TradeRecord[];
}

export type WikiPageType = 'entity' | 'concept' | 'comparison' | 'query' | 'summary' | 'raw' | string;
export type WikiConfidence = 'high' | 'medium' | 'low';

export interface WikiPageSummary {
  slug: string;
  title: string;
  type: WikiPageType;
  updatedAt: string;
  tags: string[];
  order?: number;
  excerpt?: string;
}

export interface WikiPageDetail extends WikiPageSummary {
  created?: string;
  updated?: string;
  sources: string[];
  confidence?: WikiConfidence;
  contested?: boolean;
  contradictions?: string[];
  bodyMarkdown: string;
  bodyHtml: string;
  outboundLinks: string[];
  inboundLinks: string[];
  assetUrls: string[];
}

export interface CreateWikiPageRequest {
  slug: string;
  title: string;
  type: WikiPageType;
  tags: string[];
  sources: string[];
  bodyMarkdown: string;
  order?: number;
  summary?: string;
  confidence?: WikiConfidence;
}

export interface UpdateWikiPageRequest {
  title: string;
  type: WikiPageType;
  tags: string[];
  sources: string[];
  bodyMarkdown: string;
  order?: number;
  summary?: string;
  confidence?: WikiConfidence;
}

export interface WikiLintIssue {
  severity: 'error' | 'warning';
  code: 'broken_link' | 'orphan_page' | 'missing_index_entry' | 'missing_frontmatter_field' | string;
  message: string;
  path?: string;
  target?: string;
}

export interface WikiLintReport {
  summary: {
    totalPages: number;
    issueCount: number;
    generatedAt: string;
  };
  issues: WikiLintIssue[];
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
