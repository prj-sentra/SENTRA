import { Controller, Get, Param } from '@nestjs/common';
import type { HealthResponse, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';
import { WikiService } from './wiki.service';

@Controller('wiki')
export class WikiController {
  constructor(private readonly wikiService: WikiService) {}

  @Get('health')
  health(): HealthResponse & { wikiPath: string } {
    return this.wikiService.health();
  }

  @Get('pages')
  pages(): WikiPageSummary[] {
    return this.wikiService.listPages();
  }

  @Get('pages/*slug')
  page(@Param('slug') slug: string | string[]): WikiPageDetail {
    const normalizedSlug = Array.isArray(slug) ? slug.join('/') : slug;
    return this.wikiService.getPage(normalizedSlug);
  }
}
