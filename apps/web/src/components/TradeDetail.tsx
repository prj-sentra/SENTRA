import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, TradeCampaign } from '@trading-journal/shared';
import { TradeAnalysisEditor } from './TradeAnalysisEditor';
import { ExecutionTradeRow } from './ExecutionTradeRow';

export interface TradeDetailProps {
  campaign: TradeCampaign;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onPatchCampaignAnalysis: (campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => Promise<void>;
}

export interface TradeDetailHandle {
  save: () => void;
  reset: () => void;
}

const stateLabel = (complete: boolean) => complete ? '작성 완료' : '작성 필요';
const sideLabel = (side: string) => side === 'long' ? '매수' : '매도';
const pnl = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR');

export const TradeDetail = forwardRef<TradeDetailHandle, TradeDetailProps>(({ campaign, onPatchAnalysis, onPatchCampaignAnalysis }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mobileOpenIndex, setMobileOpenIndex] = useState<number | undefined>(0);
  const selectedTrade = campaign.members[selectedIndex] ?? campaign.members[0];
  const desktopForm = useRef<HTMLFormElement>(null);
  const mobileForm = useRef<HTMLFormElement>(null);
  const campaignForm = useRef<HTMLFormElement>(null);
  const rootTrade = campaign.members.find((member) => member.id === campaign.rootTradeId) ?? campaign.members[0];
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
      <h2>거래 공통 분석</h2>
      <TradeAnalysisEditor ref={campaignForm} trade={rootTrade} campaign={campaign} scope="campaign" onSave={onPatchAnalysis} onSaveCampaign={onPatchCampaignAnalysis} />
    </section>
    <h2 className="execution-analysis-heading">매매별 분석</h2>
    <nav className="split-trade-navigation desktop-trade-navigation" aria-label="분할 매매 선택">
      {campaign.members.map((member, index) => <button key={member.id} type="button" className={`${index === selectedIndex ? 'active ' : ''}${member.analysisComplete ? 'complete' : 'incomplete'}`} aria-current={index === selectedIndex ? 'step' : undefined} onClick={() => setSelectedIndex(index)}>{index + 1}<span className="sr-only">번째 분할 매매 {stateLabel(member.analysisComplete)}</span></button>)}
    </nav>
    <div className="desktop-trade-detail"><section><ExecutionTradeRow trade={selectedTrade} /></section><div className="trade-editor-grid"><TradeAnalysisEditor ref={desktopForm} key={selectedTrade.id} trade={selectedTrade} onSave={onPatchAnalysis} /></div></div>
    <div className="mobile-trade-detail">
      {campaign.members.map((member, index) => <section key={member.id} className="mobile-trade-panel"><button id={`trade-toggle-${member.id}`} type="button" className="mobile-trade-toggle" aria-expanded={mobileOpenIndex === index} aria-controls={mobileOpenIndex === index ? `trade-detail-${member.id}` : undefined} onClick={() => setMobileOpenIndex((open) => open === index ? undefined : index)}><span>{index + 1}번째 실행 · {sideLabel(member.side)} · PnL {pnl(member.realizedPnl)}</span><span className={member.analysisComplete ? 'complete' : 'incomplete'}>{stateLabel(member.analysisComplete)}</span></button>{mobileOpenIndex === index ? <div id={`trade-detail-${member.id}`} role="region" aria-labelledby={`trade-toggle-${member.id}`}><ExecutionTradeRow trade={member} /><div className="trade-editor-grid"><TradeAnalysisEditor ref={mobileForm} key={member.id} trade={member} onSave={onPatchAnalysis} /></div></div> : null}</section>)}
    </div>
  </div>;
});
