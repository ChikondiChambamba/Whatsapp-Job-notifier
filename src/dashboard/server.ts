import express from 'express';
import { env } from '../config/env.js';
import { paths } from '../config/paths.js';
import { logger } from '../services/logger.js';
import type { StatsStore } from '../services/statsStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function startDashboardServer(statsStore: StatsStore): void {
  const app = express();
  const staticRoot = paths.dashboardStatic;

  app.get('/api/stats', (_request, response) => {
    response.json(statsStore.getStats(DAY_MS));
  });

  app.use(express.static(staticRoot));

  app.listen(env.DASHBOARD_PORT, '127.0.0.1', () => {
    logger.info(
      { port: env.DASHBOARD_PORT },
      'dashboard listening on http://127.0.0.1:%d',
      env.DASHBOARD_PORT,
    );
  });
}
