import type { WASocket } from '@whiskeysockets/baileys';

export class ChannelResolver {
  private readonly cache = new Map<string, string>();

  async resolveInvite(sock: WASocket, inviteCode: string): Promise<string | null> {
    try {
      const metadata = await sock.newsletterMetadata('invite', inviteCode);
      if (!metadata?.id) {
        return null;
      }

      const jid = toNewsletterJid(metadata.id);
      this.cache.set(jid, metadata.name || jid);
      return jid;
    } catch {
      return null;
    }
  }

  async resolve(sock: WASocket, jid: string): Promise<string> {
    const cached = this.cache.get(jid);
    if (cached) {
      return cached;
    }

    if (jid.endsWith('@g.us')) {
      return this.resolveGroup(sock, jid);
    }

    if (jid.endsWith('@newsletter')) {
      return this.resolveNewsletter(sock, jid);
    }

    return jid;
  }

  private async resolveGroup(sock: WASocket, jid: string): Promise<string> {
    try {
      const metadata = await sock.groupMetadata(jid);
      const name = metadata.subject || jid;
      this.cache.set(jid, name);
      return name;
    } catch {
      return jid;
    }
  }

  private async resolveNewsletter(sock: WASocket, jid: string): Promise<string> {
    try {
      const metadata = await sock.newsletterMetadata('jid', jid);
      const name = metadata?.name || jid;
      this.cache.set(jid, name);
      return name;
    } catch {
      return jid;
    }
  }
}

function toNewsletterJid(id: string): string {
  return id.endsWith('@newsletter') ? id : `${id}@newsletter`;
}
