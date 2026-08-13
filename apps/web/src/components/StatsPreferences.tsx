import { useEffect, useState } from 'react';
import type { PatchTradeStatsPreferencesRequest, TradeStatsPreferences } from '@trading-journal/shared';
import { ApiError } from '../api/client';

interface StatsPreferencesProps {
  preferences: TradeStatsPreferences;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onSaved?: (next: TradeStatsPreferences) => Promise<void> | void;
}

const sessionNames = ['asia', 'london', 'new-york'] as const;
const sessionLabels = { asia: '아시아', london: '런던', 'new-york': '뉴욕' } as const;

function minuteLabel(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function labelMinute(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : undefined;
}

export function StatsPreferences({ preferences, request, onSaved }: StatsPreferencesProps) {
  const [draft, setDraft] = useState(preferences);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(preferences), [preferences]);

  async function save() {
    setMessage('');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: draft.timeZone.trim() });
    } catch {
      setMessage('올바른 IANA 시간대를 입력하세요.');
      return;
    }
    if (!Number.isFinite(draft.breakevenPercent) || draft.breakevenPercent < 0 || draft.breakevenPercent > 100) {
      setMessage('손익분기점은 0~100 사이여야 합니다.');
      return;
    }
    const body: PatchTradeStatsPreferencesRequest = {
      breakevenPercent: draft.breakevenPercent,
      timeZone: draft.timeZone.trim(),
      tradingDayStartMinutes: draft.tradingDayStartMinutes,
      sessions: draft.sessions,
    };
    setSaving(true);
    try {
      const next = await request<TradeStatsPreferences>('/trade-log/stats/preferences', { method: 'PATCH', body: JSON.stringify(body) });
      setDraft(next);
      await onSaved?.(next);
      setMessage('분석 환경설정을 저장했습니다.');
    } catch (error) {
      setMessage(error instanceof ApiError && error.message ? error.message : '분석 환경설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const updateSession = (name: typeof sessionNames[number], field: 'startMinutes' | 'endMinutes', value: string) => {
    const minutes = labelMinute(value);
    if (minutes === undefined) return;
    setDraft((current) => ({ ...current, sessions: { ...current.sessions, [name]: { ...current.sessions[name], [field]: minutes } } }));
  };
  const reset = () => {
    setDraft((current) => ({
      ...current,
      breakevenPercent: 0.1,
      timeZone: 'Asia/Seoul',
      tradingDayStartMinutes: 0,
      sessions: {
        asia: { startMinutes: 540, endMinutes: 930 },
        london: { startMinutes: 480, endMinutes: 990 },
        'new-york': { startMinutes: 570, endMinutes: 960 },
      },
    }));
    setMessage('기본값을 적용했습니다. 저장하면 반영됩니다.');
  };

  return <section className="settings-card stats-preferences">
    <div className="settings-card-heading"><h2>분석 환경설정</h2><span aria-hidden="true">·</span><p className="muted">매매일지와 통계의 거래일, 세션, 손익분기 분류 기준을 설정합니다.</p></div>
    <div className="stats-preferences-groups">
      <section className="preferences-group">
        <h3>통계 기준</h3>
        <div className="preferences-general-grid">
          <label>시드 대비 본절 기준 (%)<input aria-label="시드 대비 본절 기준" type="number" min="0" max="100" step="0.01" value={draft.breakevenPercent} onChange={(event) => setDraft({ ...draft, breakevenPercent: Number(event.target.value) })} /></label>
          <label><span className="metric-label has-tooltip" tabIndex={0} data-tooltip="거래일과 세션을 계산할 때 기준으로 사용하는 IANA 표준 시간대입니다. 예: Asia/Seoul, America/New_York">IANA 분석 시간대<span aria-hidden="true">?</span></span><input aria-label="분석 시간대" value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} placeholder="Asia/Seoul" /></label>
          <label><span className="metric-label has-tooltip" tabIndex={0} data-tooltip="설정한 분석 시간대에서 이 시각부터 다음 날 시작 직전까지를 같은 매매일로 묶습니다. 예: 06:00이면 06:00부터 다음 날 05:59까지입니다.">거래일 시작 시간<span aria-hidden="true">?</span></span><input aria-label="거래일 시작 시간" type="time" value={minuteLabel(draft.tradingDayStartMinutes)} onChange={(event) => { const value = labelMinute(event.target.value); if (value !== undefined) setDraft({ ...draft, tradingDayStartMinutes: value }); }} /></label>
        </div>
      </section>
      <section className="preferences-group">
        <h3>세션 시간</h3>
        <div className="preferences-session-grid">{sessionNames.map((name) => <div className="session-setting" key={name}><strong>{sessionLabels[name]} 세션</strong><label>시작<input aria-label={`${name} 시작`} type="time" value={minuteLabel(draft.sessions[name].startMinutes)} onChange={(event) => updateSession(name, 'startMinutes', event.target.value)} /></label><label>종료<input aria-label={`${name} 종료`} type="time" value={minuteLabel(draft.sessions[name].endMinutes)} onChange={(event) => updateSession(name, 'endMinutes', event.target.value)} /></label></div>)}</div>
      </section>
    </div>
    <p className="settings-preview">현재 한국 표시 · 거래일 {preferences.display.tradingDayStartLabel} · {Object.entries(preferences.display.sessions).map(([name, value]) => `${name} ${value.startLabel}–${value.endLabel}`).join(' / ')}</p>
    <div className="stats-preferences-actions"><button type="button" className="secondary-button" onClick={reset}>환경설정 초기화</button><button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : '환경설정 저장'}</button>{message && <p role={message.includes('저장했습니다') || message.includes('기본값') ? 'status' : 'alert'}>{message}</p>}</div>
  </section>;
}
