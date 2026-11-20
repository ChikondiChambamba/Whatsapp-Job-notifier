import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  type MessageUpsertType,
  type WAMessage,
  type WASocket,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { rm } from 'node:fs/promises';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { paths } from '../config/paths.js';
import { bus } from '../core/eventBus.js';
import type { IncomingMessage, SourceType } from '../interfaces/payload.js';
import type { BotStateStore } from '../services/botStateStore.js';
import { logger } from '../services/logger.js';
import type { OutboxSender } from '../services/outboxSender.js';
import type { OutboxStore } from '../services/outboxStore.js';
import type { SettingsStore } from '../services/settingsStore.js';
import { ChannelResolver } from './channelResolver.js';
import { fetchNewsletterMessagesSince } from './newsletterMessages.js';

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

export type LinkState =
  | 'starting'
  | 'waiting_for_scan'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

export interface WhatsAppStatus {
  state: LinkState;
  /** Raw QR payload while waiting for a scan. */
  qr: string | null;
  account: { jid: string; name: string | null } | null;
  lastConnectedAt: number | null;
}

export interface GroupInfo {
  jid: string;
  name: string;
  participants: number;
}

export interface ChannelInfo {
  jid: string;
  name: string;
}

export class NotConnectedError extends Error {
  constructor() {
    super('WhatsApp is not connected');
  }
}

export interface WhatsAppClientDeps {
  settings: SettingsStore;
  stateStore: BotStateStore;
  outboxStore: OutboxStore;
  outboxSender: Pick<OutboxSender, 'drain'>;
  resolver?: ChannelResolver;
}

export class WhatsAppClient {
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private acceptedSinceMs = Date.now() - env.CATCHUP_MAX_AGE_HOURS * 60 * 60 * 1000;
  private connectionOpenedAt = Date.now();
  private readonly settings: SettingsStore;
  private readonly stateStore: BotStateStore;
  private readonly outboxStore: OutboxStore;
  private readonly outboxSender: Pick<OutboxSender, 'drain'>;
  private readonly resolver: ChannelResolver;
  private sock: WASocket | null = null;
  private status: WhatsAppStatus = {
    state: 'starting',
    qr: null,
    account: null,
    lastConnectedAt: null,
  };
  /** Unwatched channels that delivered messages, offered as suggestions in the UI. */
  private readonly seenChannels = new Map<string, number>();

  constructor(deps: WhatsAppClientDeps) {
    this.settings = deps.settings;
    this.stateStore = deps.stateStore;
    this.outboxStore = deps.outboxStore;
    this.outboxSender = deps.outboxSender;
    this.resolver = deps.resolver ?? new ChannelResolver();
  }

  getStatus(): WhatsAppStatus {
    return { ...this.status };
  }

