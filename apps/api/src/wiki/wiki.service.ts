import { Injectable } from '@nestjs/common';
import type { HealthResponse, WikiPageSummary } from '@trading-journal/shared';

@Injectable()
export class WikiService {
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'sentra-wiki',
      timestamp: new Date().toISOString(),
    };
  }

  listPages(): WikiPageSummary[] {
    return [];
  }
}
