import { Injectable } from '@nestjs/common';
import type { HealthResponse, TradeRecord } from '@trading-journal/shared';

@Injectable()
export class AppService {
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'trading-journal-api',
      timestamp: new Date().toISOString(),
    };
  }

  listTrades(): TradeRecord[] {
    return [];
  }
}
