import { useEffect, useState } from 'react';
import type { TradeRecord, WikiPageDetail, WikiPageSummary } from '@trading-journal/shared';

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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">S.E.N.T.R.A.</p>
          <h1>Trading Journal</h1>
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
      </header>

      {error ? <p className="error">API error: {error}</p> : null}

      {activeView === 'trade-log' ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Trade Log</p>
              <h2>독립 포지션 기록</h2>
            </div>
            <span className="count">{state.trades.length} trades</span>
          </div>

          {state.trades.length === 0 ? (
            <div className="empty-state">
              <h3>아직 기록된 매매가 없습니다.</h3>
              <p>텔레그램 대화를 통해 진입과 청산이 분리된 trade를 기록할 수 있습니다.</p>
            </div>
          ) : (
            <div className="list">
              {state.trades.map((trade) => (
                <article className="list-item" key={trade.id}>
                  <strong>{trade.symbol}</strong>
                  <span>{trade.side}</span>
                  <span>{trade.status}</span>
                </article>
              ))}
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
              <p>이제 markdown 기반 LLM Wiki 페이지를 웹에서 읽을 수 있습니다.</p>
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
