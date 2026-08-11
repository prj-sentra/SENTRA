import { forwardRef, useEffect, useState, type FormEvent } from 'react';
import type { PatchTradeCampaignAnalysisRequest, PatchTradeCampaignMemoRequest, TradeCampaign } from '@trading-journal/shared';

export const CampaignMemoEditor = forwardRef<HTMLFormElement, {
  campaign: TradeCampaign;
  onSave: (campaignId: string, patch: PatchTradeCampaignMemoRequest) => Promise<void>;
  onSaveAnalysis?: (campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => Promise<void>;
}>(({ campaign, onSave, onSaveAnalysis }, ref) => {
  const [memo, setMemo] = useState(campaign.memo ?? '');
  const analysis = campaign.analysis ?? {} as TradeCampaign['analysis'];
  const [review, setReview] = useState({
    entryReason: analysis.entryReason ?? '',
    invalidationCondition: analysis.invalidationCondition ?? '',
    takeProfitCondition: analysis.takeProfitCondition ?? '',
    additionalEntryPlan: analysis.additionalEntryPlan ?? '',
    tradeScore: analysis.tradeScore?.toString() ?? '',
    strengths: analysis.strengths ?? '',
    weaknesses: analysis.weaknesses ?? '',
  });
  const [, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setMemo(campaign.memo ?? '');
    const nextAnalysis = campaign.analysis ?? {} as TradeCampaign['analysis'];
    setReview({
      entryReason: nextAnalysis.entryReason ?? '',
      invalidationCondition: nextAnalysis.invalidationCondition ?? '',
      takeProfitCondition: nextAnalysis.takeProfitCondition ?? '',
      additionalEntryPlan: nextAnalysis.additionalEntryPlan ?? '',
      tradeScore: nextAnalysis.tradeScore?.toString() ?? '',
      strengths: nextAnalysis.strengths ?? '',
      weaknesses: nextAnalysis.weaknesses ?? '',
    });
  }, [campaign]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await onSave(campaign.id, { memo: memo.trim() || null, expectedUpdatedAt: campaign.updatedAt });
      if (onSaveAnalysis && campaign.analysis) await onSaveAnalysis(campaign.id, {
        expectedUpdatedAt: campaign.analysis.updatedAt,
        entryReason: review.entryReason.trim() || null,
        invalidationCondition: review.invalidationCondition.trim() || null,
        takeProfitCondition: review.takeProfitCondition.trim() || null,
        additionalEntryPlan: review.additionalEntryPlan.trim() || null,
        tradeScore: review.tradeScore ? Number(review.tradeScore) : null,
        strengths: review.strengths.trim() || null,
        weaknesses: review.weaknesses.trim() || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '거래 메모 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, key: keyof typeof review, placeholder: string) => <label><span>{label}</span><textarea value={review[key]} placeholder={placeholder} onChange={(event) => setReview((current) => ({ ...current, [key]: event.target.value }))} /></label>;

  return <form ref={ref} className="campaign-memo-editor" onSubmit={(event) => void submit(event)} onReset={() => { setMemo(campaign.memo ?? ''); setError(undefined); }}>
    <h3>거래 메모</h3>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <textarea
      aria-label="거래 메모"
      value={memo}
      placeholder={'거래 전체의 진입 근거, 청산 판단, TP·SL 설정 근거와 복기 내용을 기록하세요.'}
      onChange={(event) => setMemo(event.target.value)}
    />
    <section className="campaign-journal-fields">
      <h3>거래 계획</h3>
      {field('진입 근거', 'entryReason', '이 거래에 진입한 핵심 근거를 기록하세요.')}
      {field('관점 무효화 조건', 'invalidationCondition', '어떤 조건에서 거래 관점이 틀렸다고 판단할지 기록하세요.')}
      {field('익절 조건', 'takeProfitCondition', '수익을 확정할 가격 또는 시장 조건을 기록하세요.')}
      {field('추가매수 계획', 'additionalEntryPlan', '추가 진입 조건이나 추가매수 금지 여부를 기록하세요.')}
      <h3>거래 복기</h3>
      <label><span>거래 점수</span><select value={review.tradeScore} onChange={(event) => setReview((current) => ({ ...current, tradeScore: event.target.value }))}><option value="">미평가</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score}점</option>)}</select></label>
      {field('잘한 점', 'strengths', '계획과 실행에서 잘한 점을 기록하세요.')}
      {field('아쉬운 점', 'weaknesses', '다음 거래에서 개선할 점을 기록하세요.')}
    </section>
  </form>;
});
