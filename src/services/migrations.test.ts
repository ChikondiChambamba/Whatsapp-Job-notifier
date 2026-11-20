import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LEGACY_PROFILE_ID, migrate, SCHEMA_VERSION } from './migrations.js';

/** Builds a database exactly as the pre-profiles app left it (user_version 0). */
function legacyDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE seen_messages (message_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
    CREATE TABLE vacancy_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE,
      source_jid TEXT NOT NULL, source_name TEXT, source_type TEXT NOT NULL, text TEXT NOT NULL,
      posted_at INTEGER NOT NULL, score REAL NOT NULL, matched_categories TEXT, origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      created_at INTEGER NOT NULL, sent_at INTEGER, stats_event_id INTEGER
    );
    CREATE TABLE vacancy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, source_jid TEXT, source_name TEXT,
      source_type TEXT, score REAL NOT NULL, matched INTEGER NOT NULL, is_likely_blast INTEGER NOT NULL,
      matched_categories TEXT, email_sent INTEGER, email_error TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare(
    `INSERT INTO vacancy_outbox (message_id, source_jid, source_type, text, posted_at, score,
       matched_categories, origin, status, created_at)
     VALUES ('m1', 'g@g.us', 'group', 'We are hiring', 1, 5, '["techRole"]', 'live', 'pending', 2)`,
  ).run();
  db.prepare(
    `INSERT INTO vacancy_events (message_id, score, matched, is_likely_blast, matched_categories, created_at)
     VALUES ('m1', 5, 1, 0, '["techRole","hiringVerb"]', 1), ('m2', 2, 0, 0, '["hiringVerb"]', 1)`,
  ).run();
  db.prepare(`INSERT INTO bot_state VALUES ('last_online_at', '123')`).run();
  return db;
}

describe('migrate', () => {
  it('creates the full schema on an empty database', () => {
    const db = new Database(':memory:');
    migrate(db);

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining(['settings', 'sources', 'profiles', 'alert_outbox', 'vacancy_events']),
    );
    expect(tables).not.toContain('vacancy_outbox');
  });

  it('upgrades a legacy database without losing data', () => {
    const db = legacyDatabase();
    migrate(db);

    const outbox = db.prepare('SELECT * FROM alert_outbox').all() as Record<string, unknown>[];
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      message_id: 'm1',
      profile_id: LEGACY_PROFILE_ID,
      profile_name: 'Job vacancies',
      status: 'pending',
    });

    const events = db
      .prepare('SELECT message_id, profile_id, eligible FROM vacancy_events ORDER BY message_id')
      .all();
    expect(events).toEqual([
      { message_id: 'm1', profile_id: LEGACY_PROFILE_ID, eligible: 1 },
      { message_id: 'm2', profile_id: LEGACY_PROFILE_ID, eligible: 0 },
    ]);
    expect(db.prepare("SELECT value FROM bot_state WHERE key = 'last_online_at'").get()).toEqual({
      value: '123',
    });
  });

  it('is idempotent', () => {
    const db = legacyDatabase();
    migrate(db);
    migrate(db);

    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_outbox').get()).toEqual({ n: 1 });
  });

  it('refuses a database from a newer app version', () => {
    const db = new Database(':memory:');
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);

    expect(() => migrate(db)).toThrow(/newer/);
  });
});
