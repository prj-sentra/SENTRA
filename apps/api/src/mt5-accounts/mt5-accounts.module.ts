import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CredentialCipherService } from './credential-cipher.service';
import { Mt5AccountsController } from './mt5-accounts.controller';
import { Mt5AccountsService } from './mt5-accounts.service';

@Module({
  imports: [PrismaModule],
  controllers: [Mt5AccountsController],
  providers: [CredentialCipherService, Mt5AccountsService],
  exports: [CredentialCipherService, Mt5AccountsService],
})
export class Mt5AccountsModule {}
