import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { EmailService } from './emailService.js';
import { OutboxSender } from './outboxSender.js';
import { OutboxStore } from './outboxStore.js';
import { StatsStore } from './statsStore.js';

describe('OutboxSender', () => {
  it('sends catch-up rows as one digest at the threshold', async () => {
    const db = new Database(':memory:');
    const outboxStore = new OutboxStore(db);
    const statsStore = new StatsStore(db);
    const emailService = {
      sendDigest: vi.fn().mockResolvedValue(undefined),
      sendAlert: vi.fn().mockResolvedValue(undefined),
      isConfigured: () => true,
    };

    for (let i = 0; i < 3; i += 1) {
      outboxStore.insertPending({
        messageId: `msg-${i}`,
        profileId: 'jobs',
        profileName: 'Jobs',
        sourceJid: 'source@newsletter',
        sourceName: 'Source',
        sourceType: 'CHANNEL',
        text: 'We are hiring a backend developer. Send your CV.',
        postedAt: Date.now(),
        score: 5,
        matchedCategories: ['techRole', 'hiringVerb'],
        origin: 'catchup',
      });
    }

    const sender = new OutboxSender(outboxStore, emailService as unknown as EmailService, statsStore, 0);
    await sender.drain();

    expect(emailService.sendDigest).toHaveBeenCalledTimes(1);
    expect(emailService.sendAlert).not.toHaveBeenCalled();
    expect(outboxStore.pendingRows()).toHaveLength(0);

    outboxStore.close();
  });

  it('holds unsettled catch-up rows but still sends live rows', async () => {
    const db = new Database(':memory:');
    const outboxStore = new OutboxStore(db);
    const statsStore = new StatsStore(db);
    const emailService = {
      sendDigest: vi.fn().mockResolvedValue(undefined),
      sendAlert: vi.fn().mockResolvedValue(undefined),
      isConfigured: () => true,
    };

    for (const [messageId, origin] of [
      ['catchup-1', 'catchup'],
      ['live-1', 'live'],
    ] as const) {
      outboxStore.insertPending({
        messageId,
        profileId: 'jobs',
        profileName: 'Jobs',
        sourceJid: 'source@newsletter',
        sourceName: 'Source',
        sourceType: 'CHANNEL',
        text: 'We are hiring a backend developer. Send your CV.',
        postedAt: Date.now(),
        score: 5,
        matchedCategories: ['techRole', 'hiringVerb'],
        origin,
      });
    }

    const sender = new OutboxSender(
      outboxStore,
      emailService as unknown as EmailService,
      statsStore,
      60_000,
    );
    await sender.drain();

    expect(emailService.sendAlert).toHaveBeenCalledTimes(1);
    expect(outboxStore.pendingRows().map((row) => row.messageId)).toEqual(['catchup-1']);

    outboxStore.close();
  });

  it('leaves rows pending while email is not set up', async () => {
    const db = new Database(':memory:');
    const outboxStore = new OutboxStore(db);
    const statsStore = new StatsStore(db);
    const emailService = {
      sendDigest: vi.fn(),
      sendAlert: vi.fn(),
      isConfigured: () => false,
    };
    outboxStore.insertPending({
      messageId: 'live-1',
      profileId: 'jobs',
      profileName: 'Jobs',
      sourceJid: 'source@g.us',
      sourceName: 'Source',
      sourceType: 'GROUP',
      text: 'We are hiring a backend developer.',
      postedAt: Date.now(),
      score: 5,
      matchedCategories: ['techRole'],
      origin: 'live',
    });

    const sender = new OutboxSender(outboxStore, emailService as unknown as EmailService, statsStore, 0);
    await sender.drain();

    expect(emailService.sendAlert).not.toHaveBeenCalled();
    expect(outboxStore.pendingRows()).toHaveLength(1);

    outboxStore.close();
  });

  it('runs the AI reviewer first and keeps email-off alerts in the app only', async () => {
    const db = new Database(':memory:');
    const outboxStore = new OutboxStore(db);
    const statsStore = new StatsStore(db);
    const emailService = { sendDigest: vi.fn(), sendAlert: vi.fn().mockResolvedValue(undefined), isConfigured: () => true };
    const base = {
      sourceJid: 'g@g.us',
      sourceName: 'Group',
      sourceType: 'GROUP' as const,
      text: 'Hiring',
      postedAt: Date.now(),
      score: 5,
      matchedCategories: [],
      origin: 'live' as const,
    };
    outboxStore.insertPending({ ...base, messageId: 'a', profileId: 'emailed', profileName: 'Emailed' });
    outboxStore.insertPending({ ...base, messageId: 'b', profileId: 'quiet', profileName: 'Quiet' });
    const reviewer = { run: vi.fn().mockResolvedValue(0) };

    const sender = new OutboxSender(outboxStore, emailService as unknown as EmailService, statsStore, 0, {
      reviewer,
      wantsEmail: (profileId) => profileId !== 'quiet',
    });
    await sender.drain();

    expect(reviewer.run).toHaveBeenCalledTimes(1);
    expect(emailService.sendAlert).toHaveBeenCalledTimes(1);
    const statuses = Object.fromEntries(outboxStore.recentRows().map((row) => [row.profileId, row.status]));
    expect(statuses).toEqual({ emailed: 'sent', quiet: 'in_app' });

    outboxStore.close();
  });
});
