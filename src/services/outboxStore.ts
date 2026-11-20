import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { SourceType } from '../interfaces/payload.js';
import type { SignalCategory } from '../config/keywords.js';

const DEFAULT_DB_PATH = './data/seen_messages.db';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type OutboxOrigin = 'live' | 'catchup';
export type OutboxStatus = 'pending' | 'sent' | 'failed' | 'expired';

export interface QueueVacancyInput {
  messageId: string;
  sourceJid: string;
  sourceName: string;
  sourceType: SourceType;
  text: string;
  postedAt: number;
  score: number;
  matchedCategories: SignalCategory[];
  origin: OutboxOrigin;
  statsEventId?: number;
}

export interface OutboxRow {
  id: number;
  messageId: string;
  sourceJid: string;
  sourceName: string | null;
  sourceType: 'group' | 'channel';
  text: string;
  postedAt: number;
  score: number;
  matchedCategories: string[];
  origin: OutboxOrigin;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  sentAt: number | null;
  statsEventId: number | null;
}

interface DbOutboxRow {
  id: number;
  message_id: string;
  source_jid: string;
  source_name: string | null;
  source_type: 'group' | 'channel';
  text: string;
  posted_at: number;
  score: number;
  matched_categories: string | null;
  origin: OutboxOrigin;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
  stats_event_id: number | null;
}

interface CountRow {
  count: number;
}

export class OutboxStore {
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
      CREATE TABLE IF NOT EXISTS seen_messages (
        message_id TEXT PRIMARY KEY,
        seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vacancy_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        source_jid TEXT NOT NULL,
        source_name TEXT,
        source_type TEXT NOT NULL,
        text TEXT NOT NULL,
        posted_at INTEGER NOT NULL,
        score REAL NOT NULL,
        matched_categories TEXT,
        origin TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER,
        stats_event_id INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_status
        ON vacancy_outbox(status, posted_at);
    `);

    this.pruneSent();
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

  markSeenAndMaybeQueue(messageId: string, vacancy?: QueueVacancyInput): number | null {
    return this.db.transaction(() => {
      this.markSeen(messageId);
      if (!vacancy) {
        return null;
      }

      return this.insertPending(vacancy);
    })();
  }

  insertPending(input: QueueVacancyInput): number {
    const result = this.db
      .prepare(
        `
          INSERT OR IGNORE INTO vacancy_outbox (
            message_id,
            source_jid,
            source_name,
            source_type,
            text,
            posted_at,
            score,
            matched_categories,
            origin,
            status,
            created_at,
            stats_event_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `,
      )
      .run(
        input.messageId,
        input.sourceJid,
        input.sourceName,
        input.sourceType.toLowerCase(),
        input.text,
        input.postedAt,
        input.score,
        JSON.stringify(input.matchedCategories),
        input.origin,
        Date.now(),
        input.statsEventId ?? null,
      );

    return Number(result.lastInsertRowid);
  }

  pendingRows(): OutboxRow[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM vacancy_outbox
          WHERE status = 'pending'
          ORDER BY posted_at ASC, id ASC
        `,
      )
      .all() as DbOutboxRow[];

    return rows.map(mapRow);
  }

  markSent(ids: number[], sentAt = Date.now()): void {
    if (ids.length === 0) {
      return;
    }

    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(
        `
          UPDATE vacancy_outbox
          SET status = 'sent', sent_at = ?, last_error = NULL
          WHERE id IN (${placeholders})
        `,
      )
      .run(sentAt, ...ids);
  }

  markExpired(id: number, reason: string): void {
    this.db
      .prepare(
        `
          UPDATE vacancy_outbox
          SET status = 'expired', last_error = ?
          WHERE id = ?
        `,
      )
      .run(reason, id);
  }

  markFailure(id: number, error: string): void {
    this.db
      .prepare(
        `
          UPDATE vacancy_outbox
          SET attempts = attempts + 1,
              last_error = ?,
              status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
          WHERE id = ?
        `,
      )
      .run(error, id);
  }

  countCatchupCreatedSince(since: number): number {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM vacancy_outbox
          WHERE origin = 'catchup' AND created_at >= ?
        `,
      )
      .get(since) as CountRow | undefined;

    return row?.count ?? 0;
  }

  pruneSent(now = Date.now()): void {
    this.db
      .prepare("DELETE FROM vacancy_outbox WHERE status = 'sent' AND sent_at < ?")
      .run(now - THIRTY_DAYS_MS);
  }

  close(): void {
    this.db.close();
  }
}

function mapRow(row: DbOutboxRow): OutboxRow {
  return {
    id: row.id,
    messageId: row.message_id,
    sourceJid: row.source_jid,
    sourceName: row.source_name,
    sourceType: row.source_type,
    text: row.text,
    postedAt: row.posted_at,
    score: row.score,
    matchedCategories: parseCategories(row.matched_categories),
    origin: row.origin,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    statsEventId: row.stats_event_id,
  };
}

function parseCategories(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
