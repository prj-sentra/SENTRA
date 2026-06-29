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

export interface WikiPageSummary {
  slug: string;
  title: string;
  type: 'concept' | 'strategy' | 'setup' | 'mistake' | 'playbook' | 'query';
  updatedAt: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
