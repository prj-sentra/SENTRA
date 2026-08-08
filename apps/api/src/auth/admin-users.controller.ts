import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { UserStateAuditAction } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';
import { AuthenticatedUser, CurrentUser } from './current-user.decorator';

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}
  @Get('pending') pending(@CurrentUser() actor: AuthenticatedUser, @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 50) { return this.users.pending(actor, page, pageSize); }
  @Post(':id/approve') approve(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) { return this.users.transition(actor, id, UserStateAuditAction.APPROVE); }
  @Post(':id/reject') reject(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) { return this.users.transition(actor, id, UserStateAuditAction.REJECT); }
  @Post(':id/disable') disable(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) { return this.users.transition(actor, id, UserStateAuditAction.DISABLE); }
  @Post(':id/enable') enable(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) { return this.users.transition(actor, id, UserStateAuditAction.ENABLE); }
  @Post(':id/reset-password') reset(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body('password') password: unknown) { return this.users.resetPassword(actor, id, password); }
}
