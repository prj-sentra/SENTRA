import { useEffect, useState, type FormEvent } from 'react';
import type { PatchTradeCampaignMemoRequest, TradeCampaign } from '@trading-journal/shared';

export function CampaignMemoEditor({ campaign, onSave }: {
  campaign: TradeCampaign;
  onSave: (campaignId: string, patch: PatchTradeCampaignMemoRequest) => Promise<void>;
}) {
  const [memo, setMemo] = useState(campaign.memo ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => setMemo(campaign.memo ?? ''), [campaign.id, campaign.memo, campaign.updatedAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await onSave(campaign.id, { memo: memo.trim() || null, expectedUpdatedAt: campaign.updatedAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '거래 메모 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return <form className="campaign-memo-editor" onSubmit={(event) => void submit(event)}>
    <h3>거래 메모</h3>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <textarea
      aria-label="거래 메모"
      value={memo}
      placeholder={'거래 전체의 진입 근거, 청산 판단, TP·SL 설정 근거와 복기 내용을 기록하세요.'}
      onChange={(event) => setMemo(event.target.value)}
    />
    <button type="submit" disabled={saving}>{saving ? '저장 중…' : '메모 저장'}</button>
  </form>;
}
