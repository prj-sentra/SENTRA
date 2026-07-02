import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { CreateWikiPageRequest, HealthResponse, UpdateWikiPageRequest, WikiLintReport, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';
import type { Response } from 'express';
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

  @Get('lint')
  lint(): WikiLintReport {
    return this.wikiService.lint();
  }

  @Post('pages')
  createPage(@Body() request: CreateWikiPageRequest): WikiPageDetail {
    return this.wikiService.createPage(request);
  }

  @Put('pages/*slug')
  updatePage(@Param('slug') slug: string | string[], @Body() request: UpdateWikiPageRequest): WikiPageDetail {
    const normalizedSlug = Array.isArray(slug) ? slug.join('/') : slug;
    return this.wikiService.updatePage(normalizedSlug, request);
  }

  @Get('assets/*assetPath')
  asset(@Param('assetPath') assetPath: string | string[], @Res() response: Response): void {
    const normalizedAssetPath = Array.isArray(assetPath) ? assetPath.join('/') : assetPath;
    response.sendFile(this.wikiService.resolveAssetPath(normalizedAssetPath));
  }

  @Get('pages/*slug')
  page(@Param('slug') slug: string | string[]): WikiPageDetail {
    const normalizedSlug = Array.isArray(slug) ? slug.join('/') : slug;
    return this.wikiService.getPage(normalizedSlug);
  }
}
