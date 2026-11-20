import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { paths } from '../config/paths.js';

mkdirSync(paths.logs, { recursive: true });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['rawText', 'text'],
  },
  pino.destination({
    dest: join(paths.logs, 'bot.log'),
    mkdir: true,
    sync: false,
  }),
);

export const scoreLogger = pino(
  { level: 'debug' },
  pino.destination({
    dest: join(paths.logs, 'scored-messages.log'),
    mkdir: true,
    sync: false,
  }),
);
