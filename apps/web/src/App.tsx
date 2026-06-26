import { useEffect, useState } from 'react';
import type { HealthResponse, TradeRecord, WikiPageSummary } from '@trading-journal/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface ApiState {
  apiHealth: HealthResponse | null;
  tradeLogHealth: HealthResponse | null;
  wikiHealth: HealthResponse | null;
  trades: TradeRecord[];
  wikiPages: WikiPageSummary[];
}

const initialState: ApiState = {
  apiHealth: null,
  tradeLogHealth: null,
  wikiHealth: null,
  trades: [],
  wikiPages: [],
};

export function App() {
  const [state, setState] = useState<ApiState>(initialState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/health`).then((res) => res.json() as Promise<HealthResponse>),
      fetch(`${apiUrl}/trade-log/health`).then((res) => res.json() as Promise<HealthResponse>),
      fetch(`${apiUrl}/wiki/health`).then((res) => res.json() as Promise<HealthResponse>),
      fetch(`${apiUrl}/trade-log/trades`).then((res) => res.json() as Promise<TradeRecord[]>),
      fetch(`${apiUrl}/wiki/pages`).then((res) => res.json() as Promise<WikiPageSummary[]>),
    ])
      .then(([apiHealth, tradeLogHealth, wikiHealth, trades, wikiPages]) => {
        setState({ apiHealth, tradeLogHealth, wikiHealth, trades, wikiPages });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown API error');
      });
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">S.E.N.T.R.A.</p>
        <h1>기록이 먼저다. 판단은 그 다음이다.</h1>
        <p className="lead">
          매매일지와 트레이딩 지식 위키를 bottom-up으로 쌓아가는 수동 트레이딩 운영 시스템입니다.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>API 상태</h2>
          {state.apiHealth ? <pre>{JSON.stringify(state.apiHealth, null, 2)}</pre> : <p>확인 중...</p>}
          {error ? <p className="error">API error: {error}</p> : null}
        </article>

        <article className="card">
          <h2>Trade Log</h2>
          {state.tradeLogHealth ? <p className="ok">{state.tradeLogHealth.service} online</p> : <p>확인 중...</p>}
          <p>현재 기록된 독립 포지션: {state.trades.length}개</p>
          <p className="muted">다음 단계: 진입/청산이 분리된 최소 trade 기록 API.</p>
        </article>

        <article className="card">
          <h2>Trading Wiki</h2>
          {state.wikiHealth ? <p className="ok">{state.wikiHealth.service} online</p> : <p>확인 중...</p>}
          <p>현재 위키 페이지: {state.wikiPages.length}개</p>
          <p className="muted">Wiki는 스켈레톤만 유지하고, trade log 구현 후 확장합니다.</p>
        </article>
      </section>
    </main>
  );
}
