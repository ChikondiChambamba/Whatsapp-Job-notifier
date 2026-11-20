import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

const DEFAULT_DB_PATH = './data/seen_messages.db';

interface StateRow {
  value: string;
}

export class BotStateStore {
  private readonly db: Database.Database;

  constructor(dbPathOrConnection: string | Database.Database = DEFAULT_DB_PATH) {
    if (typeof dbPathOrConnection === 'string') {
      if (dbPathOrConnection !== ':memory:') {
        mkdirSync(dirname(dbPathOrConnection), { recursive: true });
      }
      this.db = new Database(dbPathOrConnection);
    } else {
      this.db = dbPathOrConnection;
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS downtime_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        recovered_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  getNumber(key: string): number | null {
    const row = this.db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as
      | StateRow
      | undefined;
    if (!row) {
      return null;
    }

    const value = Number(row.value);
    return Number.isFinite(value) ? value : null;
  }

  setNumber(key: string, value: number): void {
    this.db
      .prepare(
        `
          INSERT INTO bot_state (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `,
      )
      .run(key, String(value));
  }

  recordDowntimeWindow(startedAt: number, endedAt: number, recoveredCount: number): void {
    this.db
      .prepare(
        `
          INSERT INTO downtime_windows (started_at, ended_at, recovered_count)
          VALUES (?, ?, ?)
        `,
      )
      .run(startedAt, endedAt, recoveredCount);
  }

  close(): void {
    this.db.close();
  }
}
