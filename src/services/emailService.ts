import nodemailer from 'nodemailer';
import type { AlertPayload } from '../interfaces/payload.js';
import { logger } from './logger.js';
import type { OutboxRow } from './outboxStore.js';
import type { EmailSettings } from './settingsStore.js';

const MAX_ATTEMPTS = 3;

export interface SendAlertOptions {
  subjectPrefix?: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private transporterKey = '';

  /** Settings are read on every send so changes in the app apply immediately. */
  constructor(private readonly getSettings: () => EmailSettings | null) {}

  isConfigured(): boolean {
    return this.getSettings() !== null;
  }

  async sendAlert(payload: AlertPayload, options: SendAlertOptions = {}): Promise<void> {
    const subject = `${options.subjectPrefix ? `${options.subjectPrefix} ` : ''}[${payload.profileName}] ${payload.sourceName}`;
    await this.send(subject, this.buildHtml(payload), payload.messageId);
  }

  async sendDigest(rows: OutboxRow[]): Promise<void> {
    const subject = `Catch-up: ${rows.length} matches posted while the bot was offline`;
    const html = `
      <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
        <h2>${escapeHtml(subject)}</h2>
        ${rows.map((row) => this.buildDigestEntry(row)).join('')}
      </div>
    `;
    await this.send(subject, html, `digest-${Date.now()}`);
  }

  private async send(subject: string, html: string, messageId: string): Promise<void> {
    const settings = this.getSettings();
    if (!settings) {
      throw new Error('Email alerts are not set up');
    }

    const transporter = this.transporterFor(settings);
    await this.withRetry(async () => {
      await transporter.sendMail({
        from: `"${settings.fromName.replaceAll('"', '')}" <${settings.smtpUser}>`,
        to: settings.to,
        subject,
        html,
      });
    }, messageId);
  }

  private transporterFor(settings: EmailSettings): nodemailer.Transporter {
    const key = JSON.stringify([settings.smtpHost, settings.smtpPort, settings.smtpUser, settings.smtpPass]);
    if (!this.transporter || key !== this.transporterKey) {
      this.transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpPort === 465,
        auth: { user: settings.smtpUser, pass: settings.smtpPass },
      });
      this.transporterKey = key;
    }
    return this.transporter;
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

  private buildHtml(payload: AlertPayload): string {
    return `
      <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
        <h2>New match for "${escapeHtml(payload.profileName)}"</h2>
        <p><strong>Source:</strong> ${escapeHtml(payload.sourceName)} (${payload.sourceType})</p>
        <p><strong>Sender:</strong> ${escapeHtml(payload.sender)}</p>
        <p><strong>Score:</strong> ${payload.score}</p>
        <p><strong>Matched terms:</strong> ${escapeHtml(payload.matchedKeywords.join(', '))}</p>
        ${payload.aiReason ? `<p><strong>AI check:</strong> ${escapeHtml(payload.aiReason)}</p>` : ''}
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
        <p style="margin: 0 0 6px;"><strong>Alert:</strong> ${escapeHtml(row.profileName)}</p>
        <p style="margin: 0 0 6px;"><strong>Posted:</strong> ${escapeHtml(formatPostedAt(row.postedAt))}</p>
        <p style="margin: 0 0 6px;"><strong>Score:</strong> ${row.score}</p>
        <p style="margin: 0 0 10px;"><strong>Matched categories:</strong> ${escapeHtml(row.matchedCategories.join(', '))}</p>
        ${row.aiReason ? `<p style="margin: 0 0 10px;"><strong>AI check:</strong> ${escapeHtml(row.aiReason)}</p>` : ''}
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
