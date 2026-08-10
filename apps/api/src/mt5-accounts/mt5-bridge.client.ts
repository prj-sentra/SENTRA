import { BadGatewayException, Injectable } from '@nestjs/common';

export interface Mt5BridgeRequest {
  server: string;
  accountLogin: number;
  password: string;
  cursor?: string;
  historyFromMsc: number;
  historyToMsc: number;
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
  cursor: string;
  historyRange: { fromMsc: number; toMsc: number };
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

export class Mt5BridgeCursorRejected extends BadGatewayException {
  constructor() {
    super('MT5 bridge rejected the synchronization cursor');
  }
}

export class Mt5BridgeUnauthorized extends BadGatewayException {
  constructor() {
    super('MT5 bridge rejected its bearer token');
  }
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
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new BadGatewayException('MT5 bridge response is too large');
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Mt5BridgeUnauthorized();
        if (response.status === 400) {
          try {
            const body = JSON.parse(text) as unknown;
            if (this.record(body) && body.error === 'invalid or expired cursor') throw new Mt5BridgeCursorRejected();
          } catch (error) {
            if (error instanceof Mt5BridgeCursorRejected) throw error;
          }
        }
        throw new BadGatewayException('MT5 bridge request failed');
      }
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new BadGatewayException('MT5 bridge returned invalid JSON'); }
      return this.validate(value, request);
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('MT5 bridge is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private validate(value: unknown, request: Mt5BridgeRequest): Mt5BridgeResponse {
    if (!this.record(value)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (value.server !== request.server || value.accountLogin !== request.accountLogin) throw new BadGatewayException('MT5 bridge identity mismatch');
    if (value.contractVersion !== 4 || typeof value.cursor !== 'string' || !Array.isArray(value.deals) || !Array.isArray(value.orders) || !this.record(value.historyRange) || !this.record(value.account)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    if (typeof value.historyRange.fromMsc !== 'number' || typeof value.historyRange.toMsc !== 'number' || value.historyRange.fromMsc !== request.historyFromMsc || value.historyRange.toMsc !== request.historyToMsc || !Number.isSafeInteger(value.historyRange.fromMsc) || value.historyRange.fromMsc < 0 || !Number.isSafeInteger(value.historyRange.toMsc) || value.historyRange.toMsc < value.historyRange.fromMsc) throw new BadGatewayException('MT5 bridge history range mismatch');
    if (typeof value.account.currency !== 'string' || !value.account.currency.trim() || !Number.isInteger(value.account.currencyDigits) || (value.account.currencyDigits as number) < 0 || (value.account.currencyDigits as number) > 8 || !this.canonicalSignedDecimal(value.account.currentBalance)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    for (const deal of value.deals) this.validateFact(deal, DEAL_NUMBER_FIELDS, DEAL_BIGINT_FIELDS);
    for (const order of value.orders) this.validateFact(order, ORDER_NUMBER_FIELDS, ORDER_BIGINT_FIELDS);
    return value as unknown as Mt5BridgeResponse;
  }

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

  private timeoutMs(): number {
    const configured = Number(process.env.MT5_BRIDGE_TIMEOUT_MS ?? 10_000);
    return Number.isInteger(configured) && configured >= 1_000 && configured <= 30_000 ? configured : 10_000;
  }
}
