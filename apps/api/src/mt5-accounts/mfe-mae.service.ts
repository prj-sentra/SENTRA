import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Mt5BridgeTick, Mt5BridgeTicksResponse } from './mt5-bridge.client';

const Decimal = Prisma.Decimal;
const ROUNDING = Decimal.ROUND_HALF_UP;
const EIGHT_PLACES = 8;
const SUPPORTED_CALCULATION_MODES = new Set([
  'FOREX', 'FOREX_NO_LEVERAGE', 'FUTURES', 'CFD', 'CFDINDEX', 'CFDLEVERAGE',
  'EXCH_STOCKS', 'EXCH_FUTURES', 'EXCH_FUTURES_FORTS', 'EXCH_BONDS',
  'EXCH_STOCKS_MOEX', 'EXCH_BONDS_MOEX', 'SERV_COLLATERAL',
]);

export type ExcursionFailureCode =
  | 'UNSUPPORTED_TIMELINE'
  | 'UNSUPPORTED_REVERSAL'
  | 'UNSUPPORTED_VALUATION'
  | 'INVALID_TICK_PATH'
  | 'RISK_UNAVAILABLE'
  | 'HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE';

export interface RawDealForExcursion {
  ticket: string;
  positionId: string;
  symbol: string;
  timeMsc: number;
  /** MT5 DEAL_ENTRY: IN=0, OUT=1. */
  entry: number;
  /** MT5 DEAL_TYPE: BUY=0, SELL=1. */
  type: number;
  volume: string | number;
  price: string | number;
}

export interface ExcursionTickPage {
  symbol: string;
  response: Pick<Mt5BridgeTicksResponse, 'rawRange' | 'snapshotToMsc' | 'snapshot' | 'valuation' | 'ticks'>;
}

export interface ExcursionInput {
  deals: RawDealForExcursion[];
  tickPages: ExcursionTickPage[];
  rawFromMsc: number;
  rawToMsc: number;
  tickSnapshotToMsc: number;
  calculationVersion: number;
  /** Realized PnL excludes costs, matching the unrealized valuation formula. */
  realizedPnl?: string | number;
  riskAmount?: string | number;
}

export interface ExcursionExtremum {
  value: string;
  markPrice: string;
  occurredAtMsc: number;
}

export interface ExcursionMetrics {
  mfe: ExcursionExtremum;
  mae: ExcursionExtremum;
}

export interface ExcursionProvenance {
  calculationVersion: number;
  rawFromMsc: number;
  rawToMsc: number;
  tickSnapshotToMsc: number;
  pathSha256: string;
  valuationVersion: number;
  valuationSha256: string;
}

export interface ExcursionSuccess {
  ok: true;
  provenance: ExcursionProvenance;
  price?: ExcursionMetrics;
  percent?: ExcursionMetrics;
  unrealizedPnl?: ExcursionMetrics;
  r?: ExcursionMetrics;
  captureRate?: string;
  portfolioMarkPolicy?: 'all-active-symbols-last-valid-since-entry-v1';
}

export interface ExcursionFailure {
  ok: false;
  code: ExcursionFailureCode;
}

export type ExcursionResult = ExcursionSuccess | ExcursionFailure;

type Side = 'long' | 'short';
type Fill = { ticket: string; positionId: string; symbol: string; side: Side; volume: Prisma.Decimal; entry: Prisma.Decimal };
type Mark = { price: Prisma.Decimal; timeMsc: number };
type Candidate = { timeMsc: number; marks: Map<string, Prisma.Decimal>; fills: Fill[] };
type SerializedFill = { ticket: string; positionId: string; symbol: string; side: Side; volume: string; entry: string };
type SerializedMark = { price: string; timeMsc: number };
type SerializedExtremum = { value: string; mark: string; timeMsc: number };

/** JSON-safe durable state for an interrupted tick-path calculation. */
export interface MfeMaeCalculatorState {
  nextRawFromMsc: number;
  fills: SerializedFill[];
  marks: Record<string, SerializedMark>;
  extrema: Record<string, { min?: SerializedExtremum; max?: SerializedExtremum }>;
  candidateCount: number;
  pageDigests: Record<string, { snapshotSha256: string; valuationSha256: string; accountCurrency: string }>;
}

export type MfeMaeChunkResult = { ok: true; state: MfeMaeCalculatorState } | ExcursionFailure;

/**
 * Deterministic, persistence-free MFE/MAE calculator. Inputs are already validated
 * bridge pages; this method still verifies their causal and valuation provenance.
 */
