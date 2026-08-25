import type { AttachmentRef, ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '../composer/types';
import type { EvidenceRef } from '../transcript';
import type {
  AgentHubPlatform,
  AgentHubSurface,
  PreviewPort,
  RedispatchTaskResult,
  SurfaceCapabilities,
  TerminalPort,
  WorkspaceFileEntry,
  WorkspaceFilesPort,
  WorkspaceGitChange,
  WorkspaceGitCommit,
  WorkspaceGitPort,
  TerminalResizePayload,
  TerminalSession,
  TerminalSessionId,
  TerminalSpawnOptions,
  TerminalWritePayload,
  WorkbenchConversation,
} from './types';

export interface MockPlatformSeed {
  surface?: AgentHubSurface;
  capabilities?: Partial<SurfaceCapabilities>;
  conversations?: WorkbenchConversation[];
  pickFiles?: () => Promise<ComposerAttachment[]>;
  openEvidence?: (evidence: EvidenceRef) => Promise<void>;
  /**
   * Full preview port passthrough (#1967 run-review apply tests). Takes
   * precedence over the `openEvidence`-derived minimal port when both are
   * provided.
   */
  preview?: PreviewPort;
  /**
   * Optional terminal port. When omitted and `capabilities.localTerminal === true`,
   * a fixture mock port is attached so Desktop-shaped tests can exercise the panel.
   * Web defaults keep `localTerminal` false and omit the port.
   */
  terminal?: TerminalPort;
  workspaceFiles?: WorkspaceFilesPort;
  workspaceGit?: WorkspaceGitPort;
}

export interface MockTerminalPort extends TerminalPort {
  sessions: TerminalSession[];
  writes: TerminalWritePayload[];
  resizes: TerminalResizePayload[];
  closed: TerminalSessionId[];
}

export interface MockPlatform extends AgentHubPlatform {
  seed: {
    conversations: WorkbenchConversation[];
  };
  openedEvidence: EvidenceRef[];
  submittedIntents: ComposerIntent[];
  /** Dispatch-only retries recorded by `runs.redispatchTask` (CF22 queue). */
  redispatchCalls: Array<{ intent: ComposerIntent; messageId: string }>;
  /** Per-message action calls recorded by `messageActions` (Hub REST wiring). */
  messageActionCalls: Array<
    | { type: 'pin'; messageId: string; sessionId: string }
    | { type: 'unpin'; messageId: string; sessionId: string }
    | { type: 'forward'; messageId: string; targetSessionIds: string[] }
    | { type: 'recall'; messageId: string }
    | { type: 'react'; messageId: string; sessionId: string; emoji: string }
  >;
  terminal?: MockTerminalPort | TerminalPort;
}

const defaultCapabilities: SurfaceCapabilities = {
  localEdge: false,
  localFiles: false,
  browserPreview: false,
  localTerminal: false,
};

export function createMockTerminalPort(seedSessions: TerminalSession[] = []): MockTerminalPort {
  const sessions: TerminalSession[] = seedSessions.map((session) => ({ ...session }));
  const writes: TerminalWritePayload[] = [];
  const resizes: TerminalResizePayload[] = [];
  const closed: TerminalSessionId[] = [];
  let seq = sessions.length;

  return {
    sessions,
    writes,
    resizes,
    closed,
    async list() {
      return sessions.map((session) => ({ ...session }));
    },
    async spawn(options: TerminalSpawnOptions = {}) {
      seq += 1;
      const session: TerminalSession = {
        id: `mock-term-${seq}`,
        title: options.title?.trim() || `Terminal ${seq}`,
        status: 'running',
        createdAt: new Date(0).toISOString(),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.cols != null ? { cols: options.cols } : {}),
        ...(options.rows != null ? { rows: options.rows } : {}),
      };
      sessions.push(session);
      return { ...session };
    },
    async write(payload: TerminalWritePayload) {
      writes.push(payload);
      const session = sessions.find((item) => item.id === payload.sessionId);
      if (!session) {
        throw new Error(`Unknown terminal session: ${payload.sessionId}`);
      }
    },
    async resize(payload: TerminalResizePayload) {
      resizes.push(payload);
      const session = sessions.find((item) => item.id === payload.sessionId);
      if (!session) {
        throw new Error(`Unknown terminal session: ${payload.sessionId}`);
      }
      session.cols = payload.cols;
      session.rows = payload.rows;
    },
    async close(sessionId: TerminalSessionId) {
      closed.push(sessionId);
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index < 0) {
        throw new Error(`Unknown terminal session: ${sessionId}`);
      }
      const current = sessions[index];
      if (!current) {
        throw new Error(`Unknown terminal session: ${sessionId}`);
      }
      sessions[index] = {
        ...current,
        status: 'exited',
      };
    },
  };
}


