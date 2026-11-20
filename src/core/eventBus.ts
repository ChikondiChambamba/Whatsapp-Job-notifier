import { EventEmitter } from 'node:events';
import type { RawVacancyMessage, VacancyPayload } from '../interfaces/payload.js';

type ConnectionState = 'open' | 'close' | 'reconnecting';

interface BotEvents {
  'vacancy.raw': [RawVacancyMessage];
  'vacancy.matched': [VacancyPayload, number];
  'connection.state': [ConnectionState];
}

class TypedEventBus extends EventEmitter {
  emit<K extends keyof BotEvents>(event: K, ...args: BotEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this {
    return super.on(event, listener);
  }
}

export const bus = new TypedEventBus();
