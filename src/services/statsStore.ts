import { openDatabase, type Db } from './database.js';

export interface RecordScoreEventInput {
  messageId: string;
  profileId: string;
  sourceJid: string;
  sourceName: string;
  sourceType: 'GROUP' | 'CHANNEL';
  score: number;
  matched: boolean;
  isLikelyBlast: boolean;
  /** The profile's required-group check passed. */
  eligible: boolean;
  matchedCategories: string[];
  createdAt?: number;
}

export interface ScoreStats {
  min: number | null;
  avg: number | null;
  max: number | null;
}

export interface DashboardStats {
  windowMs: number;
  totalScored: number;
  eligibleCount: number;
  eligiblePct: number;
  matchedCount: number;
  matchedPct: number;
  emailsSent: number;
  emailsFailed: number;
  blastSuppressedCount: number;
  categoryBreakdown: Record<string, number>;
  topSources: Array<{ sourceName: string; count: number }>;
  scoreStats: {
    matched: ScoreStats;
    unmatched: ScoreStats;
  };
  lastMessageAt: number | null;
}

interface CountRow {
  count: number;
}

interface CategoryRow {
  category: string;
  count: number;
}

interface SourceRow {
  sourceName: string;
  count: number;
}

interface ScoreStatsRow {
  min: number | null;
  avg: number | null;
  max: number | null;
}

interface LastMessageRow {
  lastMessageAt: number | null;
}

export class StatsStore {
  private readonly db: Db;

  constructor(dbPathOrConnection?: string | Db) {
    this.db = openDatabase(dbPathOrConnection);
  }

  recordScoreEvent(input: RecordScoreEventInput): number {
    const result = this.db
      .prepare(
        `
          INSERT INTO vacancy_events (
            message_id,
            profile_id,
            eligible,
            source_jid,
            source_name,
            source_type,
            score,
            matched,
            is_likely_blast,
            matched_categories,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.messageId,
        input.profileId,
        input.eligible ? 1 : 0,
        input.sourceJid,
        input.sourceName,
        input.sourceType.toLowerCase(),
        input.score,
        input.matched ? 1 : 0,
        input.isLikelyBlast ? 1 : 0,
        JSON.stringify(input.matchedCategories),
        input.createdAt ?? Date.now(),
      );

    return Number(result.lastInsertRowid);
  }

  recordEmailResult(eventId: number, sent: boolean, error?: string): void {
    this.db
      .prepare(
        `
          UPDATE vacancy_events
          SET email_sent = ?, email_error = ?
          WHERE id = ?
        `,
      )
      .run(sent ? 1 : 0, error ?? null, eventId);
  }

  getStats(windowMs: number): DashboardStats {
    const since = Date.now() - windowMs;
    const totalScored = this.count('SELECT COUNT(*) AS count FROM vacancy_events WHERE created_at >= ?', [
      since,
    ]);
    const matchedCount = this.count(
      'SELECT COUNT(*) AS count FROM vacancy_events WHERE created_at >= ? AND matched = 1',
      [since],
    );
    const eligibleCount = this.count(
      'SELECT COUNT(*) AS count FROM vacancy_events WHERE created_at >= ? AND eligible = 1',
      [since],
    );

    const emailsSent = this.count(
      'SELECT COUNT(*) AS count FROM vacancy_events WHERE created_at >= ? AND email_sent = 1',
      [since],
    );
    const emailsFailed = this.count(
      'SELECT COUNT(*) AS count FROM vacancy_events WHERE created_at >= ? AND email_sent = 0',
      [since],
    );
    const blastSuppressedCount = this.count(
      'SELECT COUNT(*) AS count FROM vacancy_events WHERE created_at >= ? AND is_likely_blast = 1',
      [since],
    );

    return {
      windowMs,
      totalScored,
      eligibleCount,
      eligiblePct: pct(eligibleCount, totalScored),
      matchedCount,
      matchedPct: pct(matchedCount, totalScored),
      emailsSent,
      emailsFailed,
      blastSuppressedCount,
      categoryBreakdown: this.categoryBreakdown(since),
      topSources: this.topSources(since),
      scoreStats: {
        matched: this.scoreStats(since, true),
        unmatched: this.scoreStats(since, false),
      },
      lastMessageAt: this.lastMessageAt(),
    };
  }

  close(): void {
    this.db.close();
  }

  private count(sql: string, params: unknown[]): number {
    const row = this.db.prepare(sql).get(...params) as CountRow | undefined;
    return row?.count ?? 0;
  }

  private categoryBreakdown(since: number): Record<string, number> {
    const rows = this.db
      .prepare(
        `
          SELECT json_each.value AS category, COUNT(*) AS count
          FROM vacancy_events, json_each(vacancy_events.matched_categories)
          WHERE vacancy_events.created_at >= ?
          GROUP BY json_each.value
          ORDER BY count DESC
        `,
      )
      .all(since) as CategoryRow[];

    return Object.fromEntries(rows.map((row) => [row.category, row.count]));
  }

  private topSources(since: number): Array<{ sourceName: string; count: number }> {
    return this.db
      .prepare(
        `
          SELECT COALESCE(NULLIF(source_name, ''), source_jid, 'unknown') AS sourceName,
                 COUNT(*) AS count
          FROM vacancy_events
          WHERE created_at >= ?
          GROUP BY sourceName
          ORDER BY count DESC, sourceName ASC
          LIMIT 5
        `,
      )
      .all(since) as SourceRow[];
  }

  private scoreStats(since: number, matched: boolean): ScoreStats {
    const row = this.db
      .prepare(
        `
          SELECT MIN(score) AS min, AVG(score) AS avg, MAX(score) AS max
          FROM vacancy_events
          WHERE created_at >= ? AND matched = ?
        `,
      )
      .get(since, matched ? 1 : 0) as ScoreStatsRow | undefined;

    return {
      min: row?.min ?? null,
      avg: row?.avg ?? null,
      max: row?.max ?? null,
    };
  }

  private lastMessageAt(): number | null {
    const row = this.db
      .prepare('SELECT MAX(created_at) AS lastMessageAt FROM vacancy_events')
      .get() as LastMessageRow | undefined;

    return row?.lastMessageAt ?? null;
  }
}

function pct(part: number, whole: number): number {
  if (whole === 0) {
    return 0;
  }

  return Math.round((part / whole) * 1000) / 10;
}
