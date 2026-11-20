import './config/env.js';
import { MessagePipeline } from './core/pipeline.js';
import { startDashboardServer } from './dashboard/server.js';
import { logger } from './services/logger.js';
import { FilterEngine } from './services/filterEngine.js';
import { OutboxSender } from './services/outboxSender.js';
import { OutboxStore } from './services/outboxStore.js';
import { StatsStore } from './services/statsStore.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { BotStateStore } from './services/botStateStore.js';

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});

const statsStore = new StatsStore();
const outboxStore = new OutboxStore();
const outboxSender = new OutboxSender(outboxStore, undefined, statsStore);
const botStateStore = new BotStateStore();
const pipeline = new MessagePipeline(new FilterEngine(), statsStore, outboxStore, outboxSender);
pipeline.start();
startDashboardServer(statsStore);
void outboxSender.drain();
outboxSender.startPeriodicDrain();

const shutdown = (): void => {
  botStateStore.setNumber('last_online_at', Date.now());
  outboxStore.close();
  botStateStore.close();
  logger.info('bot shutdown recorded');
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

const client = new WhatsAppClient(botStateStore, outboxStore, outboxSender);
void client.start().catch((error: unknown) => {
  logger.error({ error }, 'failed to start whatsapp client');
  process.exitCode = 1;
});
