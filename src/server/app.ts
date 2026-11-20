import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { z, ZodError } from 'zod';
import { compileProfile, scoreCompiled } from '../profiles/ruleEngine.js';
import { PROFILE_TEMPLATES, getTemplate } from '../profiles/templates.js';
import { profileSchema } from '../profiles/types.js';
import { AI_MODELS, AiPermanentError, type AiChecker } from '../services/aiChecker.js';
import type { OutboxStore } from '../services/outboxStore.js';
import type { RecentMessagesStore } from '../services/recentMessagesStore.js';
import {
  aiSettingsSchema,
  emailSettingsSchema,
  whatsappAlertSettingsSchema,
  type EmailSettings,
  type SettingsStore,
} from '../services/settingsStore.js';
import type { StatsStore } from '../services/statsStore.js';
import {
  NotConnectedError,
  type ChannelInfo,
  type GroupInfo,
  type WhatsAppStatus,
} from '../whatsapp/client.js';
import { localOnly } from './security.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LIMIT = 25;

export interface WhatsAppControl {
  getStatus(): WhatsAppStatus;
  listGroups(): Promise<GroupInfo[]>;
  listSeenChannels(): Promise<ChannelInfo[]>;
  lookupChannelLink(link: string): Promise<ChannelInfo | null>;
  logout(): Promise<void>;
  sendAlertText(text: string): Promise<void>;
  numberHasWhatsApp(number: string): Promise<boolean>;
}

export interface AppDeps {
  settings: SettingsStore;
  statsStore: StatsStore;
  outboxStore: OutboxStore;
  recentMessages: RecentMessagesStore;
  whatsapp: WhatsAppControl;
  sendTestEmail: (settings: EmailSettings) => Promise<void>;
  aiChecker: Pick<AiChecker, 'check' | 'isConfigured'>;
  /** Built web UI folder; omitted in tests. */
  webRoot?: string;
}

type Handler = (request: Request, response: Response) => Promise<unknown> | unknown;

/** Wrap a handler so thrown errors reach the error middleware. */
const route =
  (handler: Handler) =>
  (request: Request, response: Response, next: NextFunction): void => {
    Promise.resolve(handler(request, response)).catch(next);
  };

