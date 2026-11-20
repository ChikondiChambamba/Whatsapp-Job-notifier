import type { WASocket } from '@whiskeysockets/baileys';
import { describe, expect, it, vi } from 'vitest';
import { ChannelResolver } from './channelResolver.js';

describe('ChannelResolver', () => {
  it('caches newsletter names', async () => {
    const sock = {
      newsletterMetadata: vi.fn().mockResolvedValue({ id: '123', name: 'CS Jobs Channel' }),
      groupMetadata: vi.fn(),
    } as unknown as WASocket;
    const resolver = new ChannelResolver();

    await expect(resolver.resolve(sock, '123@newsletter')).resolves.toBe('CS Jobs Channel');
    await expect(resolver.resolve(sock, '123@newsletter')).resolves.toBe('CS Jobs Channel');

    expect(sock.newsletterMetadata).toHaveBeenCalledTimes(1);
  });

  it('resolves invite codes to newsletter jids', async () => {
    const sock = {
      newsletterMetadata: vi.fn().mockResolvedValue({ id: '123', name: 'CS Jobs Channel' }),
      groupMetadata: vi.fn(),
    } as unknown as WASocket;
    const resolver = new ChannelResolver();

    await expect(resolver.resolveInvite(sock, '0029VaeEdz5B4hdXFDsiE30M')).resolves.toBe(
      '123@newsletter',
    );
    await expect(resolver.resolve(sock, '123@newsletter')).resolves.toBe('CS Jobs Channel');
  });

  it('falls back to raw jid on metadata failure', async () => {
    const sock = {
      newsletterMetadata: vi.fn().mockRejectedValue(new Error('offline')),
      groupMetadata: vi.fn(),
    } as unknown as WASocket;
    const resolver = new ChannelResolver();

    await expect(resolver.resolve(sock, '123@newsletter')).resolves.toBe('123@newsletter');
    await expect(resolver.resolveInvite(sock, '0029VbAlIj4Gk1Fpt7aE323N')).resolves.toBeNull();
  });
});
