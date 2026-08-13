import { BadGatewayException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface Mt5BridgeRequest {
  contractVersion: 5;
  server: string;
  accountLogin: number;
  password: string;
  mode: 'bootstrap' | 'incremental';
  snapshotToMsc: number;
  pageCursor?: string;
  changedSinceMsc?: number;
  openPositionIds?: string[];
}

export interface Mt5DealFact {
  ticket: string;
  order: string;
  positionId: string;
  time: number;
  timeMsc: number;
  type: number;
  entry: number;
  magic: string;
  reason: number;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  fee: number;
  symbol: string;
  comment: string;
  externalId: string;
}

export interface Mt5OrderFact {
  ticket: string;
  positionId: string;
  timeSetup: number;
  timeSetupMsc: number;
  timeDone: number;
  timeDoneMsc: number;
  type: number;
  state: number;
  reason: number;
  volumeInitial: number;
  volumeCurrent: number;
  priceOpen: number;
  sl: number;
  tp: number;
  priceCurrent: number;
  priceStopLimit: number;
  symbol: string;
  comment: string;
  externalId: string;
}
export interface Mt5PositionEntryPlanFact {
  positionId: string;
  side: 'long' | 'short';
  entryAt: number;
  entryPrice: string;
  quantityLots: string;
  takeProfitPrice: string;
  stopLossPrice: string;
  preEntryBalance: string;
  accountCurrency: string;
  tickSize: string;
  tickValueProfit: string;
  tickValueLoss: string;
}

export interface Mt5BridgeResponse {
  server: string;
  accountLogin: number;
  mode: 'bootstrap' | 'incremental';
  snapshotToMsc: number;
  page: { hasMore: boolean; nextCursor?: string; bytes: number };
  account: { currency: string; currencyDigits: number; currentBalance: string };
  deals: Mt5DealFact[];
  orders: Mt5OrderFact[];
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const DEAL_NUMBER_FIELDS = ['time', 'timeMsc', 'type', 'entry', 'reason', 'volume', 'price', 'commission', 'swap', 'profit', 'fee'] as const;
const DEAL_BIGINT_FIELDS = ['ticket', 'order', 'positionId', 'magic'] as const;
const ORDER_NUMBER_FIELDS = ['timeSetup', 'timeSetupMsc', 'timeDone', 'timeDoneMsc', 'type', 'state', 'reason', 'volumeInitial', 'volumeCurrent', 'priceOpen', 'sl', 'tp', 'priceCurrent', 'priceStopLimit'] as const;
const ORDER_BIGINT_FIELDS = ['ticket', 'positionId'] as const;
const STRING_FIELDS = ['symbol', 'comment', 'externalId'] as const;

const MAX_DECIMAL_PRECISION = 65;
const MAX_DECIMAL_SCALE = 30;
const TICK_MAX_RESPONSE_BYTES = 900_000;
const TICK_MAX_REQUEST_BYTES = 8_192;
const TICK_MAX_CURSOR_CHARS = 2_048;
const TICK_MAX_PAGE_SIZE = 1_000;
const TICK_MAX_CHUNK_SPAN_MSC = 300_000;
const SHA256 = /^[a-f0-9]{64}$/;

export class Mt5BridgeUnauthorized extends BadGatewayException {
  constructor() {
    super('MT5 bridge rejected its bearer token');
  }
}

export class Mt5AccountAuthorizationRejected extends BadGatewayException {
  constructor() {
    super('MT5 account credentials were rejected');
  }
}

export type Mt5BridgeTickErrorCategory =
  | 'BRIDGE_INCOMPATIBLE' | 'TICK_INVALID_REQUEST' | 'TICK_CURSOR_EXPIRED'
  | 'MT5_BRIDGE_UNAUTHORIZED' | 'TICK_IDENTITY_MISMATCH' | 'TICK_SOURCE_LIMIT'
  | 'VALUATION_UNSUPPORTED' | 'TICK_CAPACITY' | 'TICK_DEADLINE'
  | 'TICK_UNAVAILABLE' | 'TICK_INVALID_PAYLOAD';

export class Mt5BridgeTickError extends BadGatewayException {
  constructor(readonly category: Mt5BridgeTickErrorCategory, message: string) {
    super(message);
  }
}

export interface Mt5BridgeRequestOptions {
  signal?: AbortSignal;
  deadlineMsc?: number;
}

export interface Mt5BridgeCapabilities {
  contractVersion: 5;
  sync: { bootstrap: true; incremental: true; fixedSnapshot: true };
  ticks: {
    available: boolean; cursorNamespace: 'ticks-v1'; maxRequestBytes: number; maxCursorChars: number;
    pageSize: { min: number; max: number }; maxResponseBytes: number; maxChunkSpanMsc: number;
    maxChunkTicks: number; maxSnapshotBytes: number; snapshotTtlSeconds: number;
    cacheMaxEntries: number; cacheMaxBytes: number; valuationVersion: 1; supportedCalculationModes: string[];
  };
}

export interface Mt5BridgeTicksRequest {
  contractVersion: 5; server: string; accountLogin: number; password: string; symbol: string;
  rawRange: { fromMsc: number; toMsc: number }; snapshotToMsc: number; pageSize?: number; pageCursor?: string;
}
export interface Mt5BridgeTick {
  sequence: number; timeMsc: number; bid: string; ask: string;
}
export interface Mt5BridgeTicksResponse {
  contractVersion: 5; server: string; accountLogin: number; symbol: string;
  rawRange: { fromMsc: number; toMsc: number }; snapshotToMsc: number; pageSize: number;
  snapshot: { id: string; sha256: string; tickCount: number; expiresAtMsc: number };
  valuation: { version: 1; calculationMode: string; accountCurrency: string; profitCurrency: string; tickSize: string; tickValueProfit: string; tickValueLoss: string; sha256: string };
  ticks: Mt5BridgeTick[]; nextCursor?: string; complete: boolean; bytes: number;
}

@Injectable()
export class Mt5BridgeClient {
  async sync(request: Mt5BridgeRequest): Promise<Mt5BridgeResponse> {
    const baseUrl = process.env.MT5_BRIDGE_BASE_URL?.trim();
    const token = process.env.MT5_BRIDGE_TOKEN?.trim();
    if (!baseUrl || !token) throw new Error('MT5 bridge configuration is incomplete');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const response = await fetch(new URL('/sync', baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new BadGatewayException('MT5 bridge response is too large');
      const text = await this.readBoundedBody(response);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Mt5BridgeUnauthorized();
        if (response.status === 422) {
          try {
            const body = JSON.parse(text) as { error?: unknown };
            if (body.error === 'sync_account_authorization_failed') throw new Mt5AccountAuthorizationRejected();
          } catch (error) {
            if (error instanceof Mt5AccountAuthorizationRejected) throw error;
          }
        }
        throw new BadGatewayException('MT5 bridge request failed');
      }
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new BadGatewayException('MT5 bridge returned invalid JSON'); }
      return this.validate(value, request, Buffer.byteLength(text));
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('MT5 bridge is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  async getCapabilities(options: Mt5BridgeRequestOptions = {}): Promise<Mt5BridgeCapabilities> {
    const { value } = await this.tickRequest('/capabilities', undefined, options);
    if (!this.record(value) || !this.exactKeys(value, ['contractVersion', 'sync', 'ticks']) || value.contractVersion !== 5 || !this.record(value.sync) || !this.record(value.ticks)
      || !this.exactKeys(value.sync, ['bootstrap', 'incremental', 'fixedSnapshot'])
      || !this.exactKeys(value.ticks, ['available', 'cursorNamespace', 'maxRequestBytes', 'maxCursorChars', 'pageSize', 'maxResponseBytes', 'maxChunkSpanMsc', 'maxChunkTicks', 'maxSnapshotBytes', 'snapshotTtlSeconds', 'cacheMaxEntries', 'cacheMaxBytes', 'valuationVersion', 'supportedCalculationModes'])
      || value.sync.bootstrap !== true || value.sync.incremental !== true || value.sync.fixedSnapshot !== true
      || value.ticks.available !== true || value.ticks.cursorNamespace !== 'ticks-v1'
      || value.ticks.valuationVersion !== 1 || !Array.isArray(value.ticks.supportedCalculationModes)
      || value.ticks.supportedCalculationModes.some((mode) => typeof mode !== 'string' || !mode)
      || !this.safeLimit(value.ticks.maxRequestBytes, TICK_MAX_REQUEST_BYTES)
      || !this.safeLimit(value.ticks.maxCursorChars, TICK_MAX_CURSOR_CHARS)
      || !this.safeLimit(value.ticks.maxResponseBytes, TICK_MAX_RESPONSE_BYTES)
      || !this.safeLimit(value.ticks.maxChunkSpanMsc, TICK_MAX_CHUNK_SPAN_MSC)
      || !this.positiveSafeInteger(value.ticks.maxChunkTicks) || !this.positiveSafeInteger(value.ticks.maxSnapshotBytes)
      || !this.positiveSafeInteger(value.ticks.snapshotTtlSeconds) || !this.positiveSafeInteger(value.ticks.cacheMaxEntries)
      || !this.positiveSafeInteger(value.ticks.cacheMaxBytes) || !this.record(value.ticks.pageSize)
      || !this.positiveSafeInteger(value.ticks.pageSize.min) || !this.positiveSafeInteger(value.ticks.pageSize.max)
      || value.ticks.pageSize.min > value.ticks.pageSize.max || value.ticks.pageSize.max > TICK_MAX_PAGE_SIZE) {
      throw new Mt5BridgeTickError('BRIDGE_INCOMPATIBLE', 'MT5 bridge capabilities are incompatible');
    }
    return value as unknown as Mt5BridgeCapabilities;
  }

  async ticks(request: Mt5BridgeTicksRequest, options: Mt5BridgeRequestOptions = {}): Promise<Mt5BridgeTicksResponse> {
    if (!this.validTickRequest(request)) throw new Mt5BridgeTickError('TICK_INVALID_REQUEST', 'MT5 tick request is invalid');
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > TICK_MAX_REQUEST_BYTES) throw new Mt5BridgeTickError('TICK_INVALID_REQUEST', 'MT5 tick request is too large');
    const { value, bytes } = await this.tickRequest('/ticks', body, options);
    return this.validateTicks(value, request, bytes);
  }

  private async tickRequest(path: string, body: string | undefined, options: Mt5BridgeRequestOptions): Promise<{ value: unknown; bytes: number }> {
    const baseUrl = process.env.MT5_BRIDGE_BASE_URL?.trim();
    const token = process.env.MT5_BRIDGE_TOKEN?.trim();
    if (!baseUrl || !token) throw new Mt5BridgeTickError('TICK_UNAVAILABLE', 'MT5 bridge configuration is incomplete');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) throw new Mt5BridgeTickError('TICK_DEADLINE', 'MT5 tick request was aborted');
    options.signal?.addEventListener('abort', abort, { once: true });
    const remaining = options.deadlineMsc === undefined ? this.timeoutMs() : options.deadlineMsc - Date.now();
    if (remaining < 1_000) throw new Mt5BridgeTickError('TICK_DEADLINE', 'MT5 tick deadline elapsed');
    const timeout = setTimeout(abort, Math.min(this.timeoutMs(), remaining));
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? { authorization: `Bearer ${token}` } : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > TICK_MAX_RESPONSE_BYTES) throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 tick response is too large');
      const { text, bytes } = await this.readTickBody(response);
      if (!response.ok) throw this.tickHttpError(response.status, text);
      try { return { value: JSON.parse(text), bytes }; } catch { throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned invalid tick JSON'); }
    } catch (error) {
      if (error instanceof Mt5BridgeTickError) throw error;
      if (controller.signal.aborted) throw new Mt5BridgeTickError('TICK_DEADLINE', 'MT5 tick request timed out');
      throw new Mt5BridgeTickError('TICK_UNAVAILABLE', 'MT5 bridge ticks are unavailable');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private validate(value: unknown, request: Mt5BridgeRequest, responseBytes: number): Mt5BridgeResponse {
    if (!this.record(value)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (value.server !== request.server || value.accountLogin !== request.accountLogin) throw new BadGatewayException('MT5 bridge identity mismatch');
    if (value.contractVersion !== 5 || value.mode !== request.mode || value.snapshotToMsc !== request.snapshotToMsc || !Array.isArray(value.deals) || !Array.isArray(value.orders) || !this.record(value.page) || !this.record(value.account)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (!Number.isSafeInteger(value.snapshotToMsc) || (value.snapshotToMsc as number) < 0
      || typeof value.page.hasMore !== 'boolean' || !Number.isSafeInteger(value.page.bytes) || value.page.bytes !== responseBytes
      || (value.page.hasMore && (typeof value.page.nextCursor !== 'string' || !value.page.nextCursor))
      || (!value.page.hasMore && value.page.nextCursor !== undefined)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (typeof value.account.currency !== 'string' || !value.account.currency.trim() || !Number.isInteger(value.account.currencyDigits) || (value.account.currencyDigits as number) < 0 || (value.account.currencyDigits as number) > 8 || !this.canonicalSignedDecimal(value.account.currentBalance)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    for (const deal of value.deals) this.validateFact(deal, DEAL_NUMBER_FIELDS, DEAL_BIGINT_FIELDS);
    for (const order of value.orders) this.validateFact(order, ORDER_NUMBER_FIELDS, ORDER_BIGINT_FIELDS);
    return value as unknown as Mt5BridgeResponse;
  }

  private validateTicks(value: unknown, request: Mt5BridgeTicksRequest, responseBytes: number): Mt5BridgeTicksResponse {
    if (!this.record(value) || !this.exactKeys(value, ['contractVersion', 'cursorNamespace', 'server', 'accountLogin', 'symbol', 'rawRange', 'snapshotToMsc', 'pageSize', 'snapshot', 'valuation', 'ticks', 'complete', 'bytes'], ['nextCursor']) || value.contractVersion !== 5 || value.cursorNamespace !== 'ticks-v1' || value.server !== request.server
      || value.accountLogin !== request.accountLogin || value.symbol !== request.symbol
      || value.snapshotToMsc !== request.snapshotToMsc || !this.sameRange(value.rawRange, request.rawRange)
      || !this.positiveSafeInteger(value.pageSize) || (request.pageSize !== undefined && value.pageSize !== request.pageSize) || !this.record(value.snapshot) || !this.record(value.valuation)
      || !Array.isArray(value.ticks) || typeof value.complete !== 'boolean' || value.bytes !== responseBytes) {
      throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned an invalid tick payload');
    }
    const snapshot = value.snapshot;
    const valuation = value.valuation;
    if (!this.exactKeys(snapshot, ['id', 'sha256', 'tickCount', 'expiresAtMsc']) || !this.exactKeys(valuation, ['version', 'calculationMode', 'accountCurrency', 'profitCurrency', 'tickSize', 'tickValueProfit', 'tickValueLoss', 'sha256']) || typeof snapshot.id !== 'string' || !snapshot.id || !this.sha(snapshot.sha256)
      || !this.positiveOrZeroSafeInteger(snapshot.tickCount) || !this.positiveSafeInteger(snapshot.expiresAtMsc)
      || valuation.version !== 1 || typeof valuation.calculationMode !== 'string' || !valuation.calculationMode
      || !this.nonemptyString(valuation.accountCurrency) || !this.nonemptyString(valuation.profitCurrency)
      || !this.canonicalPositiveDecimal(valuation.tickSize) || !this.canonicalPositiveDecimal(valuation.tickValueProfit)
      || !this.canonicalPositiveDecimal(valuation.tickValueLoss) || !this.sha(valuation.sha256)
      || this.digestValuation(valuation) !== valuation.sha256) {
      throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned invalid tick provenance');
    }
    if ((value.complete && value.nextCursor !== undefined) || (!value.complete && (typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > TICK_MAX_CURSOR_CHARS))) {
      throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned invalid tick pagination');
    }
    const tickCount = snapshot.tickCount as number;
    let expectedSequence: number | undefined;
    for (const tick of value.ticks) {
      if (!this.record(tick) || !this.exactKeys(tick, ['sequence', 'timeMsc', 'bid', 'ask']) || !this.positiveOrZeroSafeInteger(tick.sequence) || !this.positiveOrZeroSafeInteger(tick.timeMsc)
        || tick.timeMsc < request.rawRange.fromMsc || tick.timeMsc > request.rawRange.toMsc
        || !this.canonicalPositiveDecimal(tick.bid) || !this.canonicalPositiveDecimal(tick.ask)
        || (expectedSequence !== undefined && tick.sequence !== expectedSequence)) {
        throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned invalid tick data');
      }
      expectedSequence = tick.sequence + 1;
    }
    if (value.ticks.length > value.pageSize || value.ticks.some((tick) => tick.sequence >= tickCount)
      || (value.complete && value.ticks.length > 0 && value.ticks[value.ticks.length - 1].sequence !== tickCount - 1)
      || this.digestSnapshot(tickCount, value.ticks) !== snapshot.sha256 && tickCount === value.ticks.length) {
      throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned an invalid tick digest');
    }
    return value as unknown as Mt5BridgeTicksResponse;
  }

  private validTickRequest(request: Mt5BridgeTicksRequest): boolean {
    return request.contractVersion === 5 && this.nonemptyString(request.server) && this.positiveSafeInteger(request.accountLogin)
      && typeof request.password === 'string' && this.nonemptyString(request.symbol) && request.symbol === request.symbol.trim()
      && this.sameRange(request.rawRange, request.rawRange) && this.positiveOrZeroSafeInteger(request.snapshotToMsc)
      && request.rawRange.toMsc <= request.snapshotToMsc
      && request.rawRange.toMsc - request.rawRange.fromMsc <= TICK_MAX_CHUNK_SPAN_MSC
      && (request.pageSize === undefined || (this.positiveSafeInteger(request.pageSize) && request.pageSize <= TICK_MAX_PAGE_SIZE))
      && (request.pageCursor === undefined || (typeof request.pageCursor === 'string' && request.pageCursor.length > 0 && request.pageCursor.length <= TICK_MAX_CURSOR_CHARS));
  }

  private tickHttpError(status: number, body: string): Mt5BridgeTickError {
    const error = (() => { try { return JSON.parse(body); } catch { return undefined; } })();
    const code = this.record(error) && typeof error.error === 'string' ? error.error : '';
    if (status === 401 || status === 403) return new Mt5BridgeTickError('MT5_BRIDGE_UNAUTHORIZED', 'MT5 bridge rejected its bearer token');
    if (status === 400) return new Mt5BridgeTickError(code === 'invalid_or_expired_tick_cursor' ? 'TICK_CURSOR_EXPIRED' : 'TICK_INVALID_REQUEST', 'MT5 bridge rejected the tick request');
    if (status === 409) return new Mt5BridgeTickError('TICK_IDENTITY_MISMATCH', 'MT5 bridge tick identity mismatch');
    if (status === 422) return new Mt5BridgeTickError(code === 'tick_valuation_unsupported' ? 'VALUATION_UNSUPPORTED' : 'TICK_SOURCE_LIMIT', 'MT5 bridge cannot provide ticks');
    if (status === 503) return new Mt5BridgeTickError('TICK_CAPACITY', 'MT5 bridge tick capacity is unavailable');
    return new Mt5BridgeTickError('TICK_UNAVAILABLE', 'MT5 bridge tick request failed');
  }

  private async readTickBody(response: Response): Promise<{ text: string; bytes: number }> {
    if (!response.body) return { text: '', bytes: 0 };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > TICK_MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 tick response is too large');
        }
        chunks.push(value);
      }
      try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), bytes };
      } catch {
        throw new Mt5BridgeTickError('TICK_INVALID_PAYLOAD', 'MT5 bridge returned invalid tick encoding');
      }
    } finally {
      reader.releaseLock();
    }
  }

  private digestSnapshot(tickCount: number, ticks: unknown[]): string {
    return this.digest(['ticks-v1-snapshot', tickCount, ...ticks.flatMap((tick) => {
      const value = tick as Record<string, unknown>;
      return [value.sequence as number, value.timeMsc as number, value.bid as string, value.ask as string];
    })]);
  }

  private digestValuation(value: Record<string, unknown>): string {
    return this.digest(['ticks-v1-valuation', value.version as number, value.calculationMode as string, value.accountCurrency as string,
      value.profitCurrency as string, value.tickSize as string, value.tickValueProfit as string, value.tickValueLoss as string]);
  }

  private digest(parts: Array<string | number>): string {
    const hash = createHash('sha256');
    for (const part of parts) {
      if (typeof part === 'number') {
        const bytes = Buffer.alloc(8);
        bytes.writeBigUInt64BE(BigInt(part));
        hash.update(bytes);
      } else {
        const bytes = Buffer.from(part, 'utf8');
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        hash.update(length).update(bytes);
      }
    }
    return hash.digest('hex');
  }

  private sameRange(value: unknown, expected: { fromMsc: number; toMsc: number }): value is { fromMsc: number; toMsc: number } {
    return this.record(value) && this.exactKeys(value, ['fromMsc', 'toMsc']) && this.positiveOrZeroSafeInteger(value.fromMsc) && this.positiveOrZeroSafeInteger(value.toMsc)
      && value.fromMsc <= value.toMsc && value.fromMsc === expected.fromMsc && value.toMsc === expected.toMsc;
  }
  private exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
      && Object.keys(value).every((key) => allowed.has(key));
  }
  private sha(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
  private nonemptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
  private positiveSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
  private positiveOrZeroSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
  private safeLimit(value: unknown, maximum: number): value is number { return this.positiveSafeInteger(value) && (value as number) <= maximum; }
  private canonicalPositiveDecimal(value: unknown): value is string { return typeof value === 'string' && value !== '0' && this.canonicalDecimalParts(value, false); }

  private validateFact(value: unknown, numberFields: readonly string[], bigintFields: readonly string[]): void {
    if (!this.record(value)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (numberFields.some((field) => typeof value[field] !== 'number' || !Number.isFinite(value[field]))) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (bigintFields.some((field) => {
      const candidate = value[field];
      return typeof candidate !== 'string'
        || !/^(0|[1-9]\d*)$/.test(candidate)
        || BigInt(candidate) > POSTGRES_BIGINT_MAX;
    })) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (STRING_FIELDS.some((field) => typeof value[field] !== 'string')) throw new BadGatewayException('MT5 bridge returned an invalid payload');
  }

  private canonicalSignedDecimal(value: unknown): value is string {
    return typeof value === 'string' && this.canonicalDecimalParts(value, true);
  }

  private canonicalDecimalParts(value: string, signed: boolean): boolean {
    const match = new RegExp(`^${signed ? '-?' : ''}(0|[1-9]\\d*)(?:\\.(\\d*[1-9]))?$`).exec(value);
    return Boolean(match) && match![1].length + (match![2]?.length ?? 0) <= MAX_DECIMAL_PRECISION
      && (match![2]?.length ?? 0) <= MAX_DECIMAL_SCALE;
  }

  private record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private async readBoundedBody(response: Response): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new BadGatewayException('MT5 bridge response is too large');
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  private timeoutMs(): number {
    const configured = Number(process.env.MT5_BRIDGE_TIMEOUT_MS ?? 10_000);
    return Number.isInteger(configured) && configured >= 1_000 && configured <= 30_000 ? configured : 10_000;
  }
}
