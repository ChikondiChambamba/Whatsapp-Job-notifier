import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore } from '../services/outboxStore.js';
import { RecentMessagesStore } from '../services/recentMessagesStore.js';
import { SettingsStore } from '../services/settingsStore.js';
import { StatsStore } from '../services/statsStore.js';
import { NotConnectedError, type WhatsAppStatus } from '../whatsapp/client.js';
import { createApp, type WhatsAppControl } from './app.js';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function setup(whatsappOverrides: Partial<WhatsAppControl> = {}) {
  const db = new Database(':memory:');
  const settings = new SettingsStore(db);
  const recentMessages = new RecentMessagesStore(db);
  const status: WhatsAppStatus = { state: 'connected', qr: null, account: { jid: 'me', name: 'Me' }, lastConnectedAt: 1 };
  const whatsapp: WhatsAppControl = {
    getStatus: () => status,
    listGroups: async () => [{ jid: 'g1@g.us', name: 'Jobs Malawi', participants: 120 }],
    listSeenChannels: async () => [],
    lookupChannelLink: async () => ({ jid: '99@newsletter', name: 'Tech Jobs' }),
    logout: vi.fn(async () => undefined),
    ...whatsappOverrides,
  };
  const sendTestEmail = vi.fn(async () => undefined);
  const aiCheck = vi.fn(async () => ({ relevant: true, reason: 'Looks like what you want.' }));
  const aiChecker = { check: aiCheck, isConfigured: () => settings.getAiSettings() !== null };
  const app = createApp({
    settings,
    statsStore: new StatsStore(db),
    outboxStore: new OutboxStore(db),
    recentMessages,
    whatsapp,
    sendTestEmail,
    aiChecker,
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  return { call, settings, recentMessages, whatsapp, sendTestEmail, aiCheck, base, status };
}

const blankProfile = (overrides: Record<string, unknown> = {}) => ({
  name: 'Laptops',
  threshold: 2,
  groups: [{ id: 'what', label: 'What', weight: 2, terms: ['laptop'], required: true }],
  ...overrides,
});

describe('security', () => {
  it('rejects requests whose Host is not loopback (DNS rebinding)', async () => {
    const { base } = await setup();
    // fetch() does not allow overriding Host, so use the http module directly.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.get(`${base}/api/status`, { headers: { host: 'evil.example:4000' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('rejects requests from a non-local Origin', async () => {
    const { call } = await setup();
    const { status } = await call('POST', '/api/profiles', blankProfile(), { origin: 'https://evil.example' });
    expect(status).toBe(403);
  });

  it('rejects state changes that are not JSON (cross-site form posts)', async () => {
    const { base } = await setup();
    const response = await fetch(`${base}/api/whatsapp/logout`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(response.status).toBe(415);
  });
});

describe('API', () => {
  it('reports status with setup progress', async () => {
    const { call } = await setup();
    const { body } = await call('GET', '/api/status');
    expect(body.whatsapp.state).toBe('connected');
    expect(body.whatsapp.qr).toBeUndefined();
    expect(body.setup).toEqual({ linked: true, sources: 0, profiles: 0, email: false, ai: false });
  });

  it('renders the QR code as an image while waiting for a scan', async () => {
    const { call, status } = await setup();
    status.state = 'waiting_for_scan';
    status.qr = 'test-qr-payload';
    status.account = null;
    const { body } = await call('GET', '/api/status');
    expect(body.whatsapp.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('lists groups with watched flags and adds sources', async () => {
    const { call } = await setup();
    expect((await call('POST', '/api/sources', { jid: 'g1@g.us', name: 'Jobs Malawi' })).status).toBe(201);
    const { body } = await call('GET', '/api/chats');
    expect(body.groups).toEqual([{ jid: 'g1@g.us', name: 'Jobs Malawi', participants: 120, watched: true }]);
    expect((await call('POST', '/api/sources', { jid: 'not-a-chat' })).status).toBe(400);
  });

  it('returns 409 for chats while WhatsApp is offline', async () => {
    const { call } = await setup({
      listGroups: async () => {
        throw new NotConnectedError();
      },
    });
    expect((await call('GET', '/api/chats')).status).toBe(409);
  });

  it('adds channels by link, or keeps the link for later when offline', async () => {
    const online = await setup();
    const added = await online.call('POST', '/api/sources/channel-link', { link: 'https://whatsapp.com/channel/abc' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ jid: '99@newsletter', name: 'Tech Jobs', type: 'channel' });
    server?.close();

    const offline = await setup({
      lookupChannelLink: async () => {
        throw new NotConnectedError();
      },
    });
    const pending = await offline.call('POST', '/api/sources/channel-link', { link: 'https://whatsapp.com/channel/abc' });
    expect(pending.status).toBe(202);
    expect(offline.settings.unresolvedChannelLinks()).toHaveLength(1);
  });

  it('creates, updates and deletes profiles with generated ids', async () => {
    const { call } = await setup();
    const first = await call('POST', '/api/profiles', blankProfile());
    const second = await call('POST', '/api/profiles', blankProfile());
    expect(first.body.id).toBe('laptops');
    expect(second.body.id).toBe('laptops-2');

    const updated = await call('PUT', '/api/profiles/laptops', { ...first.body, threshold: 5 });
    expect(updated.body.threshold).toBe(5);

    const invalid = await call('PUT', '/api/profiles/laptops', { ...first.body, groups: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/at least one group/i);

    expect((await call('DELETE', '/api/profiles/laptops')).status).toBe(204);
    expect((await call('GET', '/api/profiles')).body).toHaveLength(1);
  });

  it('creates a profile from a template', async () => {
    const { call } = await setup();
    const { status, body } = await call('POST', '/api/profiles/from-template', { templateId: 'job-vacancies' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ id: 'job-vacancies', name: 'Job vacancies' });
    expect(body.groups).toHaveLength(7);
  });

  it('tests a draft profile against pasted text', async () => {
    const { call } = await setup();
    const { body } = await call('POST', '/api/profiles/test', {
      profile: { ...blankProfile(), id: 'draft' },
      text: 'Laptop for sale, barely used',
    });
    expect(body).toMatchObject({ matched: true, score: 2, categoryHits: { what: ['laptop'] } });
  });

  it('previews a draft profile against recent messages', async () => {
    const { call, recentMessages } = await setup();
    recentMessages.add({ messageId: 'a', sourceJid: 'g1@g.us', sourceName: 'Market', text: 'Laptop for sale', postedAt: Date.now() });
    recentMessages.add({ messageId: 'b', sourceJid: 'g1@g.us', sourceName: 'Market', text: 'Phone for sale', postedAt: Date.now() });
    recentMessages.add({ messageId: 'c', sourceJid: 'g2@g.us', sourceName: 'Other', text: 'Laptop wanted', postedAt: Date.now() });

    const all = await call('POST', '/api/profiles/preview', { profile: { ...blankProfile(), id: 'draft' } });
    expect(all.body).toMatchObject({ checked: 3, matchCount: 2 });

    const scoped = await call('POST', '/api/profiles/preview', {
      profile: { ...blankProfile(), id: 'draft', sources: { mode: 'selected', jids: ['g1@g.us'] } },
    });
    expect(scoped.body).toMatchObject({ checked: 2, matchCount: 1 });
    expect(scoped.body.matches[0]).toMatchObject({ messageId: 'a', sourceName: 'Market' });
  });

  it('never returns the email password and keeps it when left blank', async () => {
    const { call, settings, sendTestEmail } = await setup();
    const email = { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpUser: 'me@gmail.com', smtpPass: 'app-pass', to: 'me@gmail.com' };

    const saved = await call('PUT', '/api/settings/email', email);
    expect(saved.body.smtpPass).toBeUndefined();
    expect(saved.body.hasPassword).toBe(true);

    await call('PUT', '/api/settings/email', { ...email, smtpPass: '', to: 'other@gmail.com' });
    expect(settings.getEmailSettings()).toMatchObject({ smtpPass: 'app-pass', to: 'other@gmail.com' });

    const fetched = await call('GET', '/api/settings/email');
    expect(JSON.stringify(fetched.body)).not.toContain('app-pass');

    const test = await call('POST', '/api/settings/email/test', {});
    expect(test.body).toEqual({ ok: true, to: 'other@gmail.com' });
    expect(sendTestEmail).toHaveBeenCalledTimes(1);
  });

  it('reports email test failures readably', async () => {
    const { call, sendTestEmail } = await setup();
    await call('PUT', '/api/settings/email', { smtpHost: 'h', smtpUser: 'u', smtpPass: 'p', to: 'a@b.co' });
    sendTestEmail.mockRejectedValueOnce(new Error('Invalid login'));
    const { status, body } = await call('POST', '/api/settings/email/test', {});
    expect(status).toBe(502);
    expect(body.error).toContain('Invalid login');
  });

  it('verifies the AI key before saving and never returns it', async () => {
    const { call, settings, aiCheck } = await setup();

    const saved = await call('PUT', '/api/settings/ai', { apiKey: 'sk-ant-secret-1234', model: 'claude-haiku-5-5' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ configured: true, model: 'claude-haiku-5-5', keyHint: '1234' });
    expect(JSON.stringify(saved.body)).not.toContain('secret');
    expect(aiCheck).toHaveBeenCalledTimes(1);
    expect(settings.getAiSettings()?.apiKey).toBe('sk-ant-secret-1234');

    // Changing only the model keeps the saved key.
    await call('PUT', '/api/settings/ai', { model: 'claude-opus-5-5', verify: false });
    expect(settings.getAiSettings()).toEqual({ apiKey: 'sk-ant-secret-1234', model: 'claude-opus-5-5' });

    expect((await call('DELETE', '/api/settings/ai')).body.configured).toBe(false);
  });

  it('does not save a key the API rejects', async () => {
    const { call, settings, aiCheck } = await setup();
    const { AiPermanentError } = await import('../services/aiChecker.js');
    aiCheck.mockRejectedValueOnce(new AiPermanentError('The API key was rejected. Check it in Settings.'));

    const { status, body } = await call('PUT', '/api/settings/ai', { apiKey: 'bad' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/rejected/);
    expect(settings.getAiSettings()).toBeNull();
  });

  it('runs an AI test on pasted text once a key is saved', async () => {
    const { call } = await setup();
    const input = { description: 'Laptops under K300,000', text: 'Selling a laptop' };
    expect((await call('POST', '/api/profiles/ai-test', input)).status).toBe(409);

    await call('PUT', '/api/settings/ai', { apiKey: 'sk-ant-x', verify: false });
    const { body } = await call('POST', '/api/profiles/ai-test', input);
    expect(body).toEqual({ relevant: true, reason: 'Looks like what you want.' });
  });

  it('rejects enabling the AI check without a description', async () => {
    const { call } = await setup();
    const created = await call('POST', '/api/profiles', blankProfile());
    const { status, body } = await call('PUT', '/api/profiles/laptops', {
      ...created.body,
      ai: { enabled: true, description: '' },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Describe what you want/);
  });
});
