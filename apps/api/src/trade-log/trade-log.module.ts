import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TradeLogController } from './trade-log.controller';
import { CampaignImageService } from './campaign-image.service';
import { TradeLogService } from './trade-log.service';

@Module({
  imports: [PrismaModule],
  controllers: [TradeLogController],
  providers: [TradeLogService, CampaignImageService],
  exports: [TradeLogService],
})
export class TradeLogModule {}