export function createMockWorkspaceFilesPort(
  entries: WorkspaceFileEntry[] = [],
): WorkspaceFilesPort {
  return {
    async list() {
      return entries.map((e) => ({ ...e }));
    },
  };
}

export function createMockWorkspaceGitPort(seed?: {
  changes?: WorkspaceGitChange[];
  commits?: WorkspaceGitCommit[];
}): WorkspaceGitPort {
  const changes = seed?.changes ?? [];
  const commits = seed?.commits ?? [];
  return {
    async listChanges() {
      return changes.map((c) => ({ ...c }));
    },
    async listLog(_root?: string, limit = 20) {
      return commits.slice(0, limit).map((c) => ({ ...c }));
    },
  };
}

export function createMockPlatform(seed: MockPlatformSeed = {}): MockPlatform {
  const conversations = seed.conversations ?? [];
  const openedEvidence: EvidenceRef[] = [];
  const submittedIntents: ComposerIntent[] = [];
  const redispatchCalls: Array<{ intent: ComposerIntent; messageId: string }> = [];
  const messageActionCalls: MockPlatform['messageActionCalls'] = [];
  const capabilities: SurfaceCapabilities = {
    ...defaultCapabilities,
    ...seed.capabilities,
  };

  const terminal =
    seed.terminal
    ?? (capabilities.localTerminal ? createMockTerminalPort() : undefined);

  return {
    surface: seed.surface ?? 'web',
    capabilities,
    seed: {
      conversations,
    },
    openedEvidence,
    submittedIntents,
    redispatchCalls,
    messageActionCalls,
    messageActions: {
      async pinMessage(messageId: string, sessionId: string): Promise<void> {
        messageActionCalls.push({ type: 'pin', messageId, sessionId });
      },
      async unpinMessage(messageId: string, sessionId: string): Promise<void> {
        messageActionCalls.push({ type: 'unpin', messageId, sessionId });
      },
      async forwardMessage(messageId: string, targetSessionIds: string[]): Promise<void> {
        messageActionCalls.push({ type: 'forward', messageId, targetSessionIds });
      },
      async recallMessage(messageId: string): Promise<void> {
        messageActionCalls.push({ type: 'recall', messageId });
      },
      async addMessageReaction(messageId: string, sessionId: string, reaction: { emoji: string }): Promise<void> {
        messageActionCalls.push({ type: 'react', messageId, sessionId, emoji: reaction.emoji });
      },
    },
    conversations: {
      async list() {
        return conversations;
      },
    },
    ...(seed.pickFiles
      ? {
          attachments: {
            pickFiles: seed.pickFiles,
            async uploadAttachment(file: File): Promise<AttachmentRef> {
              return {
                id: `mock-attachment-${file.name}`,
                name: file.name,
                original_name: file.name,
                size: file.size,
                mime_type: file.type || 'application/octet-stream',
              };
            },
            async uploadAttachmentWithProgress(
              file: File,
              onProgress: (progress: { percent: number; phase: 'hashing' | 'uploading' | 'done' }) => void,
            ): Promise<AttachmentRef> {
              onProgress({ percent: 10, phase: 'hashing' });
              await new Promise((resolve) => setTimeout(resolve, 10));
              onProgress({ percent: 45, phase: 'uploading' });
              await new Promise((resolve) => setTimeout(resolve, 10));
              onProgress({ percent: 90, phase: 'uploading' });
              return {
                id: `mock-attachment-${file.name}`,
                name: file.name,
                original_name: file.name,
                size: file.size,
                mime_type: file.type || 'application/octet-stream',
              };
            },
          },
        }
      : {}),
    ...(seed.preview
      ? { preview: seed.preview }
      : seed.openEvidence
        ? {
            preview: {
              async openEvidence(evidence: EvidenceRef): Promise<void> {
                openedEvidence.push(evidence);
                await seed.openEvidence?.(evidence);
              },
            },
          }
        : {}),
    ...(terminal ? { terminal } : {}),
    ...(seed.workspaceFiles ? { workspaceFiles: seed.workspaceFiles } : {}),
    ...(seed.workspaceGit ? { workspaceGit: seed.workspaceGit } : {}),
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        submittedIntents.push(intent);
        return {
          intentId: `mock-intent-${submittedIntents.length}`,
        };
      },
      async redispatchTask(intent: ComposerIntent, messageId: string): Promise<RedispatchTaskResult> {
        redispatchCalls.push({ intent, messageId });
        return {
          taskId: `mock-task-${redispatchCalls.length}`,
        };
      },
    },
  };
}
