import type {
  Project,
  Thread,
  ThreadItem,
  Message,
  Runner,
  Run,
  Approval,
  Artifact,
  Preview,
  Workspace,
  WorkspaceFile,
  ListResponse,
} from './types';
import type { AnyEvent, EventEnvelope } from './events';
import type { EventListener } from './eventClient';

// ── ID helpers ────────────────────────────────

let _seq = 0;
function seq() {
  _seq += 1;
  return _seq;
}
function evtId() {
  return `evt_${seq().toString(16).padStart(6, '0')}`;
}
function now() {
  return new Date().toISOString();
}

// ── Static mock data ──────────────────────────

export const mockProject: Project = {
  id: 'proj_1',
  name: 'AgentHub',
  description: 'Multi-agent collaboration platform',
  createdAt: '2026-05-10T08:00:00Z',
  updatedAt: '2026-05-22T12:00:00Z',
};

export const mockProjects: Project[] = [
  mockProject,
  {
    id: 'proj_2',
    name: 'CLI Tools',
    description: 'Developer tooling suite',
    createdAt: '2026-05-01T10:00:00Z',
  },
  {
    id: 'proj_3',
    name: 'Web Dashboard',
    description: 'Real-time analytics dashboard',
    createdAt: '2026-04-15T14:30:00Z',
  },
];

export const mockThreads: Thread[] = [
  {
    id: 'thread_1',
    projectId: 'proj_1',
    title: 'Implement auth middleware',
    status: 'active',
    createdAt: '2026-05-20T09:00:00Z',
    updatedAt: '2026-05-22T11:00:00Z',
  },
  {
    id: 'thread_2',
    projectId: 'proj_1',
    title: 'Fix pagination bug',
    status: 'active',
    createdAt: '2026-05-21T14:00:00Z',
    updatedAt: '2026-05-22T10:30:00Z',
  },
  {
    id: 'thread_3',
    projectId: 'proj_1',
    title: 'Add WebSocket event mock',
    status: 'active',
    createdAt: '2026-05-22T08:00:00Z',
  },
  {
    id: 'thread_4',
    projectId: 'proj_1',
    title: 'Deploy v0.2 to staging',
    status: 'archived',
    createdAt: '2026-05-18T16:00:00Z',
  },
];

export const mockMessages: Message[] = [
  {
    id: 'msg_1',
    threadId: 'thread_1',
    role: 'user',
    content: 'Can you implement JWT auth middleware for the API?',
    createdAt: '2026-05-20T09:00:00Z',
  },
  {
    id: 'msg_2',
    threadId: 'thread_1',
    role: 'agent',
    content:
      'I\'ll add JWT authentication middleware. The implementation will:\n\n1. Extract Bearer token from Authorization header\n2. Validate the JWT signature\n3. Attach user claims to request context\n4. Return 401 for invalid/missing tokens',
    createdAt: '2026-05-20T09:01:00Z',
  },
  {
    id: 'msg_3',
    threadId: 'thread_1',
    role: 'user',
    content: 'Looks good. Also add role-based access control.',
    createdAt: '2026-05-20T09:05:00Z',
  },
  {
    id: 'msg_4',
    threadId: 'thread_1',
    role: 'agent',
    content:
      'Added RBAC on top of the JWT middleware. Admin routes now require the `admin` claim.',
    createdAt: '2026-05-20T09:06:00Z',
  },
];

export const mockThreadItems: ThreadItem[] = [
  ...mockMessages.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    kind: 'message' as const,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  })),
  {
    id: 'item_1',
    threadId: 'thread_1',
    kind: 'code',
    role: 'agent',
    content: '// auth/middleware.ts\n...',
    createdAt: '2026-05-20T09:02:00Z',
  },
  {
    id: 'item_2',
    threadId: 'thread_1',
    kind: 'diff',
    role: 'agent',
    content:
      '+ import { jwtVerify } from "jose";\n+ export async function authMiddleware(req, next) { ... }',
    createdAt: '2026-05-20T09:03:00Z',
  },
];

export const mockRunners: Runner[] = [
  {
    id: 'runner_1',
    name: 'Claude Code',
    status: 'online',
    capabilities: 'code,review,debug',
  },
  {
    id: 'runner_2',
    name: 'GPT Builder',
    status: 'online',
    capabilities: 'code,test,docs',
  },
  {
    id: 'runner_3',
    name: 'Local Agent',
    status: 'offline',
    capabilities: 'shell,file',
  },
];

export const mockRuns: Run[] = [
  {
    runId: 'run_1',
    projectId: 'proj_1',
    threadId: 'thread_1',
    status: 'running',
    createdAt: '2026-05-20T09:01:00Z',
    startedAt: '2026-05-20T09:01:01Z',
  },
  {
    runId: 'run_2',
    projectId: 'proj_1',
    threadId: 'thread_2',
    status: 'finished',
    createdAt: '2026-05-21T14:01:00Z',
    startedAt: '2026-05-21T14:01:01Z',
    finishedAt: '2026-05-21T14:03:30Z',
  },
  {
    runId: 'run_3',
    projectId: 'proj_1',
    threadId: 'thread_3',
    status: 'queued',
    createdAt: '2026-05-22T08:05:00Z',
  },
];

export const mockApprovals: Approval[] = [
  {
    id: 'apr_1',
    runId: 'run_1',
    threadId: 'thread_1',
    kind: 'file_write',
    summary: 'Write to src/middleware/auth.ts',
    status: 'pending',
    createdAt: '2026-05-20T09:02:00Z',
  },
];

export const mockArtifacts: Artifact[] = [
  {
    id: 'art_1',
    runId: 'run_1',
    threadId: 'thread_1',
    kind: 'file',
    path: 'src/middleware/auth.ts',
    sizeBytes: 2048,
    createdAt: '2026-05-20T09:02:30Z',
  },
];

