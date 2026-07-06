import { validateCreateTradeTagRequest } from './trade-log.validation';

describe('trade-log validation', () => {
  it('requires createTag field explicitly', () => {
    expect(() => validateCreateTradeTagRequest({ label: '익절' } as never)).toThrow('field is required');
  });
});
