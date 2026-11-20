import makeWASocket, { useMultiFileAuthState, type WASocket } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import '../config/env.js';
import { env } from '../config/env.js';
import { ChannelResolver } from '../whatsapp/channelResolver.js';

const resolver = new ChannelResolver();

const { state, saveCreds } = await useMultiFileAuthState('./auth_session');
const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  getMessage: async () => undefined,
});

sock.ev.on('creds.update', saveCreds);
sock.ev.on('connection.update', (update) => {
  if (update.qr) {
    console.log('Scan this QR code from WhatsApp > Linked devices > Link a device:');
    qrcode.generate(update.qr, { small: true });
  }

  if (update.connection === 'open') {
    void listChats(sock)
      .catch((error: unknown) => {
        console.error('Failed to list chats:', error);
        process.exitCode = 1;
      })
      .finally(() => {
        void sock.end(undefined);
        setTimeout(() => process.exit(process.exitCode || 0), 500);
      });
  }
});

async function listChats(sock: WASocket): Promise<void> {
  console.log('\nGroups you can put in WATCHED_GROUP_JIDS:\n');

  const groups = await sock.groupFetchAllParticipating();
  const groupList = Object.values(groups).sort((a, b) => a.subject.localeCompare(b.subject));

  if (groupList.length === 0) {
    console.log('No groups found for this WhatsApp account.');
  }

  for (const group of groupList) {
    console.log(`${group.subject} = ${group.id}`);
  }

  console.log('\nConfigured channel links resolved to WATCHED_CHANNEL_JIDS:\n');

  if (env.WATCHED_CHANNEL_LINKS.length === 0) {
    console.log('No WATCHED_CHANNEL_LINKS configured.');
    return;
  }

  for (const link of env.WATCHED_CHANNEL_LINKS) {
    const inviteCode = extractChannelInviteCode(link);
    const jid = await resolver.resolveInvite(sock, inviteCode);
    console.log(`${link} = ${jid || 'could not resolve'}`);
  }
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
