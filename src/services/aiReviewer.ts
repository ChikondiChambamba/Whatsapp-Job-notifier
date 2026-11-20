import { bus } from '../core/eventBus.js';
import { AiPermanentError, type AiChecker } from './aiChecker.js';
import { logger } from './logger.js';
import type { OutboxRow, OutboxStore } from './outboxStore.js';
import type { SettingsStore } from './settingsStore.js';

/** After this many temporary failures an alert is sent without the AI's opinion. */
export const MAX_REVIEW_ATTEMPTS = 3;

/**
 * Works through alerts waiting for an AI second opinion. Fails open: when the
 * AI cannot give an answer, the alert is sent anyway with a note, because a
 * missed alert costs the user more than an extra one.
 */
export class AiReviewer {
  private running = false;

  constructor(
    private readonly outboxStore: OutboxStore,
    private readonly settings: SettingsStore,
    private readonly checker: Pick<AiChecker, 'check' | 'isConfigured'>,
  ) {}

  /** Returns how many alerts were released for sending. */
  async run(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    let released = 0;
    try {
      for (const row of this.outboxStore.reviewRows()) {
        if (await this.review(row)) {
          released += 1;
        }
      }
    } catch (error) {
      logger.error({ error }, 'AI review run failed unexpectedly');
    } finally {
      this.running = false;
    }
    return released;
  }

  private async review(row: OutboxRow): Promise<boolean> {
    const released = await this.decide(row);
    if (released) {
      bus.emit('alert.ready', {
        profileName: row.profileName,
        sourceName: row.sourceName ?? row.sourceJid,
        text: row.text,
        origin: row.origin,
      });
    }
    return released;
  }

  /** Returns true when the alert was released for sending. */
  private async decide(row: OutboxRow): Promise<boolean> {
    const profile = this.settings.getProfile(row.profileId);

    // The check was turned off (or the key removed) after this alert was queued.
    if (!profile?.ai.enabled || !this.checker.isConfigured()) {
      this.outboxStore.markReviewed(row.id, 'pending', { relevant: null, reason: null });
      return true;
    }

    try {
      const verdict = await this.checker.check(profile.ai.description, {
        text: row.text,
        sourceName: row.sourceName ?? row.sourceJid,
      });
      this.outboxStore.markReviewed(row.id, verdict.relevant ? 'pending' : 'rejected', verdict);
      logger.info(
        { outboxId: row.id, profileId: row.profileId, relevant: verdict.relevant },
        'AI reviewed alert',
      );
      return verdict.relevant;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AiPermanentError) {
        this.release(row, message);
        return true;
      }
      const attempts = this.outboxStore.markReviewAttempt(row.id, message);
      logger.warn({ outboxId: row.id, attempts, error: message }, 'AI review attempt failed');
      if (attempts >= MAX_REVIEW_ATTEMPTS) {
        this.release(row, message);
        return true;
      }
      return false;
    }
  }

  private release(row: OutboxRow, problem: string): void {
    this.outboxStore.markReviewed(row.id, 'pending', {
      relevant: null,
      reason: `Sent without an AI check: ${problem}`,
    });
    logger.warn({ outboxId: row.id, problem }, 'alert released without AI check');
  }
}
