import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { StatsStore } from './statsStore.js';

describe('StatsStore', () => {
  it('records score events and aggregates rolling stats', () => {
    const db = new Database(':memory:');
    const store = new StatsStore(db);
    const now = Date.now();

    store.recordScoreEvent({
      messageId: 'old',
      sourceJid: 'old@g.us',
      sourceName: 'Old Group',
      sourceType: 'GROUP',
      score: 5,
      matched: true,
      isLikelyBlast: false,
      matchedCategories: ['techRole', 'hiringVerb'],
      createdAt: now - 48 * 60 * 60 * 1000,
    });

    store.recordScoreEvent({
      messageId: 'eligible',
      sourceJid: 'source@g.us',
      sourceName: 'Tech Jobs',
      sourceType: 'GROUP',
      score: 3,
      matched: false,
      isLikelyBlast: false,
      matchedCategories: ['techSkill', 'hiringVerb'],
      createdAt: now - 1000,
    });

    store.recordScoreEvent({
      messageId: 'generic',
      sourceJid: 'source@g.us',
      sourceName: 'Tech Jobs',
      sourceType: 'GROUP',
      score: 3,
      matched: false,
      isLikelyBlast: true,
      matchedCategories: ['hiringVerb', 'applyInstruction', 'negative'],
      createdAt: now - 900,
    });

    const matchedEventId = store.recordScoreEvent({
      messageId: 'matched',
      sourceJid: 'channel@newsletter',
      sourceName: 'Channel Jobs',
      sourceType: 'CHANNEL',
      score: 5,
      matched: true,
      isLikelyBlast: false,
      matchedCategories: ['techRole', 'hiringVerb', 'applyInstruction'],
      createdAt: now - 500,
    });

    store.recordEmailResult(matchedEventId, true);

    const failedEventId = store.recordScoreEvent({
      messageId: 'failed-email',
      sourceJid: 'channel@newsletter',
      sourceName: 'Channel Jobs',
      sourceType: 'CHANNEL',
      score: 4,
      matched: true,
      isLikelyBlast: false,
      matchedCategories: ['civilRole', 'hiringVerb'],
      createdAt: now - 100,
    });

    store.recordEmailResult(failedEventId, false, 'smtp failed');

    const stats = store.getStats(24 * 60 * 60 * 1000);

    expect(stats.totalScored).toBe(4);
    expect(stats.eligibleCount).toBe(3);
    expect(stats.eligiblePct).toBe(75);
    expect(stats.matchedCount).toBe(2);
    expect(stats.matchedPct).toBe(50);
    expect(stats.emailsSent).toBe(1);
    expect(stats.emailsFailed).toBe(1);
    expect(stats.blastSuppressedCount).toBe(1);
    expect(stats.categoryBreakdown.techRole).toBe(1);
    expect(stats.categoryBreakdown.techSkill).toBe(1);
    expect(stats.categoryBreakdown.civilRole).toBe(1);
    expect(stats.topSources[0]).toEqual({ sourceName: 'Channel Jobs', count: 2 });
    expect(stats.scoreStats.matched.min).toBe(4);
    expect(stats.scoreStats.matched.max).toBe(5);
    expect(stats.scoreStats.unmatched.min).toBe(3);
    expect(stats.lastMessageAt).toBeGreaterThanOrEqual(now - 48 * 60 * 60 * 1000);

    store.close();
  });
});
