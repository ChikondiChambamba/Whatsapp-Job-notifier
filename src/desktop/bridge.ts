import type { BotMessage, ShellMessage } from './messages.js';

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

/** Present only when running inside the desktop app (Electron utility process). */
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

export const runningInDesktop = parentPort !== undefined;

export function sendToShell(message: BotMessage): void {
  parentPort?.postMessage(message);
}

export function onShellMessage(listener: (message: ShellMessage) => void): void {
  parentPort?.on('message', (event) => {
    const data = event.data as ShellMessage | undefined;
    if (data && typeof data === 'object' && 'type' in data) {
      listener(data);
    }
  });
}
