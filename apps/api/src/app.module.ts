import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TradeLogModule } from './trade-log/trade-log.module';
import { WikiModule } from './wiki/wiki.module';

@Module({
  imports: [TradeLogModule, WikiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
