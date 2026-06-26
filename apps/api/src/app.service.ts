import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@trading-journal/shared';

@Injectable()
export class AppService {
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'sentra-api',
      timestamp: new Date().toISOString(),
    };
  }
}
