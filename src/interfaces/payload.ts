export type SourceType = 'GROUP' | 'CHANNEL';

export interface RawVacancyMessage {
  messageId: string;
  sourceJid: string;
  sourceName: string;
  sourceType: SourceType;
  sender: string;
  rawText: string;
  timestamp: Date;
  origin: 'live' | 'catchup';
}

export interface VacancyPayload extends RawVacancyMessage {
  matchedKeywords: string[];
  score: number;
}
