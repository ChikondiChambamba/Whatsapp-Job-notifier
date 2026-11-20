# WhatsApp Alerts

WhatsApp Alerts watches the WhatsApp groups and channels you choose and tells you when a message matches what you are looking for: job vacancies, rooms to rent, items for sale, announcements, anything you can describe with words. Matches reach you by email, by WhatsApp message, as a desktop notification, or simply in the app's list.

It runs on your own computer and links to your WhatsApp the same way WhatsApp Web does. Your messages are not sent to any server run by the app's authors.

> **Important.** This app uses an unofficial WhatsApp connection ([Baileys](https://github.com/WhiskeySockets/Baileys)). WhatsApp does not allow unofficial apps and can suspend numbers that use them. Use it at your own risk, ideally with a number you could afford to lose. Do not use it to send bulk or unsolicited messages.
>
> "WhatsApp" is a trademark of WhatsApp LLC. This project is not affiliated with or endorsed by WhatsApp or Meta. The working name should change before any public release.

---

## Contents

**Using the app**

1. [What you need](#what-you-need)
2. [Installing](#installing)
3. [First-time setup](#first-time-setup)
4. [Alerts: deciding what to match](#alerts-deciding-what-to-match)
5. [How alerts reach you](#how-alerts-reach-you)
6. [Optional AI check](#optional-ai-check)
7. [Groups and channels](#groups-and-channels)
8. [The overview and match statuses](#the-overview-and-match-statuses)
9. [When the computer is off: catch-up](#when-the-computer-is-off-catch-up)
10. [Running in the background](#running-in-the-background)
11. [Privacy and your data](#privacy-and-your-data)
12. [Updating, moving and uninstalling](#updating-moving-and-uninstalling)
13. [Troubleshooting](#troubleshooting)

**Developing and hosting**

14. [How it works](#how-it-works)
15. [Project layout](#project-layout)
16. [Running from source](#running-from-source)
17. [Configuration](#configuration)
18. [Data model and migrations](#data-model-and-migrations)
19. [Matching engine](#matching-engine)
20. [Delivery pipeline](#delivery-pipeline)
21. [HTTP API](#http-api)
22. [Security model](#security-model)
23. [Testing](#testing)
24. [Building installers](#building-installers)
25. [Running on a server or in Docker](#running-on-a-server-or-in-docker)
26. [Upgrading from the original single-user bot](#upgrading-from-the-original-single-user-bot)
27. [Known limitations](#known-limitations)

---

# Using the app

## What you need

- A Windows 10 or 11 computer (64-bit). A macOS build is possible but has to be produced on a Mac (see [Building installers](#building-installers)).
- WhatsApp on your phone, with the number you want to watch groups from.
- The computer switched on and online while you want live alerts. Messages posted while it is off are caught up later (see [catch-up](#when-the-computer-is-off-catch-up)).
- Optional: a Gmail (or other) email account for email alerts.
- Optional: an [Anthropic API key](https://console.anthropic.com/settings/keys) for the AI check.

## Installing

1. Download `WhatsApp Alerts Setup <version>.exe`.
2. Double-click it. Test builds are not code-signed, so Windows may show **"Windows protected your PC"**. Click **More info**, then **Run anyway**. Some antivirus tools also warn about unsigned apps.
3. Choose where to install (the default is fine) and finish. The app opens.

The app adds itself to start when you sign in to Windows. You can turn that off from the tray menu.

## First-time setup

The app walks you through four steps.

1. **Link WhatsApp.** On your phone open WhatsApp, then **Settings** (iPhone) or the **⋮ menu** (Android) → **Linked devices** → **Link a device**, and scan the code on screen. The code refreshes every few seconds.
2. **Choose groups and channels.** Tick the groups to watch. For channels, open the channel in WhatsApp, tap its name, then **Share → Copy link**, and paste the link into the app.
3. **Create your first alert.** Start from a template ("Job vacancies" for tech and civil engineering roles) or from scratch, adjust the words, and try it on a real message before saving.
4. **Set up email** (you can skip this and use WhatsApp messages or notifications instead).

After setup you land on the **Overview**. Everything can be changed later from the sidebar: **Alerts**, **Groups & channels**, and **Settings**.

## Alerts: deciding what to match

An alert describes one kind of message you want to hear about. You can have as many as you like, for example "Nursing jobs", "Rooms in Area 47" and "Cheap laptops". Each message from a watched chat is checked against every alert that covers that chat, and a message matching two alerts produces two alerts.

### Word lists

Each alert has one or more **lists of words**. Each list has a name, a number of **points**, and a setting for **how it counts**:

| How it counts | Meaning |
|---|---|
| **Must mention one of these** | The message has to mention at least one word from a "must mention" list, or it is skipped. These lists also add their points. |
| **Adds points** | If any word in the list appears, the message gets the list's points. |
| **Rules the message out** | Words here take points away. Each different word found counts, up to three times. |

A list scores its points once, however many of its words appear (except "rules out" lists, as above).

### Writing words

- Words and phrases match **whole words**, ignore capital letters, and ignore extra spaces: `software developer` matches "Senior SOFTWARE  Developer" but not "software developers".
- Use `*` for word endings: `engineer*` matches engineer, engineers and engineering.
- Punctuation is matched literally, so `c++`, `.net` and `m&e officer` work.
- Advanced: a term written as `/pattern/flags` is a regular expression, for example `/back-?end (dev|engineer)/i`.

Tips:

- Put the thing itself in a "must mention" list (job titles, "room to rent", "laptop") and supporting signals in "adds points" lists ("hiring", "apply by", "per month").
- Add a "rules out" list for common false alarms: people asking for work, other professions, "wanted" posts when you want offers.
- Long numbered posts that list many unrelated items can be skipped with **Skip long numbered lists that mostly mention ignored words** (on by default in the Job vacancies template).

### How strict

The **How strict** slider sets how many points a message needs. Lower means more alerts; higher means fewer and more precise. The app shows how many points your lists can add up to, and warns if the setting is higher than that.

### Where to look

Each alert can cover **all groups and channels you watch** or **only selected ones**.

### Trying it out

At the bottom of every alert:

- **Paste a message** to see straight away whether it would alert you, how many points it scored, and which words matched.
- **Check recent messages** shows what the alert would have caught in the last 7 days of messages from your watched chats. This costs nothing and is the best way to tune an alert.
- **Ask the AI about this message** appears when the [AI check](#optional-ai-check) is on.

## How alerts reach you

Each alert chooses its own delivery under **How to alert me**. Any combination works; with nothing turned on, matches are only listed in the app.

### Email

Set up in **Settings → Email alerts**.

- **Gmail:** choose Gmail, enter your address, and an **app password** (not your normal password). Turn on 2-Step Verification for your Google account, then create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and paste the 16-letter code.
- **Outlook / Hotmail, Yahoo:** presets are included; these also usually need an app password.
- **Other providers:** choose "Other" and enter the SMTP server and port (587 for STARTTLS, 465 for SSL).
- Alerts go to your own address unless you enter a different one in **Send alerts to**.
- Use **Send test email** after saving.

Each email shows the alert name, the group or channel, the matched words, the AI's reason if the AI check is on, and the full message.

### WhatsApp message

Set up in **Settings → WhatsApp alerts**, then turn on **WhatsApp message** in each alert that should use it.

- **My own chat ("Message yourself")**: alerts appear in your own chat. Your phone usually does **not** ring for these, because WhatsApp treats them as messages you sent. Good as a log you can check.
- **Another WhatsApp number**: for example a second SIM or a family member's phone. That phone gets a normal notification. Enter the number with its country code (for example `265 99 123 4567`); the app checks that the number is on WhatsApp before saving.
- Use **Send test message** to check it.

Messages are sent from your linked WhatsApp, so they only go out while the app is connected; anything waiting is sent when it reconnects.

### Desktop notifications

The desktop app shows a notification for each match. If several arrive within a few seconds (for example after being offline) they are grouped into one. Clicking it opens the app.

## Optional AI check

The AI check catches messages that match your words but are not what you want, for example someone asking for a developer job when you want developer vacancies.

1. In **Settings → AI check**, paste an Anthropic API key and choose a model. The key is checked with one small request before it is saved.
2. In an alert, turn on **Double-check with AI** and describe what you want in plain words, as you would to a friend: *"Vacancies for software developers or IT support in Malawi. Not people asking for jobs, not sales roles."*

From then on, every message that passes the word lists is sent to Claude together with your description, and Claude answers yes or no with a one-line reason.

- Matches the AI rejects are kept in the app as **Skipped by AI**, with the reason, instead of being delivered.
- Approved matches are delivered as usual, with the reason included.
- **Cost:** you pay Anthropic directly through your key. Only messages that already matched your words are checked, and the check is kept short. Claude Opus 5.5 is the default and most accurate; Claude Sonnet 5.5 and Claude Haiku 5.5 are cheaper options in the same menu (prices are shown next to each).
- **It never blocks alerts by accident.** If the AI cannot be reached after 3 tries, the key stops working, or the model declines to judge a message, the alert is delivered anyway with a note saying it was not checked.
- **Privacy:** for alerts with the AI check on, the text of matching messages is sent to Anthropic.

## Groups and channels

**Groups & channels** lists every group your WhatsApp account belongs to, with a search box. Tick a group to watch it, untick to stop.

Channels cannot be listed by WhatsApp, so they are added by link (in WhatsApp: open the channel, tap its name, **Share → Copy link**). Channels you follow that have posted recently appear under **Channels you follow** with a **Watch** button. A channel added while WhatsApp is offline shows **waiting to connect** and is looked up on the next connection.

Only messages from ticked chats are read. Private chats are never read.

## The overview and match statuses

The **Overview** shows today's numbers (messages checked, matches, emails sent) and the latest matches. Each match shows its alert, the chat, when it was posted, the message, and its status:

| Status | Meaning |
|---|---|
| Emailed | The email was sent. |
| Waiting to send | Ready to send; waiting for email to be set up or for the next send attempt. |
| Being checked by AI | Waiting for the AI's answer. |
| Skipped by AI | The AI decided it was not what you want (the reason is shown). |
| Shown here only | The alert has email turned off. |
| Failed | Email failed 5 times; hover to see the error. |
| Too old to send | It was more than 3 days old by the time it could be sent. |
| WhatsApp sent / waiting / failed / too old | The same for the WhatsApp message, when that alert uses it. |

"Missed while offline" marks matches found by the catch-up after the app was off.

## When the computer is off: catch-up

When the app starts or reconnects after being offline for more than 2 minutes, it looks for what it missed:

- **Groups:** WhatsApp re-delivers recent group messages to linked devices. How far back this goes is decided by WhatsApp.
- **Channels:** the app fetches recent posts from each watched channel.
- Messages up to **3 days** old are checked. Older ones are ignored.
- If **3 or more** missed matches are found, they arrive as one summary email and one WhatsApp message instead of many.
- Nothing is sent twice: every message is remembered once it has been checked.

## Running in the background

- Closing the window **does not stop** the app; it keeps watching from the tray (the bell icon near the clock). The first time, a notification reminds you.
- Click the tray icon to open the window. Right-click for **Open**, **Start when I sign in**, and **Quit**.
- **Quit** stops watching. The app records the time it stopped so the next start can catch up.
- Alerts only arrive while the computer is on, awake and online.

## Privacy and your data

Everything is stored on your computer, in `%APPDATA%\WhatsApp Alerts` on Windows (`~/Library/Application Support/WhatsApp Alerts` on macOS):

| Folder | Contents |
|---|---|
| `data/` | The app database: your settings, alerts, watched chats, match history, and the last 7 days of messages from watched chats (at most 2,000, used for "Check recent messages"). |
| `auth_session/` | The WhatsApp link. Anyone with this folder can act as your linked device, so treat it like a password. |
| `logs/` | Diagnostic logs. `scored-messages.log` contains message text. |
| `secret.key` | The key that encrypts your saved passwords, itself protected by Windows (DPAPI) or the macOS Keychain. |

What leaves your computer:

- **WhatsApp** traffic, as with WhatsApp Web.
- **Email** alerts, through the mail server you configured.
- **WhatsApp alert messages**, to the chat you chose.
- **Message text sent to Anthropic**, only for alerts with the AI check turned on.

Your email password and API key are stored encrypted, and the app's web page never shows them again after saving. The app's web interface only accepts connections from your own computer.

## Updating, moving and uninstalling

- **Updating:** install the new version over the old one. Your settings, alerts and WhatsApp link are kept. There is no automatic update yet.
- **Moving to another computer:** install the app there, quit it, and copy the `data/` and `auth_session/` folders across. Saved passwords cannot be decrypted on another computer, so you will be asked to enter the email password and API key again.
- **Unlinking WhatsApp:** **Settings → WhatsApp → Unlink this computer**, or remove the device from your phone under **Linked devices**. The app then shows a new code.
- **Uninstalling:** Windows **Settings → Apps → WhatsApp Alerts → Uninstall**. To remove your data too, delete `%APPDATA%\WhatsApp Alerts`. Then remove the device from **Linked devices** on your phone.

## Troubleshooting

**The QR code does not appear or keeps saying "Starting…"**
Check the internet connection. If it persists, quit from the tray and start the app again. Logs are in `%APPDATA%\WhatsApp Alerts\logs\bot.log`.

**"WhatsApp is not connected" banner**
The app reconnects by itself, waiting up to a minute between tries. If the banner says the device was unlinked, scan the new code in **Settings**.

**I get no alerts**
- Is the alert switched on, and does it cover the chat (**Where to look**)?
- Is the chat ticked in **Groups & channels**?
- Use **Check recent messages** in the alert. If nothing matches, lower **How strict** or add words.
- Look at the Overview: matches may be waiting because email is not set up, or skipped by the AI.

**Too many alerts**
Raise **How strict**, add a "rules out" list, restrict **Where to look**, or turn on the AI check.

**Email test fails with "Invalid login"**
Gmail needs an app password, not your normal password, and 2-Step Verification must be on. Re-enter the app password in **Settings**.

**WhatsApp alerts arrive but my phone doesn't ring**
That is how "Message yourself" works. Choose **Another WhatsApp number** in **Settings → WhatsApp alerts**.

**"Saved key could not be read" / asked for passwords again**
The app could not unlock its encryption key (for example after moving to another computer or Windows profile). Re-enter the email password and API key.

**Windows warns about the installer**
Test builds are not signed. Click **More info → Run anyway**.

---

# Developing and hosting

## How it works

```
                 ┌──────────────────────────────── Desktop app (Electron) ─┐
                 │  main process: tray, window, notifications, secret key │
                 │        │ utilityProcess.fork          ▲ messages        │
                 │        ▼                              │                 │
WhatsApp ◄─────► │  Bot process (dist/index.js)  ───────┘                 │
 (Baileys)       │   WhatsAppClient ─► MessagePipeline ─► alert_outbox     │
                 │        │               │ RuleEngine     │               │
                 │        │               │ (per profile)  ▼               │
                 │        │               │          AiReviewer ─► Claude  │
                 │        │               ▼                │               │
                 │        │         SQLite database        ▼               │
                 │        │                          OutboxSender          │
                 │        │                           ├─► email (SMTP)     │
                 │        └◄──────────────────────────┴─► WhatsApp message │
                 │   Express API + React UI on 127.0.0.1:<port> ◄── window │
                 └─────────────────────────────────────────────────────────┘
```

1. `WhatsAppClient` keeps the Baileys connection, writes a heartbeat, and on reconnect works out how long it was offline and fetches missed channel posts.
2. Messages from watched chats go to `MessagePipeline`, which stores them in the 7-day buffer, scores them against every enabled profile that covers the chat, records a score event per profile, and queues one alert per matching profile in `alert_outbox`, all in one transaction with the "seen" mark.
3. Alerts for profiles with the AI check start as `review`; `AiReviewer` asks Claude and moves them to `pending` or `rejected`.
4. `OutboxSender` drains `pending` alerts by email (or marks them in-app only) and, independently, sends WhatsApp messages. It runs after live matches, after a catch-up settles, and every minute.
5. The Express server serves the JSON API and the built React app on loopback.
6. In the desktop app, the Electron main process runs the bot as a utility process, gives it the data folder, a free port and the encryption key, and turns its alert events into notifications.

The same bot runs without Electron (`npm start`) for servers.

## Project layout

```
src/
  index.ts              Bot entry point: wires stores, pipeline, sender, server, WhatsApp
  config/               env.ts (technical settings), paths.ts (data folder)
  core/                 eventBus.ts, pipeline.ts
  profiles/             types.ts (profile schema), terms.ts, ruleEngine.ts,
                        templates.ts, jobVacancyRules.ts (Job vacancies word lists)
  services/             database.ts, migrations.ts, settingsStore.ts, outboxStore.ts,
                        outboxSender.ts, emailService.ts, aiChecker.ts, aiReviewer.ts,
                        statsStore.ts, botStateStore.ts, recentMessagesStore.ts,
                        secretBox.ts, legacyImport.ts, whatsappAlertFormat.ts, logger.ts
  server/               app.ts (API + static UI), security.ts, server.ts
  whatsapp/             client.ts, channelResolver.ts, newsletterMessages.ts
  desktop/              messages.ts, bridge.ts (bot <-> Electron messages)
  tools/                listChats.ts, testEmail.ts (command-line helpers)
web/                    React + Vite interface (src/pages, src/components)
desktop/                Electron main process (main.ts)
assets/                 App and tray icons
```

Build output: `dist/` (bot), `web-dist/` (interface), `desktop-dist/` (Electron main), `release/` (installers). All are gitignored.

## Running from source

Requirements: Node.js 20 or newer (24 is used in development), npm, and on Windows the build tools that `better-sqlite3` needs if no prebuilt binary matches.

```bash
npm install
npm run build
npm start                 # bot + web interface on http://127.0.0.1:4000
```

| Command | What it does |
|---|---|
| `npm start` | Run the built bot and interface. |
| `npm run dev` | Run the bot from source with `tsx`. |
| `npm run web:dev` | Interface with hot reload on http://localhost:5173 (needs `npm run dev`; API calls are proxied). |
| `npm run desktop` | Build, rebuild SQLite for Electron, start the desktop app, then rebuild SQLite for Node. |
| `npm run dist:win` / `dist:mac` | Build installers into `release/` (see [Building installers](#building-installers)). |
| `npm run build` | Compile bot, interface and Electron main. |
| `npm test` | Unit and API tests (Vitest). |
| `npm run typecheck` | TypeScript checks for all three parts. |
| `npm run lint` | ESLint. |
| `npm run list:chats` | Connect and print your groups (watched ones marked `*`) and watched channels. |
| `npm run test:email` | Send one test email with the saved settings. |

When running from source, data goes in the project folder (`data/`, `auth_session/`, `logs/`) unless `APP_DATA_DIR` is set. If you start Electron from a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` first (VS Code sets it, which makes Electron behave like plain Node).

## Configuration

User settings (email, WhatsApp target, AI key, watched chats, alerts) live in the database and are edited in the app. `.env` only holds technical settings; copy `.env.example` to start.

| Variable | Default | Purpose |
|---|---|---|
| `APP_DATA_DIR` | current folder | Where `data/`, `auth_session/` and `logs/` live. The desktop app sets this to its app-data folder. |
| `DASHBOARD_PORT` | `4000` | Port of the web interface. The desktop app picks a free port. |
| `LISTEN_HOST` | `127.0.0.1` | Interface to bind. Only change inside a container. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `PROCESS_HISTORY_MESSAGES` | `false` | Also process history/backfill batches WhatsApp delivers (`append` upserts). Needed for group catch-up. |
| `HEARTBEAT_INTERVAL_MS` | `30000` | How often "last online" is recorded. |
| `CATCHUP_MIN_GAP_MS` | `120000` | Offline time before catch-up runs. |
| `CATCHUP_MAX_AGE_HOURS` | `72` | Oldest message that is still checked or delivered. |
| `CATCHUP_DIGEST_THRESHOLD` | `3` | Number of missed matches that are combined into one email / WhatsApp message. |
| `CATCHUP_SETTLE_MS` | `30000` | How long catch-up alerts are held so they can be combined. |
| `OUTBOX_DRAIN_INTERVAL_MS` | `60000` | Interval of the periodic send/retry pass. |
| `APP_SECRET_KEY` | none | 32-byte base64 key for encrypting saved secrets. Set by the desktop app; without it secrets are stored as plain text. |

Legacy variables (`SMTP_*`, `ALERT_EMAIL_TO`, `WATCHED_*`, `MATCH_THRESHOLD`) are imported once; see [Upgrading](#upgrading-from-the-original-single-user-bot).

## Data model and migrations

One SQLite database (`data/seen_messages.db`, WAL mode), migrated with `PRAGMA user_version` in `src/services/migrations.ts`. Migrations are append-only; a database newer than the app refuses to open.

| Table | Purpose |
|---|---|
| `settings` | Key/value JSON: `email`, `ai`, `whatsapp_alerts`, import marker. Secrets inside are encrypted (`enc:v1:` prefix) when a key is available. |
| `sources` | Watched groups and channels (`jid`, `name`, `type`, `invite_link` for unresolved channel links). |
| `profiles` | Alerts, stored as JSON validated by `profileSchema` on every read. |
| `seen_messages` | Every processed message ID, so nothing is handled twice. |
| `alert_outbox` | One row per (message, profile) match: email `status`, AI verdict (`ai_relevant`, `ai_reason`), WhatsApp delivery (`wa_state`, `wa_attempts`, `wa_error`, `wa_sent_at`). Sent rows are pruned after 30 days. |
| `vacancy_events` | One score record per (message, profile) for statistics. |
| `recent_messages` | Text of watched messages for 7 days (max 2,000) for previews. |
| `bot_state`, `downtime_windows` | Last-online time and catch-up history. |

| Version | Change |
|---|---|
| 1 | Original single-user schema. |
| 2 | Settings, sources, profiles; per-profile `alert_outbox` replaces `vacancy_outbox`. |
| 3 | `recent_messages`. |
| 4 | AI verdict columns. |
| 5 | WhatsApp delivery columns. |

## Matching engine

`src/profiles/ruleEngine.ts`. For each rule group, every term is tried once; the distinct matched texts are the group's hits.

- `score += weight × min(distinctHits, maxCountedHits)` for each group with hits (`maxCountedHits` is 1 for normal groups, 3 for exclude groups).
- **Gate:** if any group is `required`, at least one required group must hit.
- **List-post filter:** if enabled and the message has at least `minListItems` numbered/bulleted lines and at least `minExcludedHits` distinct hits in negative-weight groups, subtract `penalty`.
- **Match:** gate passed and `score >= threshold`.

Terms (`src/profiles/terms.ts`): plain phrases become `\b…\b` regexes with `\s+` between words and `\w*` for `*`; `/pattern/flags` terms are used as-is (stateful `g`/`y` flags are dropped). Compiled profiles are cached until `updatedAt` changes.

The Job vacancies template (`jobVacancyRules.ts`) is the original hand-written ruleset rewritten as plain words. On 2,243 real logged messages it makes the same match decision as the original regular expressions for every message.

## Delivery pipeline

Alert row lifecycle (`alert_outbox.status`):

```
           ┌─► review ──(AI yes / AI unavailable)──┐
match ─────┤                                        ▼
           └──────────────────────────────────► pending ──► sent
                       review ──(AI no)──► rejected   │ ├─► in_app   (profile email off)
                                                       │ ├─► failed   (5 failed attempts)
                                                       │ └─► expired  (older than max age)
```

- Every drain: run `AiReviewer`, expire old rows, hold unsettled catch-up rows, flag WhatsApp delivery for profiles that want it, send email, then send WhatsApp.
- Email: each send retries 3 times with backoff; a row fails after 5 drains. Catch-up batches at or above the threshold become one digest.
- WhatsApp (`wa_state`): `pending → sent | failed (5 attempts) | expired`, independent of email. Waits while WhatsApp is disconnected. Catch-up batches become one combined message (up to 10 entries).
- AI review: temporary failures retry on 3 drains, then release; permanent failures (bad key, refusal) release at once. Released rows carry a note in `ai_reason`.
- Each delivered alert emits `alert.ready`, which the desktop app turns into a notification.

## HTTP API

All endpoints are under `/api` on the loopback server and return JSON.

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | WhatsApp state, QR code image (while waiting), setup progress. |
| GET | `/stats` | Last 24 hours of counts. |
| GET | `/chats` | Groups the account is in (with `watched`) and suggested channels. 409 when offline. |
| POST | `/whatsapp/logout` | Unlink and show a new QR code. |
| GET / POST | `/sources` | List / add a watched chat by JID. |
| POST | `/sources/channel-link` | Add a channel by invite link (202 if saved for later). |
| DELETE | `/sources/:id` | Stop watching. |
| GET | `/templates` | Alert templates with their profiles. |
| GET / POST | `/profiles` | List / create alerts (ID generated from the name). |
| POST | `/profiles/from-template` | Create from a template. |
| PUT / DELETE | `/profiles/:id` | Update / delete. |
| POST | `/profiles/test` | Score pasted text against a draft profile. |
| POST | `/profiles/preview` | Matches of a draft profile among recent messages. |
| POST | `/profiles/ai-test` | Ask the AI about pasted text (one paid call). |
| GET | `/matches?limit=` | Recent alerts with statuses. |
| GET / PUT | `/settings/email` | Email settings (password never returned; blank keeps it). |
| POST | `/settings/email/test` | Send a test email. |
| GET / PUT | `/settings/whatsapp-alerts` | WhatsApp alert target (number checked on WhatsApp). |
| POST | `/settings/whatsapp-alerts/test` | Send a test WhatsApp message. |
| GET / PUT / DELETE | `/settings/ai` | AI key and model (key verified before saving; only the last 4 characters returned). |

Validation errors return 400 with `{ error, issues }`; "WhatsApp not connected" returns 409.

## Security model

- The server binds to `127.0.0.1` only.
- Requests whose `Host` is not a loopback name are rejected (prevents DNS rebinding).
- Requests carrying an `Origin` must come from a loopback origin, and `POST` bodies must be JSON, so other websites cannot change settings with forms. No CORS headers are ever sent.
- Email password and API key are encrypted with AES-256-GCM using a key from the OS credential store (desktop app), and are never returned by the API.
- WhatsApp message text sent to the AI is marked as untrusted and the answer is constrained to a JSON yes/no schema.
- The Electron window uses `contextIsolation`, `sandbox` and no Node integration; navigation away from the app is blocked and external `https` links open in the system browser.
- `auth_session/` is the most sensitive item on disk: it grants access to the linked device.

## Testing

```bash
npm test            # ~100 tests: engine, terms, stores, migrations, pipeline, sender, AI, API, security
npm run typecheck
npm run lint
```

API tests start the real Express app on a random port with fake WhatsApp and AI services. The AI tests check the request shape sent to the Anthropic SDK without calling the API; the first real call happens when a key is saved in the app.

## Building installers

```bash
npm run dist:win    # release/WhatsApp Alerts Setup <version>.exe
npm run dist:mac    # release/WhatsApp Alerts-<version>.dmg (run on a Mac)
```

- `better-sqlite3` is a native module. Packaging rebuilds it for Electron; the scripts then run `npm rebuild better-sqlite3` so tests and `npm start` work with Node again. If tests fail with a `NODE_MODULE_VERSION` error, run that command.
- The build uses the Electron copy in `node_modules/electron/dist` (`electronDist` in `package.json`) to avoid downloading it again.
- **Signing:** unsigned Windows installers trigger SmartScreen; sign with a code-signing certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`). macOS needs an Apple Developer account for signing and notarization, otherwise users must right-click → Open.
- On first launch the packaged app registers itself to start at sign-in with `--hidden` (tray only).

## Running on a server or in Docker

For an always-on setup without a desktop:

```bash
npm run build
docker compose up -d --build
docker compose logs -f        # scan the QR code shown here on first run
```

The compose file publishes the interface on the host's `127.0.0.1:4000` only and keeps `auth_session/`, `data/` and `logs/` in the project folder. On a VPS, open the interface through an SSH tunnel:

```bash
ssh -L 4000:localhost:4000 <user>@<server>
```

then browse to http://localhost:4000. Without the desktop app there is no OS-protected key, so set `APP_SECRET_KEY` (32 random bytes, base64) in `.env` if you want secrets encrypted at rest; keep that value safe, since losing it means re-entering the passwords.

## Upgrading from the original single-user bot

The first start of this version upgrades an existing `data/seen_messages.db` in place (match history and pending alerts are kept) and imports `.env` once:

- `SMTP_*`, `ALERT_EMAIL_TO` → email settings
- `WATCHED_GROUP_JIDS`, `WATCHED_CHANNEL_JIDS`, `WATCHED_CHANNEL_LINKS` → watched chats
- `MATCH_THRESHOLD` → threshold of a new "Job vacancies" alert

After that, those `.env` values are ignored. Back up `data/` first if you might want to go back: older versions cannot open the upgraded database. To move the setup into the desktop app, quit the app and copy `data/` and `auth_session/` into its app-data folder.

## Known limitations

- **Unofficial client:** WhatsApp protocol changes can break the connection until Baileys is updated, and numbers can be suspended.
- **Group catch-up** depends on what WhatsApp re-delivers to a linked device; it is not guaranteed.
- **Channel catch-up** relies on a WhatsApp request that is not officially documented; if WhatsApp does not answer it, missed channel posts are not recovered (the logs show `strategy: "none"`).
- **"Message yourself" alerts** usually do not make the phone ring.
- **Linked devices** stay linked while the phone is offline for up to about 14 days, after which WhatsApp unlinks them and a new QR scan is needed.
- **No automatic updates** yet; new versions are installed manually.
- **Text only:** captions on images, videos and documents are read; the media itself is not.
