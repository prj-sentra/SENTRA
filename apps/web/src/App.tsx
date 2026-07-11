import { useEffect, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type {
  TradeJournalContext,
  TradeLogAssistantActionsRequest,
  TradeRecord,
  TradeStatsBucket,
  TradeStatsResponse,
  TradeTagCatalog,
  TradeTagDefinition,
  WikiPageDetail,
  WikiPageSummary,
} from '@trading-journal/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type View = 'stats' | 'trade-log' | 'wiki';

interface ApiState {
  trades: TradeRecord[];
  stats: TradeStatsResponse | null;
  wikiPages: WikiPageSummary[];
  tagCatalog: TradeTagCatalog | null;
}

const initialState: ApiState = {
  trades: [],
  stats: null,
  wikiPages: [],
  tagCatalog: null,
};

function routeFromPathname(pathname: string): View {
  if (pathname.startsWith('/trade-log')) return 'trade-log';
  if (pathname.startsWith('/wiki')) return 'wiki';
  return 'stats';
}

function routePath(view: View): string {
  switch (view) {
    case 'stats':
      return '/stats';
    case 'trade-log':
      return '/trade-log';
    case 'wiki':
      return '/wiki';
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

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

function formatMetric(value: number, suffix = ''): string {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const formatted = Number.isInteger(value) ? value.toLocaleString('ko-KR') : value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return `${formatted}${suffix}`;
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

function BreakdownTable({ buckets }: { buckets: TradeStatsBucket[] }) {
  if (buckets.length === 0) {
    return <p className="stats-empty">No data yet.</p>;
  }

  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th>bucket</th>
            <th>trades</th>
            <th>win rate</th>
            <th>realized pts</th>
            <th>good</th>
            <th>observe</th>
            <th>bad/repeat</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <td>{bucket.label}</td>
              <td>{formatMetric(bucket.count)}</td>
              <td>{formatMetric(bucket.winRate, '%')}</td>
              <td>{formatMetric(bucket.realizedPoints)}</td>
              <td>{formatMetric(bucket.goodCount)}</td>
              <td>{formatMetric(bucket.observeCount)}</td>
              <td>{formatMetric(bucket.badCount + bucket.repeatBanCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


interface TagChecklistGroupProps {
  title: string;
  hint: string;
  options: TradeTagDefinition[];
  selected: string[];
  onToggle: (label: string) => void;
  emptyMessage: string;
}

function TagChecklistGroup({ title, hint, options, selected, onToggle, emptyMessage }: TagChecklistGroupProps) {
  return (
    <section className="tag-selector-block">
      <div className="subform-header">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      {options.length > 0 ? (
        <div className="tag-selector-grid narrow">
          {options.map((option) => (
            <label className="checkbox-tag" key={option.id}>
              <input
                checked={selected.includes(option.label)}
                type="checkbox"
                onChange={() => onToggle(option.label)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="stats-empty">{emptyMessage}</p>
      )}
    </section>
  );
}

interface ManualTradeFormState {
  symbol: string;
  side: 'long' | 'short';
  timeframe: string;
  session: string;
  strategy: string;
  thesis: string;
  note: string;
  entryPrice: string;
  entryQuantity: string;
  entryOccurredAt: string;
  entryNote: string;
  exitPrice: string;
  exitQuantity: string;
  exitOccurredAt: string;
  exitReason: '' | 'target_hit' | 'stop_loss' | 'manual' | 'invalidated' | 'time_exit';
  exitNote: string;
  setupType: string;
  setupTags: string[];
  entryModel: string;
  confirmations: string;
  invalidation: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  plannedLossAmount: string;
  dailyLossLimit: string;
  calmState: boolean;
  checklistNotes: string;
  breakevenRule: string;
  additionRule: string;
  exitTriggers: string;
  managementNotes: string;
  resultLabel: string;
  processVerdict: '' | 'good' | 'bad' | 'repeat-ban' | 'observe';
  ruleViolationTags: string[];
  ruleViolations: string;
  lessonTags: string[];
  lessons: string;
  realizedPnlText: string;
  reviewNotes: string;
}

function toDatetimeLocalValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function createManualTradeFormState(): ManualTradeFormState {
  const now = toDatetimeLocalValue();
  return {
    symbol: '',
    side: 'long',
    timeframe: '',
    session: '',
    strategy: '',
    thesis: '',
    note: '',
    entryPrice: '',
    entryQuantity: '',
    entryOccurredAt: now,
    entryNote: '',
    exitPrice: '',
    exitQuantity: '',
    exitOccurredAt: now,
    exitReason: 'manual',
    exitNote: '',
    setupType: '',
    setupTags: [],
    entryModel: '',
    confirmations: '',
    invalidation: '',
    stopLossPrice: '',
    takeProfitPrice: '',
    plannedLossAmount: '',
    dailyLossLimit: '',
    calmState: false,
    checklistNotes: '',
    breakevenRule: '',
    additionRule: '',
    exitTriggers: '',
    managementNotes: '',
    resultLabel: '',
    processVerdict: '',
    ruleViolationTags: [],
    ruleViolations: '',
    lessonTags: [],
    lessons: '',
    realizedPnlText: '',
    reviewNotes: '',
  };
}

function splitListInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveNumberInput(value: string, fieldName: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return parsed;
}

function buildManualJournal(form: ManualTradeFormState): TradeJournalContext | undefined {
  const plan: NonNullable<TradeJournalContext['plan']> = {};
  if (form.setupType.trim()) plan.setupType = form.setupType.trim();
  if (form.setupTags.length > 0) plan.setupTags = form.setupTags;
  if (form.entryModel.trim()) plan.entryModel = form.entryModel.trim();
  const confirmations = splitListInput(form.confirmations);
  if (confirmations.length > 0) plan.confirmations = confirmations;
  if (form.invalidation.trim()) plan.invalidation = form.invalidation.trim();
  const stopLossPrice = parsePositiveNumberInput(form.stopLossPrice, 'stopLossPrice');
  if (stopLossPrice !== undefined) plan.stopLossPrice = stopLossPrice;
  const takeProfitPrice = parsePositiveNumberInput(form.takeProfitPrice, 'takeProfitPrice');
  if (takeProfitPrice !== undefined) plan.takeProfitPrice = takeProfitPrice;
  const plannedLossAmount = parsePositiveNumberInput(form.plannedLossAmount, 'plannedLossAmount');
  if (plannedLossAmount !== undefined) plan.plannedLossAmount = plannedLossAmount;
  const dailyLossLimit = parsePositiveNumberInput(form.dailyLossLimit, 'dailyLossLimit');
  if (dailyLossLimit !== undefined) plan.dailyLossLimit = dailyLossLimit;
  if (form.calmState) plan.calmState = true;
  if (form.checklistNotes.trim()) plan.checklistNotes = form.checklistNotes.trim();

  const management: NonNullable<TradeJournalContext['management']> = {};
  if (form.breakevenRule.trim()) management.breakevenRule = form.breakevenRule.trim();
  if (form.additionRule.trim()) management.additionRule = form.additionRule.trim();
  const exitTriggers = splitListInput(form.exitTriggers);
  if (exitTriggers.length > 0) management.exitTriggers = exitTriggers;
  if (form.managementNotes.trim()) management.managementNotes = form.managementNotes.trim();

  const review: NonNullable<TradeJournalContext['review']> = {};
  if (form.resultLabel.trim()) review.resultLabel = form.resultLabel.trim();
  if (form.processVerdict) review.processVerdict = form.processVerdict;
  if (form.ruleViolationTags.length > 0) review.ruleViolationTags = form.ruleViolationTags;
  const ruleViolations = splitListInput(form.ruleViolations);
  if (ruleViolations.length > 0) review.ruleViolations = ruleViolations;
  if (form.lessonTags.length > 0) review.lessonTags = form.lessonTags;
  const lessons = splitListInput(form.lessons);
  if (lessons.length > 0) review.lessons = lessons;
  if (form.realizedPnlText.trim()) review.realizedPnlText = form.realizedPnlText.trim();
  if (form.reviewNotes.trim()) review.reviewNotes = form.reviewNotes.trim();

  const journal: TradeJournalContext = {};
  if (Object.keys(plan).length > 0) journal.plan = plan;
  if (Object.keys(management).length > 0) journal.management = management;
  if (Object.keys(review).length > 0) journal.review = review;
  return Object.keys(journal).length > 0 ? journal : undefined;
}

function toggleSelectedLabel(selected: string[], label: string): string[] {
  return selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label];
}

function buildManualRawText(form: ManualTradeFormState): string {
  const parts = [
    `${form.symbol.trim().toUpperCase()} ${form.side}`,
    form.timeframe.trim() || undefined,
    form.session.trim() || undefined,
    form.strategy.trim() || undefined,
    form.thesis.trim() || undefined,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? `manual journal entry: ${parts.join(' · ')}` : 'manual journal entry';
}

function buildAssistantActions(form: ManualTradeFormState): TradeLogAssistantActionsRequest {
  const journal = buildManualJournal(form);
  const actions: TradeLogAssistantActionsRequest['actions'] = [
    {
      type: 'create_trade',
      payload: {
        symbol: form.symbol.trim(),
        side: form.side,
        timeframe: form.timeframe.trim() || undefined,
        session: form.session.trim() || undefined,
        strategy: form.strategy.trim() || undefined,
        thesis: form.thesis.trim() || undefined,
        note: form.note.trim() || undefined,
        journal,
      },
    },
  ];

  const entryPrice = parsePositiveNumberInput(form.entryPrice, 'entryPrice');
  const entryQuantity = parsePositiveNumberInput(form.entryQuantity, 'entryQuantity');
  const entryOccurredAt = form.entryOccurredAt.trim();
  const hasEntry = entryPrice !== undefined || entryQuantity !== undefined || entryOccurredAt.length > 0 || form.entryNote.trim().length > 0;
  if (hasEntry) {
    if (entryPrice === undefined || entryOccurredAt.length === 0) {
      throw new Error('entry price and occurredAt are required when an entry is provided');
    }
    actions.push({
      type: 'record_entry',
      tradeRef: 'last_created',
      payload: {
        price: entryPrice,
        quantity: entryQuantity,
        occurredAt: new Date(entryOccurredAt).toISOString(),
        note: form.entryNote.trim() || undefined,
      },
    });
  }

  const exitPrice = parsePositiveNumberInput(form.exitPrice, 'exitPrice');
  const exitQuantity = parsePositiveNumberInput(form.exitQuantity, 'exitQuantity');
  const exitOccurredAt = form.exitOccurredAt.trim();
  const hasExit = exitPrice !== undefined || exitQuantity !== undefined || exitOccurredAt.length > 0 || form.exitNote.trim().length > 0 || form.exitReason !== 'manual';
  if (hasExit) {
    if (entryPrice === undefined || entryOccurredAt.length === 0) {
      throw new Error('exit requires an entry on the same submission');
    }
    if (exitPrice === undefined || exitOccurredAt.length === 0) {
      throw new Error('exit price and occurredAt are required when an exit is provided');
    }
    actions.push({
      type: 'record_exit',
      tradeId: 'last_created',
      payload: {
        price: exitPrice,
        quantity: exitQuantity,
        occurredAt: new Date(exitOccurredAt).toISOString(),
        reason: form.exitReason || 'manual',
        note: form.exitNote.trim() || undefined,
      },
    } as TradeLogAssistantActionsRequest['actions'][number]);
  }

  return {
    rawText: buildManualRawText(form),
    source: 'manual',
    actions,
  };
}

function ManualTradeForm({ tagCatalog, onSaved }: { tagCatalog: TradeTagCatalog | null; onSaved: (updatedTrades: TradeRecord[]) => Promise<void> | void }) {
  const [form, setForm] = useState<ManualTradeFormState>(() => createManualTradeFormState());
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function update(patch: Partial<ManualTradeFormState>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggle(field: 'setupTags' | 'ruleViolationTags' | 'lessonTags', label: string): void {
    setForm((current) => ({
      ...current,
      [field]: toggleSelectedLabel(current[field], label),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    setSubmitting(true);

    try {
      const request = buildAssistantActions(form);
      const response = await fetchJson<{ rawText: string; source: 'manual'; trades: TradeRecord[] }>(`${apiUrl}/trade-log/assistant-actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
      await onSaved(response.trades);
      setForm(createManualTradeFormState());
      setStatus(`등록 완료 · ${response.trades.length} trade${response.trades.length === 1 ? '' : 's'} updated`);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Manual trade submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const setupOptions = tagCatalog?.setup ?? [];
  const ruleViolationOptions = tagCatalog?.ruleViolation ?? [];
  const lessonOptions = tagCatalog?.lesson ?? [];
  const resultLabelOptions = tagCatalog?.resultLabel ?? [];

  return (
    <section className="manual-console">
      <div className="manual-console-header">
        <div>
          <p className="section-label">Manual Journal</p>
          <h3>수동 매매일지 등록</h3>
          <p className="subhead">create / entry / exit / journal 패치를 한 번에 assistant-actions로 보냅니다.</p>
        </div>
        <span className="count">manual source</span>
      </div>

      <form className="journal-form" onSubmit={handleSubmit}>
        <div className="form-card">
          <div className="form-card-header">
            <strong>Execution</strong>
            <span>trade identity + note</span>
          </div>
          <div className="form-grid cols-4">
            <label>
              <span>symbol</span>
              <input value={form.symbol} onChange={(event) => update({ symbol: event.target.value })} placeholder="GOLD / BTCUSDT" required />
            </label>
            <label>
              <span>side</span>
              <select value={form.side} onChange={(event) => update({ side: event.target.value as ManualTradeFormState['side'] })}>
                <option value="long">long</option>
                <option value="short">short</option>
              </select>
            </label>
            <label>
              <span>timeframe</span>
              <input value={form.timeframe} onChange={(event) => update({ timeframe: event.target.value })} placeholder="5m / 15m" />
            </label>
            <label>
              <span>session</span>
              <input value={form.session} onChange={(event) => update({ session: event.target.value })} placeholder="Asia / London / New York" />
            </label>
          </div>
          <div className="form-grid cols-2">
            <label>
              <span>strategy</span>
              <input value={form.strategy} onChange={(event) => update({ strategy: event.target.value })} placeholder="optional strategy label" />
            </label>
            <label>
              <span>thesis</span>
              <input value={form.thesis} onChange={(event) => update({ thesis: event.target.value })} placeholder="why this trade exists" />
            </label>
          </div>
          <label>
            <span>note</span>
            <textarea rows={3} value={form.note} onChange={(event) => update({ note: event.target.value })} placeholder="raw capture or manual summary" />
          </label>
        </div>

        <div className="form-card">
          <div className="form-card-header">
            <strong>Entry / Exit</strong>
            <span>optional on planned trades, required for execution</span>
          </div>
          <div className="form-split-grid">
            <div className="subform-block">
              <div className="subform-header">
                <strong>Entry</strong>
                <small>actual opening</small>
              </div>
              <div className="form-grid cols-2">
                <label>
                  <span>price</span>
                  <input value={form.entryPrice} onChange={(event) => update({ entryPrice: event.target.value })} placeholder="4175.25" />
                </label>
                <label>
                  <span>quantity</span>
                  <input value={form.entryQuantity} onChange={(event) => update({ entryQuantity: event.target.value })} placeholder="0.01" />
                </label>
              </div>
              <label>
                <span>occurred at</span>
                <input type="datetime-local" value={form.entryOccurredAt} onChange={(event) => update({ entryOccurredAt: event.target.value })} />
              </label>
              <label>
                <span>entry note</span>
                <textarea rows={3} value={form.entryNote} onChange={(event) => update({ entryNote: event.target.value })} />
              </label>
            </div>

            <div className="subform-block">
              <div className="subform-header">
                <strong>Exit</strong>
                <small>only when entry is present in same submission</small>
              </div>
              <div className="form-grid cols-2">
                <label>
                  <span>price</span>
                  <input value={form.exitPrice} onChange={(event) => update({ exitPrice: event.target.value })} placeholder="4180.50" />
                </label>
                <label>
                  <span>quantity</span>
                  <input value={form.exitQuantity} onChange={(event) => update({ exitQuantity: event.target.value })} placeholder="0.01" />
                </label>
              </div>
              <label>
                <span>occurred at</span>
                <input type="datetime-local" value={form.exitOccurredAt} onChange={(event) => update({ exitOccurredAt: event.target.value })} />
              </label>
              <div className="form-grid cols-2">
                <label>
                  <span>reason</span>
                  <select value={form.exitReason} onChange={(event) => update({ exitReason: event.target.value as ManualTradeFormState['exitReason'] })}>
                    <option value="manual">manual</option>
                    <option value="target_hit">target_hit</option>
                    <option value="stop_loss">stop_loss</option>
                    <option value="invalidated">invalidated</option>
                    <option value="time_exit">time_exit</option>
                  </select>
                </label>
                <label>
                  <span>exit note</span>
                  <input value={form.exitNote} onChange={(event) => update({ exitNote: event.target.value })} />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="form-card">
          <div className="form-card-header">
            <strong>Journal</strong>
            <span>setup / management / review</span>
          </div>
          <div className="form-split-grid">
            <div className="subform-block">
              <div className="subform-header">
                <strong>Setup / Risk</strong>
                <small>plan context</small>
              </div>
              <div className="form-grid cols-2">
                <label>
                  <span>setup type</span>
                  <input value={form.setupType} onChange={(event) => update({ setupType: event.target.value })} placeholder="투볼 / 정볼 / 역볼" />
                </label>
                <label>
                  <span>entry model</span>
                  <input value={form.entryModel} onChange={(event) => update({ entryModel: event.target.value })} placeholder="continuation / reversal" />
                </label>
              </div>
              <TagChecklistGroup
                emptyMessage="setup tags not loaded"
                hint="Korean canonical labels from API"
                onToggle={(label) => toggle('setupTags', label)}
                options={setupOptions}
                selected={form.setupTags}
                title="Setup tags"
              />
              <label>
                <span>confirmations</span>
                <textarea rows={3} value={form.confirmations} onChange={(event) => update({ confirmations: event.target.value })} placeholder="one per line or comma separated" />
              </label>
              <label>
                <span>invalidation</span>
                <textarea rows={3} value={form.invalidation} onChange={(event) => update({ invalidation: event.target.value })} />
              </label>
              <div className="form-grid cols-2">
                <label>
                  <span>stop loss price</span>
                  <input value={form.stopLossPrice} onChange={(event) => update({ stopLossPrice: event.target.value })} placeholder="4158.00" />
                </label>
                <label>
                  <span>take profit price</span>
                  <input value={form.takeProfitPrice} onChange={(event) => update({ takeProfitPrice: event.target.value })} placeholder="4188.00" />
                </label>
              </div>
              <div className="form-grid cols-2">
                <label>
                  <span>planned loss amount</span>
                  <input value={form.plannedLossAmount} onChange={(event) => update({ plannedLossAmount: event.target.value })} placeholder="50" />
                </label>
                <label>
                  <span>daily loss limit</span>
                  <input value={form.dailyLossLimit} onChange={(event) => update({ dailyLossLimit: event.target.value })} placeholder="100" />
                </label>
              </div>
              <label className="checkbox-tag">
                <input checked={form.calmState} type="checkbox" onChange={(event) => update({ calmState: event.target.checked })} />
                <span>calm state</span>
              </label>
              <label>
                <span>checklist notes</span>
                <textarea rows={3} value={form.checklistNotes} onChange={(event) => update({ checklistNotes: event.target.value })} />
              </label>
            </div>

            <div className="subform-block">
              <div className="subform-header">
                <strong>Management / Review</strong>
                <small>post-entry discipline</small>
              </div>
              <label>
                <span>breakeven rule</span>
                <textarea rows={3} value={form.breakevenRule} onChange={(event) => update({ breakevenRule: event.target.value })} />
              </label>
              <label>
                <span>addition rule</span>
                <textarea rows={3} value={form.additionRule} onChange={(event) => update({ additionRule: event.target.value })} />
              </label>
              <label>
                <span>exit triggers</span>
                <textarea rows={3} value={form.exitTriggers} onChange={(event) => update({ exitTriggers: event.target.value })} placeholder="one per line or comma separated" />
              </label>
              <label>
                <span>management notes</span>
                <textarea rows={3} value={form.managementNotes} onChange={(event) => update({ managementNotes: event.target.value })} />
              </label>
              <div className="form-grid cols-2">
                <label>
                  <span>result label</span>
                  <select value={form.resultLabel} onChange={(event) => update({ resultLabel: event.target.value })}>
                    <option value="">none</option>
                    {resultLabelOptions.map((option) => (
                      <option key={option.id} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>process verdict</span>
                  <select value={form.processVerdict} onChange={(event) => update({ processVerdict: event.target.value as ManualTradeFormState['processVerdict'] })}>
                    <option value="">none</option>
                    <option value="good">good</option>
                    <option value="bad">bad</option>
                    <option value="repeat-ban">repeat-ban</option>
                    <option value="observe">observe</option>
                  </select>
                </label>
              </div>
              <TagChecklistGroup
                emptyMessage="rule-violation tags not loaded"
                hint="select all that apply"
                onToggle={(label) => toggle('ruleViolationTags', label)}
                options={ruleViolationOptions}
                selected={form.ruleViolationTags}
                title="Rule violation tags"
              />
              <label>
                <span>rule violations</span>
                <textarea rows={3} value={form.ruleViolations} onChange={(event) => update({ ruleViolations: event.target.value })} placeholder="one per line or comma separated" />
              </label>
              <TagChecklistGroup
                emptyMessage="lesson tags not loaded"
                hint="select all that apply"
                onToggle={(label) => toggle('lessonTags', label)}
                options={lessonOptions}
                selected={form.lessonTags}
                title="Lesson tags"
              />
              <label>
                <span>lessons</span>
                <textarea rows={3} value={form.lessons} onChange={(event) => update({ lessons: event.target.value })} placeholder="one per line or comma separated" />
              </label>
              <div className="form-grid cols-2">
                <label>
                  <span>realized pnl text</span>
                  <input value={form.realizedPnlText} onChange={(event) => update({ realizedPnlText: event.target.value })} />
                </label>
                <label>
                  <span>review notes</span>
                  <input value={form.reviewNotes} onChange={(event) => update({ reviewNotes: event.target.value })} />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="manual-console-actions">
          <div className="manual-console-note">
            <p>Plan-only submission is allowed. If exit fields are filled, entry fields must also be present in the same submit.</p>
            <p>{status ?? 'Submit to create a manual trade record.'}</p>
          </div>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => setForm(createManualTradeFormState())} disabled={submitting}>
              reset
            </button>
            <button className="primary-button" type="submit" disabled={submitting || !form.symbol.trim()}>
              {submitting ? 'saving...' : 'save manual record'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
export function App() {
  const [activeView, setActiveView] = useState<View>(routeFromPathname(window.location.pathname));
  const [state, setState] = useState<ApiState>(initialState);
  const [selectedWikiSlug, setSelectedWikiSlug] = useState<string | null>(null);
  const [selectedWikiPage, setSelectedWikiPage] = useState<WikiPageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/stats');
      setActiveView('stats');
    }

    function syncRoute(): void {
      setActiveView(routeFromPathname(window.location.pathname));
    }

    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchJson<TradeRecord[]>(`${apiUrl}/trade-log/trades`)
      .then((trades) => {
        if (cancelled) {
          return;
        }
        setState((current) => ({ ...current, trades }));
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? `trade-log/trades: ${err.message}` : 'trade-log/trades request failed');
      });

    fetchJson<TradeStatsResponse>(`${apiUrl}/trade-log/stats`)
      .then((stats) => {
        if (cancelled) {
          return;
        }
        setState((current) => ({ ...current, stats }));
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? `trade-log/stats: ${err.message}` : 'trade-log/stats request failed');
      });

    fetchJson<TradeTagCatalog>(`${apiUrl}/trade-log/tags`)
      .then((tagCatalog) => {
        if (cancelled) {
          return;
        }
        setState((current) => ({ ...current, tagCatalog }));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('trade-log/tags request failed', err);
        }
      });

    fetchJson<WikiPageSummary[]>(`${apiUrl}/wiki/pages`)
      .then((wikiPages) => {
        if (cancelled) {
          return;
        }
        setState((current) => ({ ...current, wikiPages }));
        setSelectedWikiSlug((current) => current ?? wikiPages[0]?.slug ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? `wiki/pages: ${err.message}` : 'wiki/pages request failed');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedWikiSlug) {
      setSelectedWikiPage(null);
      return;
    }

    fetchJson<WikiPageDetail>(`${apiUrl}/wiki/pages/${selectedWikiSlug}`)
      .then(setSelectedWikiPage)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown wiki API error');
      });
  }, [selectedWikiSlug]);

  function navigate(nextView: View): void {
    const nextPath = routePath(nextView);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setActiveView(nextView);
    setError(null);
  }

  function mergeTrades(updatedTrades: TradeRecord[]): void {
    setState((current) => {
      const merged = new Map(current.trades.map((trade) => [trade.id, trade] as const));
      for (const updated of updatedTrades) {
        merged.set(updated.id, updated);
      }
      return { ...current, trades: Array.from(merged.values()) };
    });
  }

  async function refreshStats(): Promise<void> {
    try {
      const stats = await fetchJson<TradeStatsResponse>(`${apiUrl}/trade-log/stats`);
      setState((current) => ({ ...current, stats }));
    } catch (err: unknown) {
      setError(err instanceof Error ? `trade-log/stats: ${err.message}` : 'trade-log/stats request failed');
    }
  }

  async function handleManualTradeSaved(updatedTrades: TradeRecord[]): Promise<void> {
    mergeTrades(updatedTrades);
    await refreshStats();
  }

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
    navigate('wiki');
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

  const stats = state.stats;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">S.E.N.T.R.A. / OPERATIONS CONSOLE</p>
          <h1>Trading Journal</h1>
          <p className="subhead">Structured trade records, review-grade process stats, and field-maintained LLM wiki.</p>
        </div>
        <div className="control-stack">
          <div className="system-status" aria-label="System status">
            <span>API ONLINE</span>
            <span>{state.trades.length} TRADES</span>
            <span>{state.wikiPages.length} WIKI PAGES</span>
          </div>
          <nav className="tabs" aria-label="Sentra sections">
            <button
              className={activeView === 'stats' ? 'tab active' : 'tab'}
              type="button"
              onClick={() => navigate('stats')}
            >
              통계
            </button>
            <button
              className={activeView === 'trade-log' ? 'tab active' : 'tab'}
              type="button"
              onClick={() => navigate('trade-log')}
            >
              매매일지
            </button>
            <button
              className={activeView === 'wiki' ? 'tab active' : 'tab'}
              type="button"
              onClick={() => navigate('wiki')}
            >
              위키
            </button>
          </nav>
        </div>
      </header>

      {error ? <p className="error">API error: {error}</p> : null}

      {activeView === 'stats' ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Review Stats</p>
              <h2>복기 통계</h2>
            </div>
            <span className="count">closed trades only</span>
          </div>

          {stats ? (
            <section className="stats-section">
              <div className="stats-header">
                <div>
                  <p className="section-label">Review Stats</p>
                  <h3>Wiki-aligned process dashboard</h3>
                </div>
                <span className="count">closed trades only · {stats.overview.totalTrades} records</span>
              </div>

              <div className="stats-card-grid">
                <article className="stats-card">
                  <small>Closed trades</small>
                  <strong>{formatMetric(stats.overview.totalTrades)}</strong>
                  <span>statistics exclude planned and open positions</span>
                </article>
                <article className="stats-card">
                  <small>Realized points</small>
                  <strong>{formatMetric(stats.overview.totalRealizedPoints)}</strong>
                  <span>avg {formatMetric(stats.overview.averageRealizedPoints)} / closed trade</span>
                </article>
                <article className="stats-card">
                  <small>Win rate</small>
                  <strong>{formatMetric(stats.overview.winRate, '%')}</strong>
                  <span>closed-trade basis</span>
                </article>
                <article className="stats-card">
                  <small>Process quality</small>
                  <strong>{formatMetric(stats.overview.goodCount)}</strong>
                  <span>good · {stats.overview.observeCount} observe · {stats.overview.badCount + stats.overview.repeatBanCount} bad/repeat</span>
                </article>
              </div>

              <div className="stats-split-grid">
                <section className="stats-block">
                  <h3>Checklist coverage</h3>
                  <div className="stats-mini-grid">
                    <article>
                      <small>Stop defined</small>
                      <strong>{formatMetric(stats.checklistRates.stopLossDefinedRate, '%')}</strong>
                    </article>
                    <article>
                      <small>TP defined</small>
                      <strong>{formatMetric(stats.checklistRates.takeProfitDefinedRate, '%')}</strong>
                    </article>
                    <article>
                      <small>3+ confirmations</small>
                      <strong>{formatMetric(stats.checklistRates.confirmationsAtLeastThreeRate, '%')}</strong>
                    </article>
                    <article>
                      <small>Calm state tagged</small>
                      <strong>{formatMetric(stats.checklistRates.calmStateRate, '%')}</strong>
                    </article>
                    <article>
                      <small>Violations tagged</small>
                      <strong>{formatMetric(stats.checklistRates.ruleViolationTaggedRate, '%')}</strong>
                    </article>
                    <article>
                      <small>Lessons tagged</small>
                      <strong>{formatMetric(stats.checklistRates.lessonsTaggedRate, '%')}</strong>
                    </article>
                  </div>
                </section>

                <section className="stats-block">
                  <h3>Most repeated review tags</h3>
                  <div className="stats-tag-columns">
                    <div>
                      <small>Rule violations</small>
                      {stats.topRuleViolations.length > 0 ? (
                        <ul className="stats-tag-list">
                          {stats.topRuleViolations.map((item) => (
                            <li key={`violation-${item.label}`}><span>{item.label}</span><strong>{item.count}</strong></li>
                          ))}
                        </ul>
                      ) : <p className="stats-empty">No violation tags yet.</p>}
                    </div>
                    <div>
                      <small>Lessons</small>
                      {stats.topLessons.length > 0 ? (
                        <ul className="stats-tag-list">
                          {stats.topLessons.map((item) => (
                            <li key={`lesson-${item.label}`}><span>{item.label}</span><strong>{item.count}</strong></li>
                          ))}
                        </ul>
                      ) : <p className="stats-empty">No lesson tags yet.</p>}
                    </div>
                    <div>
                      <small>Result labels</small>
                      {stats.topResultLabels.length > 0 ? (
                        <ul className="stats-tag-list">
                          {stats.topResultLabels.map((item) => (
                            <li key={`result-${item.label}`}><span>{item.label}</span><strong>{item.count}</strong></li>
                          ))}
                        </ul>
                      ) : <p className="stats-empty">No result labels yet.</p>}
                    </div>
                  </div>
                </section>
              </div>

              <div className="stats-breakdown-grid">
                <section className="stats-block">
                  <h3>By session</h3>
                  <BreakdownTable buckets={stats.bySession} />
                </section>
                <section className="stats-block">
                  <h3>By timeframe</h3>
                  <BreakdownTable buckets={stats.byTimeframe} />
                </section>
                <section className="stats-block full-width">
                  <h3>By setup</h3>
                  <BreakdownTable buckets={stats.bySetupType} />
                </section>
              </div>
            </section>
          ) : (
            <div className="empty-state compact">
              <h3>{error?.startsWith('trade-log/stats:') ? '통계 로드 실패' : '통계 로딩 중'}</h3>
              {error?.startsWith('trade-log/stats:') ? <p>{error}</p> : null}
            </div>
          )}
        </section>
      ) : activeView === 'trade-log' ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Trade Log</p>
              <h2>독립 포지션 기록</h2>
            </div>
            <span className="count">{state.trades.length} records</span>
          </div>

          <ManualTradeForm tagCatalog={state.tagCatalog} onSaved={handleManualTradeSaved} />

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
