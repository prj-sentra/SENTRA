import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TradeLogModule } from '../trade-log/trade-log.module';
import { CredentialCipherService } from './credential-cipher.service';
import { Mt5AccountsController } from './mt5-accounts.controller';
import { Mt5AccountsService } from './mt5-accounts.service';
import { Mt5BridgeClient } from './mt5-bridge.client';
import { Mt5SyncService } from './mt5-sync.service';

@Module({
  imports: [PrismaModule, TradeLogModule],
  controllers: [Mt5AccountsController],
  providers: [CredentialCipherService, Mt5AccountsService, Mt5BridgeClient, Mt5SyncService],
  exports: [CredentialCipherService, Mt5AccountsService],
})
export class Mt5AccountsModule {}
