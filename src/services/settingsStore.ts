import { z } from 'zod';
import { profileSchema, type ProfileInput, type StoredProfile } from '../profiles/types.js';
import { AI_MODELS, DEFAULT_AI_MODEL, type AiSettings } from './aiChecker.js';
import { openDatabase, type Db } from './database.js';

export const emailSettingsSchema = z.object({
  smtpHost: z.string().trim().min(1, 'SMTP server is required'),
  smtpPort: z.number().int().positive().default(587),
  smtpUser: z.string().trim().min(1, 'SMTP username is required'),
  smtpPass: z.string().min(1, 'SMTP password is required'),
  to: z.string().trim().email('Enter a valid email address'),
  fromName: z.string().trim().min(1).default('WhatsApp Alerts'),
});

export type EmailSettings = z.infer<typeof emailSettingsSchema>;

const modelIds = AI_MODELS.map((model) => model.id) as [AiSettings['model'], ...AiSettings['model'][]];

export const aiSettingsSchema = z.object({
  apiKey: z.string().trim().min(1, 'Paste your Anthropic API key'),
  model: z.enum(modelIds).default(DEFAULT_AI_MODEL),
});
export type EmailSettingsInput = z.input<typeof emailSettingsSchema>;

export type SourceKind = 'group' | 'channel';

export interface Source {
  id: number;
  /** null for a channel link that has not been resolved yet. */
  jid: string | null;
  inviteLink: string | null;
  name: string | null;
  type: SourceKind;
  addedAt: number;
}

interface SourceRow {
  id: number;
  jid: string | null;
  invite_link: string | null;
  name: string | null;
  type: SourceKind;
  added_at: number;
}

interface ProfileRow {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
}

const EMAIL_KEY = 'email';
const AI_KEY = 'ai';

/**
 * User-editable configuration: alert email settings, watched sources and
 * alert profiles. Reads are cached in memory and invalidated on writes, so
 * per-message lookups don't hit SQLite.
 */
export class SettingsStore {
  private readonly db: Db;
  private sourcesCache: Source[] | null = null;
  private profilesCache: StoredProfile[] | null = null;

  constructor(dbPathOrConnection?: string | Db) {
    this.db = openDatabase(dbPathOrConnection);
  }

  // ---- generic key/value ----

