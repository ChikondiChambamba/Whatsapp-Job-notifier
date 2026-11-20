import '../config/env.js';
import { EmailService } from '../services/emailService.js';
import { importLegacyEnv } from '../services/legacyImport.js';
import { SettingsStore } from '../services/settingsStore.js';

const settings = new SettingsStore();
importLegacyEnv(settings);
const emailSettings = settings.getEmailSettings();

if (!emailSettings) {
  console.error('Email alerts are not set up yet.');
  process.exit(1);
}

await new EmailService(() => emailSettings).sendAlert({
  messageId: `smtp-test-${Date.now()}`,
  profileId: 'test',
  profileName: 'Test alert',
  sourceJid: 'local-test',
  sourceName: 'SMTP Test',
  sourceType: 'CHANNEL',
  sender: 'local-test',
  rawText: 'This is a test email from the WhatsApp alert bot.',
  matchedKeywords: ['smtp', 'test'],
  score: 0,
  timestamp: new Date(),
  origin: 'live',
});

console.log(`SMTP test email sent to ${emailSettings.to}`);
settings.close();
