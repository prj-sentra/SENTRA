import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type {
  PatchTradeAnalysisRequest,
  PatchTradeCampaignAnalysisRequest,
  PatchTradeCampaignMemoRequest,
  PatchTradeCampaignReviewRequest,
  PatchTradeStatsPreferencesRequest,
  RelinkTradeCampaignRequest,
  ResolveCampaignConflictRequest,
  SetTradeCampaignHeadRequest,
  UnsetTradeCampaignHeadRequest,
  CampaignHeadMutationResponse,
  TradeCampaignDateResponse,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  TradeStatsPreferences,
  TradeStatsQuery,
  TradeStatsResponse,
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
    @Query('accountId') accountId?: string,
  ): Promise<TradeCampaignDateResponse> {
    return this.tradeLogService.listCampaigns(user.id, date, accountId);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser, @Query() query: TradeStatsQuery): Promise<TradeStatsResponse> {
    return this.tradeLogService.getStats(user.id, query);
  }
  @Get('stats/preferences')
  statsPreferences(@CurrentUser() user: AuthenticatedUser): Promise<TradeStatsPreferences> {
    return this.tradeLogService.getStatsPreferences(user.id);
  }
  @Patch('stats/preferences')
  patchStatsPreferences(@CurrentUser() user: AuthenticatedUser, @Body() request: PatchTradeStatsPreferencesRequest): Promise<TradeStatsPreferences> {
    return this.tradeLogService.patchStatsPreferences(user.id, request);
  }

  @Get('trades/:id')
  trade(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('accountId') accountId?: string): Promise<TradeRecord> {
    return this.tradeLogService.getTrade(user.id, accountId, id);
  }


  @Patch('trades/:id/analysis')
  patchAnalysis(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('accountId') accountId: string | undefined, @Body() request: PatchTradeAnalysisRequest): Promise<TradeRecord> {
    return this.tradeLogService.patchTradeAnalysis(user.id, accountId, id, request);
  }

  @Patch('campaigns/:id/analysis')
  patchCampaignAnalysis(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('accountId') accountId: string | undefined, @Body() request: PatchTradeCampaignAnalysisRequest): Promise<void> {
    return this.tradeLogService.patchCampaignAnalysis(user.id, accountId, id, request);
  }
  @Patch('campaigns/:id/review')
  patchCampaignReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('accountId') accountId: string | undefined, @Body() request: PatchTradeCampaignReviewRequest): Promise<void> {
    return this.tradeLogService.patchCampaignReview(user.id, accountId, id, request);
  }
  @Patch('campaigns/:id/memo')
  patchCampaignMemo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('accountId') accountId: string | undefined,
    @Body() request: PatchTradeCampaignMemoRequest,
  ): Promise<void> {
    return this.tradeLogService.patchCampaignMemo(user.id, accountId, id, request);
  }


  @Post('campaigns/relink')
  relinkCampaign(@CurrentUser() user: AuthenticatedUser, @Body() request: RelinkTradeCampaignRequest): Promise<void> {
    return this.tradeLogService.relinkCampaign(user.id, request);
  }

  @Post('campaigns/:id/head')
  setCampaignHead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('accountId') accountId: string | undefined,
    @Body() request: SetTradeCampaignHeadRequest,
  ): Promise<CampaignHeadMutationResponse> {
    return this.tradeLogService.setCampaignHead(user.id, accountId, id, request);
  }

  @Delete('campaigns/:id/head')
  unsetCampaignHead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('accountId') accountId: string | undefined,
    @Body() request: UnsetTradeCampaignHeadRequest,
  ): Promise<CampaignHeadMutationResponse> {
    return this.tradeLogService.unsetCampaignHead(user.id, accountId, id, request);
  }

  @Post('campaign-conflicts/:id/resolve')
  resolveCampaignConflict(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() request: ResolveCampaignConflictRequest): Promise<void> {
    return this.tradeLogService.resolveCampaignConflict(user.id, id, request);
  }
  @Get('campaigns/:campaignId/images')
  images(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Query('accountId') accountId?: string): Promise<CampaignImageRecord[]> {
    return this.campaignImageService.list(user.id, accountId, campaignId);
  }
  @Post('campaigns/:campaignId/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadImage(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Query('accountId') accountId: string | undefined, @UploadedFile() file?: Express.Multer.File, @Body('uploadId') uploadId?: string): Promise<CampaignImageRecord> {
    return this.campaignImageService.upload(user.id, accountId, campaignId, uploadId, file);
  }

  @Put('campaigns/:campaignId/images/order')
  reorderImages(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Query('accountId') accountId: string | undefined, @Body() request: { imageIds: string[] }): Promise<CampaignImageRecord[]> {
    return this.campaignImageService.reorder(user.id, accountId, campaignId, request?.imageIds);
  }

  @Get('campaigns/:campaignId/images/:imageId')
  async image(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Param('imageId') imageId: string, @Query('accountId') accountId: string | undefined, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const image = await this.campaignImageService.get(user.id, accountId, campaignId, imageId);
    response.set({ 'Content-Type': image.record.mimeType, 'Content-Length': image.buffer.byteLength.toString(), 'Cache-Control': 'private, max-age=31536000, immutable' });
    return new StreamableFile(image.buffer);
  }

  @Delete('campaigns/:campaignId/images/:imageId')
  removeImage(@CurrentUser() user: AuthenticatedUser, @Param('campaignId') campaignId: string, @Param('imageId') imageId: string, @Query('accountId') accountId: string | undefined): Promise<void> {
    return this.campaignImageService.remove(user.id, accountId, campaignId, imageId);
  }
}
