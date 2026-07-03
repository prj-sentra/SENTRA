import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { TradeJournalContext, TradeRecord, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type View = 'trade-log' | 'wiki';

interface ApiState {
  trades: TradeRecord[];
  wikiPages: WikiPageSummary[];
}

const initialState: ApiState = {
  trades: [],
  wikiPages: [],
};

function wikiHtmlForCurrentHost(bodyHtml: string): string {
  if (apiUrl === '/api') {
    return bodyHtml;
  }
  return bodyHtml.replaceAll('src="/api/', `src="${apiUrl}/`);
}

function formatTradeTimestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  });
}

function tradeSummaryChips(trade: TradeRecord): string[] {
  return [trade.timeframe, trade.session, trade.strategy].filter((value): value is string => Boolean(value));
}

function tradeJournalBlocks(journal: TradeJournalContext | undefined): Array<{ title: string; rows: Array<[string, string]> }> {
  if (!journal) {
    return [];
  }

  const blocks: Array<{ title: string; rows: Array<[string, string]> }> = [];

  const planRows: Array<[string, string]> = [];
  if (journal.plan?.setupType) planRows.push(['setup', journal.plan.setupType]);
  if (journal.plan?.entryModel) planRows.push(['entry model', journal.plan.entryModel]);
  if (journal.plan?.confirmations?.length) planRows.push(['confirmations', journal.plan.confirmations.join(' · ')]);
  if (journal.plan?.invalidation) planRows.push(['invalidation', journal.plan.invalidation]);
  if (journal.plan?.stopLossPrice) planRows.push(['stop loss', String(journal.plan.stopLossPrice)]);
  if (journal.plan?.takeProfitPrice) planRows.push(['take profit', String(journal.plan.takeProfitPrice)]);
  if (journal.plan?.plannedLossAmount) planRows.push(['planned loss', String(journal.plan.plannedLossAmount)]);
  if (journal.plan?.dailyLossLimit) planRows.push(['daily loss limit', String(journal.plan.dailyLossLimit)]);
  if (journal.plan?.calmState !== undefined) planRows.push(['calm state', journal.plan.calmState ? 'yes' : 'no']);
  if (journal.plan?.checklistNotes) planRows.push(['checklist notes', journal.plan.checklistNotes]);
  if (planRows.length > 0) blocks.push({ title: 'Setup / Risk', rows: planRows });

  const managementRows: Array<[string, string]> = [];
  if (journal.management?.breakevenRule) managementRows.push(['breakeven rule', journal.management.breakevenRule]);
  if (journal.management?.additionRule) managementRows.push(['addition rule', journal.management.additionRule]);
  if (journal.management?.exitTriggers?.length) managementRows.push(['exit triggers', journal.management.exitTriggers.join(' · ')]);
  if (journal.management?.managementNotes) managementRows.push(['management notes', journal.management.managementNotes]);
  if (managementRows.length > 0) blocks.push({ title: 'Management', rows: managementRows });

  const reviewRows: Array<[string, string]> = [];
  if (journal.review?.resultLabel) reviewRows.push(['result label', journal.review.resultLabel]);
  if (journal.review?.processVerdict) reviewRows.push(['process verdict', journal.review.processVerdict]);
  if (journal.review?.ruleViolations?.length) reviewRows.push(['rule violations', journal.review.ruleViolations.join(' · ')]);
  if (journal.review?.lessons?.length) reviewRows.push(['lessons', journal.review.lessons.join(' · ')]);
  if (journal.review?.realizedPnlText) reviewRows.push(['realized pnl', journal.review.realizedPnlText]);
  if (journal.review?.reviewNotes) reviewRows.push(['review notes', journal.review.reviewNotes]);
  if (reviewRows.length > 0) blocks.push({ title: 'Review', rows: reviewRows });

  return blocks;
}

