import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { CreateWikiPageRequest, HealthResponse, UpdateWikiPageRequest, WikiLintIssue, WikiLintReport, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, relative, sep } from 'node:path';

interface WikiServiceOptions {
  wikiPath?: string;
}

interface ParsedWikiPage {
  frontmatter: Record<string, unknown>;
  body: string;
}

const RESERVED_FILENAMES = new Set(['SCHEMA.md', 'index.md', 'log.md']);
const PAGE_DIRECTORIES = new Set(['entities', 'concepts', 'comparisons', 'queries']);

@Injectable()
export class WikiService {
  private readonly wikiPath: string;

  constructor(@Optional() @Inject('WIKI_SERVICE_OPTIONS') options: WikiServiceOptions = {}) {
    this.wikiPath = options.wikiPath ?? process.env.WIKI_PATH ?? '/data/wiki';
  }

  health(): HealthResponse & { wikiPath: string } {
    return {
      status: 'ok',
      service: 'sentra-wiki',
      timestamp: new Date().toISOString(),
      wikiPath: this.wikiPath,
    };
  }

  listPages(): WikiPageSummary[] {
    if (!existsSync(this.wikiPath)) {
      return [];
    }

    return this.listMarkdownFiles(this.wikiPath)
      .filter((filePath) => this.isWikiPageFile(filePath))
      .map((filePath) => this.toPageSummary(filePath))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  getPage(slug: string): WikiPageDetail {
    const filePath = this.resolvePagePath(slug);

    if (!existsSync(filePath)) {
      throw new NotFoundException(`Wiki page not found: ${slug}`);
    }

    const parsed = this.parsePageFile(filePath);
    const normalizedSlug = this.slugFromPath(filePath);
    const bodyMarkdown = parsed.body.trim();

    return {
      slug: normalizedSlug,
      title: this.stringField(parsed.frontmatter.title) ?? this.titleFromSlug(normalizedSlug),
      type: this.stringField(parsed.frontmatter.type) ?? 'concept',
      created: this.stringField(parsed.frontmatter.created),
      updated: this.stringField(parsed.frontmatter.updated),
      updatedAt: this.stringField(parsed.frontmatter.updated) ?? '',
      tags: this.arrayField(parsed.frontmatter.tags),
      sources: this.arrayField(parsed.frontmatter.sources),
      confidence: this.confidenceField(parsed.frontmatter.confidence),
      contested: this.booleanField(parsed.frontmatter.contested),
      contradictions: this.arrayField(parsed.frontmatter.contradictions),
      bodyMarkdown,
      bodyHtml: this.renderMarkdown(bodyMarkdown),
      outboundLinks: this.extractWikiLinks(bodyMarkdown),
      inboundLinks: [],
      assetUrls: this.extractAssetUrls(bodyMarkdown),
    };
  }

  createPage(request: CreateWikiPageRequest): WikiPageDetail {
    const filePath = this.resolvePagePath(request.slug);
    if (existsSync(filePath)) {
      throw new BadRequestException(`Wiki page already exists: ${request.slug}`);
    }

    const today = this.today();
    mkdirSync(dirname(filePath), { recursive: true });
    this.writePageFile(filePath, {
      ...request,
      created: today,
      updated: today,
    });
    this.rebuildIndex(new Map([[request.slug, request.summary]]));
    this.appendLog('create', request.slug, [`Created \`${this.markdownRelativePath(filePath)}\`.`, 'Updated `index.md`.']);
    return this.getPage(request.slug);
  }

  updatePage(slug: string, request: UpdateWikiPageRequest): WikiPageDetail {
    const filePath = this.resolvePagePath(slug);
    if (!existsSync(filePath)) {
      throw new NotFoundException(`Wiki page not found: ${slug}`);
    }

    const parsed = this.parsePageFile(filePath);
    const today = this.today();
    this.writePageFile(filePath, {
      slug,
      ...request,
      created: this.stringField(parsed.frontmatter.created) ?? today,
      updated: today,
    });
    this.rebuildIndex(new Map([[slug, request.summary]]));
    this.appendLog('update', slug, [`Updated \`${this.markdownRelativePath(filePath)}\`.`, 'Updated `index.md`.']);
    return this.getPage(slug);
  }

  resolveAssetPath(assetPath: string): string {
    if (!assetPath || assetPath.startsWith('/') || assetPath.includes('..') || assetPath.includes('\\')) {
      throw new BadRequestException(`Unsafe wiki asset path: ${assetPath}`);
    }

    const normalizedAssetPath = normalize(assetPath);
    const assetRoot = join(this.wikiPath, 'raw', 'assets');
    const filePath = join(assetRoot, normalizedAssetPath);
    const relativePath = relative(assetRoot, filePath);

    if (relativePath.startsWith('..') || relativePath.includes(`..${sep}`)) {
      throw new BadRequestException(`Unsafe wiki asset path: ${assetPath}`);
    }

    if (!existsSync(filePath)) {
      throw new NotFoundException(`Wiki asset not found: ${assetPath}`);
    }

    return filePath;
  }

  lint(): WikiLintReport {
    const pageFiles = existsSync(this.wikiPath)
      ? this.listMarkdownFiles(this.wikiPath).filter((filePath) => this.isWikiPageFile(filePath))
      : [];
    const pageSlugs = pageFiles.map((filePath) => this.slugFromPath(filePath));
    const slugSet = new Set(pageSlugs);
    const basenameToSlug = new Map(pageSlugs.map((slug) => [slug.split('/').at(-1)!, slug]));
    const inboundCounts = new Map(pageSlugs.map((slug) => [slug, 0]));
    const issues: WikiLintIssue[] = [];
    const indexLinks = this.readIndexLinks();

    for (const filePath of pageFiles) {
      const pagePath = this.markdownRelativePath(filePath);
      const parsed = this.parsePageFile(filePath);
      const frontmatter = parsed.frontmatter;
      const pageSlug = this.slugFromPath(filePath);

      for (const field of ['title', 'created', 'updated', 'type', 'tags', 'sources']) {
        const value = frontmatter[field];
        const missingArray = (field === 'tags' || field === 'sources') && !Array.isArray(value);
        const missingScalar = field !== 'tags' && field !== 'sources' && typeof value !== 'string';
        if (missingArray || missingScalar) {
          issues.push({
            severity: 'warning',
            code: 'missing_frontmatter_field',
            path: pagePath,
            target: field,
            message: `${pagePath} is missing required frontmatter field: ${field}`,
          });
        }
      }

      for (const outboundLink of this.extractWikiLinks(parsed.body)) {
        const resolvedSlug = this.resolveWikiLink(outboundLink, slugSet, basenameToSlug);
        if (!resolvedSlug) {
          issues.push({
            severity: 'error',
            code: 'broken_link',
            path: pagePath,
            target: outboundLink,
            message: `${pagePath} links to missing page: ${outboundLink}`,
          });
          continue;
        }
        inboundCounts.set(resolvedSlug, (inboundCounts.get(resolvedSlug) ?? 0) + 1);
      }

      if (!this.isIndexed(pageSlug, indexLinks)) {
        issues.push({
          severity: 'warning',
          code: 'missing_index_entry',
          path: pagePath,
          target: pageSlug,
          message: `${pagePath} is missing from index.md`,
        });
      }
    }

    for (const [slug, count] of inboundCounts) {
      if (count === 0) {
        issues.push({
          severity: 'warning',
          code: 'orphan_page',
          path: `${slug}.md`,
          target: slug,
          message: `${slug}.md has no inbound wiki links`,
        });
      }
    }

    return {
      summary: {
        totalPages: pageFiles.length,
        issueCount: issues.length,
        generatedAt: new Date().toISOString(),
      },
      issues,
    };
  }

  private writePageFile(
    filePath: string,
    input: CreateWikiPageRequest & { created: string; updated: string },
  ): void {
    const lines = [
      '---',
      `title: ${input.title}`,
      `created: ${input.created}`,
      `updated: ${input.updated}`,
      `type: ${input.type}`,
      `tags: ${this.formatArray(input.tags)}`,
      `sources: ${this.formatArray(input.sources)}`,
    ];
    if (input.confidence) {
      lines.push(`confidence: ${input.confidence}`);
    }
    lines.push('---', '', input.bodyMarkdown.trim(), '');
    writeFileSync(filePath, lines.join('\n'));
  }

  private rebuildIndex(summaryOverrides: Map<string, string | undefined> = new Map()): void {
    const pages = this.listPages();
    const sections: Array<{ title: string; types: string[] }> = [
      { title: 'Entities', types: ['entity'] },
      { title: 'Concepts', types: ['concept'] },
      { title: 'Comparisons', types: ['comparison'] },
      { title: 'Queries', types: ['query'] },
    ];
    const lines = [
      '# Wiki Index',
      '',
      '> S.E.N.T.R.A. LLM Wiki catalog.',
      `> Last updated: ${this.today()} | Total pages: ${pages.length}`,
      '',
    ];

    for (const section of sections) {
      lines.push(`## ${section.title}`);
      const sectionPages = pages
        .filter((page) => section.types.includes(page.type))
        .sort((a, b) => a.title.localeCompare(b.title));
      for (const page of sectionPages) {
        const basenameSlug = page.slug.split('/').at(-1)!;
        const summary = summaryOverrides.get(page.slug) ?? page.excerpt ?? '';
        lines.push(`- [[${basenameSlug}]] - ${summary}`.trimEnd());
      }
      lines.push('');
    }

    writeFileSync(join(this.wikiPath, 'index.md'), lines.join('\n'));
  }

  private appendLog(action: 'create' | 'update', slug: string, bullets: string[]): void {
    const logPath = join(this.wikiPath, 'log.md');
    const existing = existsSync(logPath)
      ? readFileSync(logPath, 'utf8').trimEnd()
      : '# Wiki Log\n\n> Chronological record of all wiki actions. Append-only.';
    const entry = [
      '',
      `## [${this.today()}] ${action} | ${slug}`,
      ...bullets.map((bullet) => `- ${bullet}`),
      '',
    ].join('\n');
    writeFileSync(logPath, `${existing}${entry}`);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private formatArray(values: string[]): string {
    return `[${values.join(', ')}]`;
  }

  private listMarkdownFiles(root: string): string[] {
    const entries = readdirSync(root, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listMarkdownFiles(fullPath));
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private isWikiPageFile(filePath: string): boolean {
    const fileName = basename(filePath);
    if (RESERVED_FILENAMES.has(fileName)) {
      return false;
    }

    const relativePath = this.relativeWikiPath(filePath);
    const [topLevel] = relativePath.split(sep);
    return PAGE_DIRECTORIES.has(topLevel);
  }

  private toPageSummary(filePath: string): WikiPageSummary {
    const parsed = this.parsePageFile(filePath);
    const slug = this.slugFromPath(filePath);
    const body = parsed.body.trim();
    const firstParagraph = body
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith('#'));

    return {
      slug,
      title: this.stringField(parsed.frontmatter.title) ?? this.titleFromSlug(slug),
      type: this.stringField(parsed.frontmatter.type) ?? 'concept',
      updatedAt: this.stringField(parsed.frontmatter.updated) ?? '',
      tags: this.arrayField(parsed.frontmatter.tags),
      excerpt: firstParagraph,
    };
  }

  private parsePageFile(filePath: string): ParsedWikiPage {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

    if (!match) {
      throw new BadRequestException(`Wiki page is missing YAML frontmatter: ${this.slugFromPath(filePath)}`);
    }

    return {
      frontmatter: this.parseFrontmatter(match[1]),
      body: match[2],
    };
  }

  private parseFrontmatter(yaml: string): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};

    for (const rawLine of yaml.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      frontmatter[key] = this.parseScalarOrArray(rawValue);
    }

    return frontmatter;
  }