export function calculateMfeMae(input: ExcursionInput): ExcursionResult {
  const state = createMfeMaeCalculator(input);
  if (!state.ok) return state;
  const advanced = advanceMfeMaeCalculator(state.state, input);
  return advanced.ok ? finalizeMfeMaeCalculator(advanced.state, input) : advanced;
}

/** Starts an incremental calculation. Deal validation remains deterministic on every advance. */
export function createMfeMaeCalculator(input: Pick<ExcursionInput, 'deals' | 'rawFromMsc' | 'rawToMsc' | 'tickSnapshotToMsc' | 'calculationVersion'>): MfeMaeChunkResult {
  if (!Number.isSafeInteger(input.rawFromMsc) || !Number.isSafeInteger(input.rawToMsc) || input.rawFromMsc > input.rawToMsc
    || !Number.isSafeInteger(input.tickSnapshotToMsc) || !Number.isSafeInteger(input.calculationVersion)) return failure('UNSUPPORTED_TIMELINE');
  const orderedDeals = [...input.deals].sort(dealOrder);
  if (!orderedDeals.length) return failure('UNSUPPORTED_TIMELINE');
  const parsed = orderedDeals.map(parseDeal);
  if (parsed.some((deal) => deal === null)) return failure('UNSUPPORTED_TIMELINE');
  const sides = new Set((parsed as RawDealForExcursion[]).map((deal) => sideFor(deal)));
  if (sides.has(undefined)) return failure('UNSUPPORTED_REVERSAL');
  return { ok: true, state: { nextRawFromMsc: input.rawFromMsc, fills: [], marks: {}, extrema: {}, candidateCount: 0, pageDigests: {} } };
}

/**
 * Advances exactly one contiguous raw range. A caller persists the returned state
 * only after this method has consumed the complete bridge response for the range.
 */
