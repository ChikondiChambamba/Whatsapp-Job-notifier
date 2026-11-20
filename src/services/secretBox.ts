import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretUnavailableError extends Error {}

/**
 * Encrypts secrets (email password, API key) before they are written to the
 * settings database. The desktop app supplies the key from the operating
 * system's protected storage; without a key, values are stored as plain text.
 */
export class SecretBox {
  private constructor(private readonly key: Buffer | null) {}

  /** Reads a base64 32-byte key, e.g. from APP_SECRET_KEY. */
  static fromBase64(value: string | undefined): SecretBox {
    if (!value) {
      return new SecretBox(null);
    }
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) {
      throw new Error('APP_SECRET_KEY must be 32 bytes, base64-encoded');
    }
    return new SecretBox(key);
  }

  static none(): SecretBox {
    return new SecretBox(null);
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  static isSealed(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  seal(plain: string): string {
    if (!this.key) {
      return plain;
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  /** Returns plain text. Throws SecretUnavailableError if it cannot be decrypted. */
  open(value: string): string {
    if (!SecretBox.isSealed(value)) {
      return value;
    }
    if (!this.key) {
      throw new SecretUnavailableError('This secret was saved by the desktop app and needs its key');
    }
    try {
      const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretUnavailableError('A saved secret could not be decrypted');
    }
  }
}
