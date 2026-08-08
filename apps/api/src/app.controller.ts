import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@trading-journal/shared';
import { AppService } from './app.service';
import { Public, PublicRoute } from './auth/public-route.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @Public(PublicRoute.HEALTH)
  health(): HealthResponse {
    return this.appService.health();
  }
}
