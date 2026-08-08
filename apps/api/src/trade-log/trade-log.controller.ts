import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type {
  PatchTradeAnalysisRequest,
  RelinkTradeCampaignRequest,
  ResolveCampaignConflictRequest,
  TradeCampaignDateResponse,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  TradeStatsResponse,
  UpdateTradeExecutionNoteRequest,
  UpdateTradeRequest,
} from '@trading-journal/shared';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { CampaignImageService, type CampaignImageRecord } from './campaign-image.service';
import { TradeLogService } from './trade-log.service';

@Controller('trade-log')
export class TradeLogController {
  constructor(
    private readonly tradeLogService: TradeLogService,
    private readonly campaignImageService: CampaignImageService,
  ) {}

  @Post('assistant-actions')
  applyAssistantActions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: TradeLogAssistantActionsRequest,
  ): Promise<TradeLogAssistantActionsResponse> {
    return this.tradeLogService.applyAssistantActions(user.id, request);
  }

  @Get('campaigns')
  campaigns(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
    @Query('scope') scope?: 'all' | 'manual' | 'account',
    @Query('accountId') accountId?: string,
  ): Promise<TradeCampaignDateResponse> {
    return this.tradeLogService.listCampaigns(user.id, date, { scope, accountId });
  }

  @Get('stats')
  stats(
    @CurrentUser() user: AuthenticatedUser,
    @Query('scope') scope?: 'all' | 'manual' | 'account',
    @Query('accountId') accountId?: string,
  ): Promise<TradeStatsResponse> {
    return this.tradeLogService.getStats(user.id, { scope, accountId });
  }

  @Get('trades/:id')
  trade(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<TradeRecord> {
    return this.tradeLogService.getTrade(user.id, id);
  }

  @Patch('trades/:id')
  updateTrade(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() request: UpdateTradeRequest): Promise<TradeRecord> {
    return this.tradeLogService.updateTrade(user.id, id, request);
  }

  @Patch('trades/:id/analysis')
  patchAnalysis(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() request: PatchTradeAnalysisRequest): Promise<TradeRecord> {
    return this.tradeLogService.patchTradeAnalysis(user.id, id, request);
  }

  @Patch('trades/:id/entry/note')
  updateEntryNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() request: UpdateTradeExecutionNoteRequest): Promise<TradeRecord> {
    return this.tradeLogService.updateTradeEntryNote(user.id, id, request);
  }

  @Patch('trades/:id/exit/note')
  updateExitNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() request: UpdateTradeExecutionNoteRequest): Promise<TradeRecord> {
    return this.tradeLogService.updateTradeExitNote(user.id, id, request);
  }

  @Post('campaigns/relink')
  relinkCampaign(@CurrentUser() user: AuthenticatedUser, @Body() request: RelinkTradeCampaignRequest): Promise<void> {
    return this.tradeLogService.relinkCampaign(user.id, request);
  }

  @Post('campaign-conflicts/:id/resolve')
  resolveCampaignConflict(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() request: ResolveCampaignConflictRequest): Promise<void> {
    return this.tradeLogService.resolveCampaignConflict(user.id, id, request);
  }
  @Get('campaigns/:campaignId/images')
  images(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string): Promise<CampaignImageRecord[]> {
    return this.campaignImageService.list(user.id, campaignId);
  }

  @Post('campaigns/:campaignId/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadImage(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @UploadedFile() file?: Express.Multer.File): Promise<CampaignImageRecord> {
    return this.campaignImageService.upload(user.id, campaignId, file);
  }

  @Put('campaigns/:campaignId/images/order')
  reorderImages(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Body() request: { imageIds: string[] }): Promise<CampaignImageRecord[]> {
    return this.campaignImageService.reorder(user.id, campaignId, request?.imageIds);
  }

  @Get('campaigns/:campaignId/images/:imageId')
  async image(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Param('imageId') imageId: string, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const image = await this.campaignImageService.get(user.id, campaignId, imageId);
    response.set({ 'Content-Type': image.record.mimeType, 'Content-Length': image.buffer.byteLength.toString(), 'Cache-Control': 'private, max-age=31536000, immutable' });
    return new StreamableFile(image.buffer);
  }

  @Delete('campaigns/:campaignId/images/:imageId')
  removeImage(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Param('imageId') imageId: string): Promise<void> {
    return this.campaignImageService.remove(user.id, campaignId, imageId);
  }
}
