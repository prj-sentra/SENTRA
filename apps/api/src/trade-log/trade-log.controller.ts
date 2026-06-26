import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, TradeRecord } from '@trading-journal/shared';
import { TradeLogService } from './trade-log.service';

@Controller('trade-log')
export class TradeLogController {
  constructor(private readonly tradeLogService: TradeLogService) {}

  @Get('health')
  health(): HealthResponse {
    return this.tradeLogService.health();
  }

  @Get('trades')
  trades(): TradeRecord[] {
    return this.tradeLogService.listTrades();
  }
}
