import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, saltValue, digestValue] = encoded.split('$');
    if (algorithm !== 'scrypt' || !saltValue || !digestValue) return false;
    try {
      const salt = Buffer.from(saltValue, 'base64');
      const expected = Buffer.from(digestValue, 'base64');
      if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
      const actual = (await scrypt(password, salt, expected.length)) as Buffer;
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