export function advanceMfeMaeCalculator(state: MfeMaeCalculatorState, input: ExcursionInput): MfeMaeChunkResult {
  if (input.rawFromMsc !== state.nextRawFromMsc || input.rawFromMsc > input.rawToMsc) return failure('INVALID_TICK_PATH');
  const pages = new Map<string, ExcursionTickPage>();
  for (const page of input.tickPages) {
    if (pages.has(page.symbol) || page.response.snapshotToMsc !== input.tickSnapshotToMsc
      || page.response.rawRange.fromMsc !== input.rawFromMsc || page.response.rawRange.toMsc !== input.rawToMsc
      || !validValuation(page.response) || !validTicks(page.response.ticks, input.rawFromMsc, input.rawToMsc)) return failure('INVALID_TICK_PATH');
    if (!SUPPORTED_CALCULATION_MODES.has(page.response.valuation.calculationMode)) return failure('UNSUPPORTED_VALUATION');
    const digestKey = pageDigestKey(page.symbol, input.rawFromMsc, input.rawToMsc);
    const digest = state.pageDigests[digestKey];
    if (digest && (digest.snapshotSha256 !== page.response.snapshot.sha256 || digest.valuationSha256 !== page.response.valuation.sha256 || digest.accountCurrency !== page.response.valuation.accountCurrency)) return failure('INVALID_TICK_PATH');
    pages.set(page.symbol, page);
  }
  const orderedDeals = [...input.deals].sort(dealOrder);
  if (!orderedDeals.length || orderedDeals.some((deal) => !pages.has(deal.symbol) && deal.timeMsc >= input.rawFromMsc && deal.timeMsc <= input.rawToMsc)) return failure('UNSUPPORTED_TIMELINE');
  const parsed = orderedDeals.map(parseDeal);
  if (parsed.some((deal) => deal === null)) return failure('UNSUPPORTED_TIMELINE');
  const entries = parsed as Array<RawDealForExcursion & { volumeDecimal: Prisma.Decimal; priceDecimal: Prisma.Decimal }>;
  const fills: Fill[] = state.fills.map((fill) => ({ ...fill, volume: new Decimal(fill.volume), entry: new Decimal(fill.entry) }));
  const marks = new Map(Object.entries(state.marks).map(([symbol, mark]) => [symbol, { price: new Decimal(mark.price), timeMsc: mark.timeMsc }]));
  const byTime = new Map<number, { ins: typeof entries; outs: typeof entries; ticks: Array<{ symbol: string; tick: Mt5BridgeTick }> }>();
  for (const deal of entries.filter((deal) => deal.timeMsc >= input.rawFromMsc && deal.timeMsc <= input.rawToMsc)) {
    const slot = eventSlot(byTime, deal.timeMsc);
    if (deal.entry === 0) slot.ins.push(deal); else slot.outs.push(deal);
  }
  for (const [symbol, page] of pages) for (const tick of page.response.ticks) eventSlot(byTime, tick.timeMsc).ticks.push({ symbol, tick });

  for (const timeMsc of [...byTime.keys()].sort((a, b) => a - b)) {
    const slot = byTime.get(timeMsc)!;
    for (const deal of slot.ins.sort(dealOrder)) {
      const side = sideFor(deal)!;
      if (fills.some((fill) => fill.symbol === deal.symbol && fill.side !== side)) return failure('UNSUPPORTED_REVERSAL');
      fills.push({ ticket: deal.ticket, positionId: deal.positionId, symbol: deal.symbol, side, volume: deal.volumeDecimal, entry: deal.priceDecimal });
      marks.delete(deal.symbol); // a mark before the latest entry is not valid for a newly active symbol.
    }
    for (const { symbol, tick } of slot.ticks.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.tick.sequence - b.tick.sequence)) {
      marks.set(symbol, { price: new Decimal(markForSymbol(fills, symbol, tick)), timeMsc });
      if (fills.length && [...new Set(fills.map((fill) => fill.symbol))].every((active) => marks.has(active))) {
        const candidate: Candidate = { timeMsc, marks: new Map([...marks].map(([activeSymbol, mark]) => [activeSymbol, mark.price])), fills: fills.map((fill) => ({ ...fill })) };
        updateExtrema(state.extrema, 'pnl', portfolioCandidate(candidate, pages));
        const first = candidate.fills[0];
        const symbolFills = candidate.fills.filter((fill) => fill.symbol === first.symbol);
        const mark = candidate.marks.get(first.symbol)!;
        const price = mark.minus(weightedEntry(symbolFills)).times(first.side === 'long' ? 1 : -1);
        updateExtrema(state.extrema, 'price', { value: price, mark, timeMsc });
        updateExtrema(state.extrema, 'percent', { value: price.dividedBy(weightedEntry(symbolFills)).times(100), mark, timeMsc });
        state.candidateCount++;
      }
    }
    for (const deal of slot.outs.sort(dealOrder)) {
      const side = sideFor(deal);
      if (!side) return failure('UNSUPPORTED_REVERSAL');
      let remaining = deal.volumeDecimal;
      for (let index = 0; index < fills.length && remaining.gt(0);) {
        const fill = fills[index];
        if (fill.positionId !== deal.positionId || fill.symbol !== deal.symbol || fill.side !== side) { index++; continue; }
        const closed = Decimal.min(fill.volume, remaining);
        fill.volume = fill.volume.minus(closed); remaining = remaining.minus(closed);
        if (fill.volume.isZero()) fills.splice(index, 1); else index++;
      }
      if (!remaining.isZero()) return failure('UNSUPPORTED_REVERSAL');
      if (!fills.some((fill) => fill.symbol === deal.symbol)) marks.delete(deal.symbol);
    }
  }
  for (const [symbol, page] of pages) state.pageDigests[pageDigestKey(symbol, input.rawFromMsc, input.rawToMsc)] = { snapshotSha256: page.response.snapshot.sha256, valuationSha256: page.response.valuation.sha256, accountCurrency: page.response.valuation.accountCurrency };
  return { ok: true, state: { ...state, nextRawFromMsc: input.rawToMsc + 1, fills: fills.map((fill) => ({ ...fill, volume: fill.volume.toString(), entry: fill.entry.toString() })), marks: Object.fromEntries([...marks].map(([symbol, mark]) => [symbol, { price: mark.price.toString(), timeMsc: mark.timeMsc }])), extrema: state.extrema } };
}

