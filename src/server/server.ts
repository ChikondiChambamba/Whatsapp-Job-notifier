import type { Server } from 'node:http';
import { env } from '../config/env.js';
import { logger } from '../services/logger.js';
import { createApp, type AppDeps } from './app.js';

/** Serve the API and web UI on loopback only. */
export function startServer(deps: AppDeps, port = env.DASHBOARD_PORT): Server {
  const app = createApp(deps);
  return app.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'app listening on http://127.0.0.1:%d', port);
  });
}
