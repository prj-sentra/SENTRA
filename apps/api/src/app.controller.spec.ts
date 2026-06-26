import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController skeleton', () => {
  it('keeps root health endpoint available', () => {
    const controller = new AppController(new AppService());

    expect(controller.health()).toMatchObject({
      status: 'ok',
      service: 'sentra-api',
    });
  });
});