export function createApp(deps: AppDeps): express.Express {
  const { settings, statsStore, outboxStore, recentMessages, whatsapp } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(localOnly);
  app.use(express.json({ limit: '1mb' }));

  // ---- status ----

  app.get(
    '/api/status',
    route(async (_request, response) => {
      const status = whatsapp.getStatus();
      response.json({
        whatsapp: {
          ...status,
          qr: undefined,
          qrDataUrl: status.qr ? await QRCode.toDataURL(status.qr, { margin: 1, width: 280 }) : null,
        },
        setup: {
          linked: status.account !== null || status.state === 'connected',
          sources: settings.listSources().length,
          profiles: settings.listProfiles().length,
          email: settings.getEmailSettings() !== null,
          ai: settings.getAiSettings() !== null,
        },
      });
    }),
  );

  app.get('/api/stats', (_request, response) => {
    response.json(statsStore.getStats(DAY_MS));
  });

  // ---- WhatsApp ----

  app.get(
    '/api/chats',
    route(async (_request, response) => {
      const [groups, channels] = await Promise.all([
        whatsapp.listGroups(),
        whatsapp.listSeenChannels(),
      ]);
      response.json({
        groups: groups.map((group) => ({ ...group, watched: settings.isWatched(group.jid) })),
        suggestedChannels: channels,
      });
    }),
  );

  app.post(
    '/api/whatsapp/logout',
    route(async (_request, response) => {
      await whatsapp.logout();
      response.json({ ok: true });
    }),
  );

  // ---- sources ----

  app.get('/api/sources', (_request, response) => {
    response.json(settings.listSources());
  });

  app.post(
    '/api/sources',
    route((request, response) => {
      const input = z
        .object({ jid: z.string().regex(/@(g\.us|newsletter)$/, 'Not a group or channel'), name: z.string().optional() })
        .parse(request.body);
      response.status(201).json(settings.addSource(input));
    }),
  );

  app.post(
    '/api/sources/channel-link',
    route(async (request, response) => {
      const { link } = z
        .object({ link: z.string().trim().url('Paste the full channel link') })
        .parse(request.body);

      let channel: ChannelInfo | null;
      try {
        channel = await whatsapp.lookupChannelLink(link);
      } catch (error) {
        if (!(error instanceof NotConnectedError)) {
          throw error;
        }
        // Offline: keep the link and resolve it on the next connection.
        response.status(202).json(settings.addChannelLink(link));
        return;
      }

      if (!channel) {
        response.status(404).json({ error: 'WhatsApp could not find a channel for that link' });
        return;
      }
      response.status(201).json(settings.addSource({ jid: channel.jid, name: channel.name, type: 'channel' }));
    }),
  );

  app.delete('/api/sources/:id', (request, response) => {
    settings.removeSource(Number(request.params.id));
    response.status(204).end();
  });

  // ---- profiles ----

  app.get('/api/templates', (_request, response) => {
    response.json(
      PROFILE_TEMPLATES.map(({ id, name, description, build }) => ({
        id,
        name,
        description,
        profile: build(),
      })),
    );
  });

  app.get('/api/profiles', (_request, response) => {
    response.json(settings.listProfiles());
  });

  app.post(
    '/api/profiles',
    route((request, response) => {
      const body = z.object({ name: z.string().trim().min(1) }).passthrough().parse(request.body);
      const id = uniqueProfileId(settings, body.name);
      response.status(201).json(settings.saveProfile({ ...profileSchema.parse({ ...body, id }), id }));
    }),
  );

  app.post(
    '/api/profiles/from-template',
    route((request, response) => {
      const { templateId, name } = z
        .object({ templateId: z.string(), name: z.string().trim().min(1).optional() })
        .parse(request.body);
      const template = getTemplate(templateId);
      if (!template) {
        response.status(404).json({ error: 'Unknown template' });
        return;
      }
      const base = template.build();
      const finalName = name ?? base.name;
      const id = uniqueProfileId(settings, finalName);
      response.status(201).json(settings.saveProfile({ ...base, id, name: finalName }));
    }),
  );

  app.put(
    '/api/profiles/:id',
    route((request, response) => {
      const id = String(request.params.id);
      if (!settings.getProfile(id)) {
        response.status(404).json({ error: 'Alert not found' });
        return;
      }
      response.json(settings.saveProfile({ ...request.body, id }));
    }),
  );

  app.delete('/api/profiles/:id', (request, response) => {
    settings.deleteProfile(String(request.params.id));
    response.status(204).end();
  });

  /** Score one pasted message against a draft profile. */
  app.post(
    '/api/profiles/test',
    route((request, response) => {
      const { profile, text } = z
        .object({ profile: z.unknown(), text: z.string().max(20_000) })
        .parse(request.body);
      const draft = profileSchema.parse(profile);
      response.json(scoreCompiled(compileProfile(draft), text, { log: false }));
    }),
  );

  /** Show which recent watched messages a draft profile would match. */
  app.post(
    '/api/profiles/preview',
    route((request, response) => {
      const { profile } = z.object({ profile: z.unknown() }).parse(request.body);
      const draft = profileSchema.parse(profile);
      const compiled = compileProfile(draft);
      const messages = recentMessages.list();
      const inScope = messages.filter(
        (message) => draft.sources.mode === 'all' || draft.sources.jids.includes(message.sourceJid),
      );
      const matches = inScope.flatMap((message) => {
        const result = scoreCompiled(compiled, message.text, { log: false });
        return result.matched
          ? [
              {
                messageId: message.messageId,
                sourceName: message.sourceName ?? message.sourceJid,
                postedAt: message.postedAt,
                text: message.text.slice(0, 600),
                score: result.score,
                categoryHits: result.categoryHits,
              },
            ]
          : [];
      });
      response.json({
        checked: inScope.length,
        matchCount: matches.length,
        matches: matches.slice(0, PREVIEW_LIMIT),
        oldest: messages.at(-1)?.postedAt ?? null,
      });
    }),
  );

  /** Ask the AI about one pasted message (costs one API call). */
  app.post(
    '/api/profiles/ai-test',
    route(async (request, response) => {
      const { description, text } = z
        .object({
          description: z.string().trim().min(1, 'Describe what you want first').max(1000),
          text: z.string().trim().min(1, 'Paste a message first').max(20_000),
        })
        .parse(request.body);
      if (!deps.aiChecker.isConfigured()) {
        response.status(409).json({ error: 'Add your API key in Settings first' });
        return;
      }
      try {
        response.json(await deps.aiChecker.check(description, { text, sourceName: 'Test message' }));
      } catch (error) {
        response.status(502).json({ error: errorMessage(error) });
      }
    }),
  );

  // ---- matches ----

  app.get('/api/matches', (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
    response.json(
      outboxStore.recentRows(limit).map((row) => ({
        id: row.id,
        profileId: row.profileId,
        profileName: row.profileName,
        // Prefer the current name; older rows may have stored the raw ID.
        sourceName:
          settings.sourceName(row.sourceJid) ??
          (row.sourceName && row.sourceName !== row.sourceJid ? row.sourceName : row.sourceJid),
        text: row.text,
        postedAt: row.postedAt,
        score: row.score,
        matchedCategories: row.matchedCategories,
        origin: row.origin,
        status: row.status,
        waState: row.waState,
        waError: row.waError,
        aiRelevant: row.aiRelevant,
        aiReason: row.aiReason,
        lastError: row.lastError,
        sentAt: row.sentAt,
      })),
    );
  });

  // ---- email ----

  app.get('/api/settings/email', (_request, response) => {
    const current = settings.getEmailSettings();
    response.json(
      current
        ? { configured: true, ...current, smtpPass: undefined, hasPassword: current.smtpPass.length > 0 }
        : { configured: false },
    );
  });

  app.put(
    '/api/settings/email',
    route((request, response) => {
      const body = z.record(z.string(), z.unknown()).parse(request.body);
      // A blank password means "keep the saved one".
      const existing = settings.getEmailSettings();
      if ((body.smtpPass === undefined || body.smtpPass === '') && existing) {
        body.smtpPass = existing.smtpPass;
      }
      const saved = settings.setEmailSettings(emailSettingsSchema.parse(body));
      response.json({ configured: true, ...saved, smtpPass: undefined, hasPassword: true });
    }),
  );

  app.post(
    '/api/settings/email/test',
    route(async (_request, response) => {
      const current = settings.getEmailSettings();
      if (!current) {
        response.status(400).json({ error: 'Save your email settings first' });
        return;
      }
      try {
        await deps.sendTestEmail(current);
      } catch (error) {
        response.status(502).json({ error: `Sending failed: ${errorMessage(error)}` });
        return;
      }
      response.json({ ok: true, to: current.to });
    }),
  );

  // ---- WhatsApp alerts ----

  app.get('/api/settings/whatsapp-alerts', (_request, response) => {
    response.json(settings.getWhatsAppAlertSettings());
  });

  app.put(
    '/api/settings/whatsapp-alerts',
    route(async (request, response) => {
      const input = whatsappAlertSettingsSchema.parse(request.body);
      if (input.target === 'number' && input.number) {
        let exists = true;
        try {
          exists = await whatsapp.numberHasWhatsApp(input.number);
        } catch (error) {
          // Offline: save it anyway; sending will report problems.
          if (!(error instanceof NotConnectedError)) {
            throw error;
          }
        }
        if (!exists) {
          response.status(400).json({ error: 'That number is not on WhatsApp. Check the country code.' });
          return;
        }
      }
      response.json(settings.setWhatsAppAlertSettings(input));
    }),
  );

  app.post(
    '/api/settings/whatsapp-alerts/test',
    route(async (_request, response) => {
      await whatsapp.sendAlertText(
        '🔔 *Test alert*\nWhatsApp alerts are working. Matches for alerts with "WhatsApp message" turned on will arrive here.',
      );
      response.json({ ok: true });
    }),
  );

  // ---- AI ----

  const aiView = () => {
    const current = settings.getAiSettings();
    return {
      configured: current !== null,
      model: current?.model ?? null,
      // Only the last 4 characters, so people can tell which key is saved.
      keyHint: current ? current.apiKey.slice(-4) : null,
      models: AI_MODELS,
    };
  };

  app.get('/api/settings/ai', (_request, response) => {
    response.json(aiView());
  });

  app.put(
    '/api/settings/ai',
    route(async (request, response) => {
      const body = z
        .object({ apiKey: z.string().optional(), model: z.string().optional(), verify: z.boolean().optional() })
        .parse(request.body);
      const existing = settings.getAiSettings();
      const candidate = aiSettingsSchema.parse({
        apiKey: body.apiKey?.trim() || existing?.apiKey || '',
        model: body.model ?? existing?.model,
      });

      // Check the key with one tiny request before saving it.
      if (body.verify !== false) {
        try {
          await deps.aiChecker.check(
            'Job vacancies for software developers',
            { text: 'We are hiring a junior web developer. Send your CV.', sourceName: 'Key check' },
            candidate,
          );
        } catch (error) {
          if (error instanceof AiPermanentError) {
            response.status(400).json({ error: errorMessage(error) });
            return;
          }
          response.status(502).json({ error: `Could not check the key: ${errorMessage(error)}` });
          return;
        }
      }

      settings.setAiSettings(candidate);
      response.json(aiView());
    }),
  );

  app.delete('/api/settings/ai', (_request, response) => {
    settings.clearAiSettings();
    response.json(aiView());
  });

  // ---- web UI ----

  if (deps.webRoot && existsSync(deps.webRoot)) {
    const webRoot = deps.webRoot;
    app.use(express.static(webRoot, { index: 'index.html' }));
    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.sendFile(join(webRoot, 'index.html'));
    });
  }

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: error.issues[0]?.message ?? 'Invalid input',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
      return;
    }
    if (error instanceof NotConnectedError) {
      response.status(409).json({ error: 'WhatsApp is not connected yet' });
      return;
    }
    response.status(500).json({ error: errorMessage(error) });
  });

  return app;
}

function uniqueProfileId(settings: SettingsStore, name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'alert';
  let id = base;
  for (let n = 2; settings.getProfile(id); n += 1) {
    id = `${base}-${n}`;
  }
  return id;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