/** Completes a fully-consumed calculator state; the one-shot API is this wrapper. */
export function finalizeMfeMaeCalculator(state: MfeMaeCalculatorState, input: Pick<ExcursionInput, 'deals' | 'rawFromMsc' | 'rawToMsc' | 'tickSnapshotToMsc' | 'calculationVersion' | 'realizedPnl' | 'riskAmount'>): ExcursionResult {
  if (state.nextRawFromMsc !== input.rawToMsc + 1 || state.fills.length) return failure('UNSUPPORTED_TIMELINE');
  if (!state.candidateCount || !Object.keys(state.pageDigests).length) return failure('INVALID_TICK_PATH');
  const pnl = metricsFromState(state.extrema.pnl);
  if (!pnl) return failure('INVALID_TICK_PATH');
  const risk = decimal(input.riskAmount);
  const realized = decimal(input.realizedPnl);
  const pages = Object.entries(state.pageDigests).map(([key, digest]) => ({ symbol: pageDigestProvenanceLabel(key), response: { snapshot: { sha256: digest.snapshotSha256 }, valuation: { version: 1, sha256: digest.valuationSha256 } } })) as ExcursionTickPage[];
  const result: ExcursionSuccess = { ok: true, provenance: provenanceFor(input as ExcursionInput, pages), unrealizedPnl: pnl, portfolioMarkPolicy: 'all-active-symbols-last-valid-since-entry-v1' };
  if (risk && risk.gt(0)) result.r = scaleMetrics(pnl, risk);
  if (risk === null && input.riskAmount !== undefined) return failure('RISK_UNAVAILABLE');
  if (realized && new Decimal(pnl.mfe.value).gt(0)) result.captureRate = rounded(realized.dividedBy(new Decimal(pnl.mfe.value)).times(100));
  const homogeneous = new Set(input.deals.map((deal) => `${deal.symbol}\u0000${sideFor(deal)}`)).size === 1;
  if (homogeneous) { result.price = metricsFromState(state.extrema.price); result.percent = metricsFromState(state.extrema.percent); }
  return result;
}

