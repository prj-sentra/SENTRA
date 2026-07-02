import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WikiService } from './wiki.service';

function createWikiFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sentra-wiki-'));
  mkdirSync(join(root, 'concepts'), { recursive: true });
  mkdirSync(join(root, 'entities'), { recursive: true });
  mkdirSync(join(root, 'raw', 'assets'), { recursive: true });

  writeFileSync(join(root, 'SCHEMA.md'), '# Wiki Schema\n');
  writeFileSync(join(root, 'index.md'), '# Wiki Index\n\n## Concepts\n- [[liquidity-sweep]] - Liquidity sweep concept.\n');
  writeFileSync(join(root, 'log.md'), '# Wiki Log\n');
  writeFileSync(
    join(root, 'concepts', 'liquidity-sweep.md'),
    `---
title: Liquidity Sweep
created: 2026-07-01
updated: 2026-07-01
type: concept
tags: [price-action, liquidity]
sources: [raw/articles/liquidity-note.md]
confidence: medium
---

# Liquidity Sweep

A liquidity sweep is a trading setup concept.

Related to [[market-structure]] and [[stop-hunt]].

Image: ![[sweep.png]]
`,
  );
  writeFileSync(
    join(root, 'entities', 'bitcoin.md'),
    `---
title: Bitcoin
created: 2026-07-01
updated: 2026-07-02
type: entity
tags: [asset]
sources: []
---

Bitcoin context.
`,
  );
  writeFileSync(join(root, 'raw', 'assets', 'sweep.png'), 'fake image bytes');
  mkdirSync(join(root, 'queries'), { recursive: true });
  writeFileSync(
    join(root, 'queries', 'incomplete-note.md'),
    `---
type: query
updated: 2026-07-02
---

Incomplete note.
`,
  );
  return root;
}

describe('WikiService filesystem-backed llm-wiki reader', () => {
  let wikiPath: string;

  beforeEach(() => {
    wikiPath = createWikiFixture();
  });

  afterEach(() => {
    rmSync(wikiPath, { recursive: true, force: true });
  });

  it('reports wiki health with the configured wiki path', () => {
    const service = new WikiService({ wikiPath });

    expect(service.health()).toMatchObject({
      status: 'ok',
      service: 'sentra-wiki',
      wikiPath,
    });
  });

  it('lists markdown pages while ignoring reserved files and raw sources', () => {
    const service = new WikiService({ wikiPath });

    expect(service.listPages()).toEqual([
      {
        slug: 'concepts/liquidity-sweep',
        title: 'Liquidity Sweep',
        type: 'concept',
        updatedAt: '2026-07-01',
        tags: ['price-action', 'liquidity'],
        excerpt: 'A liquidity sweep is a trading setup concept.',
      },
      {
        slug: 'entities/bitcoin',
        title: 'Bitcoin',
        type: 'entity',
        updatedAt: '2026-07-02',
        tags: ['asset'],
        excerpt: 'Bitcoin context.',
      },
      {
        slug: 'queries/incomplete-note',
        title: 'Incomplete Note',
        type: 'query',
        updatedAt: '2026-07-02',
        tags: [],
        excerpt: 'Incomplete note.',
      },
    ]);
  });

  it('returns a page detail with frontmatter, markdown body, rendered HTML, links, and asset URLs', () => {
    const service = new WikiService({ wikiPath });

    expect(service.getPage('concepts/liquidity-sweep')).toMatchObject({
      slug: 'concepts/liquidity-sweep',
      title: 'Liquidity Sweep',
      type: 'concept',
      created: '2026-07-01',
      updated: '2026-07-01',
      tags: ['price-action', 'liquidity'],
      sources: ['raw/articles/liquidity-note.md'],
      confidence: 'medium',
      outboundLinks: ['market-structure', 'stop-hunt'],
      assetUrls: ['/api/wiki/assets/sweep.png'],
    });
    const page = service.getPage('concepts/liquidity-sweep');
    expect(page.bodyMarkdown).toContain('A liquidity sweep');
    expect(page.bodyHtml).toContain('<p>A liquidity sweep is a trading setup concept.</p>');
    expect(page.bodyHtml).toContain('<a href="#wiki/market-structure"');
    expect(page.bodyHtml).toContain('<img src="/api/wiki/assets/sweep.png" alt="sweep.png"');
  });

  it('resolves asset files only from raw/assets', () => {
    const service = new WikiService({ wikiPath });

    expect(service.resolveAssetPath('sweep.png')).toBe(join(wikiPath, 'raw', 'assets', 'sweep.png'));
    expect(() => service.resolveAssetPath('../SCHEMA.md')).toThrow(BadRequestException);
    expect(() => service.resolveAssetPath('/etc/passwd')).toThrow(BadRequestException);
  });

  it('rejects unsafe page slugs', () => {
    const service = new WikiService({ wikiPath });

    expect(() => service.getPage('../secrets')).toThrow(BadRequestException);
    expect(() => service.getPage('/etc/passwd')).toThrow(BadRequestException);
  });

  it('returns lint issues for broken links, orphan pages, missing index entries, and frontmatter gaps', () => {
    const service = new WikiService({ wikiPath });

    const report = service.lint();
    const issueCodes = report.issues.map((issue) => issue.code);

    expect(report.summary.totalPages).toBe(3);
    expect(report.summary.issueCount).toBe(report.issues.length);
    expect(issueCodes).toEqual(expect.arrayContaining([
      'broken_link',
      'orphan_page',
      'missing_index_entry',
      'missing_frontmatter_field',
    ]));
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'broken_link', path: 'concepts/liquidity-sweep.md', target: 'market-structure' }),
        expect.objectContaining({ code: 'missing_index_entry', path: 'entities/bitcoin.md' }),
        expect.objectContaining({ code: 'missing_frontmatter_field', path: 'queries/incomplete-note.md', target: 'title' }),
      ]),
    );
  });

  it('throws not found for missing pages', () => {
    const service = new WikiService({ wikiPath });

    expect(() => service.getPage('concepts/missing')).toThrow(NotFoundException);
  });
});
