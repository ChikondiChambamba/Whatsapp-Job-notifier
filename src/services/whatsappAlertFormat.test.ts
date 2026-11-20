import { describe, expect, it } from 'vitest';
import { formatWhatsAppAlert, formatWhatsAppDigest } from './whatsappAlertFormat.js';

const row = (overrides = {}) => ({
  profileName: 'Job vacancies',
  sourceName: 'Tech Jobs Malawi',
  sourceJid: 'g@g.us',
  text: 'We are hiring a backend developer. Send your CV.',
  aiReason: null as string | null,
  origin: 'live' as const,
  ...overrides,
});

describe('WhatsApp alert formatting', () => {
  it('formats a single alert', () => {
    expect(formatWhatsAppAlert(row({ aiReason: 'A developer vacancy.' }))).toBe(
      '🔔 *Job vacancies*\nFrom: Tech Jobs Malawi\n\nWe are hiring a backend developer. Send your CV.\n\n_AI: A developer vacancy._',
    );
  });

  it('marks catch-up alerts and strips formatting characters from names', () => {
    const text = formatWhatsAppAlert(row({ origin: 'catchup', sourceName: '*Jobs*_Group_' }));
    expect(text).toContain('(missed while offline)');
    expect(text).toContain('From: JobsGroup');
  });

  it('shortens very long posts', () => {
    const text = formatWhatsAppAlert(row({ text: 'x'.repeat(5000) }));
    expect(text.length).toBeLessThan(1600);
    expect(text.endsWith('…')).toBe(true);
  });

  it('combines a backlog into one digest with a cap', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ text: `Post ${i}\n\n\nmore` }));
    const text = formatWhatsAppDigest(rows);
    expect(text.startsWith('🔔 *12 matches posted while the app was offline*')).toBe(true);
    expect(text).toContain('Post 9\nmore');
    expect(text).not.toContain('Post 10');
    expect(text).toContain('…and 2 more.');
  });
});
