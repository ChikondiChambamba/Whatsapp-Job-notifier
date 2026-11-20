import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import type { BotMessage, ShellMessage } from '../src/desktop/messages.js';

const APP_NAME = 'WhatsApp Alerts';
const START_HIDDEN_FLAG = '--hidden';
const NOTIFY_BATCH_MS = 4000;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bot: UtilityProcess | null = null;
let botUrl: string | null = null;
let quitting = false;
let shownTrayHint = false;
const restartTimes: number[] = [];

// ---------------------------------------------------------------- helpers

const userDataPath = (...parts: string[]) => join(app.getPath('userData'), ...parts);
const assetPath = (name: string) => join(app.getAppPath(), 'assets', name);

function readFlag(name: string): boolean {
  return existsSync(userDataPath(name));
}

function writeFlag(name: string): void {
  writeFileSync(userDataPath(name), new Date().toISOString());
}

/**
 * A random key for encrypting the email password and API key in the
 * database. The key itself is stored encrypted by the operating system
 * (Windows DPAPI, macOS Keychain, libsecret on Linux).
 */
async function loadSecretKey(): Promise<string | undefined> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    console.warn('OS encryption unavailable; secrets will be stored unencrypted');
    return undefined;
  }
  const file = userDataPath('secret.key');
  if (existsSync(file)) {
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(readFileSync(file));
      if (shouldReEncrypt) {
        // The OS rotated its key; store ours again under the new one.
        writeFileSync(file, await safeStorage.encryptStringAsync(result));
      }
      return result;
    } catch (error) {
      // A key we cannot open (e.g. the OS profile changed). Starting over
      // means the user re-enters their passwords; everything else is kept.
      console.error('could not unlock the saved secret key; creating a new one', error);
    }
  }
  const key = randomBytes(32).toString('base64');
  writeFileSync(file, await safeStorage.encryptStringAsync(key));
  return key;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function loadingPage(message: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#111513;color:#e6ebe7}
@media (prefers-color-scheme: light){body{background:#f6f7f5;color:#1c2420}}</style>
<p>${message}</p>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// ---------------------------------------------------------------- bot process

async function startBot(): Promise<void> {
  const port = await findFreePort();
  const secretKey = await loadSecretKey();
  botUrl = null;

  bot = utilityProcess.fork(join(app.getAppPath(), 'dist', 'index.js'), [], {
    serviceName: `${APP_NAME} bot`,
    stdio: 'pipe',
    env: {
      ...process.env,
      APP_DATA_DIR: app.getPath('userData'),
      DASHBOARD_PORT: String(port),
      ...(secretKey ? { APP_SECRET_KEY: secretKey } : {}),
    },
  });

  bot.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  bot.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));

  bot.on('message', (message: BotMessage) => {
    if (message.type === 'ready') {
      botUrl = `http://127.0.0.1:${message.port}/`;
      void mainWindow?.loadURL(botUrl);
    } else if (message.type === 'alert') {
      queueNotification(message);
    } else if (message.type === 'fatal') {
      dialog.showErrorBox(APP_NAME, `The app could not start: ${message.message}`);
    }
  });

  bot.on('exit', (code) => {
    bot = null;
    if (quitting) {
      return;
    }
    const now = Date.now();
    restartTimes.push(now);
    while (restartTimes.length > 0 && (restartTimes[0] ?? 0) < now - RESTART_WINDOW_MS) {
      restartTimes.shift();
    }
    if (restartTimes.length > MAX_RESTARTS) {
      void mainWindow?.loadURL(loadingPage('The app keeps stopping. Please restart it, or check the logs.'));
      dialog.showErrorBox(APP_NAME, `The background service stopped unexpectedly (code ${code}) and is not restarting.`);
      return;
    }
    void mainWindow?.loadURL(loadingPage('Restarting…'));
    setTimeout(() => void startBot(), 2000);
  });
}

function stopBot(): Promise<void> {
  const running = bot;
  if (!running) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      running.kill();
      resolve();
    }, 5000);
    running.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    const message: ShellMessage = { type: 'shutdown' };
    running.postMessage(message);
  });
}

// ---------------------------------------------------------------- window

function createWindow(show: boolean): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 420,
    minHeight: 500,
    title: APP_NAME,
    icon: assetPath('icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadURL(botUrl ?? loadingPage('Starting…'));

  if (show) {
    mainWindow.once('ready-to-show', () => mainWindow?.show());
  }

  // Stay on the app; anything else opens in the user's browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!botUrl || !url.startsWith(botUrl)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (quitting) {
      return;
    }
    // Keep watching WhatsApp in the background.
    event.preventDefault();
    mainWindow?.hide();
    if (!shownTrayHint && Notification.isSupported()) {
      shownTrayHint = true;
      new Notification({
        title: `${APP_NAME} is still running`,
        body: 'It keeps watching your groups. Use the tray icon to open it again or quit.',
      }).show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(hash?: string): void {
  if (!mainWindow) {
    createWindow(true);
  } else {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
  if (hash && botUrl) {
    void mainWindow?.loadURL(`${botUrl}#${hash}`);
  }
}

function openExternal(url: string): void {
  if (url.startsWith('https://')) {
    void shell.openExternal(url);
  }
}

// ---------------------------------------------------------------- tray

function startsAtLogin(): boolean {
  return app.getLoginItemSettings({ args: [START_HIDDEN_FLAG] }).openAtLogin;
}

function setStartAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: [START_HIDDEN_FLAG] });
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: `Open ${APP_NAME}`, click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Start when I sign in',
      type: 'checkbox',
      checked: startsAtLogin(),
      click: (item) => {
        setStartAtLogin(item.checked);
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  const image = nativeImage.createFromPath(
    assetPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
  );
  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showWindow());
}

// ---------------------------------------------------------------- notifications

let pending: Array<Extract<BotMessage, { type: 'alert' }>> = [];
let notifyTimer: NodeJS.Timeout | null = null;

/** Batches alerts so a catch-up burst becomes one notification. */
function queueNotification(alert: Extract<BotMessage, { type: 'alert' }>): void {
  pending.push(alert);
  notifyTimer ??= setTimeout(flushNotifications, NOTIFY_BATCH_MS);
}

function flushNotifications(): void {
  notifyTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0 || !Notification.isSupported()) {
    return;
  }

  const [first] = batch;
  const notification =
    batch.length === 1 && first
      ? new Notification({
          title: `${first.profileName}: ${first.sourceName}`,
          body: first.text.replace(/\s+/g, ' ').slice(0, 180),
        })
      : new Notification({
          title: `${batch.length} new matches`,
          body: Array.from(new Set(batch.map((a) => a.profileName))).join(', '),
        });
  notification.on('click', () => showWindow('/'));
  notification.show();
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.whatsappalerts.app');
    mkdirSync(app.getPath('userData'), { recursive: true });

    // Alerts are only useful if the app is running, so start at sign-in by
    // default the first time. The tray menu turns it off.
    if (!readFlag('first-run-done')) {
      if (app.isPackaged) {
        setStartAtLogin(true);
      }
      writeFlag('first-run-done');
    }

    createTray();
    createWindow(!process.argv.includes(START_HIDDEN_FLAG));
    await startBot();
  });

  // The tray keeps the app alive with no windows open.
  app.on('window-all-closed', () => undefined);

  app.on('activate', () => showWindow());

  app.on('before-quit', (event) => {
    if (quitting) {
      return;
    }
    quitting = true;
    event.preventDefault();
    void stopBot().finally(() => app.exit(0));
  });
}
