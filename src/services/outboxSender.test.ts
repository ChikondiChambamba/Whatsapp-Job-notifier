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
      sendVacancyAlert: vi.fn().mockResolvedValue(undefined),
    };

    for (let i = 0; i < 3; i += 1) {
      outboxStore.insertPending({
        messageId: `msg-${i}`,
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
    expect(emailService.sendVacancyAlert).not.toHaveBeenCalled();
    expect(outboxStore.pendingRows()).toHaveLength(0);

    outboxStore.close();
  });

  it('holds unsettled catch-up rows but still sends live rows', async () => {
    const db = new Database(':memory:');
    const outboxStore = new OutboxStore(db);
    const statsStore = new StatsStore(db);
    const emailService = {
      sendDigest: vi.fn().mockResolvedValue(undefined),
      sendVacancyAlert: vi.fn().mockResolvedValue(undefined),
    };

    for (const [messageId, origin] of [
      ['catchup-1', 'catchup'],
      ['live-1', 'live'],
    ] as const) {
      outboxStore.insertPending({
        messageId,
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

    expect(emailService.sendVacancyAlert).toHaveBeenCalledTimes(1);
    expect(outboxStore.pendingRows().map((row) => row.messageId)).toEqual(['catchup-1']);

    outboxStore.close();
  });
});
