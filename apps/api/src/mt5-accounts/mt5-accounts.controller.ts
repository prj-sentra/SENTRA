import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Mt5AccountsService } from './mt5-accounts.service';
import { Mt5SyncService } from './mt5-sync.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('mt5-accounts')
export class Mt5AccountsController {
  constructor(
    private readonly accounts: Mt5AccountsService,
    private readonly syncService: Mt5SyncService,
  ) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.accounts.create(request.user.id, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.accounts.list(request.user.id);
  }

  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.update(request.user.id, id, body);
  }

  @Post(':id/sync')
  @HttpCode(202)
  sync(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('x-mt5-sync-token') syncToken: string | undefined,
  ) {
    this.syncService.assertTrustedToken(syncToken);
    return this.syncService.sync(request.user.id, id);
  }

  @Post(':id/full-sync')
  @HttpCode(202)
  fullSync(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('x-mt5-sync-token') syncToken: string | undefined,
  ) {
    this.syncService.assertTrustedToken(syncToken);
    return this.syncService.sync(request.user.id, id, true);
  }

  @Get(':id/classification-preview')
  classificationPreview(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.syncService.previewCampaignReclassification(request.user.id, id);
  }

  @Get(':id/excursion-progress')
  excursionProgress(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.syncService.getExcursionProgress(request.user.id, id);
  }

  @Post(':id/reclassify')
  reclassify(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || typeof (body as { classificationFingerprint?: unknown }).classificationFingerprint !== 'string'
      || !/^[a-f0-9]{64}$/.test((body as { classificationFingerprint: string }).classificationFingerprint)) {
      throw new BadRequestException('classificationFingerprint is required');
    }
    return this.syncService.reclassifyOwnedAccount(
      request.user.id,
      id,
      false,
      (body as { classificationFingerprint: string }).classificationFingerprint,
    );
  }
}
