import { bus } from './eventBus.js';
import { FilterEngine } from '../services/filterEngine.js';
import { StatsStore } from '../services/statsStore.js';
import type { RawVacancyMessage } from '../interfaces/payload.js';
import { logger } from '../services/logger.js';
import { OutboxStore } from '../services/outboxStore.js';
import { OutboxSender } from '../services/outboxSender.js';
import type { SignalCategory } from '../config/keywords.js';

export class MessagePipeline {
  constructor(
    private readonly filterEngine = new FilterEngine(),
    private readonly statsStore = new StatsStore(),
    private readonly outboxStore = new OutboxStore(),
    private readonly outboxSender = new OutboxSender(outboxStore, undefined, statsStore),
  ) {}

  start(): void {
    bus.on('vacancy.raw', (message) => {
      void this.process(message);
    });
  }

  async process(message: RawVacancyMessage): Promise<void> {
    if (this.outboxStore.hasSeen(message.messageId)) {
      logger.debug({ messageId: message.messageId }, 'duplicate message ignored');
      return;
    }

    const result = this.filterEngine.score(message.rawText);
    const matchedCategories = Object.keys(result.categoryHits) as SignalCategory[];
    const eventId = this.statsStore.recordScoreEvent({
      messageId: message.messageId,
      sourceJid: message.sourceJid,
      sourceName: message.sourceName,
      sourceType: message.sourceType,
      score: result.score,
      matched: result.matched,
      isLikelyBlast: result.isLikelyBlast,
      matchedCategories,
    });

    const outboxId = this.outboxStore.markSeenAndMaybeQueue(
      message.messageId,
      result.matched
        ? {
            messageId: message.messageId,
            sourceJid: message.sourceJid,
            sourceName: message.sourceName,
            sourceType: message.sourceType,
            text: message.rawText,
            postedAt: message.timestamp.getTime(),
            score: result.score,
            matchedCategories,
            origin: message.origin,
            statsEventId: eventId,
          }
        : undefined,
    );

    logger.info(
      {
        eventId,
        outboxId,
        messageId: message.messageId,
        sourceType: message.sourceType,
        sourceName: message.sourceName,
        score: result.score,
        matched: result.matched,
      },
      'message scored',
    );

    if (!result.matched) {
      return;
    }

    if (message.origin === 'live') {
      void this.outboxSender.drain();
    }
  }
}
