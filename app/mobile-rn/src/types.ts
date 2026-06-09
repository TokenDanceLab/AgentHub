import type { TranscriptBlock } from '@agenthub/shared/transcript';

export type MobileThemeMode = 'system' | 'light' | 'dark' | 'oled';

export type MobileTab =
  | 'chat'
  | 'thread'
  | 'contacts'
  | 'docs'
  | 'agents'
  | 'tasks'
  | 'projects'
  | 'settings'
  | 'more'
  | 'account';

export type MobileSurfaceStatus = 'online' | 'running' | 'waiting' | 'failed' | 'offline' | 'muted';

export interface MobileThread {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  avatarTone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  unread: number;
  muted?: boolean;
  participantKind: 'agent' | 'human' | 'group' | 'bot' | 'external';
  status: MobileSurfaceStatus;
  statusDetail?: string;
  presenceLabel?: string;
  lastActivity: string;
  activeRunId?: string;
  reviewDensity?: 'light' | 'normal' | 'dense' | 'critical';
  evidenceCount?: number;
  previewIntent?: MobileFixtureScenario;
  deepLinkPath?: string;
  retryAvailable?: boolean;
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
  reviewDensity?: 'light' | 'normal' | 'dense' | 'critical';
  evidenceCount?: number;
  statusDetail?: string;
  previewIntent?: MobileFixtureScenario;
  deepLinkPath?: string;
  filePreview?: MobileFilePreview;
  browserPreview?: MobileBrowserPreview;
  retryAvailable?: boolean;
}

export interface MobileDiffPreviewLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
}

export interface MobileFilePreview {
  selectedPath?: string;
  diffLines?: MobileDiffPreviewLine[];
}

export interface MobileBrowserPreview {
  status: 'empty' | 'loading' | 'ready' | 'error';
  url?: string;
  title?: string;
  description?: string;
}

export type MobileInspectorSheetMode = 'review' | 'approveConfirm' | 'rejectConfirm' | 'approvalError';

export interface MobileAccountState {
  tokenDanceId: 'signed_in' | 'signed_out' | 'recovering';
  hubSession: 'active' | 'missing' | 'expired';
  notification: 'granted' | 'prompt' | 'blocked';
  hubSync: 'active' | 'recovering' | 'offline';
  deviceLabel: string;
}

export interface MobileAppFixture {
  threads: MobileThread[];
  runs: MobileRun[];
  transcript: Record<string, TranscriptBlock[]>;
  account: MobileAccountState;
}

export type MobileFixtureScenario =
  | 'default'
  | 'empty'
  | 'offline'
  | 'notification'
  | 'deeplink'
  | 'sendError'
  | 'sendPending'
  | 'approvalPending'
  | 'approvalError'
  | 'approvalResolved'
  | 'diffPreview'
  | 'previewMatrix';
