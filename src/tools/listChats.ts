import makeWASocket, { useMultiFileAuthState, type WASocket } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import '../config/env.js';
import { paths } from '../config/paths.js';
import { importLegacyEnv } from '../services/legacyImport.js';
import { SettingsStore } from '../services/settingsStore.js';
import { ChannelResolver } from '../whatsapp/channelResolver.js';

const resolver = new ChannelResolver();
const settings = new SettingsStore();
importLegacyEnv(settings);

const { state, saveCreds } = await useMultiFileAuthState(paths.authSession);
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
  console.log('\nGroups this WhatsApp account belongs to (* = watched):\n');

  const groups = await sock.groupFetchAllParticipating();
  const groupList = Object.values(groups).sort((a, b) => a.subject.localeCompare(b.subject));

  if (groupList.length === 0) {
    console.log('No groups found for this WhatsApp account.');
  }

  for (const group of groupList) {
    console.log(`${settings.isWatched(group.id) ? '*' : ' '} ${group.subject} = ${group.id}`);
  }

  console.log('\nWatched channels:\n');

  const channels = settings.listSources().filter((source) => source.type === 'channel');
  if (channels.length === 0) {
    console.log('No channels watched.');
    return;
  }

  for (const channel of channels) {
    if (channel.jid) {
      console.log(`${channel.name ?? channel.jid} = ${channel.jid}`);
      continue;
    }
    const inviteCode = extractChannelInviteCode(channel.inviteLink ?? '');
    const jid = await resolver.resolveInvite(sock, inviteCode);
    console.log(`${channel.inviteLink} = ${jid || 'could not resolve'}`);
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
