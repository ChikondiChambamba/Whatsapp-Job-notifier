# WhatsApp Alert Bot

A WhatsApp bot that watches chosen groups and channels and sends an alert when a message matches one of your alert profiles. The original use is job vacancies (tech and civil engineering), but a profile can describe anything: rooms to rent, items for sale, announcements.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install` and `npm run build`.
3. Start the app with `npm start` (or `npm run dev` while developing).
4. Open http://127.0.0.1:4000 and follow the setup: link WhatsApp by scanning the QR code, tick the groups and channels to watch, create an alert, and set up email.

Everything after that is managed in the app: alerts (word lists, sensitivity, which chats), groups and channels, and email settings. Each alert has a "Try it out" box and can be checked against the last 7 days of messages before saving.

### Developing the web app

Run `npm run dev` for the API and `npm run web:dev` for the interface with hot reload at http://localhost:5173 (API requests are proxied to port 4000).

### Privacy and security

- The app only listens on 127.0.0.1. Requests with a non-local Host or Origin, and cross-site form posts, are rejected so other websites cannot read or change your settings.
- Messages from watched chats are kept on this computer for 7 days (at most 2,000) to power the alert preview.
- The email app password is stored in the local database and is never sent back to the browser.

## How matching works

Settings live in the app database, not in `.env`:

- **Sources**: the WhatsApp groups and channels being watched. Channel invite links are resolved after WhatsApp connects.
- **Profiles**: one per thing you want alerts about. Each profile has:
  - which sources it watches (all, or a chosen list);
  - groups of terms, each with a weight. A message scores a group's weight when any of its terms appear. Groups with negative weights exclude messages;
  - optional *required* groups: at least one must match before anything else counts;
  - a threshold: the score needed to send an alert;
  - an optional list-post filter that marks down long numbered/bulleted posts mostly about things the profile excludes.
- **Terms** are plain words or phrases matched as whole words, ignoring case and spacing. `*` matches the rest of a word (`engineer*`). Advanced users can write a regular expression as `/pattern/flags`.

A message matching several profiles produces one alert per profile. Each profile can email its matches or, with email turned off, only list them in the app.

## Optional AI check

Each alert can also be double-checked by Claude. After a message passes the word lists, it is sent with the alert's plain-English description ("Vacancies for software developers in Malawi, not people asking for jobs") to the Anthropic API, which answers yes or no with a short reason. Rejected matches are kept in the app (marked "Skipped by AI") instead of being emailed.

- Add an Anthropic API key and pick a model in Settings. The key is checked with one request before it is saved and is never sent back to the browser. Usage is billed to that key.
- The default model is Claude Opus 5.5. Claude Sonnet 5.5 and Claude Haiku 5.5 are cheaper options in the same menu.
- Only messages that already matched the words are sent to the API, at low effort.
- It fails open: if the API cannot be reached after 3 tries, the key stops working, or the model declines to judge a message, the alert is sent anyway with a note saying it was not checked.
- Opus 5.5 and Sonnet 5.5 requests opt in to Anthropic's server-side fallback, so a declined request is retried on another model instead of failing.

## Upgrading from the .env setup

On first start the bot imports `SMTP_*`, `ALERT_EMAIL_TO`, `WATCHED_GROUP_JIDS`, `WATCHED_CHANNEL_JIDS`, `WATCHED_CHANNEL_LINKS` and `MATCH_THRESHOLD` from `.env` once, and creates a "Job vacancies" profile with the original rules. After that, those `.env` keys are ignored; the database is the source of truth. The database upgrade keeps all match history and pending alerts.

## Data location

Everything the bot writes lives under `APP_DATA_DIR` (default: the current folder): the database in `data/`, WhatsApp auth state in `auth_session/`, and logs in `logs/`. These paths are gitignored.

## Technical settings (.env)

- `APP_DATA_DIR`: folder for the database, WhatsApp session and logs. Defaults to the current folder.
- `LOG_LEVEL`: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.
- `DASHBOARD_PORT`: port for the app's web interface. Defaults to `4000`.
- `PROCESS_HISTORY_MESSAGES`: set to `true` to process recent WhatsApp history/backfill messages after reconnect.
- `HEARTBEAT_INTERVAL_MS`: how often the bot records that WhatsApp is online. Defaults to `30000`.
- `CATCHUP_MIN_GAP_MS`: minimum offline gap before catch-up runs. Defaults to `120000`.
- `CATCHUP_MAX_AGE_HOURS`: maximum age for catch-up/outbox messages. Defaults to `72`.
- `CATCHUP_DIGEST_THRESHOLD`: number of missed matches that triggers one digest email. Defaults to `3`.
- `CATCHUP_SETTLE_MS`: time after reconnect before catch-up recovery is summarized and drained. Defaults to `30000`. Catch-up alerts are held this long before sending so they can be grouped into a digest.
- `OUTBOX_DRAIN_INTERVAL_MS`: how often pending alerts (held catch-up alerts, failed sends) are retried. Defaults to `60000`.

## Commands

- `npm start`: run the built app (`npm run build` first).
- `npm run dev`: run the bot from source with `tsx`.
- `npm run web:dev`: run the web interface with hot reload (needs `npm run dev` running).
- `npm run list:chats`: connect to WhatsApp and list your groups (watched ones marked `*`) and watched channels.
- `npm run test:email`: send one test email using the saved email settings.
- `npm run typecheck`: run strict TypeScript checks.
- `npm run lint`: run ESLint.
- `npm run test`: run unit tests.
- `npm run build`: compile the server to `dist/` and the web interface to `web-dist/`.

## Running on a server

The web interface only listens on 127.0.0.1. On a VPS, open it through an SSH tunnel:

```bash
ssh -L 4000:localhost:4000 <user>@<vps-host>
```

Then open `http://localhost:4000` on your own machine.

## Offline Catch-Up

The bot records when WhatsApp was last connected. On every reconnect, it uses that timestamp to accept recent group history messages delivered by WhatsApp and to fetch recent channel messages from watched channels. Every match is written to the `alert_outbox` table before email is attempted, so a crash or SMTP outage leaves it pending for the next drain.

Large catch-up batches are sent as one digest email. Smaller catch-up batches are sent individually with a missed-while-offline subject prefix. Sent outbox rows are pruned after 30 days.

Known limitations:

- Group recovery is best effort: it covers only what WhatsApp delivers on reconnect, and retention for an offline linked device is not documented.
- If the WhatsApp session has been logged out, nothing can be recovered until the QR is re-scanned.
- Messages in chats not on the watch list are ignored.

Manual verification:

1. Stop the bot.
2. From another account, post a message that clearly matches a profile in a watched group and, if possible, in a watched channel.
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
