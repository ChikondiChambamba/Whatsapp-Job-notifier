import '../config/env.js';
import { EmailService } from '../services/emailService.js';
import { env } from '../config/env.js';

const service = new EmailService();

await service.sendVacancyAlert({
  messageId: `smtp-test-${Date.now()}`,
  sourceJid: 'local-test',
  sourceName: 'SMTP Test',
  sourceType: 'CHANNEL',
  sender: 'local-test',
  rawText: 'This is a test email from the WhatsApp Job Vacancy Alert Bot.',
  matchedKeywords: ['smtp', 'test'],
  score: env.MATCH_THRESHOLD,
  timestamp: new Date(),
  origin: 'live',
});

console.log(`SMTP test email sent to ${env.ALERT_EMAIL_TO}`);
