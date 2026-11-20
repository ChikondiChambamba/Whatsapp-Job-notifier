import { openDatabase, type Db } from './database.js';

interface StateRow {
  value: string;
}

export class BotStateStore {
  private readonly db: Db;

  constructor(dbPathOrConnection?: string | Db) {
    this.db = openDatabase(dbPathOrConnection);
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
