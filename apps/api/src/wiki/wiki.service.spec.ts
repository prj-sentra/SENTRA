import { BadRequestException, NotFoundException } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
order: 20
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
order: 10
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
        slug: 'entities/bitcoin',
        title: 'Bitcoin',
        type: 'entity',
        updatedAt: '2026-07-02',
        tags: ['asset'],
        order: 10,
        excerpt: 'Bitcoin context.',
      },
      {
        slug: 'concepts/liquidity-sweep',
        title: 'Liquidity Sweep',
        type: 'concept',
        updatedAt: '2026-07-01',
        tags: ['price-action', 'liquidity'],
        order: 20,
        excerpt: 'A liquidity sweep is a trading setup concept.',
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
      order: 20,
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

  it('renders strikethrough, emphasis, code, and provenance markers in wiki pages', () => {
    writeFileSync(
      join(wikiPath, 'concepts', 'rendering-check.md'),
      `---
title: Rendering Check
created: 2026-07-02
updated: 2026-07-02
type: concept
tags: [rendering]
sources: [raw/transcripts/rendering-check.md]
---

This keeps ~~deprecated text~~, **strong text**, *emphasis*, and \`inline-code\`.^[raw/transcripts/rendering-check.md]
`,
    );

    const service = new WikiService({ wikiPath });
    const page = service.getPage('concepts/rendering-check');

    expect(page.bodyHtml).toContain('<del>deprecated text</del>');
    expect(page.bodyHtml).toContain('<strong>strong text</strong>');
    expect(page.bodyHtml).toContain('<em>emphasis</em>');
    expect(page.bodyHtml).toContain('<code>inline-code</code>');
    expect(page.bodyHtml).toContain('<sup class="wiki-provenance"');
    expect(page.bodyHtml).toContain('[raw/transcripts/rendering-check.md]</sup>');
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

  it('creates a wiki page and automatically updates index and log', () => {
    const service = new WikiService({ wikiPath });

    const created = service.createPage({
      slug: 'concepts/risk-control',
      title: 'Risk Control',
      type: 'concept',
      tags: ['risk', 'operations'],
      sources: [],
      order: 15,
      confidence: 'medium',
      bodyMarkdown: '# Risk Control\n\nRisk control limits downside before execution. Related to [[liquidity-sweep]].',
      summary: 'Risk control limits downside before execution.',
    });

    expect(created).toMatchObject({ slug: 'concepts/risk-control', title: 'Risk Control', order: 15, updatedAt: expect.any(String) });
    expect(existsSync(join(wikiPath, 'concepts', 'risk-control.md'))).toBe(true);
    expect(readFileSync(join(wikiPath, 'concepts', 'risk-control.md'), 'utf8')).toContain('title: Risk Control');
    expect(readFileSync(join(wikiPath, 'concepts', 'risk-control.md'), 'utf8')).toContain('order: 15');
    const index = readFileSync(join(wikiPath, 'index.md'), 'utf8');
    expect(index).toContain('- [[risk-control]] - Risk control limits downside before execution.');
    expect(index.indexOf('[[risk-control]]')).toBeLessThan(index.indexOf('[[liquidity-sweep]]'));
    expect(readFileSync(join(wikiPath, 'log.md'), 'utf8')).toContain('create | concepts/risk-control');
  });

  it('updates a wiki page and appends log without duplicating index entries', () => {
    const service = new WikiService({ wikiPath });

    const updated = service.updatePage('concepts/liquidity-sweep', {
      title: 'Liquidity Sweep',
      type: 'concept',
      tags: ['price-action', 'liquidity'],
      sources: ['raw/articles/liquidity-note.md'],
      order: 5,
      confidence: 'medium',
      bodyMarkdown: '# Liquidity Sweep\n\nUpdated body. Related to [[bitcoin]].',
      summary: 'Updated body.',
    });

    const index = readFileSync(join(wikiPath, 'index.md'), 'utf8');
    expect(updated.bodyMarkdown).toContain('Updated body');
    expect(updated.order).toBe(5);
    expect(index.match(/\[\[liquidity-sweep\]\]/g)).toHaveLength(1);
    expect(index).toContain('- [[liquidity-sweep]] - Updated body.');
    expect(readFileSync(join(wikiPath, 'concepts', 'liquidity-sweep.md'), 'utf8')).toContain('order: 5');
    expect(readFileSync(join(wikiPath, 'log.md'), 'utf8')).toContain('update | concepts/liquidity-sweep');
  });

  it('rejects unsafe or duplicate page writes', () => {
    const service = new WikiService({ wikiPath });

    expect(() => service.createPage({
      slug: '../bad',
      title: 'Bad',
      type: 'concept',
      tags: [],
      sources: [],
      bodyMarkdown: 'Bad',
    })).toThrow(BadRequestException);

    expect(() => service.createPage({
      slug: 'concepts/liquidity-sweep',
      title: 'Duplicate',
      type: 'concept',
      tags: [],
      sources: [],
      bodyMarkdown: 'Duplicate',
    })).toThrow(BadRequestException);
  });

  it('throws not found for missing pages', () => {
    const service = new WikiService({ wikiPath });

    expect(() => service.getPage('concepts/missing')).toThrow(NotFoundException);
  });
});
