import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SecretBox, SecretUnavailableError } from './secretBox.js';
import { SettingsStore } from './settingsStore.js';

const key = () => randomBytes(32).toString('base64');
const email = { smtpHost: 'smtp.gmail.com', smtpUser: 'me@gmail.com', smtpPass: 'app-password', to: 'me@gmail.com' };

describe('SecretBox', () => {
  it('round-trips and never stores the plain text', () => {
    const box = SecretBox.fromBase64(key());
    const sealed = box.seal('app-password');

    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain('app-password');
    expect(box.open(sealed)).toBe('app-password');
    expect(box.seal('x')).not.toBe(box.seal('x'));
  });

  it('passes plain text through without a key', () => {
    const box = SecretBox.none();
    expect(box.seal('secret')).toBe('secret');
    expect(box.open('secret')).toBe('secret');
  });

  it('refuses sealed values with the wrong key or no key', () => {
    const sealed = SecretBox.fromBase64(key()).seal('secret');
    expect(() => SecretBox.fromBase64(key()).open(sealed)).toThrow(SecretUnavailableError);
    expect(() => SecretBox.none().open(sealed)).toThrow(SecretUnavailableError);
  });

  it('rejects a malformed key', () => {
    expect(() => SecretBox.fromBase64('short')).toThrow(/32 bytes/);
  });
});

describe('SettingsStore with encrypted secrets', () => {
  it('encrypts secrets at rest and reads them back', () => {
    const db = new Database(':memory:');
    const store = new SettingsStore(db, SecretBox.fromBase64(key()));
    store.setEmailSettings(email);
    store.setAiSettings({ apiKey: 'sk-ant-secret' });

    const raw = JSON.stringify(db.prepare('SELECT value FROM settings').all());
    expect(raw).not.toContain('app-password');
    expect(raw).not.toContain('sk-ant-secret');
    expect(store.getEmailSettings()?.smtpPass).toBe('app-password');
    expect(store.getAiSettings()?.apiKey).toBe('sk-ant-secret');
  });

  it('upgrades plain-text secrets saved before encryption', () => {
    const db = new Database(':memory:');
    new SettingsStore(db).setEmailSettings(email);
    const secretKey = key();
    const store = new SettingsStore(db, SecretBox.fromBase64(secretKey));

    expect(store.encryptStoredSecrets()).toBe(1);
    expect(store.encryptStoredSecrets()).toBe(0);
    expect(JSON.stringify(db.prepare('SELECT value FROM settings').all())).not.toContain('app-password');
    expect(store.getEmailSettings()?.smtpPass).toBe('app-password');
  });

  it('treats undecryptable secrets as not set up', () => {
    const db = new Database(':memory:');
    new SettingsStore(db, SecretBox.fromBase64(key())).setEmailSettings(email);

    expect(new SettingsStore(db, SecretBox.fromBase64(key())).getEmailSettings()).toBeNull();
  });
});
