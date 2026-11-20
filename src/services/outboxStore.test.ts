import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { OutboxStore } from './outboxStore.js';

describe('OutboxStore', () => {
  it('marks seen and queues a pending vacancy in one call', () => {
    const store = new OutboxStore(new Database(':memory:'));

    const [outboxId] = store.markSeenAndQueue('msg-1', [{
      messageId: 'msg-1',
      profileId: 'jobs',
      profileName: 'Jobs',
      sourceJid: 'source@newsletter',
      sourceName: 'Source',
      sourceType: 'CHANNEL',
      text: 'We are hiring a backend developer. Send your CV.',
      postedAt: Date.now(),
      score: 5,
      matchedCategories: ['techRole', 'hiringVerb'],
      origin: 'live',
      statsEventId: 10,
    }]);

    expect(outboxId).toBeGreaterThan(0);
    expect(store.hasSeen('msg-1')).toBe(true);
    expect(store.pendingRows()).toHaveLength(1);

    store.close();
  });

  it('tracks sent, failed and expired lifecycle states', () => {
    const store = new OutboxStore(new Database(':memory:'));
    const outboxId = store.insertPending({
      messageId: 'msg-2',
      profileId: 'jobs',
      profileName: 'Jobs',
      sourceJid: 'source@newsletter',
      sourceName: 'Source',
      sourceType: 'CHANNEL',
      text: 'Vacancy: Data Analyst with SQL. Apply now.',
      postedAt: Date.now(),
      score: 5,
      matchedCategories: ['techRole', 'techSkill'],
      origin: 'catchup',
    });

    store.markFailure(outboxId, 'smtp failed');
    expect(store.pendingRows()[0]?.attempts).toBe(1);

    store.markSent([outboxId]);
    expect(store.pendingRows()).toHaveLength(0);

    const expiredId = store.insertPending({
      messageId: 'msg-3',
      profileId: 'jobs',
      profileName: 'Jobs',
      sourceJid: 'source@newsletter',
      sourceName: 'Source',
      sourceType: 'CHANNEL',
      text: 'Vacancy: Civil Engineer. Apply now.',
      postedAt: Date.now(),
      score: 5,
      matchedCategories: ['civilRole'],
      origin: 'catchup',
    });
    store.markExpired(expiredId, 'too old');
    expect(store.pendingRows()).toHaveLength(0);

    store.close();
  });
});
