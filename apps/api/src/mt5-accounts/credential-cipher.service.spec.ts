import { CredentialCipherService } from './credential-cipher.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('CredentialCipherService', () => {
  it('rejects absent, malformed, and wrong-sized keys', () => {
    expect(() => new CredentialCipherService('')).toThrow();
    expect(() => new CredentialCipherService('not-base64')).toThrow();
    expect(() => new CredentialCipherService(Buffer.alloc(31).toString('base64'))).toThrow();
  });

  it('encrypts with fresh authenticated envelopes and decrypts them', () => {
    const cipher = new CredentialCipherService(KEY);
    const first = cipher.encrypt('broker-secret');
    const second = cipher.encrypt('broker-secret');

    expect(first.ciphertext.equals(Buffer.from('broker-secret'))).toBe(false);
    expect(first.iv.equals(second.iv)).toBe(false);
    expect(cipher.decrypt(first)).toBe('broker-secret');
  });

  it('fails closed for tampering and unsupported versions', () => {
    const cipher = new CredentialCipherService(KEY);
    const envelope = cipher.encrypt('broker-secret');
    envelope.ciphertext[0] ^= 1;
    expect(() => cipher.decrypt(envelope)).toThrow('Invalid MT5 credential envelope');

    const unsupported = { ...cipher.encrypt('secret'), version: 2 };
    expect(() => cipher.decrypt(unsupported)).toThrow('Invalid MT5 credential envelope');
  });
});
