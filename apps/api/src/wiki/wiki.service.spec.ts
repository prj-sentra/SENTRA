import { WikiService } from './wiki.service';

describe('WikiService skeleton', () => {
  it('reports wiki health', () => {
    const service = new WikiService();

    expect(service.health()).toMatchObject({
      status: 'ok',
      service: 'sentra-wiki',
    });
    expect(typeof service.health().timestamp).toBe('string');
  });

  it('starts with no wiki pages', () => {
    const service = new WikiService();

    expect(service.listPages()).toEqual([]);
  });
});
