import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { HealthResponse, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, normalize, relative, sep } from 'node:path';

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
      bodyHtml: '',
      outboundLinks: this.extractWikiLinks(bodyMarkdown),
      inboundLinks: [],
      assetUrls: this.extractAssetUrls(bodyMarkdown),
    };
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
      .find((paragraph) => paragraph.length > 0);

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

  private extractWikiLinks(markdown: string): string[] {
    return Array.from(markdown.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)).map((match) => match[1].trim());
  }

  private extractAssetUrls(markdown: string): string[] {
    return Array.from(markdown.matchAll(/!\[\[([^\]]+)\]\]/g))
      .map((match) => match[1].trim())
      .filter((assetPath) => assetPath && !assetPath.startsWith('/') && !assetPath.includes('..'))
      .map((assetPath) => `/api/wiki/assets/${assetPath}`);
  }
}
