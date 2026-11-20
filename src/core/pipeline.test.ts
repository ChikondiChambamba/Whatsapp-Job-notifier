import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from '../interfaces/payload.js';
import { getTemplate } from '../profiles/templates.js';
import { OutboxStore } from '../services/outboxStore.js';
import { SettingsStore } from '../services/settingsStore.js';
import { StatsStore } from '../services/statsStore.js';
import { MessagePipeline } from './pipeline.js';

function setup() {
  const db = new Database(':memory:');
  const settings = new SettingsStore(db);
  const outboxStore = new OutboxStore(db);
  const statsStore = new StatsStore(db);
  const outboxSender = { drain: vi.fn().mockResolvedValue(undefined) };
  settings.saveProfile(getTemplate('job-vacancies')!.build());
  settings.saveProfile({
    id: 'laptops',
    name: 'Laptops',
    threshold: 2,
    sources: { mode: 'selected', jids: ['market@g.us'] },
    groups: [{ id: 'what', label: 'What', weight: 2, terms: ['laptop'], required: true }],
  });
  const pipeline = new MessagePipeline({ settings, statsStore, outboxStore, outboxSender });
  return { pipeline, outboxStore, statsStore, outboxSender };
}

function message(overrides: Partial<IncomingMessage>): IncomingMessage {
  return {
    messageId: 'm1',
    sourceJid: 'market@g.us',
    sourceName: 'Market',
    sourceType: 'GROUP',
    sender: 'someone',
    rawText: '',
    timestamp: new Date(),
    origin: 'live',
    ...overrides,
  };
}

describe('MessagePipeline', () => {
  it('queues one alert per matching profile and drains live matches', () => {
    const { pipeline, outboxStore, statsStore, outboxSender } = setup();

    pipeline.process(
      message({ rawText: 'We are hiring a software developer, laptop provided. Send your CV.' }),
    );

    expect(outboxStore.pendingRows().map((row) => row.profileId).sort()).toEqual([
      'job-vacancies',
      'laptops',
    ]);
    expect(statsStore.getStats(60_000).totalScored).toBe(2);
    expect(outboxSender.drain).toHaveBeenCalledTimes(1);
  });

  it('only scores profiles that watch the source', () => {
    const { pipeline, outboxStore } = setup();

    pipeline.process(message({ sourceJid: 'other@g.us', rawText: 'Laptop for sale' }));

    expect(outboxStore.pendingRows()).toHaveLength(0);
  });

  it('ignores duplicates and does not drain catch-up matches immediately', () => {
    const { pipeline, outboxStore, outboxSender } = setup();
    const catchup = message({ rawText: 'Laptop for sale', origin: 'catchup' });

    pipeline.process(catchup);
    pipeline.process(catchup);

    expect(outboxStore.pendingRows()).toHaveLength(1);
    expect(outboxSender.drain).not.toHaveBeenCalled();
  });

  it('queues AI-checked profiles for review when a key is saved', () => {
    const db = new Database(':memory:');
    const settings = new SettingsStore(db);
    const outboxStore = new OutboxStore(db);
    settings.saveProfile({
      id: 'laptops',
      name: 'Laptops',
      threshold: 2,
      groups: [{ id: 'what', label: 'What', weight: 2, terms: ['laptop'], required: true }],
      ai: { enabled: true, description: 'Cheap laptops' },
    });
    const run = (aiReady: boolean, messageId: string) =>
      new MessagePipeline({
        settings,
        statsStore: new StatsStore(db),
        outboxStore,
        outboxSender: { drain: vi.fn() },
        aiReady: () => aiReady,
      }).process(message({ messageId, rawText: 'Laptop for sale' }));

    run(true, 'with-key');
    run(false, 'no-key');

    const statuses = Object.fromEntries(outboxStore.recentRows().map((row) => [row.messageId, row.status]));
    expect(statuses).toEqual({ 'with-key': 'review', 'no-key': 'pending' });
  });
});
