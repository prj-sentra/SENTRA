import { UnauthorizedException } from '@nestjs/common';
import type { CreateWikiPageRequest, UpdateWikiPageRequest, WikiLintReport, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';
import { WikiController } from './wiki.controller';
import { WikiService } from './wiki.service';

describe('WikiController', () => {
  const originalWikiWriteToken = process.env.WIKI_WRITE_TOKEN;

  beforeEach(() => {
    process.env.WIKI_WRITE_TOKEN = 'test-write-token';
  });

  afterAll(() => {
    if (originalWikiWriteToken === undefined) {
      delete process.env.WIKI_WRITE_TOKEN;
    } else {
      process.env.WIKI_WRITE_TOKEN = originalWikiWriteToken;
    }
  });

  const summary: WikiPageSummary = {
    slug: 'concepts/liquidity-sweep',
    title: 'Liquidity Sweep',
    type: 'concept',
    updatedAt: '2026-07-01',
    tags: ['liquidity'],
  };

  const detail: WikiPageDetail = {
    ...summary,
    sources: [],
    bodyMarkdown: 'body',
    bodyHtml: '',
    outboundLinks: [],
    inboundLinks: [],
    assetUrls: [],
  };

  const lintReport: WikiLintReport = {
    summary: { totalPages: 1, issueCount: 0, generatedAt: '2026-07-01T00:00:00.000Z' },
    issues: [],
  };

  function createController() {
    const service = {
      health: jest.fn(() => ({ status: 'ok', service: 'sentra-wiki', timestamp: '2026-07-01T00:00:00.000Z', wikiPath: '/data/wiki' })),
      listPages: jest.fn(() => [summary]),
      getPage: jest.fn(() => detail),
      createPage: jest.fn(() => detail),
      updatePage: jest.fn(() => detail),
      lint: jest.fn(() => lintReport),
      resolveAssetPath: jest.fn(() => '/data/wiki/raw/assets/demo.svg'),
    } as unknown as WikiService;

    return { controller: new WikiController(service), service };
  }

  it('returns filesystem-backed page summaries', () => {
    const { controller } = createController();

    expect(controller.pages()).toEqual([summary]);
  });

  it('normalizes wildcard slug arrays before reading page detail', () => {
    const { controller, service } = createController();

    expect(controller.page(['concepts', 'liquidity-sweep'])).toEqual(detail);
    expect(service.getPage).toHaveBeenCalledWith('concepts/liquidity-sweep');
  });

  it('returns lint report', () => {
    const { controller, service } = createController();

    expect(controller.lint()).toEqual(lintReport);
    expect(service.lint).toHaveBeenCalledTimes(1);
  });

  it('creates wiki pages through the service', () => {
    const { controller, service } = createController();
    const request: CreateWikiPageRequest = {
      slug: 'concepts/risk-control',
      title: 'Risk Control',
      type: 'concept',
      tags: ['risk'],
      sources: [],
      bodyMarkdown: 'Risk control body.',
    };

    expect(controller.createPage(request, 'test-write-token')).toEqual(detail);
    expect(service.createPage).toHaveBeenCalledWith(request);
  });

  it('rejects wiki page creation without the configured write token', () => {
    const { controller, service } = createController();
    const request: CreateWikiPageRequest = {
      slug: 'concepts/risk-control',
      title: 'Risk Control',
      type: 'concept',
      tags: ['risk'],
      sources: [],
      bodyMarkdown: 'Risk control body.',
    };

    expect(() => controller.createPage(request, undefined)).toThrow(UnauthorizedException);
    expect(() => controller.createPage(request, 'wrong-token')).toThrow(UnauthorizedException);
    expect(service.createPage).not.toHaveBeenCalled();
  });

  it('updates wiki pages through the service', () => {
    const { controller, service } = createController();
    const request: UpdateWikiPageRequest = {
      title: 'Liquidity Sweep',
      type: 'concept',
      tags: ['liquidity'],
      sources: [],
      bodyMarkdown: 'Updated body.',
    };

    expect(controller.updatePage(['concepts', 'liquidity-sweep'], request, 'test-write-token')).toEqual(detail);
    expect(service.updatePage).toHaveBeenCalledWith('concepts/liquidity-sweep', request);
  });

  it('rejects wiki page updates without the configured write token', () => {
    const { controller, service } = createController();
    const request: UpdateWikiPageRequest = {
      title: 'Liquidity Sweep',
      type: 'concept',
      tags: ['liquidity'],
      sources: [],
      bodyMarkdown: 'Updated body.',
    };

    expect(() => controller.updatePage(['concepts', 'liquidity-sweep'], request, undefined)).toThrow(UnauthorizedException);
    expect(() => controller.updatePage(['concepts', 'liquidity-sweep'], request, 'wrong-token')).toThrow(UnauthorizedException);
    expect(service.updatePage).not.toHaveBeenCalled();
  });

  it('normalizes wildcard asset paths before sending files', () => {
    const { controller, service } = createController();
    const response = { sendFile: jest.fn() };

    controller.asset(['charts', 'demo.svg'], response as never);

    expect(service.resolveAssetPath).toHaveBeenCalledWith('charts/demo.svg');
    expect(response.sendFile).toHaveBeenCalledWith('/data/wiki/raw/assets/demo.svg');
  });
});
