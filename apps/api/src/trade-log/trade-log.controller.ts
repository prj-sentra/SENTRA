import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import type {
  CreateTradeRequest,
  CreateTradeTagRequest,
  HealthResponse,
  TradeEntryRequest,
  TradeExitRequest,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeLogMt5SyncResponse,
  TradeRecord,
  TradeStatsResponse,
  TradeTagCatalog,
  TradeTagDefinition,
  TradeTagField,
  UpdateTradeEntryRequest,
  UpdateTradeExitRequest,
  UpdateTradeJournalRequest,
  UpdateTradeRequest,
} from '@trading-journal/shared';
import { TradeLogService } from './trade-log.service';

@Controller('trade-log')
export class TradeLogController {
  private assertMt5SyncToken(providedToken: string | undefined): void {
    const expectedToken = process.env.MT5_SYNC_TOKEN?.trim();
    if (!expectedToken || !providedToken || providedToken !== expectedToken) {
      throw new UnauthorizedException('Valid MT5 sync token required');
    }
  }
  constructor(private readonly tradeLogService: TradeLogService) {}

  @Get('health')
  health(): HealthResponse {
    return this.tradeLogService.health();
  }

  @Get('tags')
  tags(@Query('field') field?: TradeTagField): Promise<TradeTagCatalog | TradeTagDefinition[]> {
    return field ? this.tradeLogService.listTagsByField(field) : this.tradeLogService.listTags();
  }

  @Post('tags')
  createTag(@Body() request: CreateTradeTagRequest): Promise<TradeTagDefinition> {
    return this.tradeLogService.createTag(request);
  }

  @Post('assistant-actions')
  applyAssistantActions(
    @Body() request: TradeLogAssistantActionsRequest,
  ): Promise<TradeLogAssistantActionsResponse> {
    return this.tradeLogService.applyAssistantActions(request);
  }

  @Post('mt5/sync')
  syncMt5Trades(@Headers('x-mt5-sync-token') syncToken: string | undefined): Promise<TradeLogMt5SyncResponse> {
    this.assertMt5SyncToken(syncToken);
    return this.tradeLogService.syncMt5Trades();
  }

  @Post('trades')
  createTrade(@Body() request: CreateTradeRequest): Promise<TradeRecord> {
    return this.tradeLogService.createTrade(request);
  }

  @Get('trades')
  trades(): Promise<TradeRecord[]> {
    return this.tradeLogService.listTrades();
  }

  @Get('stats')
  stats(): Promise<TradeStatsResponse> {
    return this.tradeLogService.getStats();
  }

  @Get('trades/:id')
  trade(@Param('id') id: string): Promise<TradeRecord> {
    return this.tradeLogService.getTrade(id);
  }

  @Patch('trades/:id')
  updateTrade(@Param('id') id: string, @Body() request: UpdateTradeRequest): Promise<TradeRecord> {
    return this.tradeLogService.updateTrade(id, request);
  }

  @Patch('trades/:id/journal')
  patchJournal(@Param('id') id: string, @Body() request: UpdateTradeJournalRequest): Promise<TradeRecord> {
    return this.tradeLogService.patchTradeJournal(id, request);
  }

  @Post('trades/:id/entry')
  recordEntry(@Param('id') id: string, @Body() request: TradeEntryRequest): Promise<TradeRecord> {
    return this.tradeLogService.recordEntry(id, request);
  }

  @Patch('trades/:id/entry')
  updateEntry(@Param('id') id: string, @Body() request: UpdateTradeEntryRequest): Promise<TradeRecord> {
    return this.tradeLogService.updateTradeEntry(id, request);
  }

  @Post('trades/:id/exit')
  recordExit(@Param('id') id: string, @Body() request: TradeExitRequest): Promise<TradeRecord> {
    return this.tradeLogService.recordExit(id, request);
  }

  @Patch('trades/:id/exit')
  updateExit(@Param('id') id: string, @Body() request: UpdateTradeExitRequest): Promise<TradeRecord> {
    return this.tradeLogService.updateTradeExit(id, request);
  }
}
