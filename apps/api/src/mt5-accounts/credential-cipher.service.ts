import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface CredentialEnvelope {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  version: number;
}

@Injectable()
export class CredentialCipherService {
  private static readonly VERSION = 1;
  private readonly key: Buffer;

  constructor(keyValue = process.env.MT5_CREDENTIAL_ENCRYPTION_KEY) {
    if (!keyValue || !/^[A-Za-z0-9+/]{43}=$/.test(keyValue)) {
      throw new Error('MT5_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }

    const key = Buffer.from(keyValue, 'base64');
    if (key.length !== 32 || key.toString('base64') !== keyValue) {
      throw new Error('MT5_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    this.key = key;
  }

  encrypt(plaintext: string): CredentialEnvelope {
    if (!plaintext) {
      throw new Error('MT5 credential must not be empty');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext,
      iv,
      tag: cipher.getAuthTag(),
      version: CredentialCipherService.VERSION,
    };
  }

  decrypt(envelope: CredentialEnvelope): string {
    if (
      envelope.version !== CredentialCipherService.VERSION ||
      !Buffer.isBuffer(envelope.ciphertext) ||
      !Buffer.isBuffer(envelope.iv) ||
      envelope.iv.length !== 12 ||
      !Buffer.isBuffer(envelope.tag) ||
      envelope.tag.length !== 16
    ) {
      throw new Error('Invalid MT5 credential envelope');
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, envelope.iv);
      decipher.setAuthTag(envelope.tag);
      return Buffer.concat([
        decipher.update(envelope.ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Invalid MT5 credential envelope');
    }
  }
}
