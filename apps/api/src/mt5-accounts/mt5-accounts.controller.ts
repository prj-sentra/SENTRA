import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Mt5AccountsService } from './mt5-accounts.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('mt5-accounts')
export class Mt5AccountsController {
  constructor(private readonly accounts: Mt5AccountsService) {}

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

  @Post(':id/deactivate')
  deactivate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.accounts.deactivate(request.user.id, id);
  }
}
