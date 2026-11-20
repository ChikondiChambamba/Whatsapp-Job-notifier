import 'dotenv/config';
import { z } from 'zod';

const jidList = z
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

const envSchema = z
  .object({
    SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
    SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
    ALERT_EMAIL_TO: z.string().email('ALERT_EMAIL_TO must be a valid email address'),
    WATCHED_GROUP_JIDS: jidList,
    WATCHED_CHANNEL_JIDS: jidList,
    WATCHED_CHANNEL_LINKS: jidList,
    MATCH_THRESHOLD: z.coerce.number().int().min(1).default(4),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DRY_RUN: boolish,
    DASHBOARD_PORT: z.coerce.number().int().positive().default(4000),
    PROCESS_HISTORY_MESSAGES: boolish,
    HISTORY_LOOKBACK_HOURS: z.coerce.number().positive().default(24),
    HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    CATCHUP_MIN_GAP_MS: z.coerce.number().int().positive().default(120000),
    CATCHUP_MAX_AGE_HOURS: z.coerce.number().positive().default(72),
    CATCHUP_DIGEST_THRESHOLD: z.coerce.number().int().positive().default(3),
    CATCHUP_SETTLE_MS: z.coerce.number().int().positive().default(30000),
    OUTBOX_DRAIN_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  })
  .refine(
    (value) =>
      value.WATCHED_GROUP_JIDS.length > 0 ||
      value.WATCHED_CHANNEL_JIDS.length > 0 ||
      value.WATCHED_CHANNEL_LINKS.length > 0,
    'At least one watched group JID, channel JID, or channel link is required',
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `- ${issue.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
