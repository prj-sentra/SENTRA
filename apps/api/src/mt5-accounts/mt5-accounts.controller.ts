import {
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
}
