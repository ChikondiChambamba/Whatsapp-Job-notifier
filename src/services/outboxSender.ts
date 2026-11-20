import { env } from '../config/env.js';
import type { AlertPayload } from '../interfaces/payload.js';
import type { EmailService } from './emailService.js';
import { logger } from './logger.js';
import type { OutboxRow, OutboxStore } from './outboxStore.js';
import type { StatsStore } from './statsStore.js';

const SEND_SPACING_MS = 1500;

export class OutboxSender {
  private draining = false;
  private periodicTimer: NodeJS.Timeout | undefined;
  private warnedUnconfigured = false;

  constructor(
    private readonly outboxStore: OutboxStore,
    private readonly emailService: Pick<EmailService, 'sendAlert' | 'sendDigest' | 'isConfigured'>,
    private readonly statsStore: StatsStore,
    private readonly catchupSettleMs = env.CATCHUP_SETTLE_MS,
  ) {}

  /**
   * Safety net: catch-up rows are never drained by the live path, and failed
   * sends stay pending, so drain on a fixed interval as well.
   */
  startPeriodicDrain(intervalMs = env.OUTBOX_DRAIN_INTERVAL_MS): void {
    this.stopPeriodicDrain();
    this.periodicTimer = setInterval(() => {
      void this.drain();
    }, intervalMs);
    this.periodicTimer.unref();
  }

  stopPeriodicDrain(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
  }

  async drain(): Promise<void> {
    if (this.draining) {
      logger.debug('outbox drain already running');
      return;
    }

    this.draining = true;
    try {
      await this.drainOnce();
    } catch (error) {
      logger.error({ error }, 'outbox drain failed unexpectedly');
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    const rows = this.outboxStore.pendingRows();
    if (rows.length === 0) {
      return;
    }

    // Leave rows pending until email is set up; they expire after the max age.
    if (!this.emailService.isConfigured()) {
      if (!this.warnedUnconfigured) {
        logger.warn({ pending: rows.length }, 'alerts waiting: email is not set up');
        this.warnedUnconfigured = true;
      }
      return;
    }
    this.warnedUnconfigured = false;

    const maxAgeMs = env.CATCHUP_MAX_AGE_HOURS * 60 * 60 * 1000;
    const freshRows: OutboxRow[] = [];

    for (const row of rows) {
      if (row.postedAt < Date.now() - maxAgeMs) {
        this.outboxStore.markExpired(row.id, 'older than catch-up max age');
        recordStatsResult(this.statsStore, row, false, 'expired before send');
      } else {
        freshRows.push(row);
      }
    }

    // Hold catch-up rows until they have settled so a reconnect backlog goes
    // out as one digest instead of being split by an early live drain.
    const settledBefore = Date.now() - this.catchupSettleMs;
    const catchupRows = freshRows.filter(
      (row) => row.origin === 'catchup' && row.createdAt <= settledBefore,
    );
    const liveRows = freshRows.filter((row) => row.origin === 'live');

    if (catchupRows.length >= env.CATCHUP_DIGEST_THRESHOLD) {
      await this.sendDigest(catchupRows);
    } else {
      for (const row of catchupRows) {
        await this.sendIndividual(row, '[Missed while offline]');
        await delay(SEND_SPACING_MS);
      }
    }

    for (const row of liveRows) {
      await this.sendIndividual(row);
      await delay(SEND_SPACING_MS);
    }
  }

  private async sendDigest(rows: OutboxRow[]): Promise<void> {
    try {
      await this.emailService.sendDigest(rows);
      this.outboxStore.markSent(rows.map((row) => row.id));
      for (const row of rows) {
        recordStatsResult(this.statsStore, row, true);
      }
      logger.info({ count: rows.length }, 'catch-up digest sent');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of rows) {
        this.outboxStore.markFailure(row.id, message);
        recordStatsResult(this.statsStore, row, false, message);
      }
      logger.error({ count: rows.length, error }, 'catch-up digest send failed');
    }
  }

  private async sendIndividual(row: OutboxRow, subjectPrefix?: string): Promise<void> {
    try {
      await this.emailService.sendAlert(toPayload(row), { subjectPrefix });
      this.outboxStore.markSent([row.id]);
      recordStatsResult(this.statsStore, row, true);
      logger.info({ outboxId: row.id, messageId: row.messageId }, 'outbox email sent');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outboxStore.markFailure(row.id, message);
      recordStatsResult(this.statsStore, row, false, message);
      logger.error({ outboxId: row.id, messageId: row.messageId, error }, 'outbox email failed');
    }
  }
}

function toPayload(row: OutboxRow): AlertPayload {
  return {
    messageId: row.messageId,
    profileId: row.profileId,
    profileName: row.profileName,
    sourceJid: row.sourceJid,
    sourceName: row.sourceName || row.sourceJid,
    sourceType: row.sourceType === 'group' ? 'GROUP' : 'CHANNEL',
    sender: row.sourceJid,
    rawText: row.text,
    timestamp: new Date(row.postedAt),
    origin: row.origin,
    matchedKeywords: row.matchedCategories,
    score: row.score,
  };
}

function recordStatsResult(
  statsStore: StatsStore,
  row: OutboxRow,
  sent: boolean,
  error?: string,
): void {
  if (row.statsEventId !== null) {
    statsStore.recordEmailResult(row.statsEventId, sent, error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
