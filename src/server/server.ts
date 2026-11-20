import type { Server } from 'node:http';
import { env } from '../config/env.js';
import { logger } from '../services/logger.js';
import { createApp, type AppDeps } from './app.js';

/** Serve the API and web UI on loopback only. */
export function startServer(
  deps: AppDeps,
  port = env.DASHBOARD_PORT,
  hooks: { onListening?: (port: number) => void; onError?: (error: Error) => void } = {},
): Server {
  const app = createApp(deps);
  const server = app.listen(port, env.LISTEN_HOST, () => {
    logger.info({ port, host: env.LISTEN_HOST }, 'app listening on http://127.0.0.1:%d', port);
    hooks.onListening?.(port);
  });
  server.on('error', (error) => {
    logger.error({ error, port }, 'web server failed to start');
    hooks.onError?.(error);
  });
  return server;
}
