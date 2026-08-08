import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { Mt5AccountsModule } from './mt5-accounts/mt5-accounts.module';
import { TradeLogModule } from './trade-log/trade-log.module';

@Module({
  imports: [AuthModule, Mt5AccountsModule, TradeLogModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
