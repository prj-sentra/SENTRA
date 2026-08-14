import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ExcursionFailureReason, ExcursionStatus, PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, TradeCampaign } from '@trading-journal/shared';
import { TradeAnalysisEditor } from './TradeAnalysisEditor';
import { ExecutionTradeRow } from './ExecutionTradeRow';

export interface TradeDetailProps {
  campaign: TradeCampaign;
  selectedTradeId?: string;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onPatchCampaignAnalysis: (campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => Promise<void>;
  onChangeCampaignHead?: (campaign: TradeCampaign, tradeId: string) => Promise<void>;
  campaignHeadBusy?: boolean;
}

export interface TradeDetailHandle {
  save: () => void;
  reset: () => void;
}

const stateLabel = (complete: boolean) => complete ? '작성 완료' : '작성 필요';
const sideLabel = (side: string) => side === 'long' ? '매수' : '매도';
const pnl = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR');
const excursionValue = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const money = (value: number | undefined, currency?: string) => `${excursionValue(value)}${currency ? ` ${currency}` : ''}`;
function elapsedLabel(openedAt: string, occurredAt: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(occurredAt) - Date.parse(openedAt)) / 60_000));
  if (minutes < 60) return `진입 ${minutes}분 후`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `진입 ${hours}시간${remainder ? ` ${remainder}분` : ''} 후`;
}
const failureCopy: Record<ExcursionFailureReason, string> = {
  HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE: '여러 종목이 섞여 가격 기준 비교를 제공할 수 없습니다.',
  VALUATION_UNSUPPORTED: '이 종목의 손익 계산 방식은 아직 지원하지 않습니다.',
  UNSUPPORTED_DEAL_SEQUENCE: 'MT5 체결 순서를 안전하게 해석할 수 없습니다.',
  TICK_SOURCE_LIMIT: 'MT5가 해당 기간의 가격 기록을 제공하지 않습니다.',
  TICK_CURSOR_EXPIRED: '가격 조회 시간이 만료되어 다시 계산을 기다리고 있습니다.',
  TICK_CAPACITY: 'MT5 가격 조회가 혼잡하여 잠시 후 다시 계산합니다.',
  TICK_DEADLINE: '가격 조회 시간이 초과되어 다시 계산을 기다리고 있습니다.',
  TICK_UNAVAILABLE: 'MT5에서 해당 기간의 가격 기록을 가져오지 못했습니다.',
  TICK_INVALID_PAYLOAD: '가격 기록 검증에 실패해 계산을 중단했습니다.',
  TICK_IDENTITY_MISMATCH: '다른 계정 또는 종목의 가격 기록이 감지되어 계산을 중단했습니다.',
  SYNC_PRIORITY_YIELD: 'MT5 동기화를 우선 처리한 뒤 자동으로 다시 계산합니다.',
  INPUT_CHANGED: '거래 정보가 변경되어 다시 계산해야 합니다.',
  ACCOUNT_DEACTIVATED: '비활성 계정은 계산하지 않습니다.',
  NO_SYNC_SNAPSHOT: '먼저 MT5 동기화가 필요합니다.',
};
const statusCopy: Record<ExcursionStatus, string> = {
  success: '계산 완료',
  stale: '재계산 필요',
  failed: '자동 계산 중단',
  unsupported: '계산할 수 없음',
};
function ExcursionStatusBadge({ status }: { status: ExcursionStatus }) {
  return <span className={`excursion-status is-${status}`}>{statusCopy[status]}</span>;
}
function OpportunityCards({ opportunity, risk, captureRate, currency, openedAt, opportunityAt, riskAt }: { opportunity?: number; risk?: number; captureRate?: number; currency?: string; openedAt: string; opportunityAt?: string; riskAt?: string }) {
  return <div className="excursion-card-grid">
    <article><span>최대 수익 기회</span><strong className="is-positive">{money(opportunity, currency)}</strong><small>{opportunityAt ? elapsedLabel(openedAt, opportunityAt) : '보유 중 가장 컸던 평가수익'}</small></article>
    <article><span>최대 손실 위험</span><strong className="is-negative">{money(risk, currency)}</strong><small>{riskAt ? elapsedLabel(openedAt, riskAt) : '보유 중 가장 컸던 평가손실'}</small></article>
    <article><span>수익 실현률</span><strong>{captureRate === undefined ? '계산 불가' : `${excursionValue(captureRate)}%`}</strong><small>실제 손익 ÷ 최대 수익 기회</small></article>
  </div>;
}
function OpportunityInterpretation({ realizedPnl, opportunity, risk, captureRate, currency }: { realizedPnl?: number; opportunity?: number; risk?: number; captureRate?: number; currency?: string }) {
  if (realizedPnl === undefined || opportunity === undefined || opportunity <= 0) return <p className="muted">수익 기회와 실제 손익을 비교할 수 없습니다.</p>;
  const missed = opportunity - realizedPnl;
  const riskNote = risk !== undefined && Math.abs(risk) > opportunity ? ' 최대 손실 위험이 최대 수익 기회보다 컸습니다.' : '';
  if (realizedPnl <= 0) return <p className="excursion-interpretation is-warning">보유 중 최대 {money(opportunity, currency)}의 수익 기회가 있었지만 {money(realizedPnl, currency)}로 종료했습니다.{riskNote}</p>;
  if (missed > 0) return <p className="excursion-interpretation">최대 수익 기회 중 {money(missed, currency)}를 반납하고 {money(realizedPnl, currency)}를 실현했습니다.{riskNote}</p>;
  return <p className="excursion-interpretation">최대 수익 기회의 {captureRate === undefined ? '대부분' : `${excursionValue(captureRate)}%`}를 실현했습니다.{riskNote}</p>;
}
function ExcursionRange({ opportunity, risk, realizedPnl, currency, openedAt, closedAt, opportunityAt, riskAt }: { opportunity: number; risk: number; realizedPnl: number; currency?: string; openedAt: string; closedAt?: string; opportunityAt: string; riskAt: string }) {
  const min = Math.min(risk, realizedPnl, 0), max = Math.max(opportunity, realizedPnl, 0), span = max - min || 1;
  const position = (value: number) => `${(value - min) / span * 100}%`;
  const events = [
    { label: '최대 손실 위험', at: riskAt },
    { label: '최대 수익 기회', at: opportunityAt },
    ...(closedAt ? [{ label: '청산', at: closedAt }] : []),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return <figure className="excursion-range" aria-label={`최대 손실 ${money(risk, currency)}, 실제 손익 ${money(realizedPnl, currency)}, 최대 수익 기회 ${money(opportunity, currency)}`}>
    <figcaption>보유 중 손익 범위</figcaption>
    <div className="excursion-range-labels"><span>{money(risk, currency)}</span><span>{money(opportunity, currency)}</span></div>
    <div className="excursion-range-track">
      <span className="range-loss" style={{ left: position(risk), width: `calc(${position(0)} - ${position(risk)})` }} />
      <span className="range-profit" style={{ left: position(0), width: `calc(${position(opportunity)} - ${position(0)})` }} />
      <i className="range-zero" style={{ left: position(0) }}><span>0</span></i>
      <i className={`range-realized ${realizedPnl >= 0 ? 'is-positive' : 'is-negative'}`} style={{ left: position(realizedPnl) }}><span>실제 {money(realizedPnl, currency)}</span></i>
    </div>
    <p>경로: {events.map((event) => event.label).join(' → ')}</p>
    <small>수익 기회 {elapsedLabel(openedAt, opportunityAt)} · 손실 위험 {elapsedLabel(openedAt, riskAt)}</small>
  </figure>;
}
function ExcursionDetail({ trade }: { trade: TradeCampaign['members'][number] }) {
  const result = trade.excursion;
  if (!result) return <section className="excursion-panel entry-excursion" aria-label="선택한 진입 시장 진행 분석"><header><div><h3>선택한 진입의 시장 진행</h3><p>이 분할 진입 하나만 계산한 결과입니다.</p></div><span className="excursion-status is-pending">계산 대기</span></header><p className="muted">MT5 가격 기록을 바탕으로 백그라운드에서 계산합니다.</p></section>;
  if (result.status === 'failed' || result.status === 'unsupported') return <section className="excursion-panel entry-excursion" aria-label="선택한 진입 시장 진행 분석"><header><div><h3>선택한 진입의 시장 진행</h3><p>이 분할 진입 하나만 계산한 결과입니다.</p></div><ExcursionStatusBadge status={result.status} /></header><p>{failureCopy[result.attempt.failureReason]}</p><details><summary>기술 정보</summary><p>내부 상태: {result.attempt.failureReason}</p></details></section>;
  if (!result.success || !result.metrics) return <section className="excursion-panel entry-excursion"><p className="muted">계산 결과를 확인할 수 없습니다.</p></section>;
  const metrics = result.metrics;
  return <section className="excursion-panel entry-excursion" aria-label="선택한 진입 시장 진행 분석"><header><div><h3>선택한 진입의 시장 진행</h3><p>이 분할 진입 하나만 계산한 결과입니다.</p></div><ExcursionStatusBadge status={result.status} /></header><OpportunityCards opportunity={metrics.unrealizedPnl.mfe.value} risk={metrics.unrealizedPnl.mae.value} captureRate={metrics.captureRate} currency={result.success.accountCurrency} openedAt={trade.openedAt ?? result.success.displayRange.fromAt} opportunityAt={metrics.unrealizedPnl.mfe.occurredAt} riskAt={metrics.unrealizedPnl.mae.occurredAt} /><ExcursionRange opportunity={metrics.unrealizedPnl.mfe.value} risk={metrics.unrealizedPnl.mae.value} realizedPnl={trade.realizedPnl ?? 0} currency={result.success.accountCurrency} openedAt={trade.openedAt ?? result.success.displayRange.fromAt} closedAt={trade.closedAt} opportunityAt={metrics.unrealizedPnl.mfe.occurredAt} riskAt={metrics.unrealizedPnl.mae.occurredAt} /><OpportunityInterpretation realizedPnl={trade.realizedPnl} opportunity={metrics.unrealizedPnl.mfe.value} risk={metrics.unrealizedPnl.mae.value} captureRate={metrics.captureRate} currency={result.success.accountCurrency} />{result.status === 'stale' ? <p className="muted">{failureCopy[result.attempt.failureReason]}</p> : null}<details><summary>상세 계산 정보 (MFE/MAE)</summary><dl><div><dt>가격 최대 유리/불리 변동</dt><dd>{excursionValue(metrics.price.mfe.value)} / {excursionValue(metrics.price.mae.value)}</dd></div><div><dt>진입가 대비 비율</dt><dd>{excursionValue(metrics.percent.mfe.value)}% / {excursionValue(metrics.percent.mae.value)}%</dd></div><div><dt>위험 대비 손익(R)</dt><dd>{metrics.rAvailability === 'available' ? `${excursionValue(metrics.r.mfe.value)} / ${excursionValue(metrics.r.mae.value)}` : '위험금액 없음'}</dd></div><div><dt>계산 근거</dt><dd>버전 {result.success.calculationVersion} · MT5 틱 {result.success.tickCount.toLocaleString('ko-KR')}개</dd></div></dl>{result.status === 'stale' ? <p>내부 상태: {result.attempt.failureReason}</p> : null}</details></section>;
}
function CampaignExcursionDetail({ campaign }: { campaign: TradeCampaign }) {
  const result = campaign.excursion;
  if (!result) return <section className="excursion-panel campaign-excursion" aria-label="매매 전체 시장 진행 분석"><header><div><h3>매매 전체 시장 진행</h3><p>모든 분할 진입과 청산을 합산한 결과입니다.</p></div><span className="excursion-status is-pending">계산 대기</span></header></section>;
  const family = result.unrealizedPnl;
  if (family.status === 'failed' || family.status === 'unsupported') return <section className="excursion-panel campaign-excursion" aria-label="매매 전체 시장 진행 분석"><header><div><h3>매매 전체 시장 진행</h3><p>모든 분할 진입과 청산을 합산한 결과입니다.</p></div><ExcursionStatusBadge status={family.status} /></header><p>{failureCopy[family.attempt.failureReason]}</p><details><summary>기술 정보</summary><p>내부 상태: {family.attempt.failureReason}</p></details></section>;
  if (!family.metrics || !family.success) return null;
  const price = result.price;
  return <section className="excursion-panel campaign-excursion" aria-label="매매 전체 시장 진행 분석"><header><div><h3>매매 전체 시장 진행</h3><p>모든 분할 진입과 청산을 합산한 결과입니다.</p></div><ExcursionStatusBadge status={family.status} /></header><OpportunityCards opportunity={family.metrics.unrealizedPnl.mfe.value} risk={family.metrics.unrealizedPnl.mae.value} captureRate={family.metrics.captureRate} currency={family.success.accountCurrency} openedAt={campaign.openedAt} opportunityAt={family.metrics.unrealizedPnl.mfe.occurredAt} riskAt={family.metrics.unrealizedPnl.mae.occurredAt} /><ExcursionRange opportunity={family.metrics.unrealizedPnl.mfe.value} risk={family.metrics.unrealizedPnl.mae.value} realizedPnl={campaign.realizedPnl} currency={family.success.accountCurrency} openedAt={campaign.openedAt} closedAt={campaign.closedAt} opportunityAt={family.metrics.unrealizedPnl.mfe.occurredAt} riskAt={family.metrics.unrealizedPnl.mae.occurredAt} /><OpportunityInterpretation realizedPnl={campaign.realizedPnl} opportunity={family.metrics.unrealizedPnl.mfe.value} risk={family.metrics.unrealizedPnl.mae.value} captureRate={family.metrics.captureRate} currency={family.success.accountCurrency} />{family.status === 'stale' ? <p className="muted">{failureCopy[family.attempt.failureReason]}</p> : null}<details><summary>상세 계산 정보 (MFE/MAE)</summary><dl><div><dt>평가손익 최대 유리/불리</dt><dd>{excursionValue(family.metrics.unrealizedPnl.mfe.value)} / {excursionValue(family.metrics.unrealizedPnl.mae.value)}</dd></div>{price.metrics && 'price' in price.metrics ? <div><dt>가격 최대 유리/불리 변동</dt><dd>{excursionValue(price.metrics.price.mfe.value)} / {excursionValue(price.metrics.price.mae.value)}</dd></div> : null}<div><dt>계산 근거</dt><dd>버전 {family.success.calculationVersion} · MT5 틱 {family.success.tickCount.toLocaleString('ko-KR')}개</dd></div></dl></details></section>;
}

export const TradeDetail = forwardRef<TradeDetailHandle, TradeDetailProps>(({ campaign, selectedTradeId, onPatchAnalysis, onPatchCampaignAnalysis, onChangeCampaignHead, campaignHeadBusy = false }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mobileOpenIndex, setMobileOpenIndex] = useState<number | undefined>(0);
  const selectedTrade = campaign.members[selectedIndex] ?? campaign.members[0];
  const desktopForm = useRef<HTMLFormElement>(null);
  const mobileForm = useRef<HTMLFormElement>(null);
  const campaignForm = useRef<HTMLFormElement>(null);
  const rootTrade = campaign.members.find((member) => member.id === campaign.rootTradeId) ?? campaign.members[0];
  useEffect(() => {
    if (!selectedTradeId) return;
    const index = campaign.members.findIndex((member) => member.id === selectedTradeId);
    if (index >= 0) { setSelectedIndex(index); setMobileOpenIndex(index); }
  }, [campaign.members, selectedTradeId]);
  const activeForm = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 800px)').matches ? mobileForm.current : desktopForm.current;
  useImperativeHandle(ref, () => ({
    save: () => {
      campaignForm.current?.requestSubmit();
      activeForm()?.requestSubmit();
    },
    reset: () => {
      campaignForm.current?.reset();
      activeForm()?.reset();
    },
  }));
  if (!selectedTrade) return null;
  return <div className="trade-detail">
    <section className="campaign-analysis-section">
      <TradeAnalysisEditor ref={campaignForm} trade={rootTrade} campaign={campaign} scope="campaign" onSave={onPatchAnalysis} onSaveCampaign={onPatchCampaignAnalysis} />
    </section>
    <CampaignExcursionDetail campaign={campaign} />
    <h2 className="execution-analysis-heading">진입별 분석</h2>
    <nav className="split-trade-navigation desktop-trade-navigation" aria-label="분할 진입 선택">
      {campaign.members.map((member, index) => <button key={member.id} type="button" className={`${index === selectedIndex ? 'active ' : ''}${member.analysisComplete ? 'complete' : 'incomplete'}`} aria-current={index === selectedIndex ? 'step' : undefined} onClick={() => setSelectedIndex(index)}>{index + 1}<span className="sr-only">번째 분할 진입 {stateLabel(member.analysisComplete)}</span></button>)}
    </nav>
    <div className="desktop-trade-detail"><section><ExecutionTradeRow trade={selectedTrade} campaign={campaign} busy={campaignHeadBusy} onChangeCampaignHead={onChangeCampaignHead} /><ExcursionDetail trade={selectedTrade} /></section><div className="trade-editor-grid"><TradeAnalysisEditor ref={desktopForm} key={selectedTrade.id} trade={selectedTrade} onSave={onPatchAnalysis} /></div></div>
    <div className="mobile-trade-detail">
      {campaign.members.map((member, index) => <section key={member.id} className="mobile-trade-panel"><button id={`trade-toggle-${member.id}`} type="button" className="mobile-trade-toggle" aria-expanded={mobileOpenIndex === index} aria-controls={mobileOpenIndex === index ? `trade-detail-${member.id}` : undefined} onClick={() => setMobileOpenIndex((open) => open === index ? undefined : index)}><span>{index + 1}번째 실행 · {sideLabel(member.side)} · PnL {pnl(member.realizedPnl)}</span><span className={member.analysisComplete ? 'complete' : 'incomplete'}>{stateLabel(member.analysisComplete)}</span></button>{mobileOpenIndex === index ? <div id={`trade-detail-${member.id}`} role="region" aria-labelledby={`trade-toggle-${member.id}`}><ExecutionTradeRow trade={member} campaign={campaign} busy={campaignHeadBusy} onChangeCampaignHead={onChangeCampaignHead} /><ExcursionDetail trade={member} /><div className="trade-editor-grid"><TradeAnalysisEditor ref={mobileForm} key={member.id} trade={member} onSave={onPatchAnalysis} /></div></div> : null}</section>)}
    </div>
  </div>;
});