  async listGroups(): Promise<GroupInfo[]> {
    const sock = this.connectedSock();
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups)
      .map((group) => ({
        jid: group.id,
        name: group.subject || group.id,
        participants: group.size ?? group.participants?.length ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Channels seen delivering messages that are not watched yet. */
  async listSeenChannels(): Promise<ChannelInfo[]> {
    const sock = this.connectedSock();
    const channels: ChannelInfo[] = [];
    for (const jid of this.seenChannels.keys()) {
      if (!this.settings.isWatched(jid)) {
        channels.push({ jid, name: await this.resolver.resolve(sock, jid) });
      }
    }
    return channels;
  }

  /** Look up a channel invite link. Returns null if WhatsApp does not know it. */
  async lookupChannelLink(link: string): Promise<ChannelInfo | null> {
    const sock = this.connectedSock();
    const jid = await this.resolver.resolveInvite(sock, extractChannelInviteCode(link));
    if (!jid) {
      return null;
    }
    return { jid, name: await this.resolver.resolve(sock, jid) };
  }

  /** True when an alert message can be sent right now. */
  canSendAlerts(): boolean {
    return this.status.state === 'connected' && this.sock !== null;
  }

  /** Send an alert to the chosen WhatsApp chat (your own chat by default). */
  async sendAlertText(text: string): Promise<void> {
    const sock = this.connectedSock();
    const target = this.settings.getWhatsAppAlertSettings();
    let jid: string;
    if (target.target === 'number' && target.number) {
      jid = `${target.number}@s.whatsapp.net`;
    } else {
      const own = sock.user?.id ?? this.status.account?.jid;
      if (!own) {
        throw new Error('Your WhatsApp account is not known yet');
      }
      jid = jidNormalizedUser(own);
    }
    await sock.sendMessage(jid, { text });
  }

  /** Whether a phone number (digits with country code) has WhatsApp. */
  async numberHasWhatsApp(number: string): Promise<boolean> {
    const sock = this.connectedSock();
    const [result] = (await sock.onWhatsApp(number)) ?? [];
    return Boolean(result?.exists);
  }

  /** Unlink this device. The session is wiped and a new QR code is shown. */
  async logout(): Promise<void> {
    const sock = this.sock;
    if (!sock) {
      await this.resetSession();
      return;
    }
    try {
      await sock.logout();
    } catch (error) {
      logger.warn({ error }, 'whatsapp logout request failed; resetting session locally');
      await this.resetSession();
    }
  }

  private connectedSock(): WASocket {
    if (!this.sock || this.status.state !== 'connected') {
      throw new NotConnectedError();
    }
    return this.sock;
  }

  private setStatus(update: Partial<WhatsAppStatus>): void {
    this.status = { ...this.status, ...update };
  }

  private async resetSession(): Promise<void> {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const previous = this.sock;
    this.sock = null;
    try {
      previous?.end(undefined);
    } catch {
      // already closed
    }
    this.setStatus({ state: 'logged_out', qr: null, account: null });
    await rm(paths.authSession, { recursive: true, force: true });
    logger.warn('whatsapp session cleared; waiting for a new QR scan');
    this.backoffMs = INITIAL_BACKOFF_MS;
    await this.start();
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(paths.authSession);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      getMessage: async () => undefined,
    });
    this.sock = sock;
    if (this.status.state !== 'logged_out') {
      this.setStatus({ state: 'starting', qr: null });
    }
    // A saved session means this device is already linked, even before it connects.
    // (creds.registered is only set by the pairing-code flow, so check `me`.)
    const me = state.creds.me;
    if (me && !this.status.account) {
      this.setStatus({ account: { jid: me.id, name: me.name ?? null } });
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      // Ignore late events from a socket that has been replaced.
      if (sock !== this.sock) {
        return;
      }
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.setStatus({ state: 'waiting_for_scan', qr });
        logger.info('waiting for the WhatsApp QR code to be scanned');
        if (process.stdout.isTTY) {
          qrcode.generate(qr, { small: true });
        }
      }

      if (connection === 'connecting' && this.status.state !== 'waiting_for_scan') {
        this.setStatus({ state: 'connecting' });
      }

      if (connection === 'open') {
        const now = Date.now();
        this.setStatus({
          state: 'connected',
          qr: null,
          lastConnectedAt: now,
          // sock.user can be missing on the first connection after a QR scan;
          // the saved credentials (updated in place by Baileys) always have it.
          account: accountFrom(sock.user ?? state.creds.me) ?? this.status.account,
        });
        const gapStart = this.stateStore.getNumber('last_online_at');
        this.connectionOpenedAt = now;
        this.acceptedSinceMs = computeCutoff(gapStart ?? now, now);
        this.backoffMs = INITIAL_BACKOFF_MS;
        bus.emit('connection.state', 'open');
        logger.info({ gapStart, gapMs: gapStart ? now - gapStart : 0 }, 'whatsapp connection opened');
        this.startHeartbeat();
        void this.handleOpen(sock, gapStart, now);
      }

      if (connection === 'close') {
        this.stopHeartbeat();
        this.stateStore.setNumber('last_online_at', Date.now());
        bus.emit('connection.state', 'close');
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          logger.error('whatsapp session logged out');
          void this.resetSession().catch((error: unknown) => {
            logger.error({ error }, 'failed to restart after logout');
          });
          return;
        }

        this.setStatus({ state: 'reconnecting', qr: null });
        this.scheduleReconnect();
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      void this.handleMessageBatch(sock, messages, type);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    const delayMs = Math.min(this.backoffMs, MAX_BACKOFF_MS);
    bus.emit('connection.state', 'reconnecting');
    logger.warn({ delayMs }, 'whatsapp disconnected; reconnect scheduled');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      void this.start().catch((error: unknown) => {
        logger.error({ error }, 'whatsapp reconnect failed');
        this.scheduleReconnect();
      });
    }, delayMs);
  }

  private async handleMessageBatch(
    sock: WASocket,
    messages: WAMessage[],
    type: MessageUpsertType,
  ): Promise<void> {
    if (type !== 'notify' && !(type === 'append' && env.PROCESS_HISTORY_MESSAGES)) {
      logger.debug({ type, count: messages.length }, 'message batch ignored');
      return;
    }

    for (const message of messages) {
      if (message.key.fromMe) {
        continue;
      }

      const remoteJid = message.key.remoteJid;
      if (remoteJid?.endsWith('@newsletter') && !this.settings.isWatched(remoteJid)) {
        this.seenChannels.set(remoteJid, Date.now());
      }

      if (!this.acceptMessage(message)) {
        logger.debug(
          { messageId: message.key.id, timestamp: getMessageTimestampMs(message) },
          'message outside catch-up window or already seen ignored',
        );
        continue;
      }

      const payload = await this.toIncomingMessage(sock, message, this.originFor(message));
      if (payload) {
        logger.info(
          {
            messageId: payload.messageId,
            sourceType: payload.sourceType,
            sourceName: payload.sourceName,
            upsertType: type,
          },
          'watched message received',
        );
        bus.emit('message.received', payload);
      }
    }
  }

  private async toIncomingMessage(
    sock: WASocket,
    message: WAMessage,
    origin: 'live' | 'catchup',
  ): Promise<IncomingMessage | null> {
    const sourceJid = message.key.remoteJid;
    const messageId = message.key.id;

    if (!sourceJid || !messageId || !this.settings.isWatched(sourceJid)) {
      return null;
    }

    const sourceType = getSourceType(sourceJid);
    if (!sourceType) {
      return null;
    }

    const rawText = extractText(message);
    if (!rawText.trim()) {
      return null;
    }

    const sourceName = await this.resolver.resolve(sock, sourceJid);

    return {
      messageId,
      sourceJid,
      sourceName,
      sourceType,
      sender: message.key.participant || sourceJid,
      rawText,
      timestamp: new Date(getMessageTimestampMs(message)),
      origin,
    };
  }

  private async handleOpen(sock: WASocket, gapStart: number | null, openedAt: number): Promise<void> {
    await this.resolveWatchedChannelLinks(sock);
    await this.nameUnnamedSources(sock);
    await this.subscribeWatchedChannels(sock);

    if (gapStart === null) {
      this.stateStore.setNumber('last_online_at', openedAt);
      logger.info('first WhatsApp connection recorded; catch-up skipped');
      return;
    }

    const gapMs = openedAt - gapStart;
    this.stateStore.setNumber('last_online_at', openedAt);
    if (gapMs <= env.CATCHUP_MIN_GAP_MS) {
      logger.info({ gapMs }, 'gap below catch-up threshold');
      return;
    }

    logger.info({ gapStart, gapMs, cutoff: this.acceptedSinceMs }, 'catch-up window detected');
    await this.fetchChannelCatchup(sock, gapStart);

    setTimeout(() => {
      const recoveredCount = this.outboxStore.countCatchupCreatedSince(openedAt);
      this.stateStore.recordDowntimeWindow(gapStart, openedAt, recoveredCount);
      logger.info({ recoveredCount }, 'catch-up window settled');
      void this.outboxSender.drain();
    }, env.CATCHUP_SETTLE_MS);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.stateStore.setNumber('last_online_at', Date.now());
    this.heartbeatTimer = setInterval(() => {
      this.stateStore.setNumber('last_online_at', Date.now());
    }, env.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private acceptMessage(message: WAMessage): boolean {
    const sourceJid = message.key.remoteJid;
    const messageId = message.key.id;
    if (!sourceJid || !messageId || !this.settings.isWatched(sourceJid)) {
      return false;
    }

    return getMessageTimestampMs(message) >= this.acceptedSinceMs && !this.outboxStore.hasSeen(messageId);
  }

  private originFor(message: WAMessage): 'live' | 'catchup' {
    return getMessageTimestampMs(message) < this.connectionOpenedAt ? 'catchup' : 'live';
  }

  private async resolveWatchedChannelLinks(sock: WASocket): Promise<void> {
    for (const source of this.settings.unresolvedChannelLinks()) {
      const inviteCode = extractChannelInviteCode(source.inviteLink ?? '');
      const jid = await this.resolver.resolveInvite(sock, inviteCode);
      if (jid) {
        const name = await this.resolver.resolve(sock, jid);
        this.settings.resolveChannelLink(source.id, jid, name === jid ? null : name);
        logger.info({ jid }, 'watched channel link resolved');
      } else {
        logger.warn({ inviteCode }, 'failed to resolve watched channel link');
      }
    }
  }

  /** Fill in display names for sources added by JID (e.g. imported from .env). */
  private async nameUnnamedSources(sock: WASocket): Promise<void> {
    for (const source of this.settings.unnamedSources()) {
      const jid = source.jid as string;
      const name = await this.resolver.resolve(sock, jid);
      if (name !== jid) {
        this.settings.addSource({ jid, name, type: source.type });
      }
    }
  }

  private async subscribeWatchedChannels(sock: WASocket): Promise<void> {
    for (const jid of this.channelJids()) {
      try {
        await sock.subscribeNewsletterUpdates(jid);
        logger.info({ jid }, 'subscribed to newsletter live updates');
      } catch (error) {
        logger.warn({ jid, error }, 'failed to subscribe to newsletter live updates');
      }
    }
  }

  private async fetchChannelCatchup(sock: WASocket, gapStart: number): Promise<void> {
    const sinceMs = gapStart - 5 * 60 * 1000;

    for (const jid of this.channelJids()) {
      try {
        const startedAt = Date.now();
        const { messages, strategy } = await fetchNewsletterMessagesSince(sock, jid, sinceMs);
        const accepted = messages.filter((message) => this.acceptMessage(message));
        logger.info(
          {
            jid,
            strategy,
            count: messages.length,
            accepted: accepted.length,
            durationMs: Date.now() - startedAt,
          },
          'newsletter catch-up fetched',
        );
        for (const message of accepted) {
          const payload = await this.toIncomingMessage(sock, message, 'catchup');
          if (payload) {
            bus.emit('message.received', payload);
          }
        }
      } catch (error) {
        logger.warn({ jid, error }, 'newsletter catch-up fetch failed');
      }
    }
  }

  private channelJids(): string[] {
    return this.settings.watchedChannelJids();
  }
}

function computeCutoff(gapStart: number, now: number): number {
  const maxAgeCutoff = now - env.CATCHUP_MAX_AGE_HOURS * 60 * 60 * 1000;
  return Math.max(gapStart - 5 * 60 * 1000, maxAgeCutoff);
}

function getMessageTimestampMs(message: WAMessage): number {
  const timestamp = message.messageTimestamp;

  if (typeof timestamp === 'number') {
    return normalizeEpochMs(timestamp);
  }

  if (typeof timestamp === 'bigint') {
    return normalizeEpochMs(Number(timestamp));
  }

  if (typeof timestamp === 'string') {
    return normalizeEpochMs(Number(timestamp));
  }

  if (timestamp && typeof timestamp === 'object' && 'toNumber' in timestamp) {
    return normalizeEpochMs((timestamp as { toNumber: () => number }).toNumber());
  }

  return Date.now();
}

function normalizeEpochMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now();
  }

  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function extractChannelInviteCode(value: string): string {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.at(-1) || value;
  } catch {
    return value;
  }
}

function getSourceType(jid: string): SourceType | null {
  if (jid.endsWith('@g.us')) {
    return 'GROUP';
  }

  if (jid.endsWith('@newsletter')) {
    return 'CHANNEL';
  }

  return null;
}

function extractText(message: WAMessage): string {
  const content = message.message;
  return (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.caption ||
    ''
  );
}

function accountFrom(user: { id: string; name?: string } | undefined): { jid: string; name: string | null } | null {
  return user?.id ? { jid: user.id, name: user.name ?? null } : null;
}
