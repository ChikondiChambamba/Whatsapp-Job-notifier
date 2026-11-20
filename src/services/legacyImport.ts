import { env } from '../config/env.js';
import { getTemplate } from '../profiles/templates.js';
import { logger } from './logger.js';
import type { SettingsStore } from './settingsStore.js';

const IMPORTED_KEY = 'legacy_env_imported_at';

type LegacyEnv = Pick<
  typeof env,
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_USER'
  | 'SMTP_PASS'
  | 'ALERT_EMAIL_TO'
  | 'WATCHED_GROUP_JIDS'
  | 'WATCHED_CHANNEL_JIDS'
  | 'WATCHED_CHANNEL_LINKS'
  | 'MATCH_THRESHOLD'
>;

export interface LegacyImportResult {
  imported: boolean;
  sources: number;
  email: boolean;
  profile: boolean;
}

/**
 * One-time import of the pre-profiles .env configuration into the settings
 * database. After it runs, .env values for email/sources/threshold are ignored.
 */
export function importLegacyEnv(
  settings: SettingsStore,
  legacy: LegacyEnv = env,
): LegacyImportResult {
  if (settings.getValue<number>(IMPORTED_KEY) !== null) {
    return { imported: false, sources: 0, email: false, profile: false };
  }

  let sources = 0;
  for (const jid of [...legacy.WATCHED_GROUP_JIDS, ...legacy.WATCHED_CHANNEL_JIDS]) {
    settings.addSource({ jid });
    sources += 1;
  }
  for (const link of legacy.WATCHED_CHANNEL_LINKS) {
    settings.addChannelLink(link);
    sources += 1;
  }

  let email = false;
  if (legacy.SMTP_HOST && legacy.SMTP_USER && legacy.SMTP_PASS && legacy.ALERT_EMAIL_TO) {
    settings.setEmailSettings({
      smtpHost: legacy.SMTP_HOST,
      smtpPort: legacy.SMTP_PORT,
      smtpUser: legacy.SMTP_USER,
      smtpPass: legacy.SMTP_PASS,
      to: legacy.ALERT_EMAIL_TO,
      fromName: 'WhatsApp Vacancy Bot',
    });
    email = true;
  }

  // Only an existing setup gets the job profile; new users start empty and
  // pick a template during setup.
  let profile = false;
  if (sources > 0 && settings.listProfiles().length === 0) {
    const template = getTemplate('job-vacancies');
    if (template) {
      settings.saveProfile(template.build({ threshold: legacy.MATCH_THRESHOLD }));
      profile = true;
    }
  }

  settings.setValue(IMPORTED_KEY, Date.now());
  const result = { imported: true, sources, email, profile };
  logger.info(result, 'legacy .env configuration imported into settings');
  return result;
}