function failure(code: ExcursionFailureCode): ExcursionFailure { return { ok: false, code }; }
function pageDigestKey(symbol: string, rawFromMsc: number, rawToMsc: number): string {
  return JSON.stringify([symbol, rawFromMsc, rawToMsc]);
}
function pageDigestProvenanceLabel(key: string): string {
  const value: unknown = JSON.parse(key);
  if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== 'string' || !Number.isSafeInteger(value[1]) || !Number.isSafeInteger(value[2])) throw new Error('Invalid persisted page digest key');
  return `${value[0]}\u0000${value[1]}\u0000${value[2]}`;
}
function decimal(value: string | number | undefined): Prisma.Decimal | null { try { const result = value === undefined ? null : new Decimal(value); return result?.isFinite() ? result : null; } catch { return null; } }
function rounded(value: Prisma.Decimal): string { return value.toDecimalPlaces(EIGHT_PLACES, ROUNDING).toFixed(EIGHT_PLACES); }
function dealOrder(a: RawDealForExcursion, b: RawDealForExcursion): number {
  if (a.timeMsc !== b.timeMsc) return a.timeMsc - b.timeMsc;
  const left = BigInt(a.ticket); const right = BigInt(b.ticket);
  return left < right ? -1 : left > right ? 1 : 0;
}
function sideFor(deal: RawDealForExcursion): Side | undefined { return deal.entry === 0 && deal.type === 0 ? 'long' : deal.entry === 0 && deal.type === 1 ? 'short' : deal.entry === 1 && deal.type === 1 ? 'long' : deal.entry === 1 && deal.type === 0 ? 'short' : undefined; }
function parseDeal(deal: RawDealForExcursion) { const volumeDecimal = decimal(deal.volume); const priceDecimal = decimal(deal.price); return volumeDecimal?.gt(0) && priceDecimal?.gt(0) && Number.isSafeInteger(deal.timeMsc) ? { ...deal, volumeDecimal, priceDecimal } : null; }
function eventSlot(map: Map<number, { ins: any[]; outs: any[]; ticks: Array<{ symbol: string; tick: Mt5BridgeTick }> }>, timeMsc: number) { let slot = map.get(timeMsc); if (!slot) { slot = { ins: [], outs: [], ticks: [] }; map.set(timeMsc, slot); } return slot; }
function validValuation(response: ExcursionTickPage['response']): boolean { const v = response.valuation; return v.version === 1 && /^[a-f0-9]{64}$/.test(v.sha256) && [v.tickSize, v.tickValueProfit, v.tickValueLoss].every((value) => decimal(value)?.gt(0)); }
function validTicks(ticks: Mt5BridgeTick[], from: number, to: number): boolean { return ticks.every((tick, index) => tick.sequence === index && tick.timeMsc >= from && tick.timeMsc <= to && decimal(tick.bid)?.gt(0) && decimal(tick.ask)?.gt(0)); }
function markForSymbol(fills: Fill[], symbol: string, tick: Mt5BridgeTick): string { return fills.find((fill) => fill.symbol === symbol)?.side === 'long' ? tick.bid : tick.ask; }
function weightedEntry(fills: Fill[]): Prisma.Decimal { const volume = fills.reduce((sum, fill) => sum.plus(fill.volume), new Decimal(0)); return fills.reduce((sum, fill) => sum.plus(fill.entry.times(fill.volume)), new Decimal(0)).dividedBy(volume); }
function extrema(samples: Array<{ value: Prisma.Decimal; mark: Prisma.Decimal; timeMsc: number }>): ExcursionMetrics { const min = samples.reduce((best, sample) => sample.value.lt(best.value) ? sample : best); const max = samples.reduce((best, sample) => sample.value.gt(best.value) ? sample : best); const output = (sample: typeof min): ExcursionExtremum => ({ value: rounded(sample.value), markPrice: rounded(sample.mark), occurredAtMsc: sample.timeMsc }); return { mfe: output(max), mae: output(min) }; }
function updateExtrema(extremaState: MfeMaeCalculatorState['extrema'], key: string, sample: { value: Prisma.Decimal; mark: Prisma.Decimal; timeMsc: number }): void {
  const current = extremaState[key] ?? {};
  const serialized = { value: sample.value.toString(), mark: sample.mark.toString(), timeMsc: sample.timeMsc };
  if (!current.min || sample.value.lt(new Decimal(current.min.value))) current.min = serialized;
  if (!current.max || sample.value.gt(new Decimal(current.max.value))) current.max = serialized;
  extremaState[key] = current;
}
function metricsFromState(state: { min?: SerializedExtremum; max?: SerializedExtremum } | undefined): ExcursionMetrics | undefined {
  if (!state?.min || !state.max) return undefined;
  const output = (value: SerializedExtremum): ExcursionExtremum => ({ value: rounded(new Decimal(value.value)), markPrice: rounded(new Decimal(value.mark)), occurredAtMsc: value.timeMsc });
  return { mfe: output(state.max), mae: output(state.min) };
}
function portfolioCandidate(candidate: Candidate, pages: Map<string, ExcursionTickPage>) {
  const value = candidate.fills.reduce((sum, fill) => {
    const valuation = pages.get(fill.symbol)!.response.valuation;
    const mark = candidate.marks.get(fill.symbol)!;
    const signed = mark.minus(fill.entry).times(fill.side === 'long' ? 1 : -1);
    const tickValue = signed.gte(0) ? valuation.tickValueProfit : valuation.tickValueLoss;
    return sum.plus(signed.dividedBy(valuation.tickSize).times(tickValue).times(fill.volume));
  }, new Decimal(0));
  return { value, mark: candidate.marks.get(candidate.fills[0].symbol)!, timeMsc: candidate.timeMsc };
}
function scaleMetrics(metrics: ExcursionMetrics, risk: Prisma.Decimal): ExcursionMetrics { const convert = (value: ExcursionExtremum): ExcursionExtremum => ({ ...value, value: rounded(new Decimal(value.value).dividedBy(risk)) }); return { mfe: convert(metrics.mfe), mae: convert(metrics.mae) }; }
function portfolioCandidates(candidates: Candidate[], pages: Map<string, ExcursionTickPage>) {
  return candidates.map((candidate) => {
    const value = candidate.fills.reduce((sum, fill) => {
      const valuation = pages.get(fill.symbol)!.response.valuation;
      const mark = candidate.marks.get(fill.symbol)!;
      const signed = mark.minus(fill.entry).times(fill.side === 'long' ? 1 : -1);
      const tickValue = signed.gte(0) ? valuation.tickValueProfit : valuation.tickValueLoss;
      return sum.plus(signed.dividedBy(valuation.tickSize).times(tickValue).times(fill.volume));
    }, new Decimal(0));
    const mark = candidate.marks.get(candidate.fills[0].symbol)!;
    return { value, mark, timeMsc: candidate.timeMsc };
  });
}
function provenanceFor(input: ExcursionInput, pages: ExcursionTickPage[]): ExcursionProvenance { const digest = createHash('sha256'); digest.update('ticks-v1-path'); for (const page of pages.sort((a, b) => a.symbol.localeCompare(b.symbol))) digest.update(`${page.symbol}\0${page.response.snapshot.sha256}\0${page.response.valuation.sha256}\0`); const first = pages[0].response.valuation; return { calculationVersion: input.calculationVersion, rawFromMsc: input.rawFromMsc, rawToMsc: input.rawToMsc, tickSnapshotToMsc: input.tickSnapshotToMsc, pathSha256: digest.digest('hex'), valuationVersion: first.version, valuationSha256: createHash('sha256').update(pages.map((page) => page.response.valuation.sha256).sort().join('')).digest('hex') }; }
