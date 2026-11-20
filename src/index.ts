import './config/env.js';
import { MessagePipeline } from './core/pipeline.js';
import { startDashboardServer } from './dashboard/server.js';
import { BotStateStore } from './services/botStateStore.js';
import { openDatabase } from './services/database.js';
import { EmailService } from './services/emailService.js';
import { importLegacyEnv } from './services/legacyImport.js';
import { logger } from './services/logger.js';
import { OutboxSender } from './services/outboxSender.js';
import { OutboxStore } from './services/outboxStore.js';
import { SettingsStore } from './services/settingsStore.js';
import { StatsStore } from './services/statsStore.js';
import { WhatsAppClient } from './whatsapp/client.js';

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});

const db = openDatabase();
const settings = new SettingsStore(db);
importLegacyEnv(settings);

const statsStore = new StatsStore(db);
const outboxStore = new OutboxStore(db);
const botStateStore = new BotStateStore(db);
const emailService = new EmailService(() => settings.getEmailSettings());
const outboxSender = new OutboxSender(outboxStore, emailService, statsStore);

new MessagePipeline({ settings, statsStore, outboxStore, outboxSender }).start();
startDashboardServer(statsStore);
void outboxSender.drain();
outboxSender.startPeriodicDrain();

logger.info(
  {
    profiles: settings.listProfiles().map((profile) => profile.name),
    sources: settings.listSources().length,
    emailConfigured: emailService.isConfigured(),
  },
  'configuration loaded',
);

const shutdown = (): void => {
  botStateStore.setNumber('last_online_at', Date.now());
  db.close();
  logger.info('bot shutdown recorded');
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

const client = new WhatsAppClient({ settings, stateStore: botStateStore, outboxStore, outboxSender });
void client.start().catch((error: unknown) => {
  logger.error({ error }, 'failed to start whatsapp client');
  process.exitCode = 1;
});
