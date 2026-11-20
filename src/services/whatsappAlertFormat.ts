import type { OutboxRow } from './outboxStore.js';

const MAX_SINGLE_CHARS = 1500;
const MAX_DIGEST_ENTRY_CHARS = 280;
const MAX_DIGEST_ENTRIES = 10;

type AlertRow = Pick<OutboxRow, 'profileName' | 'sourceName' | 'sourceJid' | 'text' | 'aiReason' | 'origin'>;

function shorten(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** WhatsApp formatting characters would garble names like *Jobs* or _Area_47_. */
function plain(value: string): string {
  return value.replace(/[*_~`]/g, '');
}

/** One alert as a WhatsApp message (uses WhatsApp's *bold* and _italic_). */
export function formatWhatsAppAlert(row: AlertRow): string {
  const header = `🔔 *${plain(row.profileName)}*${row.origin === 'catchup' ? ' (missed while offline)' : ''}`;
  const lines = [header, `From: ${plain(row.sourceName ?? row.sourceJid)}`, '', shorten(row.text, MAX_SINGLE_CHARS)];
  if (row.aiReason) {
    lines.push('', `_AI: ${plain(row.aiReason)}_`);
  }
  return lines.join('\n');
}

/** Several catch-up alerts as one message, so a backlog does not flood the chat. */
export function formatWhatsAppDigest(rows: AlertRow[]): string {
  const shown = rows.slice(0, MAX_DIGEST_ENTRIES);
  const parts = [`🔔 *${rows.length} matches posted while the app was offline*`];
  for (const row of shown) {
    parts.push(
      '',
      `*${plain(row.profileName)}* · ${plain(row.sourceName ?? row.sourceJid)}`,
      shorten(collapse(row.text), MAX_DIGEST_ENTRY_CHARS),
    );
  }
  if (rows.length > shown.length) {
    parts.push('', `…and ${rows.length - shown.length} more. Open the app to see them all.`);
  }
  return parts.join('\n');
}

function collapse(text: string): string {
  return text.replace(/\n\s*\n+/g, '\n');
}
