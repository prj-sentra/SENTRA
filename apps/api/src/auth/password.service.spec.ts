import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();
  it('uses random salts and verifies only the original password', async () => {
    const first = await service.hash('correct horse battery staple');
    const second = await service.hash('correct horse battery staple');
    expect(first).not.toBe(second);
    await expect(service.verify('correct horse battery staple', first)).resolves.toBe(true);
    await expect(service.verify('wrong password', first)).resolves.toBe(false);
  });
  it('fails closed for malformed hashes', async () => {
    await expect(service.verify('password', 'not-a-hash')).resolves.toBe(false);
  });
});
