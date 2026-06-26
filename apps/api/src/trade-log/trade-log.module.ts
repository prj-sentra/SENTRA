import { Module } from '@nestjs/common';
import { TradeLogController } from './trade-log.controller';
import { TradeLogService } from './trade-log.service';

@Module({
  controllers: [TradeLogController],
  providers: [TradeLogService],
})
export class TradeLogModule {}
