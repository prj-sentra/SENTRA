export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';

export interface TradeEntry {
  price: number;
  quantity?: number;
  occurredAt: string;
  note?: string;
}

export interface TradeExit {
  price: number;
  quantity?: number;
  occurredAt: string;
  reason?: 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit';
  note?: string;
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
  entry?: TradeEntry;
  exit?: TradeExit;
  createdAt: string;
  updatedAt: string;
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
