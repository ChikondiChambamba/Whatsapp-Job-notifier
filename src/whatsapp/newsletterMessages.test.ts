import { proto, type BinaryNode } from '@whiskeysockets/baileys';
import { describe, expect, it, vi } from 'vitest';
import { fetchNewsletterMessagesSince, parseNewsletterFetchResult } from './newsletterMessages.js';

const JID = '123@newsletter';

function messageNode(attrs: Record<string, string>, text?: string): BinaryNode {
  return {
    tag: 'message',
    attrs,
    content:
      text === undefined
        ? []
        : [{ tag: 'plaintext', attrs: {}, content: proto.Message.encode({ conversation: text }).finish() }],
  };
}

describe('parseNewsletterFetchResult', () => {
  it('decodes messages nested in the raw IQ reply', () => {
    const reply: BinaryNode = {
      tag: 'iq',
      attrs: { type: 'result' },
      content: [
        {
          tag: 'message_updates',
          attrs: {},
          content: [
            {
              tag: 'messages',
              attrs: {},
              content: [
                messageNode({ server_id: '101', t: '1794807900' }, 'We are hiring'),
                messageNode({ message_id: 'ABC', server_id: '102', t: '1794807960' }, 'Send your CV'),
              ],
            },
          ],
        },
      ],
    };

    const messages = parseNewsletterFetchResult(reply, JID);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.key).toEqual({ remoteJid: JID, id: '101', fromMe: false });
    expect(messages[0]?.message?.conversation).toBe('We are hiring');
    expect(messages[0]?.messageTimestamp).toBe(1794807900);
    expect(messages[1]?.key.id).toBe('ABC');
    expect(messages[1]?.message?.conversation).toBe('Send your CV');
  });

  it('skips messages without a plaintext body', () => {
    const reply: BinaryNode = { tag: 'iq', attrs: {}, content: [messageNode({ server_id: '1', t: '1' })] };
    expect(parseNewsletterFetchResult(reply, JID)).toEqual([]);
  });

  it('returns nothing for unexpected shapes', () => {
    expect(parseNewsletterFetchResult(undefined, JID)).toEqual([]);
    expect(parseNewsletterFetchResult({ foo: 'bar' }, JID)).toEqual([]);
  });
});

describe('fetchNewsletterMessagesSince', () => {
  const reply = (...messages: BinaryNode[]): BinaryNode => ({
    tag: 'iq',
    attrs: {},
    content: [{ tag: 'messages', attrs: {}, content: messages }],
  });
  const makeSock = (query: ReturnType<typeof vi.fn>) =>
    ({ query, generateMessageTag: () => 'tag' }) as unknown as Parameters<
      typeof fetchNewsletterMessagesSince
    >[0];

  it('uses the history query sent to s.whatsapp.net', async () => {
    const query = vi
      .fn()
      .mockResolvedValue(reply(messageNode({ server_id: '5', t: '1794807900' }, 'hiring')));

    const result = await fetchNewsletterMessagesSince(makeSock(query), JID, 0);

    expect(result.strategy).toBe('messages');
    expect(result.messages).toHaveLength(1);
    const node = query.mock.calls[0]?.[0] as BinaryNode;
    expect(node.attrs.to).toBe('@s.whatsapp.net');
    expect((node.content as BinaryNode[])[0]).toMatchObject({
      tag: 'messages',
      attrs: { type: 'jid', jid: JID, count: '100' },
    });
    expect(query.mock.calls[0]?.[1]).toBe(15_000);
  });

  it('falls back to message_updates when the history query gets no reply', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(reply(messageNode({ server_id: '7', t: '1794807900' }, 'cv')));

    const result = await fetchNewsletterMessagesSince(makeSock(query), JID, 0);

    expect(result.strategy).toBe('message_updates');
    expect(result.messages).toHaveLength(1);
    const node = query.mock.calls[1]?.[0] as BinaryNode;
    expect(node.attrs.to).toBe(JID);
    expect((node.content as BinaryNode[])[0]?.tag).toBe('message_updates');
  });

  it('reports none when neither query is answered', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const result = await fetchNewsletterMessagesSince(makeSock(query), JID, 0);
    expect(result).toEqual({ messages: [], strategy: 'none' });
  });

  it('pages back with before=<oldest server_id> until past the cutoff', async () => {
    const page = (startId: number, t: number) =>
      reply(
        ...Array.from({ length: 100 }, (_, i) =>
          messageNode({ server_id: String(startId - i), t: String(t) }, `post ${startId - i}`),
        ),
      );
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(300, 2_000))
      .mockResolvedValueOnce(page(200, 500));

    const result = await fetchNewsletterMessagesSince(makeSock(query), JID, 1_000 * 1000);

    expect(query).toHaveBeenCalledTimes(2);
    const second = query.mock.calls[1]?.[0] as BinaryNode;
    expect((second.content as BinaryNode[])[0]?.attrs.before).toBe('201');
    expect(result.messages).toHaveLength(200);
  });
});
