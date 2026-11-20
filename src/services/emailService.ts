import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import type { VacancyPayload } from '../interfaces/payload.js';
import { logger } from './logger.js';
import type { OutboxRow } from './outboxStore.js';

const MAX_ATTEMPTS = 3;

export interface SendAlertOptions {
  subjectPrefix?: string;
}

export class EmailService {
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  async sendVacancyAlert(payload: VacancyPayload, options: SendAlertOptions = {}): Promise<void> {
    const subject = `${options.subjectPrefix ?? '[Job Alert]'} ${payload.sourceName}`;
    const html = this.buildHtml(payload);

    await this.withRetry(async () => {
      await this.transporter.sendMail({
        from: `"WhatsApp Vacancy Bot" <${env.SMTP_USER}>`,
        to: env.ALERT_EMAIL_TO,
        subject,
        html,
      });
    }, payload.messageId);
  }

  async sendDigest(rows: OutboxRow[]): Promise<void> {
    const subject = `Catch-up: ${rows.length} vacancies posted while the bot was offline`;
    const html = `
      <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
        <h2>${escapeHtml(subject)}</h2>
        ${rows.map((row) => this.buildDigestEntry(row)).join('')}
      </div>
    `;

    await this.withRetry(async () => {
      await this.transporter.sendMail({
        from: `"WhatsApp Vacancy Bot" <${env.SMTP_USER}>`,
        to: env.ALERT_EMAIL_TO,
        subject,
        html,
      });
    }, `digest-${Date.now()}`);
  }

  private async withRetry(action: () => Promise<void>, messageId: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await action();
        logger.info({ messageId, attempt }, 'email alert sent');
        return;
      } catch (error) {
        lastError = error;
        logger.error({ messageId, attempt, error }, 'email alert failed');

        if (attempt < MAX_ATTEMPTS) {
          await delay(500 * 2 ** (attempt - 1));
        }
      }
    }

    throw lastError;
  }

  private buildHtml(payload: VacancyPayload): string {
    return `
      <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
        <h2>New job vacancy detected</h2>
        <p><strong>Source:</strong> ${escapeHtml(payload.sourceName)} (${payload.sourceType})</p>
        <p><strong>Sender:</strong> ${escapeHtml(payload.sender)}</p>
        <p><strong>Score:</strong> ${payload.score}</p>
        <p><strong>Matched terms:</strong> ${escapeHtml(payload.matchedKeywords.join(', '))}</p>
        <hr />
        <blockquote style="white-space: pre-wrap; border-left: 4px solid #2563eb; margin: 0; padding: 8px 12px; background: #f8fafc;">${escapeHtml(payload.rawText)}</blockquote>
        <hr />
        <small>Received at: ${payload.timestamp.toISOString()}</small>
      </div>
    `;
  }

  private buildDigestEntry(row: OutboxRow): string {
    return `
      <section style="border-top: 1px solid #ccc; padding: 14px 0;">
        <h3 style="margin: 0 0 8px;">${escapeHtml(row.sourceName || row.sourceJid)}</h3>
        <p style="margin: 0 0 6px;"><strong>Posted:</strong> ${escapeHtml(formatPostedAt(row.postedAt))}</p>
        <p style="margin: 0 0 6px;"><strong>Score:</strong> ${row.score}</p>
        <p style="margin: 0 0 10px;"><strong>Matched categories:</strong> ${escapeHtml(row.matchedCategories.join(', '))}</p>
        <div style="white-space: normal; border-left: 4px solid #2563eb; padding: 8px 12px; background: #f8fafc;">${escapeHtml(row.text).replaceAll('\n', '<br>')}</div>
      </section>
    `;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPostedAt(postedAt: number): string {
  const date = new Date(postedAt);
  const ageMs = Date.now() - postedAt;
  const minutes = Math.max(0, Math.floor(ageMs / 60000));
  const relative =
    minutes < 60 ? `${minutes} minutes ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;

  return `${relative} (${date.toLocaleString()})`;
}
