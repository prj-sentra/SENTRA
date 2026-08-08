import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');

describe('committed product language and layout gate', () => {
  it('uses a per-card 719px container boundary', () => {
    const css = readFileSync(join(sourceRoot, 'styles.css'), 'utf8');
    expect(css).toMatch(/\.trade-record-card\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toContain('@container (max-width: 719px)');
  });

  it('does not expose internal grouping terminology in rendered copy', () => {
    const files = ['components/TradeJournalPage.tsx', 'components/TradeRecordCard.tsx', 'components/TradeDetail.tsx'];
    const renderedText = files.map((file) => readFileSync(join(sourceRoot, file), 'utf8')).join('\n');
    expect(renderedText).not.toMatch(/>[\s]*(Campaign|Member)s?[\s]*</i);
    expect(renderedText).not.toMatch(/aria-label=["'`][^"'`]*(Campaign|Member)/i);
  });
});
