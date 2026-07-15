import { validateCreateTradeTagRequest, validateTradeLogAssistantActionsRequest } from './trade-log.validation';

describe('trade-log validation', () => {
  it('requires createTag field explicitly', () => {
    expect(() => validateCreateTradeTagRequest({ label: '익절' } as never)).toThrow('field is required');
  });

  it('rejects assistant actions missing required mt5-facing references', () => {
    expect(() =>
      validateTradeLogAssistantActionsRequest({
        rawText: 'mt5 sync',
        source: 'api',
        actions: [{ type: 'record_exit', payload: { price: 1, occurredAt: '2026-07-11T08:30:00.000Z' } }],
      } as never),
    ).toThrow('Invalid assistant actions payload');
  });

  it('rejects unsupported assistant actions early', () => {
    expect(() =>
      validateTradeLogAssistantActionsRequest({
        rawText: 'mt5 sync',
        source: 'api',
        actions: [{ type: 'unknown_action', payload: {} }],
      } as never),
    ).toThrow('Invalid assistant actions payload');
  });
});
