import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type {
  CreateTradeRequest,
  HealthResponse,
  TradeEntryRequest,
  TradeExitRequest,
  TradeRecord,
} from '@trading-journal/shared';
import { TradeLogService } from './trade-log.service';

@Controller('trade-log')
export class TradeLogController {
  constructor(private readonly tradeLogService: TradeLogService) {}

  @Get('health')
  health(): HealthResponse {
    return this.tradeLogService.health();
  }

  @Post('trades')
  createTrade(@Body() request: CreateTradeRequest): TradeRecord {
    return this.tradeLogService.createTrade(request);
  }

  @Get('trades')
  trades(): TradeRecord[] {
    return this.tradeLogService.listTrades();
  }

  @Get('trades/:id')
  trade(@Param('id') id: string): TradeRecord {
    return this.tradeLogService.getTrade(id);
  }

  @Post('trades/:id/entry')
  recordEntry(@Param('id') id: string, @Body() request: TradeEntryRequest): TradeRecord {
    return this.tradeLogService.recordEntry(id, request);
  }

  @Post('trades/:id/exit')
  recordExit(@Param('id') id: string, @Body() request: TradeExitRequest): TradeRecord {
    return this.tradeLogService.recordExit(id, request);
  }
}
