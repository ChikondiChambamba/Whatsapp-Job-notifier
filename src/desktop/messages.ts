// Messages between the desktop shell (Electron main process) and the bot,
// which runs as an Electron utility process. Shared by both sides.

/** Bot -> shell */
export type BotMessage =
  | { type: 'ready'; port: number }
  | { type: 'fatal'; message: string }
  | {
      type: 'alert';
      profileName: string;
      sourceName: string;
      text: string;
      origin: 'live' | 'catchup';
    };

/** Shell -> bot */
export type ShellMessage = { type: 'shutdown' };
