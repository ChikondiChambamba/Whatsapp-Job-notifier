import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Everything the app writes lives under one data root so a desktop shell can
 * point it at the OS app-data folder. Defaults to the working directory, which
 * keeps the original ./data, ./auth_session and ./logs layout.
 */
const dataRoot = resolve(process.env.APP_DATA_DIR || '.');

export const paths = {
  dataRoot,
  database: join(dataRoot, 'data', 'seen_messages.db'),
  authSession: join(dataRoot, 'auth_session'),
  logs: join(dataRoot, 'logs'),
  /** Bundled static files, resolved relative to this module (works from src/ and dist/). */
  dashboardStatic: fileURLToPath(new URL('../../public/dashboard', import.meta.url)),
};
