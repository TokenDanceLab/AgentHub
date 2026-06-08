import type { TranscriptBlock } from '@agenthub/shared/transcript';

export type MobileThemeMode = 'system' | 'light' | 'dark' | 'oled';

export type MobileTab = 'threads' | 'chat' | 'runs' | 'account';

export type MobileSurfaceStatus = 'online' | 'running' | 'waiting' | 'failed' | 'offline' | 'muted';

export interface MobileThread {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  unread: number;
  muted?: boolean;
  participantKind: 'agent' | 'human' | 'group' | 'bot' | 'external';
  status: MobileSurfaceStatus;
  lastActivity: string;
  activeRunId?: string;
}

export interface MobileRun {
  id: string;
  threadId: string;
  title: string;
  status: 'queued' | 'running' | 'approval_required' | 'failed' | 'completed';
  target: string;
  updatedAt: string;
  summary: string;
  changedFiles: string[];
  approvalRisk?: 'low' | 'medium' | 'high' | 'critical';
}

export interface MobileAccountState {
  tokenDanceId: 'signed_in' | 'signed_out' | 'recovering';
  hubSession: 'active' | 'missing' | 'expired';
  notification: 'granted' | 'prompt' | 'blocked';
  websocket: 'connected' | 'reconnecting' | 'offline';
  deviceLabel: string;
}

export interface MobileAppFixture {
  threads: MobileThread[];
  runs: MobileRun[];
  transcript: Record<string, TranscriptBlock[]>;
  account: MobileAccountState;
}
