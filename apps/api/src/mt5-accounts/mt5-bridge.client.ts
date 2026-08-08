import { BadGatewayException, Injectable } from '@nestjs/common';
import type { TradeLogAssistantActionsRequest } from '@trading-journal/shared';

export interface Mt5BridgeRequest {
  server: string;
  accountLogin: number;
  password: string;
  cursor?: string;
}

export interface Mt5BridgeResponse {
  server: string;
  accountLogin: number;
  cursor?: string;
  actions: TradeLogAssistantActionsRequest;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;

@Injectable()
export class Mt5BridgeClient {
  async sync(request: Mt5BridgeRequest): Promise<Mt5BridgeResponse> {
    const baseUrl = process.env.MT5_BRIDGE_BASE_URL?.trim();
    const token = process.env.MT5_BRIDGE_TOKEN?.trim();
    if (!baseUrl || !token) throw new Error('MT5 bridge configuration is incomplete');

    const controller = new AbortController();
    const timeoutMs = this.timeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL('/sync', baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) throw new BadGatewayException('MT5 bridge request failed');
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new BadGatewayException('MT5 bridge response is too large');
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
        throw new BadGatewayException('MT5 bridge response is too large');
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadGatewayException('MT5 bridge returned an invalid payload');
    }
    const payload = value as Record<string, unknown>;
    if (payload.server !== request.server || payload.accountLogin !== request.accountLogin) {
      throw new BadGatewayException('MT5 bridge identity mismatch');
    }
    if (!payload.actions || typeof payload.actions !== 'object' || Array.isArray(payload.actions)) {
      throw new BadGatewayException('MT5 bridge returned an invalid payload');
    }
    return payload as unknown as Mt5BridgeResponse;
  }

  private timeoutMs(): number {
    const configured = Number(process.env.MT5_BRIDGE_TIMEOUT_MS ?? 10_000);
    return Number.isInteger(configured) && configured >= 1_000 && configured <= 30_000 ? configured : 10_000;
  }
}
