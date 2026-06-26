import { useEffect, useState } from 'react';
import type { HealthResponse, TradeRecord } from '@trading-journal/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${apiUrl}/health`).then((res) => res.json() as Promise<HealthResponse>),
      fetch(`${apiUrl}/trades`).then((res) => res.json() as Promise<TradeRecord[]>),
    ])
      .then(([healthResponse, tradeResponse]) => {
        setHealth(healthResponse);
        setTrades(tradeResponse);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown API error');
      });
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">S.E.N.T.R.A. Trading Journal</p>
        <h1>기록이 먼저다. 판단은 그 다음이다.</h1>
        <p className="lead">
          진입 근거, 리스크, 실행 품질, 사후 리뷰를 분리해서 기록하기 위한 웹서비스 스켈레톤입니다.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>API 상태</h2>
          {health ? <pre>{JSON.stringify(health, null, 2)}</pre> : <p>확인 중...</p>}
          {error ? <p className="error">API error: {error}</p> : null}
        </article>

        <article className="card">
          <h2>거래 기록</h2>
          <p>현재 샘플 API는 {trades.length}개의 거래를 반환합니다.</p>
          <p className="muted">다음 단계: DB schema, trade create form, journal review workflow.</p>
        </article>
      </section>
    </main>
  );
}
