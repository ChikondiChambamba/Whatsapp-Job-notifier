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

  describe('WhatsApp delivery', () => {
    const base = {
      sourceJid: 'g@g.us',
      sourceName: 'Group',
      sourceType: 'GROUP' as const,
      text: 'Hiring a developer',
      score: 5,
      matchedCategories: [],
    };

    function setupWhatsApp(ready: boolean, send = vi.fn().mockResolvedValue(undefined)) {
      const db = new Database(':memory:');
      const outboxStore = new OutboxStore(db);
      const emailService = { sendDigest: vi.fn().mockResolvedValue(undefined), sendAlert: vi.fn().mockResolvedValue(undefined), isConfigured: () => true };
      const state = { ready };
      const sender = new OutboxSender(outboxStore, emailService as unknown as EmailService, new StatsStore(db), 0, {
        wantsEmail: (profileId) => profileId !== 'wa-only',
        whatsapp: { wants: (profileId) => profileId !== 'email-only', isReady: () => state.ready, send },
        spacingMs: 0,
      });
      return { outboxStore, emailService, sender, send, state };
    }

    it('sends email and WhatsApp independently', async () => {
      const { outboxStore, emailService, sender, send } = setupWhatsApp(true);
      for (const profileId of ['both', 'wa-only', 'email-only']) {
        outboxStore.insertPending({ ...base, messageId: profileId, profileId, profileName: profileId, postedAt: Date.now(), origin: 'live' });
      }

      await sender.drain();

      expect(emailService.sendAlert).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(2);
      const rows = Object.fromEntries(outboxStore.recentRows().map((row) => [row.profileId, [row.status, row.waState]]));
      expect(rows).toEqual({ both: ['sent', 'sent'], 'wa-only': ['in_app', 'sent'], 'email-only': ['sent', null] });
    });

    it('waits for WhatsApp to connect, then sends', async () => {
      const { outboxStore, sender, send, state } = setupWhatsApp(false);
      outboxStore.insertPending({ ...base, messageId: 'm', profileId: 'wa-only', profileName: 'Jobs', postedAt: Date.now(), origin: 'live' });

      await sender.drain();
      expect(send).not.toHaveBeenCalled();
      expect(outboxStore.recentRows()[0]?.waState).toBe('pending');

      state.ready = true;
      await sender.drain();
      expect(send).toHaveBeenCalledTimes(1);
      expect(outboxStore.recentRows()[0]?.waState).toBe('sent');
    });

    it('combines a catch-up backlog into one WhatsApp message', async () => {
      const { outboxStore, sender, send } = setupWhatsApp(true);
      for (let i = 0; i < 4; i += 1) {
        outboxStore.insertPending({ ...base, messageId: `c${i}`, profileId: 'wa-only', profileName: 'Jobs', postedAt: Date.now(), origin: 'catchup' });
      }

      await sender.drain();

      expect(send).toHaveBeenCalledTimes(1);
      expect(String(send.mock.calls[0]?.[0])).toContain('4 matches posted while the app was offline');
    });

    it('retries failed WhatsApp sends without re-sending email', async () => {
      const send = vi.fn().mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(undefined);
      const { outboxStore, emailService, sender } = setupWhatsApp(true, send);
      outboxStore.insertPending({ ...base, messageId: 'm', profileId: 'both', profileName: 'Jobs', postedAt: Date.now(), origin: 'live' });

      await sender.drain();
      expect(outboxStore.recentRows()[0]).toMatchObject({ status: 'sent', waState: 'pending', waAttempts: 1, waError: 'socket closed' });

      await sender.drain();
      expect(outboxStore.recentRows()[0]?.waState).toBe('sent');
      expect(emailService.sendAlert).toHaveBeenCalledTimes(1);
    });
  });
});