  getValue<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) {
      return null;
    }
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  setValue(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  }

  // ---- email ----

  getEmailSettings(): EmailSettings | null {
    const parsed = emailSettingsSchema.safeParse(this.getValue(EMAIL_KEY));
    return parsed.success ? parsed.data : null;
  }

  setEmailSettings(input: EmailSettingsInput): EmailSettings {
    const settings = emailSettingsSchema.parse(input);
    this.setValue(EMAIL_KEY, settings);
    return settings;
  }

  // ---- AI ----

  getAiSettings(): AiSettings | null {
    const parsed = aiSettingsSchema.safeParse(this.getValue(AI_KEY));
    return parsed.success ? parsed.data : null;
  }

  setAiSettings(input: z.input<typeof aiSettingsSchema>): AiSettings {
    const settings = aiSettingsSchema.parse(input);
    this.setValue(AI_KEY, settings);
    return settings;
  }

  clearAiSettings(): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(AI_KEY);
  }

  // ---- sources ----

  listSources(): Source[] {
    if (!this.sourcesCache) {
      const rows = this.db.prepare('SELECT * FROM sources ORDER BY added_at, id').all() as SourceRow[];
      this.sourcesCache = rows.map(mapSource);
    }
    return this.sourcesCache;
  }

  isWatched(jid: string): boolean {
    return this.listSources().some((source) => source.jid === jid);
  }

  sourceName(jid: string): string | null {
    return this.listSources().find((source) => source.jid === jid)?.name ?? null;
  }

  /** Watched sources whose display name is still unknown. */
  unnamedSources(): Source[] {
    return this.listSources().filter((source) => source.jid && !source.name);
  }

  watchedChannelJids(): string[] {
    return this.listSources()
      .filter((source) => source.type === 'channel' && source.jid)
      .map((source) => source.jid as string);
  }

  unresolvedChannelLinks(): Source[] {
    return this.listSources().filter((source) => !source.jid && source.inviteLink);
  }

  /** Add a group/channel by JID; returns the existing row if already watched. */
  addSource(input: { jid: string; name?: string | null; type?: SourceKind }): Source {
    const type = input.type ?? kindForJid(input.jid);
    this.db
      .prepare(
        `INSERT INTO sources (jid, name, type, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET name = COALESCE(excluded.name, sources.name)`,
      )
      .run(input.jid, input.name ?? null, type, Date.now());
    this.sourcesCache = null;
    return this.listSources().find((source) => source.jid === input.jid) as Source;
  }

  addChannelLink(inviteLink: string): Source {
    const existing = this.listSources().find((source) => source.inviteLink === inviteLink);
    if (existing) {
      return existing;
    }
    const result = this.db
      .prepare(`INSERT INTO sources (invite_link, type, added_at) VALUES (?, 'channel', ?)`)
      .run(inviteLink, Date.now());
    this.sourcesCache = null;
    return this.listSources().find((source) => source.id === Number(result.lastInsertRowid)) as Source;
  }

  /** Record the JID a channel link resolved to. Merges into an existing row for that JID. */
  resolveChannelLink(sourceId: number, jid: string, name: string | null): void {
    this.db.transaction(() => {
      const duplicate = this.db.prepare('SELECT id FROM sources WHERE jid = ?').get(jid) as
        | { id: number }
        | undefined;
      if (duplicate && duplicate.id !== sourceId) {
        this.db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
        if (name) {
          this.db
            .prepare('UPDATE sources SET name = COALESCE(name, ?) WHERE id = ?')
            .run(name, duplicate.id);
        }
        return;
      }
      this.db
        .prepare('UPDATE sources SET jid = ?, name = COALESCE(?, name) WHERE id = ?')
        .run(jid, name, sourceId);
    })();
    this.sourcesCache = null;
  }

  removeSource(id: number): void {
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    this.sourcesCache = null;
  }

  // ---- profiles ----

  listProfiles(): StoredProfile[] {
    if (!this.profilesCache) {
      const rows = this.db
        .prepare('SELECT * FROM profiles ORDER BY position, created_at')
        .all() as ProfileRow[];
      this.profilesCache = rows.flatMap((row) => {
        const parsed = profileSchema.safeParse({ ...safeJson(row.data), id: row.id });
        return parsed.success
          ? [{ ...parsed.data, createdAt: row.created_at, updatedAt: row.updated_at }]
          : [];
      });
    }
    return this.profilesCache;
  }

  getProfile(id: string): StoredProfile | undefined {
    return this.listProfiles().find((profile) => profile.id === id);
  }

  /** Enabled profiles that watch the given source. */
  profilesForSource(jid: string): StoredProfile[] {
    return this.listProfiles().filter(
      (profile) =>
        profile.enabled &&
        (profile.sources.mode === 'all' || profile.sources.jids.includes(jid)),
    );
  }

  saveProfile(input: ProfileInput): StoredProfile {
    const profile = profileSchema.parse(input);
    const now = Date.now();
    const existing = this.db.prepare('SELECT updated_at FROM profiles WHERE id = ?').get(profile.id) as
      | { updated_at: number }
      | undefined;
    // Strictly increasing so the rule engine cache always notices the change.
    const updatedAt = existing ? Math.max(now, existing.updated_at + 1) : now;
    const { id, ...data } = profile;

    this.db
      .prepare(
        `INSERT INTO profiles (id, data, position, created_at, updated_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM profiles), ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(id, JSON.stringify(data), now, updatedAt);
    this.profilesCache = null;
    return this.getProfile(id) as StoredProfile;
  }

  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    this.profilesCache = null;
  }

  close(): void {
    this.db.close();
  }
}

export function kindForJid(jid: string): SourceKind {
  return jid.endsWith('@newsletter') ? 'channel' : 'group';
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    jid: row.jid,
    inviteLink: row.invite_link,
    name: row.name,
    type: row.type,
    addedAt: row.added_at,
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
