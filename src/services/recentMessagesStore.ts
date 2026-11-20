import { openDatabase, type Db } from './database.js';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 2000;
const PRUNE_EVERY = 100;

export interface RecentMessage {
  messageId: string;
  sourceJid: string;
  sourceName: string | null;
  text: string;
  postedAt: number;
}

interface Row {
  message_id: string;
  source_jid: string;
  source_name: string | null;
  text: string;
  posted_at: number;
}

/**
 * Keeps the last week of watched messages (capped) on this machine only, so
 * the app can show what a profile would have matched before it is saved.
 */
export class RecentMessagesStore {
  private readonly db: Db;
  private insertsSincePrune = 0;

  constructor(dbPathOrConnection?: string | Db) {
    this.db = openDatabase(dbPathOrConnection);
    this.prune();
  }

  add(message: RecentMessage): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO recent_messages
           (message_id, source_jid, source_name, text, posted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.messageId,
        message.sourceJid,
        message.sourceName,
        message.text,
        message.postedAt,
        Date.now(),
      );

    this.insertsSincePrune += 1;
    if (this.insertsSincePrune >= PRUNE_EVERY) {
      this.prune();
    }
  }

  list(limit = MAX_ROWS): RecentMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM recent_messages ORDER BY posted_at DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map((row) => ({
      messageId: row.message_id,
      sourceJid: row.source_jid,
      sourceName: row.source_name,
      text: row.text,
      postedAt: row.posted_at,
    }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM recent_messages').get() as { n: number }).n;
  }

  prune(now = Date.now()): void {
    this.insertsSincePrune = 0;
    this.db.prepare('DELETE FROM recent_messages WHERE posted_at < ?').run(now - MAX_AGE_MS);
    this.db
      .prepare(
        `DELETE FROM recent_messages WHERE message_id NOT IN (
           SELECT message_id FROM recent_messages ORDER BY posted_at DESC LIMIT ?
         )`,
      )
      .run(MAX_ROWS);
  }
}
