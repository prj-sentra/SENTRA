import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, WikiPageSummary } from '@trading-journal/shared';
import { WikiService } from './wiki.service';

@Controller('wiki')
export class WikiController {
  constructor(private readonly wikiService: WikiService) {}

  @Get('health')
  health(): HealthResponse {
    return this.wikiService.health();
  }

  @Get('pages')
  pages(): WikiPageSummary[] {
    return this.wikiService.listPages();
  }
}
