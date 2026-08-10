import { BadGatewayException, Injectable } from '@nestjs/common';

export interface Mt5BridgeRequest {
  server: string;
  accountLogin: number;
  password: string;
  cursor?: string;
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

export interface Mt5PositionEntryBalanceFact {
  positionId: string; entryDealTicket: string; entryOrderTicket: string; entryTimeMsc: number; preEntryBalance: string; ledgerSemanticsVersion: number;
}
export interface Mt5UnsupportedPositionEntryBalanceFact {
  kind: 'ANCHORED' | 'UNANCHORED'; positionId: string; entryDealTicket?: string; entryOrderTicket?: string; entryTimeMsc?: number;
  reason: string; ledgerSemanticsVersion: number;
}
export interface Mt5BridgeResponse {
  server: string; accountLogin: number; cursor: string; deals: Mt5DealFact[]; orders: Mt5OrderFact[];
  positionEntryBalances: Mt5PositionEntryBalanceFact[];
  unsupportedPositionEntryBalances: Mt5UnsupportedPositionEntryBalanceFact[];
  positionEntryPlans: Mt5PositionEntryPlanFact[];
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const DEAL_NUMBER_FIELDS = ['time', 'timeMsc', 'type', 'entry', 'reason', 'volume', 'price', 'commission', 'swap', 'profit', 'fee'] as const;
const DEAL_BIGINT_FIELDS = ['ticket', 'order', 'positionId', 'magic'] as const;
const ORDER_NUMBER_FIELDS = ['timeSetup', 'timeSetupMsc', 'timeDone', 'timeDoneMsc', 'type', 'state', 'reason', 'volumeInitial', 'volumeCurrent', 'priceOpen', 'sl', 'tp', 'priceCurrent', 'priceStopLimit'] as const;
const ORDER_BIGINT_FIELDS = ['ticket', 'positionId'] as const;
const STRING_FIELDS = ['symbol', 'comment', 'externalId'] as const;

const PLAN_DECIMAL_FIELDS = ['entryPrice', 'quantityLots', 'takeProfitPrice', 'stopLossPrice', 'preEntryBalance', 'tickSize', 'tickValueProfit', 'tickValueLoss'] as const;
const MAX_DECIMAL_PRECISION = 65;
const MAX_DECIMAL_SCALE = 30;
const ANCHORED_UNSUPPORTED_REASONS = new Set([
  'UNSUPPORTED_INOUT',
  'UNSUPPORTED_ACCOUNT_NOT_APPROVED',
  'UNSUPPORTED_CHECKPOINT',
]);

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
      if (!response.ok) throw new BadGatewayException('MT5 bridge request failed');
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new BadGatewayException('MT5 bridge response is too large');
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new BadGatewayException('MT5 bridge response is too large');
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
    if (value.contractVersion !== 3 || value.ledgerSemanticsVersion !== 1 || typeof value.cursor !== 'string' || !Array.isArray(value.deals) || !Array.isArray(value.orders) || !Array.isArray(value.positionEntryBalances) || !Array.isArray(value.unsupportedPositionEntryBalances) || (value.positionEntryPlans !== undefined && !Array.isArray(value.positionEntryPlans))) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    const positionEntryPlans = value.positionEntryPlans ?? [];
    for (const deal of value.deals) this.validateFact(deal, DEAL_NUMBER_FIELDS, DEAL_BIGINT_FIELDS);
    for (const order of value.orders) this.validateFact(order, ORDER_NUMBER_FIELDS, ORDER_BIGINT_FIELDS);
    const positionIds = new Set<string>();
    const anchors = new Set<string>();
    for (const row of [...value.positionEntryBalances, ...value.unsupportedPositionEntryBalances]) {
      if (!this.record(row) || typeof row.positionId !== 'string' || !/^[1-9]\d*$/.test(row.positionId) || BigInt(row.positionId) > POSTGRES_BIGINT_MAX || positionIds.has(row.positionId) || row.ledgerSemanticsVersion !== 1) throw new BadGatewayException('MT5 bridge returned an invalid payload');
      positionIds.add(row.positionId);
      const unanchored = row.kind === 'UNANCHORED';
      if (unanchored) {
        if (row.reason !== 'OPENING_DEAL_OUTSIDE_HISTORY' || 'entryDealTicket' in row || 'entryOrderTicket' in row || 'entryTimeMsc' in row || 'preEntryBalance' in row) throw new BadGatewayException('MT5 bridge returned an invalid payload');
      } else {
        if (typeof row.entryDealTicket !== 'string' || typeof row.entryOrderTicket !== 'string' || !/^[1-9]\d*$/.test(row.entryDealTicket) || !/^[1-9]\d*$/.test(row.entryOrderTicket) || BigInt(row.entryDealTicket) > POSTGRES_BIGINT_MAX || BigInt(row.entryOrderTicket) > POSTGRES_BIGINT_MAX || !Number.isSafeInteger(row.entryTimeMsc) || anchors.has(row.entryDealTicket)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
        if (row.kind !== 'ANCHORED' && !this.canonicalSignedDecimal(row.preEntryBalance)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
        if (row.kind === 'ANCHORED' ? typeof row.reason !== 'string' || !ANCHORED_UNSUPPORTED_REASONS.has(row.reason) || 'preEntryBalance' in row : row.kind !== undefined || 'reason' in row) throw new BadGatewayException('MT5 bridge returned an invalid payload');
        anchors.add(row.entryDealTicket);
      }
    }
    const planPositionIds = new Set<string>();
    for (const plan of positionEntryPlans) {
      this.validateEntryPlan(plan);
      if (planPositionIds.has(plan.positionId)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
      planPositionIds.add(plan.positionId);
    }
    return { ...value, positionEntryPlans } as unknown as Mt5BridgeResponse;
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
  private validateEntryPlan(value: unknown): void {
    if (!this.record(value)
      || typeof value.positionId !== 'string'
      || !/^(0|[1-9]\d*)$/.test(value.positionId)
      || BigInt(value.positionId) > POSTGRES_BIGINT_MAX
      || !['long', 'short'].includes(value.side as string)
      || typeof value.entryAt !== 'number'
      || !Number.isSafeInteger(value.entryAt)
      || value.entryAt < 0
      || value.entryAt > 8_640_000_000_000_000
      || typeof value.accountCurrency !== 'string'
      || !value.accountCurrency.trim()) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    for (const field of PLAN_DECIMAL_FIELDS) {
      const decimal = value[field];
      if (typeof decimal !== 'string' || !this.canonicalDecimal(decimal)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
    }
  }

  private canonicalDecimal(value: string): boolean {
    return this.canonicalDecimalParts(value, false);
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
