import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
const ENC_PREFIX = 'ENC:';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.FB_TOKEN_ENCRYPTION_KEY || '';
    if (!raw) {
      this.logger.warn(
        '[Encryption] FB_TOKEN_ENCRYPTION_KEY not set — tokens will NOT be encrypted. Set this env var immediately in production!',
      );
      this.key = Buffer.alloc(32, 0);
    } else {
      // scrypt KDF: work factor N=2^14, fixed salt derived from key material
      const salt = crypto.createHash('sha256').update('FlamboyAI-enc-salt-v1').digest();
      this.key = crypto.scryptSync(raw, salt, 32, { N: 16384, r: 8, p: 1 });
    }
  }

  /** Encrypt a plain-text value. Returns "ENC:<base64>" string. */
  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    if (plaintext.startsWith(ENC_PREFIX)) return plaintext; // already encrypted

    if (!process.env.FB_TOKEN_ENCRYPTION_KEY) {
      this.logger.warn(
        '[Encryption] Encrypting without FB_TOKEN_ENCRYPTION_KEY — insecure!',
      );
    }

    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // Format: iv(16) + tag(16) + ciphertext → base64
    const combined = Buffer.concat([iv, tag, encrypted]);
    return ENC_PREFIX + combined.toString('base64');
  }

  /** Decrypt an "ENC:<base64>" string. Returns plain text. */
  decrypt(ciphertext: string): string {
    if (!ciphertext) return ciphertext;

    // Backward compat: if plain text (no prefix), return as-is and warn
    if (!ciphertext.startsWith(ENC_PREFIX)) {
      this.logger.warn(
        '[Encryption] Decrypting plain-text token — not encrypted. Re-save this page to encrypt.',
      );
      return ciphertext;
    }

    try {
      const combined = Buffer.from(
        ciphertext.slice(ENC_PREFIX.length),
        'base64',
      );
      const iv = combined.subarray(0, IV_LEN);
      const tag = combined.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const encrypted = combined.subarray(IV_LEN + TAG_LEN);

      const decipher = crypto.createDecipheriv(ALGO, this.key, iv);
      decipher.setAuthTag(tag);

      return decipher.update(encrypted) + decipher.final('utf8');
    } catch (err) {
      this.logger.error(`[Encryption] Decrypt failed: ${err}`);
      throw new Error(
        'Token decryption failed — check FB_TOKEN_ENCRYPTION_KEY',
      );
    }
  }

  /** True if value is already encrypted */
  isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(ENC_PREFIX);
  }

  /** Encrypt only if not already encrypted (idempotent) */
  encryptIfNeeded(value: string): string {
    if (!value) return value;
    return this.isEncrypted(value) ? value : this.encrypt(value);
  }
}
