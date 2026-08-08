import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TradeLogModule } from './trade-log/trade-log.module';

@Module({
  imports: [AuthModule, TradeLogModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
