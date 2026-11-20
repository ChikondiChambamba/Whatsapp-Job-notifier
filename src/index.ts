import './config/env.js';
import { MessagePipeline } from './core/pipeline.js';
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
import { paths } from './config/paths.js';
import { RecentMessagesStore } from './services/recentMessagesStore.js';
import { AiChecker } from './services/aiChecker.js';
import { AiReviewer } from './services/aiReviewer.js';
import { startServer } from './server/server.js';

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
const aiChecker = new AiChecker(() => settings.getAiSettings());
const aiReviewer = new AiReviewer(outboxStore, settings, aiChecker);
const outboxSender = new OutboxSender(outboxStore, emailService, statsStore, undefined, {
  reviewer: aiReviewer,
  wantsEmail: (profileId) => settings.getProfile(profileId)?.alerts.email ?? true,
});
const recentMessages = new RecentMessagesStore(db);

new MessagePipeline({
  settings,
  statsStore,
  outboxStore,
  outboxSender,
  recentMessages,
  aiReady: () => aiChecker.isConfigured(),
}).start();
void outboxSender.drain();
outboxSender.startPeriodicDrain();

logger.info(
  {
    profiles: settings.listProfiles().map((profile) => profile.name),
    sources: settings.listSources().length,
    emailConfigured: emailService.isConfigured(),
    aiConfigured: aiChecker.isConfigured(),
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

startServer({
  settings,
  statsStore,
  outboxStore,
  recentMessages,
  whatsapp: client,
  sendTestEmail: (emailSettings) =>
    new EmailService(() => emailSettings).sendAlert({
      messageId: `test-${Date.now()}`,
      profileId: 'test',
      profileName: 'Test',
      sourceJid: 'test',
      sourceName: 'Test email',
      sourceType: 'GROUP',
      sender: 'test',
      rawText: 'Your email alerts are working. Matching WhatsApp messages will arrive like this.',
      matchedKeywords: [],
      score: 0,
      timestamp: new Date(),
      origin: 'live',
    }),
  aiChecker,
  webRoot: paths.webStatic,
});

void client.start().catch((error: unknown) => {
  logger.error({ error }, 'failed to start whatsapp client');
  process.exitCode = 1;
});