  private parseScalarOrArray(rawValue: string): string | string[] | boolean {
    if (rawValue === 'true') {
      return true;
    }
    if (rawValue === 'false') {
      return false;
    }
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      if (!inner) {
        return [];
      }
      return inner.split(',').map((item) => this.stripQuotes(item.trim()));
    }
    return this.stripQuotes(rawValue);
  }

  private stripQuotes(value: string): string {
    return value.replace(/^['"]|['"]$/g, '');
  }

  private resolvePagePath(slug: string): string {
    if (!slug || slug.startsWith('/') || slug.includes('..') || slug.includes('\\')) {
      throw new BadRequestException(`Unsafe wiki page slug: ${slug}`);
    }

    const normalizedSlug = normalize(slug);
    const filePath = join(this.wikiPath, `${normalizedSlug}.md`);
    const relativePath = relative(this.wikiPath, filePath);

    if (relativePath.startsWith('..') || relativePath.includes(`..${sep}`)) {
      throw new BadRequestException(`Unsafe wiki page slug: ${slug}`);
    }

    const [topLevel] = relativePath.split(sep);
    if (!PAGE_DIRECTORIES.has(topLevel)) {
      throw new BadRequestException(`Unsupported wiki page collection: ${topLevel}`);
    }

    return filePath;
  }

  private relativeWikiPath(filePath: string): string {
    return relative(this.wikiPath, filePath);
  }

  private slugFromPath(filePath: string): string {
    return this.relativeWikiPath(filePath).replace(/\.md$/, '').split(sep).join('/');
  }

  private titleFromSlug(slug: string): string {
    return slug
      .split('/')
      .at(-1)!
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private stringField(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private arrayField(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    return [];
  }

  private booleanField(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private confidenceField(value: unknown): 'high' | 'medium' | 'low' | undefined {
    return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
  }

  private renderMarkdown(markdown: string): string {
    const blocks = markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);

    return blocks
      .map((block) => {
        if (block.startsWith('### ')) {
          return `<h3>${this.renderInline(block.slice(4))}</h3>`;
        }
        if (block.startsWith('## ')) {
          return `<h2>${this.renderInline(block.slice(3))}</h2>`;
        }
        if (block.startsWith('# ')) {
          return `<h1>${this.renderInline(block.slice(2))}</h1>`;
        }
        if (block.split('\n').every((line) => line.trim().startsWith('- '))) {
          const items = block
            .split('\n')
            .map((line) => `<li>${this.renderInline(line.trim().slice(2))}</li>`)
            .join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${this.renderInline(block).replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');
  }

  private renderInline(text: string): string {
    return this.escapeHtml(text)
      .replace(/!\[\[([^\]]+)\]\]/g, (_match, assetPath: string) => {
        const trimmedAssetPath = String(assetPath).trim();
        if (!trimmedAssetPath || trimmedAssetPath.startsWith('/') || trimmedAssetPath.includes('..')) {
          return '';
        }
        const src = this.assetUrl(trimmedAssetPath);
        const alt = this.escapeHtml(basename(trimmedAssetPath));
        return `<img src="${src}" alt="${alt}" loading="lazy">`;
      })
      .replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_match, slug: string) => {
        const trimmedSlug = String(slug).trim();
        const label = this.escapeHtml(this.titleFromSlug(trimmedSlug));
        const href = `#wiki/${encodeURI(trimmedSlug)}`;
        return `<a href="${href}" data-wiki-link="${this.escapeHtml(trimmedSlug)}">${label}</a>`;
      });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private assetUrl(assetPath: string): string {
    return `/api/wiki/assets/${assetPath.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
  }

  private readIndexLinks(): string[] {
    const indexPath = join(this.wikiPath, 'index.md');
    if (!existsSync(indexPath)) {
      return [];
    }
    return this.extractWikiLinks(readFileSync(indexPath, 'utf8'));
  }

  private resolveWikiLink(link: string, slugSet: Set<string>, basenameToSlug: Map<string, string>): string | undefined {
    const normalizedLink = link.trim().replace(/\.md$/, '');
    if (slugSet.has(normalizedLink)) {
      return normalizedLink;
    }
    return basenameToSlug.get(normalizedLink);
  }

  private isIndexed(slug: string, indexLinks: string[]): boolean {
    const basenameSlug = slug.split('/').at(-1)!;
    return indexLinks.some((link) => {
      const normalizedLink = link.trim().replace(/\.md$/, '');
      return normalizedLink === slug || normalizedLink === basenameSlug;
    });
  }

  private markdownRelativePath(filePath: string): string {
    return this.relativeWikiPath(filePath).split(sep).join('/');
  }

  private extractWikiLinks(markdown: string): string[] {
    return Array.from(markdown.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)).map((match) => match[1].trim());
  }

  private extractAssetUrls(markdown: string): string[] {
    return Array.from(markdown.matchAll(/!\[\[([^\]]+)\]\]/g))
      .map((match) => match[1].trim())
      .filter((assetPath) => assetPath && !assetPath.startsWith('/') && !assetPath.includes('..'))
      .map((assetPath) => this.assetUrl(assetPath));
  }
}
