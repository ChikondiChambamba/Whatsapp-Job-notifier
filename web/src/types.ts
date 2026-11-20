// Mirrors of the server's API shapes (see src/profiles/types.ts and src/server/app.ts).

export interface RuleGroup {
  id: string;
  label: string;
  weight: number;
  terms: string[];
  required: boolean;
  maxCountedHits: number;
}

export interface Profile {
  id: string;
  name: string;
  enabled: boolean;
  sources: { mode: 'all' | 'selected'; jids: string[] };
  groups: RuleGroup[];
  threshold: number;
  listPostFilter: { enabled: boolean; minListItems: number; minExcludedHits: number; penalty: number };
  alerts: { email: boolean; whatsappSelf: boolean };
  ai: { enabled: boolean; description: string };
  createdAt?: number;
  updatedAt?: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  profile: Profile;
}

export type LinkState =
  | 'starting'
  | 'waiting_for_scan'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

export interface AppStatus {
  whatsapp: {
    state: LinkState;
    qrDataUrl: string | null;
    account: { jid: string; name: string | null } | null;
    lastConnectedAt: number | null;
  };
  setup: { linked: boolean; sources: number; profiles: number; email: boolean; ai: boolean };
}

export interface Source {
  id: number;
  jid: string | null;
  inviteLink: string | null;
  name: string | null;
  type: 'group' | 'channel';
  addedAt: number;
}

export interface GroupInfo {
  jid: string;
  name: string;
  participants: number;
  watched: boolean;
}

export interface ChannelInfo {
  jid: string;
  name: string;
}

export interface ScoreResult {
  matched: boolean;
  score: number;
  categoryHits: Record<string, string[]>;
  gatePassed: boolean;
  isLikelyBlast: boolean;
}

export interface PreviewResult {
  checked: number;
  matchCount: number;
  oldest: number | null;
  matches: Array<{
    messageId: string;
    sourceName: string;
    postedAt: number;
    text: string;
    score: number;
    categoryHits: Record<string, string[]>;
  }>;
}

export interface Match {
  id: number;
  profileId: string;
  profileName: string;
  sourceName: string;
  text: string;
  postedAt: number;
  score: number;
  matchedCategories: string[];
  origin: 'live' | 'catchup';
  status: 'review' | 'pending' | 'sent' | 'failed' | 'expired' | 'rejected' | 'in_app';
  aiRelevant: boolean | null;
  aiReason: string | null;
  lastError: string | null;
  sentAt: number | null;
}

export interface Stats {
  totalScored: number;
  matchedCount: number;
  emailsSent: number;
  emailsFailed: number;
  lastMessageAt: number | null;
}

export interface EmailSettings {
  configured: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  to?: string;
  fromName?: string;
  hasPassword?: boolean;
}

export interface AiModel {
  id: string;
  label: string;
  note: string;
}

export interface AiSettingsView {
  configured: boolean;
  model: string | null;
  keyHint: string | null;
  models: AiModel[];
}

export interface AiVerdict {
  relevant: boolean;
  reason: string;
}
