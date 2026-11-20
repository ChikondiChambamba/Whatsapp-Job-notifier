import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export class DedupeStore {
  private readonly db: Database.Database;

  constructor(dbPath = './data/seen_messages.db') {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_messages (
        message_id TEXT PRIMARY KEY,
        seen_at INTEGER NOT NULL
      )
    `);
    this.prune();
  }

  isDuplicate(messageId: string): boolean {
    if (this.hasSeen(messageId)) {
      return true;
    }

    this.markSeen(messageId);
    return false;
  }

  hasSeen(messageId: string): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM seen_messages WHERE message_id = ?').get(messageId),
    );
  }

  markSeen(messageId: string, seenAt = Date.now()): void {
    this.db
      .prepare('INSERT OR IGNORE INTO seen_messages (message_id, seen_at) VALUES (?, ?)')
      .run(messageId, seenAt);
  }

  prune(now = Date.now()): void {
    this.db.prepare('DELETE FROM seen_messages WHERE seen_at < ?').run(now - FOURTEEN_DAYS_MS);
  }

  close(): void {
    this.db.close();
  }
}
