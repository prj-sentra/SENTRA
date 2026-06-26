export type TradeSide = 'long' | 'short';
export type TradeStatus = 'planned' | 'open' | 'closed' | 'cancelled';

export interface TradeRecord {
  id: string;
  symbol: string;
  side: TradeSide;
  status: TradeStatus;
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  riskAmount?: number;
  thesis: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
