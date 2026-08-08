import { createHmac } from 'node:crypto';
import { LoginThrottleService } from './throttle.service';

const secret = 'test-throttle-key-that-is-long-enough';
const digest = (dimension: 'ip' | 'principal', value: string) =>
  Uint8Array.from(createHmac('sha256', secret).update(`login\0${dimension}\0${value}`).digest());

describe('LoginThrottleService', () => {
  beforeEach(() => { process.env.AUTH_THROTTLE_KEY = secret; });

  it('clears only the successful principal and preserves the source IP failure budget', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { loginThrottle: { deleteMany } };
    const service = new LoginThrottleService(prisma as never);

    await service.clearPrincipal('trader');

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { keyDigest: digest('principal', 'trader') } });
    expect(deleteMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { keyDigest: digest('ip', '203.0.113.10') },
    }));
  });

  it('checks both IP and principal blocks regardless of row ordering', async () => {
    const future = new Date(Date.now() + 60_000);
    const findMany = jest.fn().mockResolvedValue([
      { keyDigest: digest('principal', 'trader'), blockedUntil: null },
      { keyDigest: digest('ip', '203.0.113.10'), blockedUntil: future },
    ]);
    const service = new LoginThrottleService({ loginThrottle: { findMany } } as never);

    await expect(service.assertAllowed('203.0.113.10', 'trader')).rejects.toMatchObject({ status: 429 });
    expect(findMany).toHaveBeenCalledWith({ where: { keyDigest: { in: [
      digest('ip', '203.0.113.10'), digest('principal', 'trader'),
    ] } } });
  });
});
