import { mkdirSync } from 'node:fs';
import pino from 'pino';
mkdirSync('logs', { recursive: true });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['rawText', 'text'],
  },
  pino.destination({
    dest: 'logs/bot.log',
    mkdir: true,
    sync: false,
  }),
);

export const scoreLogger = pino(
  { level: 'debug' },
  pino.destination({
    dest: 'logs/scored-messages.log',
    mkdir: true,
    sync: false,
  }),
);
