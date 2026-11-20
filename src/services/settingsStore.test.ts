import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getTemplate } from '../profiles/templates.js';
import { importLegacyEnv } from './legacyImport.js';
import { SettingsStore } from './settingsStore.js';

const newStore = () => new SettingsStore(new Database(':memory:'));

describe('SettingsStore', () => {
  it('stores and validates email settings', () => {
    const store = newStore();
    expect(store.getEmailSettings()).toBeNull();
    expect(() => store.setEmailSettings({ smtpHost: 'x', smtpUser: 'u', smtpPass: 'p', to: 'nope' })).toThrow();

    store.setEmailSettings({ smtpHost: 'smtp.example.com', smtpUser: 'u', smtpPass: 'p', to: 'me@example.com' });
    expect(store.getEmailSettings()).toMatchObject({ smtpPort: 587, fromName: 'WhatsApp Alerts' });
  });

  it('tracks watched sources and resolves channel links', () => {
    const store = newStore();
    store.addSource({ jid: 'group@g.us', name: 'Group' });
    const link = store.addChannelLink('https://whatsapp.com/channel/abc');

    expect(store.isWatched('group@g.us')).toBe(true);
    expect(store.unresolvedChannelLinks()).toHaveLength(1);

    store.resolveChannelLink(link.id, '123@newsletter', 'Jobs Channel');

    expect(store.unresolvedChannelLinks()).toHaveLength(0);
    expect(store.watchedChannelJids()).toEqual(['123@newsletter']);
    expect(store.isWatched('123@newsletter')).toBe(true);
  });

  it('merges a resolved link into an already watched channel', () => {
    const store = newStore();
    store.addSource({ jid: '123@newsletter' });
    const link = store.addChannelLink('https://whatsapp.com/channel/abc');

    store.resolveChannelLink(link.id, '123@newsletter', 'Jobs Channel');

    expect(store.listSources()).toHaveLength(1);
    expect(store.listSources()[0]?.name).toBe('Jobs Channel');
  });

  it('saves profiles and filters them by source', () => {
    const store = newStore();
    const jobs = store.saveProfile(getTemplate('job-vacancies')!.build());
    store.saveProfile({
      ...getTemplate('blank')!.build(),
      id: 'rooms',
      name: 'Rooms',
      sources: { mode: 'selected', jids: ['rooms@g.us'] },
    });
    store.saveProfile({ ...getTemplate('blank')!.build(), id: 'off', enabled: false });

    expect(store.profilesForSource('jobs@g.us').map((p) => p.id)).toEqual(['job-vacancies']);
    expect(store.profilesForSource('rooms@g.us').map((p) => p.id)).toEqual(['job-vacancies', 'rooms']);

    const updated = store.saveProfile({ ...jobs, threshold: 6 });
    expect(updated.threshold).toBe(6);
    expect(updated.updatedAt).toBeGreaterThan(jobs.updatedAt);

    store.deleteProfile('rooms');
    expect(store.getProfile('rooms')).toBeUndefined();
  });
});

describe('importLegacyEnv', () => {
  const legacy = {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: 587,
    SMTP_USER: 'bot@example.com',
    SMTP_PASS: 'secret',
    ALERT_EMAIL_TO: 'me@example.com',
    WATCHED_GROUP_JIDS: ['a@g.us'],
    WATCHED_CHANNEL_JIDS: ['1@newsletter'],
    WATCHED_CHANNEL_LINKS: ['https://whatsapp.com/channel/abc'],
    MATCH_THRESHOLD: 5,
  };

  it('imports an existing .env setup once', () => {
    const store = newStore();

    expect(importLegacyEnv(store, legacy)).toEqual({ imported: true, sources: 3, email: true, profile: true });
    expect(store.listSources()).toHaveLength(3);
    expect(store.getEmailSettings()?.to).toBe('me@example.com');
    expect(store.listProfiles()).toHaveLength(1);
    expect(store.listProfiles()[0]).toMatchObject({ id: 'job-vacancies', threshold: 5 });

    expect(importLegacyEnv(store, legacy).imported).toBe(false);
    expect(store.listSources()).toHaveLength(3);
  });

  it('creates nothing for a brand new user', () => {
    const store = newStore();
    const result = importLegacyEnv(store, {
      ...legacy,
      SMTP_HOST: undefined,
      WATCHED_GROUP_JIDS: [],
      WATCHED_CHANNEL_JIDS: [],
      WATCHED_CHANNEL_LINKS: [],
    });

    expect(result).toEqual({ imported: true, sources: 0, email: false, profile: false });
    expect(store.listProfiles()).toHaveLength(0);
  });
});
