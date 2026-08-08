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

export interface Mt5BridgeResponse {
  server: string;
  accountLogin: number;
  cursor: string;
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
    if (typeof value.cursor !== 'string' || !Array.isArray(value.deals) || !Array.isArray(value.orders)) throw new BadGatewayException('MT5 bridge returned an invalid payload');
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

  private record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private timeoutMs(): number {
    const configured = Number(process.env.MT5_BRIDGE_TIMEOUT_MS ?? 10_000);
    return Number.isInteger(configured) && configured >= 1_000 && configured <= 30_000 ? configured : 10_000;
  }
}
