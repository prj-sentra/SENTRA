import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('accepts a successful response with an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(apiRequest<void>('/empty')).resolves.toBeUndefined();
  });

  it('parses a successful JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ saved: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(apiRequest<{ saved: boolean }>('/json')).resolves.toEqual({ saved: true });
  });
});