export function App() {
  const [activeView, setActiveView] = useState<View>('trade-log');
  const [state, setState] = useState<ApiState>(initialState);
  const [selectedWikiSlug, setSelectedWikiSlug] = useState<string | null>(null);
  const [selectedWikiPage, setSelectedWikiPage] = useState<WikiPageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/trade-log/trades`).then((res) => res.json() as Promise<TradeRecord[]>),
      fetch(`${apiUrl}/wiki/pages`).then((res) => res.json() as Promise<WikiPageSummary[]>),
    ])
      .then(([trades, wikiPages]) => {
        setState({ trades, wikiPages });
        setSelectedWikiSlug((current) => current ?? wikiPages[0]?.slug ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown API error');
      });
  }, []);

  useEffect(() => {
    if (!selectedWikiSlug) {
      setSelectedWikiPage(null);
      return;
    }

    fetch(`${apiUrl}/wiki/pages/${selectedWikiSlug}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Wiki page request failed: ${res.status}`);
        }
        return res.json() as Promise<WikiPageDetail>;
      })
      .then(setSelectedWikiPage)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown wiki API error');
      });
  }, [selectedWikiSlug]);

  function resolveWikiSlug(wikiLink: string): string | undefined {
    const normalizedLink = wikiLink.replace(/\.md$/, '');
    return state.wikiPages.find((page) => {
      const basename = page.slug.split('/').at(-1);
      return page.slug === normalizedLink || basename === normalizedLink;
    })?.slug;
  }

  function activateWikiLink(wikiLink: string): void {
    const resolvedSlug = resolveWikiSlug(wikiLink);
    if (!resolvedSlug) {
      setError(`Wiki link target not found: ${wikiLink}`);
      return;
    }

    setError(null);
    setActiveView('wiki');
    setSelectedWikiSlug(resolvedSlug);
  }

  useEffect(() => {
    function syncWikiHash(): void {
      if (!window.location.hash.startsWith('#wiki/')) {
        return;
      }
      const wikiLink = decodeURIComponent(window.location.hash.slice('#wiki/'.length));
      activateWikiLink(wikiLink);
    }

    syncWikiHash();
    window.addEventListener('hashchange', syncWikiHash);
    return () => window.removeEventListener('hashchange', syncWikiHash);
  }, [state.wikiPages]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent): void {
      const target = event.target as Element | null;
      const link = target?.closest<HTMLAnchorElement>('a[data-wiki-link]');
      const wikiLink = link?.dataset.wikiLink;
      if (!wikiLink) {
        return;
      }
      activateWikiLink(wikiLink);
    }

    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [state.wikiPages]);

  function handleWikiContentClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const target = event.target as Element | null;
    const link = target?.closest<HTMLAnchorElement>('a[data-wiki-link]');
    if (!link) {
      return;
    }

    const wikiLink = link.dataset.wikiLink;
    if (!wikiLink) {
      return;
    }

    activateWikiLink(wikiLink);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">S.E.N.T.R.A. / OPERATIONS CONSOLE</p>
          <h1>Trading Journal</h1>
          <p className="subhead">Structured trade records and field-maintained LLM wiki.</p>
        </div>
        <div className="control-stack">
          <div className="system-status" aria-label="System status">
            <span>API ONLINE</span>
            <span>{state.trades.length} TRADES</span>
            <span>{state.wikiPages.length} WIKI PAGES</span>
          </div>
          <nav className="tabs" aria-label="Sentra sections">
            <button
              className={activeView === 'trade-log' ? 'tab active' : 'tab'}
              type="button"
              onClick={() => setActiveView('trade-log')}
            >
              매매일지
            </button>
            <button
              className={activeView === 'wiki' ? 'tab active' : 'tab'}
              type="button"
              onClick={() => setActiveView('wiki')}
            >
              위키
            </button>
          </nav>
        </div>
      </header>

      {error ? <p className="error">API error: {error}</p> : null}

      {activeView === 'trade-log' ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Trade Log</p>
              <h2>독립 포지션 기록</h2>
            </div>
            <span className="count">{state.trades.length} records</span>
          </div>

          {state.trades.length === 0 ? (
            <div className="empty-state">
              <h3>기록 대기 상태</h3>
              <p>텔레그램 대화를 통해 진입과 청산이 분리된 trade를 기록할 수 있습니다.</p>
            </div>
          ) : (
            <div className="list">
              {state.trades.map((trade) => {
                const journalBlocks = tradeJournalBlocks(trade.journal);
                const summaryChips = tradeSummaryChips(trade);
                const entryAt = formatTradeTimestamp(trade.entry?.occurredAt);
                const exitAt = formatTradeTimestamp(trade.exit?.occurredAt);

                return (
                  <article className="list-item trade-card" key={trade.id}>
                    <div className="trade-card-header">
                      <div>
                        <strong>{trade.symbol}</strong>
                        <div className="trade-chip-row">
                          <span>{trade.side}</span>
                          <span>{trade.status}</span>
                          {summaryChips.map((chip) => (
                            <span key={`${trade.id}-${chip}`}>{chip}</span>
                          ))}
                        </div>
                      </div>
                      <span className="trade-id">{trade.id.slice(0, 8)}</span>
                    </div>

                    <div className="trade-stat-grid">
                      {trade.entry ? (
                        <div className="trade-stat-block">
                          <small>entry</small>
                          <strong>{trade.entry.price}</strong>
                          <span>
                            {trade.entry.quantity ? `qty ${trade.entry.quantity}` : 'qty -'}
                            {entryAt ? ` · ${entryAt}` : ''}
                          </span>
                        </div>
                      ) : null}
                      {trade.exit ? (
                        <div className="trade-stat-block">
                          <small>exit</small>
                          <strong>{trade.exit.price}</strong>
                          <span>
                            {trade.exit.quantity ? `qty ${trade.exit.quantity}` : 'qty -'}
                            {exitAt ? ` · ${exitAt}` : ''}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {trade.thesis ? <p className="trade-thesis">{trade.thesis}</p> : null}
                    {trade.note ? <p className="trade-note">raw: {trade.note}</p> : null}

                    {journalBlocks.length > 0 ? (
                      <div className="trade-journal-grid">
                        {journalBlocks.map((block) => (
                          <section className="trade-journal-block" key={`${trade.id}-${block.title}`}>
                            <h3>{block.title}</h3>
                            <dl>
                              {block.rows.map(([label, value]) => (
                                <div key={`${block.title}-${label}`}>
                                  <dt>{label}</dt>
                                  <dd>{value}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">LLM Wiki</p>
              <h2>트레이딩 지식 베이스</h2>
            </div>
            <span className="count">{state.wikiPages.length} pages</span>
          </div>

          {state.wikiPages.length === 0 ? (
            <div className="empty-state">
              <h3>위키 페이지가 아직 없습니다.</h3>
              <p>Markdown 기반 LLM Wiki 페이지를 웹에서 읽을 수 있습니다.</p>
            </div>
          ) : (
            <div className="wiki-layout">
              <aside className="wiki-sidebar" aria-label="Wiki pages">
                {state.wikiPages.map((page) => (
                  <button
                    className={selectedWikiSlug === page.slug ? 'wiki-nav-item active' : 'wiki-nav-item'}
                    key={page.slug}
                    type="button"
                    onClick={() => setSelectedWikiSlug(page.slug)}
                  >
                    <strong>{page.title}</strong>
                    <span>{page.type} · {page.updatedAt}</span>
                    {page.excerpt ? <small>{page.excerpt}</small> : null}
                  </button>
                ))}
              </aside>

              <article className="wiki-reader">
                {selectedWikiPage ? (
                  <>
                    <header className="wiki-reader-header">
                      <p className="section-label">{selectedWikiPage.type}</p>
                      <h3>{selectedWikiPage.title}</h3>
                      <div className="tag-row">
                        {selectedWikiPage.tags.map((tag) => (
                          <span className="tag" key={tag}>{tag}</span>
                        ))}
                      </div>
                    </header>

                    <div
                      className="wiki-content"
                      onClick={handleWikiContentClick}
                      dangerouslySetInnerHTML={{ __html: wikiHtmlForCurrentHost(selectedWikiPage.bodyHtml) }}
                    />

                    <footer className="wiki-meta">
                      <span>slug: {selectedWikiPage.slug}</span>
                      <span>links: {selectedWikiPage.outboundLinks.length}</span>
                      <span>assets: {selectedWikiPage.assetUrls.length}</span>
                    </footer>
                  </>
                ) : (
                  <div className="empty-state compact">
                    <h3>페이지를 선택하세요.</h3>
                  </div>
                )}
              </article>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
