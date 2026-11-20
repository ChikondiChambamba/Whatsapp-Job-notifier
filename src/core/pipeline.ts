import type { IncomingMessage } from '../interfaces/payload.js';
import { RuleEngine } from '../profiles/ruleEngine.js';
import { logger } from '../services/logger.js';
import type { OutboxSender } from '../services/outboxSender.js';
import type { OutboxStore, QueueAlertInput } from '../services/outboxStore.js';
import type { SettingsStore } from '../services/settingsStore.js';
import type { StatsStore } from '../services/statsStore.js';
import { bus } from './eventBus.js';

export interface PipelineDeps {
  settings: SettingsStore;
  statsStore: StatsStore;
  outboxStore: OutboxStore;
  outboxSender: Pick<OutboxSender, 'drain'>;
  engine?: RuleEngine;
}

/** Scores each incoming message against every profile watching its source. */
export class MessagePipeline {
  private readonly engine: RuleEngine;

  constructor(private readonly deps: PipelineDeps) {
    this.engine = deps.engine ?? new RuleEngine();
  }

  start(): void {
    bus.on('message.received', (message) => {
      try {
        this.process(message);
      } catch (error) {
        logger.error({ error, messageId: message.messageId }, 'message processing failed');
      }
    });
  }

  /** Synchronous on purpose: the seen-check and mark-seen must not interleave. */
  process(message: IncomingMessage): void {
    const { settings, statsStore, outboxStore, outboxSender } = this.deps;

    if (outboxStore.hasSeen(message.messageId)) {
      logger.debug({ messageId: message.messageId }, 'duplicate message ignored');
      return;
    }

    const profiles = settings.profilesForSource(message.sourceJid);
    const alerts: QueueAlertInput[] = [];

    for (const profile of profiles) {
      const result = this.engine.score(profile, message.rawText);
      const matchedCategories = Object.keys(result.categoryHits);
      const eventId = statsStore.recordScoreEvent({
        messageId: message.messageId,
        profileId: profile.id,
        sourceJid: message.sourceJid,
        sourceName: message.sourceName,
        sourceType: message.sourceType,
        score: result.score,
        matched: result.matched,
        isLikelyBlast: result.isLikelyBlast,
        eligible: result.gatePassed,
        matchedCategories,
      });

      logger.info(
        {
          eventId,
          messageId: message.messageId,
          profileId: profile.id,
          sourceName: message.sourceName,
          score: result.score,
          matched: result.matched,
        },
        'message scored',
      );

      if (result.matched) {
        alerts.push({
          messageId: message.messageId,
          profileId: profile.id,
          profileName: profile.name,
          sourceJid: message.sourceJid,
          sourceName: message.sourceName,
          sourceType: message.sourceType,
          text: message.rawText,
          postedAt: message.timestamp.getTime(),
          score: result.score,
          matchedCategories,
          origin: message.origin,
          statsEventId: eventId,
        });
      }
    }

    if (profiles.length === 0) {
      logger.debug({ sourceJid: message.sourceJid }, 'no enabled profile watches this source');
    }

    outboxStore.markSeenAndQueue(message.messageId, alerts);

    // Catch-up alerts are drained after the settle window (or by the periodic drain).
    if (alerts.length > 0 && message.origin === 'live') {
      void outboxSender.drain();
    }
  }
}