export const mockPreviews: Preview[] = [
  {
    id: 'prev_1',
    runId: 'run_1',
    threadId: 'thread_1',
    url: 'http://127.0.0.1:4173',
    status: 'ready',
    createdAt: '2026-05-20T09:03:00Z',
  },
];

export const mockWorkspaces: Workspace[] = [
  {
    id: 'ws_1',
    name: 'agenthub-web',
    runId: 'run_1',
    createdAt: '2026-05-20T09:00:00Z',
  },
];

export const mockWorkspaceFiles: WorkspaceFile[] = [
  { path: 'src/App.tsx', sizeBytes: 4500, modifiedAt: '2026-05-22T12:00:00Z' },
  {
    path: 'src/pages/workbench/WorkbenchPage.tsx',
    sizeBytes: 28000,
    modifiedAt: '2026-05-22T11:30:00Z',
  },
  {
    path: 'package.json',
    sizeBytes: 1200,
    modifiedAt: '2026-05-21T09:00:00Z',
  },
];

// ── Envelope factory ──────────────────────────

function envelope(
  type: string,
  payload: Record<string, unknown>,
  scope: Record<string, unknown> = {},
): EventEnvelope {
  return {
    version: 'v1',
    id: evtId(),
    seq: seq(),
    type,
    scope,
    sentAt: now(),
    payload,
  };
}

// ── Mock event stream ─────────────────────────

/**
 * Simulates a WebSocket event stream for local development.
 * Supports the same listener interface as EventClient so consumers
 * can swap between real and mock with minimal code changes.
 */
export class MockEventStream {
  private listeners = new Set<EventListener>();
  private typeListeners = new Map<string, Set<EventListener>>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onType(type: string, listener: EventListener): () => void {
    let set = this.typeListeners.get(type);
    if (!set) {
      set = new Set();
      this.typeListeners.set(type, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  emit(event: AnyEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // ignore
      }
    }
    const typed = this.typeListeners.get(event.type);
    if (typed) {
      for (const fn of typed) {
        try {
          fn(event);
        } catch {
          // ignore
        }
      }
    }
  }

  emitEnvelope(type: string, payload: Record<string, unknown>): void {
    this.emit(envelope(type, payload) as AnyEvent);
  }

  /** Emit an event after a delay. Returns a cancel function. */
  emitAfter(
    delayMs: number,
    type: string,
    payload: Record<string, unknown>,
  ): () => void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.emitEnvelope(type, payload);
    }, delayMs);
    this.timers.add(timer);
    return () => {
      clearTimeout(timer);
      this.timers.delete(timer);
    };
  }

  destroy(): void {
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers.clear();
    this.listeners.clear();
    this.typeListeners.clear();
  }
}

// ── Preset scenarios ──────────────────────────

/**
 * Plays a full run lifecycle: queued → started → output (streaming) → finished.
 * Returns the MockEventStream so the caller can subscribe before play starts.
 */
export function playRunLifecycle(
  stream: MockEventStream,
  opts: {
    runId?: string;
    projectId?: string;
    threadId?: string;
    outputLines?: string[];
    stepDelayMs?: number;
  } = {},
): MockEventStream {
  const {
    runId = 'run_mock_1',
    projectId = 'proj_1',
    threadId = 'thread_1',
    outputLines = [
      'Installing dependencies...\n',
      '✓ 142 packages installed\n',
      'Running type checks...\n',
      '✓ No type errors\n',
      'Running tests...\n',
      '✓ 23 tests passed\n',
      'Building...\n',
      '✓ Build complete in 1.2s\n',
    ],
    stepDelayMs = 400,
  } = opts;

  const scope = { projectId, threadId, runId };

  stream.emitEnvelope('run.queued', { runId, projectId, threadId });
  stream.emitAfter(stepDelayMs, 'run.started', {
    runId,
    startedAt: now(),
  });

  outputLines.forEach((line, i) => {
    stream.emitAfter(stepDelayMs * (i + 2), 'run.output', {
      runId,
      stream: 'stdout',
      offset: i,
      text: line,
    });
    if (i === outputLines.length - 1) {
      stream.emitAfter(stepDelayMs * (i + 3), 'run.status.changed', {
        runId,
        status: 'finished',
      });
      stream.emitAfter(stepDelayMs * (i + 3) + 100, 'run.finished', {
        runId,
        finishedAt: now(),
      });
    }
  });

  return stream;
}

/**
 * Simulates a streaming agent message: message.created (skeleton) then
 * several message.delta chunks.
 */
export function playMessageStream(
  stream: MockEventStream,
  opts: {
    messageId?: string;
    threadId?: string;
    fullText?: string;
    chunkSize?: number;
    chunkDelayMs?: number;
  } = {},
): MockEventStream {
  const {
    messageId = 'msg_mock_1',
    threadId = 'thread_1',
    fullText = "Here's the implementation plan:\n\n1. Add JWT middleware\n2. Add role validation\n3. Add tests\n4. Update docs",
    chunkSize = 20,
    chunkDelayMs = 100,
  } = opts;

  // Send skeleton
  stream.emitEnvelope('message.created', {
    messageId,
    threadId,
    role: 'agent',
    content: '',
  });

  // Stream deltas
  for (let offset = 0; offset < fullText.length; offset += chunkSize) {
    const delta = fullText.slice(offset, offset + chunkSize);
    const chunkIndex = Math.floor(offset / chunkSize);
    stream.emitAfter(
      chunkDelayMs * (chunkIndex + 1),
      'message.delta',
      {
        messageId,
        threadId,
        delta,
        offset,
      },
    );
  }

  return stream;
}
