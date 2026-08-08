import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OriginGuard, SessionAuthGuard } from './guards';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { LoginThrottleService, SignupThrottleService } from './throttle.service';

@Module({
  imports: [PrismaModule], controllers: [AuthController, AdminUsersController],
  providers: [AuthService, PasswordService, SessionService, LoginThrottleService, SignupThrottleService, AdminUsersService,
    { provide: APP_GUARD, useClass: OriginGuard }, { provide: APP_GUARD, useClass: SessionAuthGuard }],
  exports: [SessionService],
})
export class AuthModule {}
