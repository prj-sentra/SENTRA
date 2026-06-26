import { useEffect, useState } from 'react';
import type { TradeRecord, WikiPageSummary } from '@trading-journal/shared';

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

export function App() {
  const [activeView, setActiveView] = useState<View>('trade-log');
  const [state, setState] = useState<ApiState>(initialState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/trade-log/trades`).then((res) => res.json() as Promise<TradeRecord[]>),
      fetch(`${apiUrl}/wiki/pages`).then((res) => res.json() as Promise<WikiPageSummary[]>),
    ])
      .then(([trades, wikiPages]) => {
        setState({ trades, wikiPages });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown API error');
      });
  }, []);

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
              <p>다음 단계에서 진입과 청산이 분리된 trade 기록 API를 붙입니다.</p>
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
              <p className="section-label">Trading Wiki</p>
              <h2>트레이딩 지식 베이스</h2>
            </div>
            <span className="count">{state.wikiPages.length} pages</span>
          </div>

          {state.wikiPages.length === 0 ? (
            <div className="empty-state">
              <h3>위키는 아직 준비 영역입니다.</h3>
              <p>매매일지 기능을 먼저 쌓은 뒤, 대화 기반 지식 정리와 뷰어를 붙입니다.</p>
            </div>
          ) : (
            <div className="list">
              {state.wikiPages.map((page) => (
                <article className="list-item" key={page.slug}>
                  <strong>{page.title}</strong>
                  <span>{page.type}</span>
                  <span>{page.updatedAt}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
