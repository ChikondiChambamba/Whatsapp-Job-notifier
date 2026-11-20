import {
  getBinaryNodeChild,
  proto,
  S_WHATSAPP_NET,
  type BinaryNode,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import { logger } from '../services/logger.js';

const QUERY_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

type NewsletterQuerySocket = Pick<WASocket, 'query' | 'generateMessageTag'>;

export interface NewsletterFetchResult {
  messages: WAMessage[];
  strategy: 'messages' | 'message_updates' | 'none';
}

/**
 * Fetch channel posts newer than `sinceMs`.
 *
 * Baileys' `newsletterFetchMessages` sends a `message_updates` IQ, which the
 * server answers with view/reaction updates (or not at all). Baileys swallows
 * the 60s query timeout and resolves `undefined`, which looked like "0 messages".
 *
 * The history query WhatsApp Web uses is `<messages type="jid">` sent to
 * s.whatsapp.net, paged backwards with `before=<server_id>`. Try that first,
 * fall back to `message_updates`, and bound both with a short timeout.
 */
export async function fetchNewsletterMessagesSince(
  sock: NewsletterQuerySocket,
  jid: string,
  sinceMs: number,
): Promise<NewsletterFetchResult> {
  const history = await fetchHistoryPages(sock, jid, sinceMs);
  if (history) {
    return { messages: history, strategy: 'messages' };
  }

  const reply = await sock.query(
    {
      tag: 'iq',
      attrs: { id: sock.generateMessageTag(), type: 'get', xmlns: 'newsletter', to: jid },
      content: [
        {
          tag: 'message_updates',
          attrs: { count: String(PAGE_SIZE), since: String(Math.floor(sinceMs / 1000)) },
        },
      ],
    },
    QUERY_TIMEOUT_MS,
  );

  if (!reply) {
    logger.warn({ jid }, 'newsletter message_updates query got no reply');
    return { messages: [], strategy: 'none' };
  }

  return { messages: parseNewsletterFetchResult(reply, jid), strategy: 'message_updates' };
}

/** Returns null when the server does not answer the history query at all. */
async function fetchHistoryPages(
  sock: NewsletterQuerySocket,
  jid: string,
  sinceMs: number,
): Promise<WAMessage[] | null> {
  const collected: WAMessage[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const attrs: Record<string, string> = { type: 'jid', jid, count: String(PAGE_SIZE) };
    if (before) {
      attrs.before = before;
    }

    let reply: BinaryNode | undefined;
    try {
      reply = await sock.query(
        {
          tag: 'iq',
          attrs: { id: sock.generateMessageTag(), type: 'get', xmlns: 'newsletter', to: S_WHATSAPP_NET },
          content: [{ tag: 'messages', attrs }],
        },
        QUERY_TIMEOUT_MS,
      );
    } catch (error) {
      if (page === 0) {
        logger.warn({ jid, error }, 'newsletter history query rejected');
        return null;
      }
      throw error;
    }

    if (!reply) {
      if (page === 0) {
        logger.warn({ jid }, 'newsletter history query got no reply');
        return null;
      }
      break;
    }

    const { messages, oldestServerId } = parseWithServerIds(reply, jid);
    collected.push(...messages);

    const oldestTimestampMs = Math.min(
      ...messages.map((message) => Number(message.messageTimestamp) * 1000),
    );
    if (messages.length < PAGE_SIZE || !oldestServerId || oldestTimestampMs < sinceMs) {
      break;
    }
    before = oldestServerId;
  }

  return collected;
}

function parseWithServerIds(
  reply: BinaryNode,
  jid: string,
): { messages: WAMessage[]; oldestServerId: string | undefined } {
  let oldestServerId: string | undefined;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isBinaryNode(value)) {
      const serverId = value.attrs.server_id;
      if (value.tag === 'message' && serverId) {
        if (!oldestServerId || Number(serverId) < Number(oldestServerId)) {
          oldestServerId = serverId;
        }
      } else if (Array.isArray(value.content)) {
        value.content.forEach(visit);
      }
    }
  };
  visit(reply);

  return { messages: parseNewsletterFetchResult(reply, jid), oldestServerId };
}

/**
 * `sock.newsletterFetchMessages` returns the raw IQ reply
 * (iq > message_updates > messages > message[]), not decoded messages.
 * Each <message> carries its protobuf body in a <plaintext> child.
 *
 * The id scheme (message_id || server_id) mirrors how Baileys builds live
 * newsletter messages, so dedupe matches the same post across both paths.
 */
export function parseNewsletterFetchResult(result: unknown, jid: string): WAMessage[] {
  const messages: WAMessage[] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (!isBinaryNode(value)) {
      return;
    }

    if (value.tag === 'message') {
      const message = decodeNewsletterMessage(value, jid);
      if (message) {
        messages.push(message);
      }
      return;
    }

    if (Array.isArray(value.content)) {
      value.content.forEach(walk);
    }
  };

  walk(result);
  return messages;
}

function decodeNewsletterMessage(node: BinaryNode, jid: string): WAMessage | null {
  const id = node.attrs.message_id || node.attrs.server_id;
  const plaintext = getBinaryNodeChild(node, 'plaintext');
  if (!id || !plaintext?.content || Array.isArray(plaintext.content)) {
    return null;
  }

  try {
    const buffer =
      typeof plaintext.content === 'string'
        ? Buffer.from(plaintext.content, 'binary')
        : Buffer.from(plaintext.content);

    return {
      key: { remoteJid: jid, id, fromMe: false },
      message: proto.Message.decode(buffer),
      messageTimestamp: Number(node.attrs.t) || undefined,
    } as WAMessage;
  } catch (error) {
    logger.warn({ jid, id, error }, 'failed to decode fetched newsletter message');
    return null;
  }
}

function isBinaryNode(value: unknown): value is BinaryNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BinaryNode).tag === 'string' &&
    typeof (value as BinaryNode).attrs === 'object'
  );
}
