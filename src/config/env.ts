import 'dotenv/config';
import { z } from 'zod';

const list = z
  .string()
  .optional()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const boolish = z
  .string()
  .optional()
  .default('false')
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()));

const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

/**
 * Technical/runtime settings. User-facing configuration (email, watched
 * sources, alert rules) lives in the settings database; the legacy keys
 * below are only read once to import an existing .env setup.
 */
const envSchema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(4000),
  PROCESS_HISTORY_MESSAGES: boolish,
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  CATCHUP_MIN_GAP_MS: z.coerce.number().int().positive().default(120000),
  CATCHUP_MAX_AGE_HOURS: z.coerce.number().positive().default(72),
  CATCHUP_DIGEST_THRESHOLD: z.coerce.number().int().positive().default(3),
  CATCHUP_SETTLE_MS: z.coerce.number().int().positive().default(30000),
  OUTBOX_DRAIN_INTERVAL_MS: z.coerce.number().int().positive().default(60000),

  // Legacy (imported once into the settings database).
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  ALERT_EMAIL_TO: optionalString,
  WATCHED_GROUP_JIDS: list,
  WATCHED_CHANNEL_JIDS: list,
  WATCHED_CHANNEL_LINKS: list,
  MATCH_THRESHOLD: z.coerce.number().int().min(1).default(4),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
