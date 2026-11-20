export type SourceType = 'GROUP' | 'CHANNEL';

/** A text message from a watched group or channel, before any rules run. */
export interface IncomingMessage {
  messageId: string;
  sourceJid: string;
  sourceName: string;
  sourceType: SourceType;
  sender: string;
  rawText: string;
  timestamp: Date;
  origin: 'live' | 'catchup';
}

/** A message that matched an alert profile and is ready to be sent. */
export interface AlertPayload extends IncomingMessage {
  profileId: string;
  profileName: string;
  matchedKeywords: string[];
  score: number;
}
