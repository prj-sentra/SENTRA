import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type {
  CreateTradeRequest,
  HealthResponse,
  TradeEntryRequest,
  TradeExitRequest,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  UpdateTradeJournalRequest,
} from '@trading-journal/shared';
import { TradeLogService } from './trade-log.service';

@Controller('trade-log')
export class TradeLogController {
  constructor(private readonly tradeLogService: TradeLogService) {}

  @Get('health')
  health(): HealthResponse {
    return this.tradeLogService.health();
  }

  @Post('assistant-actions')
  applyAssistantActions(
    @Body() request: TradeLogAssistantActionsRequest,
  ): Promise<TradeLogAssistantActionsResponse> {
    return this.tradeLogService.applyAssistantActions(request);
  }

  @Post('trades')
  createTrade(@Body() request: CreateTradeRequest): Promise<TradeRecord> {
    return this.tradeLogService.createTrade(request);
  }

  @Get('trades')
  trades(): Promise<TradeRecord[]> {
    return this.tradeLogService.listTrades();
  }

  @Get('trades/:id')
  trade(@Param('id') id: string): Promise<TradeRecord> {
    return this.tradeLogService.getTrade(id);
  }

  @Patch('trades/:id/journal')
  patchJournal(@Param('id') id: string, @Body() request: UpdateTradeJournalRequest): Promise<TradeRecord> {
    return this.tradeLogService.patchTradeJournal(id, request);
  }

  @Post('trades/:id/entry')
  recordEntry(@Param('id') id: string, @Body() request: TradeEntryRequest): Promise<TradeRecord> {
    return this.tradeLogService.recordEntry(id, request);
  }

  @Post('trades/:id/exit')
  recordExit(@Param('id') id: string, @Body() request: TradeExitRequest): Promise<TradeRecord> {
    return this.tradeLogService.recordExit(id, request);
  }
}
