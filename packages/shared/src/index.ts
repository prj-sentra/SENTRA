export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';

export interface CreateTradeRequest {
  symbol: string;
  side: TradeSide;
  timeframe?: string;
  session?: string;
  strategy?: string;
  thesis?: string;
  note?: string;
}

export interface TradeEntryRequest {
  price: number;
  quantity?: number;
  occurredAt: string;
  note?: string;
}

export interface TradeExitRequest {
  price: number;
  quantity?: number;
  occurredAt: string;
  reason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit';
  note?: string;
}

export interface TradeEntry extends TradeEntryRequest {}
export interface TradeExit extends TradeExitRequest {}

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
  entry?: TradeEntry;
  exit?: TradeExit;
  createdAt: string;
  updatedAt: string;
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

export type TradeLogAssistantAction =
  | TradeLogAssistantActionCreateTrade
  | TradeLogAssistantActionRecordEntry
  | TradeLogAssistantActionRecordExit;

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
