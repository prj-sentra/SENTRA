import { Body, Controller, Get, Headers, Param, Post, Put, Res, UnauthorizedException } from '@nestjs/common';
import type { CreateWikiPageRequest, HealthResponse, UpdateWikiPageRequest, WikiLintReport, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';
import type { Response } from 'express';
import { WikiService } from './wiki.service';

@Controller('wiki')
export class WikiController {
  constructor(private readonly wikiService: WikiService) {}

  private assertWriteToken(providedToken: string | undefined): void {
    const expectedToken = process.env.WIKI_WRITE_TOKEN;
    if (!expectedToken || !providedToken || providedToken !== expectedToken) {
      throw new UnauthorizedException('Valid wiki write token required');
    }
  }

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
  createPage(
    @Body() request: CreateWikiPageRequest,
    @Headers('x-wiki-write-token') writeToken: string | undefined,
  ): WikiPageDetail {
    this.assertWriteToken(writeToken);
    return this.wikiService.createPage(request);
  }

  @Put('pages/*slug')
  updatePage(
    @Param('slug') slug: string | string[],
    @Body() request: UpdateWikiPageRequest,
    @Headers('x-wiki-write-token') writeToken: string | undefined,
  ): WikiPageDetail {
    this.assertWriteToken(writeToken);
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
