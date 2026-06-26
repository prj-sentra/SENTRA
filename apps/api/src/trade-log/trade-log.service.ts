import { Injectable } from '@nestjs/common';
import type { HealthResponse, TradeRecord } from '@trading-journal/shared';

@Injectable()
export class TradeLogService {
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'sentra-trade-log',
      timestamp: new Date().toISOString(),
    };
  }

  listTrades(): TradeRecord[] {
    return [];
  }
}
