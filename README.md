# WhatsApp Job Vacancy Alert Bot

A personal WhatsApp bot that watches configured groups and channels for Computer Science or Software Engineering vacancy posts, then sends an HTML email alert.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in SMTP credentials plus the watched WhatsApp JIDs.
4. Start the bot with `npm run dev` and scan the QR code on first run.

The bot stores WhatsApp auth state in `auth_session/`, message idempotency data in `data/`, and diagnostic logs in `logs/`. These paths are gitignored.

## Environment

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: SMTP settings for Nodemailer.
- `ALERT_EMAIL_TO`: destination inbox for alerts.
- `WATCHED_GROUP_JIDS`: comma-separated `@g.us` JIDs.
- `WATCHED_CHANNEL_JIDS`: comma-separated `@newsletter` JIDs.
- `WATCHED_CHANNEL_LINKS`: comma-separated `https://whatsapp.com/channel/...` links. The bot resolves these to `@newsletter` JIDs after WhatsApp connects.
- `MATCH_THRESHOLD`: weighted score required to send an alert. Defaults to `4`.
- `LOG_LEVEL`: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.
- `DRY_RUN`: set to `true` to score and log matching messages without sending emails.
- `DASHBOARD_PORT`: local dashboard port. Defaults to `4000`.
- `PROCESS_HISTORY_MESSAGES`: set to `true` to process recent WhatsApp history/backfill messages after reconnect.
- `HISTORY_LOOKBACK_HOURS`: how far back history messages may be processed. Defaults to `24`.
- `HEARTBEAT_INTERVAL_MS`: how often the bot records that WhatsApp is online. Defaults to `30000`.
- `CATCHUP_MIN_GAP_MS`: minimum offline gap before catch-up runs. Defaults to `120000`.
- `CATCHUP_MAX_AGE_HOURS`: maximum age for catch-up/outbox messages. Defaults to `72`.
- `CATCHUP_DIGEST_THRESHOLD`: number of missed vacancies that triggers one digest email. Defaults to `3`.
- `CATCHUP_SETTLE_MS`: time after reconnect before catch-up recovery is summarized and drained. Defaults to `30000`. Catch-up rows are held this long before sending so they can be grouped into a digest.
- `OUTBOX_DRAIN_INTERVAL_MS`: how often pending outbox rows (held catch-up rows, failed sends) are retried. Defaults to `60000`.

## Commands

- `npm run dev`: run the bot with `tsx`.
- `npm run list:chats`: connect to WhatsApp and print group JIDs plus configured channel link resolutions.
- `npm run test:email`: send one SMTP test email using `.env`.
- `npm run typecheck`: run strict TypeScript checks.
- `npm run lint`: run ESLint.
- `npm run test`: run unit tests.
- `npm run build`: compile production JavaScript to `dist/`.

## Dashboard

The bot starts a local KPI dashboard on `127.0.0.1:4000` by default. On a VPS, view it through an SSH tunnel:

```bash
ssh -L 4000:localhost:4000 <user>@<vps-host>
```

Then open `http://localhost:4000` on your own machine.

## Offline Catch-Up

The bot records when WhatsApp was last connected. On every reconnect, it uses that timestamp to accept recent group history messages delivered by WhatsApp and to fetch recent channel messages from watched `@newsletter` JIDs. Every matched vacancy is written to `vacancy_outbox` before SMTP is attempted, so a crash or SMTP outage leaves it pending for the next drain.

Large catch-up batches are sent as one digest email. Smaller catch-up batches are sent individually with a missed-while-offline subject prefix. Sent outbox rows are pruned after 30 days.

Known limitations:

- Group recovery is best effort: it covers only what WhatsApp delivers on reconnect, and retention for an offline linked device is not documented.
- If the WhatsApp session has been logged out, nothing can be recovered until the QR is re-scanned.
- Messages in chats not on the watch list are ignored.

Manual verification:

1. Stop the bot.
2. From another account, post a clearly matching vacancy in a watched group and, if possible, in a watched channel.
3. Wait at least 5 minutes.
4. Start the bot.
5. Expect log lines for the detected gap and accepted catch-up messages, and an email within about a minute marked as missed while offline or sent as a digest.
6. Restart the bot again and confirm nothing is re-sent.

## Docker Engine

Build the production output first, then build and run the image:

```bash
npm run build
docker build -t whatsapp-job-notifier .
docker run --env-file .env -v whatsapp_auth:/app/auth_session -v whatsapp_data:/app/data whatsapp-job-notifier
```
