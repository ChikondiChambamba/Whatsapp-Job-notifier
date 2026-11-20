import type { SourceType } from '../interfaces/payload.js';
import { openDatabase, type Db } from './database.js';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type OutboxOrigin = 'live' | 'catchup';
/**
 * review   - waiting for the AI second opinion
 * pending  - ready to send
 * rejected - the AI said the match is not wanted (kept for the app's list)
 * in_app   - the alert's email delivery is off; shown in the app only
 */
export type OutboxStatus = 'review' | 'pending' | 'sent' | 'failed' | 'expired' | 'rejected' | 'in_app';

export interface QueueAlertInput {
  messageId: string;
  profileId: string;
  profileName: string;
  sourceJid: string;
  sourceName: string;
  sourceType: SourceType;
  text: string;
  postedAt: number;
  score: number;
  matchedCategories: string[];
  origin: OutboxOrigin;
  statsEventId?: number;
  /** 'review' when an AI check must run before sending. */
  status?: 'pending' | 'review';
}

export interface OutboxRow {
  id: number;
  messageId: string;
  profileId: string;
  profileName: string;
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
  aiRelevant: boolean | null;
  aiReason: string | null;
}

interface DbOutboxRow {
  id: number;
  message_id: string;
  profile_id: string;
  profile_name: string;
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
  ai_relevant: number | null;
  ai_reason: string | null;
}

interface CountRow {
  count: number;
}

export class OutboxStore {
  private readonly db: Db;

  constructor(dbPathOrConnection?: string | Db) {
    this.db = openDatabase(dbPathOrConnection);
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

  /** Mark a message seen and queue one alert per matched profile, atomically. */
  markSeenAndQueue(messageId: string, alerts: QueueAlertInput[] = []): number[] {
    return this.db.transaction(() => {
      this.markSeen(messageId);
      return alerts.map((alert) => this.insertPending(alert));
    })();
  }

  insertPending(input: QueueAlertInput): number {
    const result = this.db
      .prepare(
        `
          INSERT OR IGNORE INTO alert_outbox (
            message_id,
            profile_id,
            profile_name,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.messageId,
        input.profileId,
        input.profileName,
        input.sourceJid,
        input.sourceName,
        input.sourceType.toLowerCase(),
        input.text,
        input.postedAt,
        input.score,
        JSON.stringify(input.matchedCategories),
        input.origin,
        input.status ?? 'pending',
        Date.now(),
        input.statsEventId ?? null,
      );

    // An ignored duplicate leaves lastInsertRowid pointing at an unrelated row.
    return result.changes > 0 ? Number(result.lastInsertRowid) : 0;
  }

  pendingRows(): OutboxRow[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM alert_outbox
          WHERE status = 'pending'
          ORDER BY posted_at ASC, id ASC
        `,
      )
      .all() as DbOutboxRow[];

    return rows.map(mapRow);
  }

  reviewRows(): OutboxRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM alert_outbox WHERE status = 'review' ORDER BY posted_at ASC, id ASC`)
      .all() as DbOutboxRow[];
    return rows.map(mapRow);
  }

  /** Record the AI outcome and move the alert on ('pending' to send, 'rejected' to hold). */
  markReviewed(id: number, status: 'pending' | 'rejected', verdict: { relevant: boolean | null; reason: string | null }): void {
    this.db
      .prepare(
        `UPDATE alert_outbox SET status = ?, ai_relevant = ?, ai_reason = ?, attempts = 0, last_error = NULL
         WHERE id = ? AND status = 'review'`,
      )
      .run(status, verdict.relevant === null ? null : verdict.relevant ? 1 : 0, verdict.reason, id);
  }

  markReviewAttempt(id: number, error: string): number {
    this.db
      .prepare('UPDATE alert_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?')
      .run(error, id);
    return (this.db.prepare('SELECT attempts FROM alert_outbox WHERE id = ?').get(id) as { attempts: number } | undefined)
      ?.attempts ?? 0;
  }

  markInApp(ids: number[]): void {
    if (ids.length === 0) {
      return;
    }
    this.db
      .prepare(`UPDATE alert_outbox SET status = 'in_app' WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .run(...ids);
  }

  /** Most recent alerts in any state, newest first. */
  recentRows(limit = 50): OutboxRow[] {
    const rows = this.db
      .prepare('SELECT * FROM alert_outbox ORDER BY posted_at DESC, id DESC LIMIT ?')
      .all(limit) as DbOutboxRow[];
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
          UPDATE alert_outbox
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
          UPDATE alert_outbox
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
          UPDATE alert_outbox
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
          FROM alert_outbox
          WHERE origin = 'catchup' AND created_at >= ?
        `,
      )
      .get(since) as CountRow | undefined;

    return row?.count ?? 0;
  }

  pruneSent(now = Date.now()): void {
    this.db
      .prepare("DELETE FROM alert_outbox WHERE status = 'sent' AND sent_at < ?")
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
    profileId: row.profile_id,
    profileName: row.profile_name,
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
    aiRelevant: row.ai_relevant === null ? null : row.ai_relevant === 1,
    aiReason: row.ai_reason,
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
