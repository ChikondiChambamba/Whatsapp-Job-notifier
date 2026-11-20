import type Database from 'better-sqlite3';

/** Profile id given to the rules that existed before profiles were introduced. */
export const LEGACY_PROFILE_ID = 'job-vacancies';
export const LEGACY_PROFILE_NAME = 'Job vacancies';

/** Categories that counted as the "field gate" in the original hard-coded rules. */
const LEGACY_FIELD_CATEGORIES = ['techRole', 'techSkill', 'civilRole', 'civilSkill'];

type Migration = (db: Database.Database) => void;

/**
 * Ordered schema migrations, tracked with PRAGMA user_version.
 * Index 0 brings a database to version 1, and so on. Never edit a released
 * migration; append a new one.
 */
const MIGRATIONS: Migration[] = [
  // v1: the original single-user schema (no-op on databases that already have it).
  (db) => {
    db.exec(`
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

      CREATE TABLE IF NOT EXISTS vacancy_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT,
        source_jid TEXT,
        source_name TEXT,
        source_type TEXT,
        score REAL NOT NULL,
        matched INTEGER NOT NULL,
        is_likely_blast INTEGER NOT NULL,
        matched_categories TEXT,
        email_sent INTEGER,
        email_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vacancy_events_created_at
        ON vacancy_events(created_at);

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
  },

  // v2: user-editable settings, sources and profiles; per-profile outbox and events.
  (db) => {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT UNIQUE,
        invite_link TEXT,
        name TEXT,
        type TEXT NOT NULL CHECK (type IN ('group', 'channel')),
        added_at INTEGER NOT NULL
      );

      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE alert_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
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
        stats_event_id INTEGER,
        UNIQUE (message_id, profile_id)
      );
      CREATE INDEX idx_alert_outbox_status ON alert_outbox(status, posted_at);

      ALTER TABLE vacancy_events ADD COLUMN profile_id TEXT;
      ALTER TABLE vacancy_events ADD COLUMN eligible INTEGER;
    `);

    // Everything recorded so far came from the original job rules.
    db.prepare('UPDATE vacancy_events SET profile_id = ? WHERE profile_id IS NULL').run(
      LEGACY_PROFILE_ID,
    );
    db.prepare(
      `
        UPDATE vacancy_events
        SET eligible = EXISTS (
          SELECT 1 FROM json_each(vacancy_events.matched_categories)
          WHERE value IN (${LEGACY_FIELD_CATEGORIES.map(() => '?').join(', ')})
        )
        WHERE eligible IS NULL
      `,
    ).run(...LEGACY_FIELD_CATEGORIES);

    db.prepare(
      `
        INSERT INTO alert_outbox (
          message_id, profile_id, profile_name, source_jid, source_name, source_type, text,
          posted_at, score, matched_categories, origin, status, attempts, last_error,
          created_at, sent_at, stats_event_id
        )
        SELECT
          message_id, ?, ?, source_jid, source_name, source_type, text,
          posted_at, score, matched_categories, origin, status, attempts, last_error,
          created_at, sent_at, stats_event_id
        FROM vacancy_outbox
      `,
    ).run(LEGACY_PROFILE_ID, LEGACY_PROFILE_NAME);
    db.exec('DROP TABLE vacancy_outbox');
  },

  // v3: short local buffer of watched messages, used to preview profile changes.
  (db) => {
    db.exec(`
      CREATE TABLE recent_messages (
        message_id TEXT PRIMARY KEY,
        source_jid TEXT NOT NULL,
        source_name TEXT,
        text TEXT NOT NULL,
        posted_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_recent_messages_posted_at ON recent_messages(posted_at);
    `);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (${SCHEMA_VERSION}). Update the app.`,
    );
  }

  for (let version = current; version < SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (!step) {
      break;
    }
    db.transaction(() => {
      step(db);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
