import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { getTemplate } from '../profiles/templates.js';
import { AiPermanentError, AiTemporaryError, type AiChecker } from './aiChecker.js';
import { AiReviewer, MAX_REVIEW_ATTEMPTS } from './aiReviewer.js';
import { OutboxStore } from './outboxStore.js';
import { SettingsStore } from './settingsStore.js';

function setup(check: ReturnType<typeof vi.fn>, aiEnabled = true) {
  const db = new Database(':memory:');
  const settings = new SettingsStore(db);
  const outbox = new OutboxStore(db);
  settings.saveProfile({
    ...getTemplate('blank')!.build(),
    id: 'nurses',
    name: 'Nursing jobs',
    groups: [{ id: 'what', label: 'What', weight: 2, terms: ['nurse'], required: true }],
    ai: { enabled: aiEnabled, description: 'Nursing vacancies in Lilongwe' },
  });
  const id = outbox.insertPending({
    messageId: 'm1',
    profileId: 'nurses',
    profileName: 'Nursing jobs',
    sourceJid: 'g@g.us',
    sourceName: 'Jobs',
    sourceType: 'GROUP',
    text: 'Hiring a nurse',
    postedAt: Date.now(),
    score: 2,
    matchedCategories: ['what'],
    origin: 'live',
    status: 'review',
  });
  const reviewer = new AiReviewer(outbox, settings, {
    check: check as unknown as AiChecker['check'],
    isConfigured: () => true,
  });
  const row = () => outbox.recentRows(1)[0]!;
  return { reviewer, row, id };
}

describe('AiReviewer', () => {
  it('releases relevant alerts with the reason', async () => {
    const { reviewer, row } = setup(vi.fn().mockResolvedValue({ relevant: true, reason: 'A nursing job.' }));
    expect(await reviewer.run()).toBe(1);
    expect(row()).toMatchObject({ status: 'pending', aiRelevant: true, aiReason: 'A nursing job.' });
  });

  it('holds back alerts the AI rejects', async () => {
    const { reviewer, row } = setup(vi.fn().mockResolvedValue({ relevant: false, reason: 'Job seeker.' }));
    expect(await reviewer.run()).toBe(0);
    expect(row()).toMatchObject({ status: 'rejected', aiRelevant: false, aiReason: 'Job seeker.' });
  });

  it('retries temporary failures, then sends without a verdict', async () => {
    const check = vi.fn().mockRejectedValue(new AiTemporaryError('network down'));
    const { reviewer, row } = setup(check);

    for (let i = 1; i < MAX_REVIEW_ATTEMPTS; i += 1) {
      await reviewer.run();
      expect(row().status).toBe('review');
    }
    await reviewer.run();

    expect(check).toHaveBeenCalledTimes(MAX_REVIEW_ATTEMPTS);
    expect(row()).toMatchObject({ status: 'pending', aiRelevant: null, attempts: 0 });
    expect(row().aiReason).toMatch(/without an AI check: network down/);
  });

  it('sends immediately on a permanent failure', async () => {
    const { reviewer, row } = setup(vi.fn().mockRejectedValue(new AiPermanentError('bad key')));
    expect(await reviewer.run()).toBe(1);
    expect(row().status).toBe('pending');
  });

  it('skips the AI when the profile no longer asks for it', async () => {
    const check = vi.fn();
    const { reviewer, row } = setup(check, false);
    await reviewer.run();
    expect(check).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ status: 'pending', aiReason: null });
  });
});
