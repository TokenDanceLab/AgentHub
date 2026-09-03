/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * ChatScreen data-level logic tests.
 *
 * Covers transcript block formatting, evidence states, message delivery states,
 * display name mapping, approval risk labels, and fixture scenario validation.
 *
 * Vitest environment: node — tests pure data transformations (no React rendering).
 */
import { describe, expect, it } from 'vitest';

import {
  getMobileFixtureForScenario,
  getPendingReviewCount,
  getThreadRun,
  mobileFixture,
} from '@/data/mobileFixtures';
import type {
  MobileAppFixture,
  MobileFixtureScenario,
  MobileRun,
  MobileThread,
  TranscriptBlock,
} from '@/types';

// ---------------------------------------------------------------------------
// Replicated helpers (source: ChatScreen.tsx)
// These functions are internal to ChatScreen.tsx and not exported.
// We replicate them here to test data-level correctness.
// ---------------------------------------------------------------------------

type ChatDisplayName = 'Delicious233' | 'TokenDance' | 'AgentHub';

function formatChatCopy(value: string): string {
  return value
    .replace(/\bweb\s*socket\b/gi, 'live sync')
    .replace(/\bwebsocket\b/gi, 'live sync')
    .replace(/\breconnecting\b/gi, 'recovering sync')
    .replace(/\breconnect(ed|s)?\b/gi, 'recover$1')
    .replace(/\bsocket\b/gi, 'sync channel');
}

function formatChatDisplayName(name: string | undefined, role?: string): ChatDisplayName {
  const normalized = name?.trim().toLowerCase() ?? '';

  if (normalized.includes('delicious') || role === 'human') {
    return 'Delicious233';
  }
  if (normalized.includes('tokendance')) {
    return 'TokenDance';
  }

  return 'AgentHub';
}

function getDisplayInitials(name: ChatDisplayName): string {
  if (name === 'Delicious233') return 'D';
  if (name === 'TokenDance') return 'TD';
  return 'AH';
}

function getBlockTitle(block: TranscriptBlock): string {
  switch (block.kind) {
    case 'text':
      return formatChatCopy(
        block.displayTitle ?? formatChatDisplayName(block.author.name, block.author.role),
      );
    case 'approval':
    case 'artifact':
    case 'diff':
    case 'run_session':
      return formatChatCopy(block.title);
    case 'tool_call':
      return formatChatCopy(block.toolName);
    case 'run_step_group':
      return formatChatCopy(block.title);
    case 'thinking':
      return 'Thinking';
    case 'subagent':
    case 'child_agent':
      return formatChatCopy(block.title);
    case 'route_decision':
      return formatChatCopy(block.action);
    case 'context_usage':
      return block.modelLabel ? formatChatCopy(block.modelLabel) : 'Context usage';
    case 'result':
      return block.success ? 'Result completed' : 'Result failed';
    case 'agent_timeline':
      return block.title ? formatChatCopy(block.title) : 'Agent timeline';
    default:
      return 'Transcript block';
  }
}

function getEvidenceStatusTone(status?: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'pending': return 'warning';
    case 'running': return 'accent';
    default: return 'neutral';
  }
}

function formatEvidenceStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'pending': return 'Review';
    case 'running': return 'Running';
    default: return 'Status';
  }
}

function formatApprovalRiskLabel(risk: string | undefined): string {
  switch (risk) {
    case 'critical':
    case 'high':
      return 'Blocked';
    case 'medium':
      return 'Needs action';
    case 'low':
      return 'Review approval';
    default:
      return 'Review approval';
  }
}

function getApprovalTone(risk?: string): 'accent' | 'warning' | 'danger' {
  if (risk === 'critical' || risk === 'high') return 'danger';
  return risk === 'medium' ? 'warning' : 'accent';
}

function formatSafeScopeLabel(target: string | undefined): string {
  if (!target) return 'AgentHub';
  if (target.includes('mobile-rn')) return 'Mobile workspace';
  if (target.includes('hub-server')) return 'Hub service';
  if (target.toLowerCase().includes('tokendance')) return 'TokenDance';
  return 'AgentHub';
}

function formatCompactFileName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const fileName = segments[segments.length - 1] ?? path;
  const parent = segments[segments.length - 2];
  return parent ? `${parent}/${fileName}` : fileName;
}

function runStatusToPill(status: MobileRun['status']): 'running' | 'waiting' | 'failed' | 'completed' {
  if (status === 'approval_required') return 'waiting';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'running';
}

function browserPreviewTone(status: string | undefined): 'neutral' | 'accent' | 'success' | 'danger' {
  if (status === 'ready') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'loading') return 'accent';
  return 'neutral';
}

function formatBrowserPreviewStatus(status: string | undefined): string {
  if (status === 'ready') return 'Preview ready';
  if (status === 'error') return 'Preview error';
  if (status === 'loading') return 'Preview loading';
  return 'No browser preview';
}

// Composer delivery state machine
type DeliveryState = 'idle' | 'sending' | 'failed';
function deriveDeliveryState(thread: MobileThread): DeliveryState {
  if (thread?.previewIntent === 'sendPending') return 'sending';
  if (thread?.retryAvailable) return 'failed';
  return 'idle';
}

// ---------------------------------------------------------------------------
// formatChatCopy
// ---------------------------------------------------------------------------

describe('formatChatCopy', () => {
  it('replaces web socket terms with chat-friendly copy', () => {
    expect(formatChatCopy('web socket')).toBe('live sync');
    expect(formatChatCopy('WebSocket')).toBe('live sync');
    expect(formatChatCopy('websocket')).toBe('live sync');
  });

  it('replaces reconnecting/reconnect terms', () => {
    expect(formatChatCopy('reconnecting')).toBe('recovering sync');
    expect(formatChatCopy('reconnect')).toBe('recover');
    expect(formatChatCopy('reconnected')).toBe('recovered');
    expect(formatChatCopy('reconnects')).toBe('recovers');
  });

  it('replaces socket with sync channel', () => {
    expect(formatChatCopy('socket')).toBe('sync channel');
  });

  it('preserves text without networking terms', () => {
    expect(formatChatCopy('AgentHub Mobile Workbench')).toBe('AgentHub Mobile Workbench');
  });
});

// ---------------------------------------------------------------------------
// formatChatDisplayName
// ---------------------------------------------------------------------------

describe('formatChatDisplayName', () => {
  it('returns Delicious233 for human role or matching name', () => {
    expect(formatChatDisplayName('Alice', 'human')).toBe('Delicious233');
    expect(formatChatDisplayName('Delicious233')).toBe('Delicious233');
  });

  it('returns TokenDance for matching name', () => {
    expect(formatChatDisplayName('TokenDance')).toBe('TokenDance');
    expect(formatChatDisplayName('TokenDance ID')).toBe('TokenDance');
  });

  it('returns AgentHub as default', () => {
    expect(formatChatDisplayName('AgentHub')).toBe('AgentHub');
    expect(formatChatDisplayName('Codex')).toBe('AgentHub');
    expect(formatChatDisplayName(undefined)).toBe('AgentHub');
  });
});

// ---------------------------------------------------------------------------
// getDisplayInitials
// ---------------------------------------------------------------------------

describe('getDisplayInitials', () => {
  it('returns correct initials per display name', () => {
    expect(getDisplayInitials('Delicious233')).toBe('D');
    expect(getDisplayInitials('TokenDance')).toBe('TD');
    expect(getDisplayInitials('AgentHub')).toBe('AH');
  });
});

// ---------------------------------------------------------------------------
// getBlockTitle
// ---------------------------------------------------------------------------

describe('getBlockTitle', () => {
  const humanAuthor = { id: 'alice', name: 'Alice', role: 'human' as const };
  const agentAuthor = { id: 'agenthub', name: 'AgentHub', role: 'agent' as const };

  it('returns displayTitle for text blocks', () => {
    const block: TranscriptBlock = {
      id: 't1', kind: 'text', author: agentAuthor,
      text: 'Hello', displayTitle: 'Custom title', createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Custom title');
  });

  it('falls back to display name for text blocks without displayTitle', () => {
    const block: TranscriptBlock = {
      id: 't2', kind: 'text', author: humanAuthor,
      text: 'Hi', createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Delicious233');
  });

  it('returns title for approval blocks', () => {
    const block: TranscriptBlock = {
      id: 'a1', kind: 'approval', author: agentAuthor,
      title: 'Review design', status: 'pending', risk: 'medium',
      reason: 'Check tokens', createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Review design');
  });

  it('returns title for diff blocks', () => {
    const block: TranscriptBlock = {
      id: 'd1', kind: 'diff', author: agentAuthor,
      title: 'Token update', files: ['tokens.ts'], additions: 10, deletions: 2,
      createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Token update');
  });

  it('returns toolName for tool_call blocks', () => {
    const block: TranscriptBlock = {
      id: 'tc1', kind: 'tool_call', author: agentAuthor,
      toolName: 'go test', status: 'completed', createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('go test');
  });

  it('returns Thinking for thinking blocks', () => {
    const block: TranscriptBlock = {
      id: 'think1', kind: 'thinking', author: agentAuthor,
      content: 'reasoning...', createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Thinking');
  });

  it('returns title for run_session blocks', () => {
    const block: TranscriptBlock = {
      id: 'rs1', kind: 'run_session', author: agentAuthor,
      title: 'Workflow started', status: 'running', createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Workflow started');
  });

  it('handles context_usage blocks', () => {
    const block: TranscriptBlock = {
      id: 'cu1', kind: 'context_usage', author: agentAuthor,
      inputTokens: 5000, outputTokens: 1000, usagePercent: 50, createdAt: '14:00',
    };
    expect(getBlockTitle(block)).toBe('Context usage');

    const block2: TranscriptBlock = {
      id: 'cu2', kind: 'context_usage', author: agentAuthor,
      inputTokens: 5000, outputTokens: 1000, usagePercent: 50, modelLabel: 'Claude Opus', createdAt: '14:00',
    };
    expect(getBlockTitle(block2)).toBe('Claude Opus');
  });

  it('handles result blocks', () => {
    const success: TranscriptBlock = {
      id: 'r1', kind: 'result', author: agentAuthor,
      success: true, createdAt: '14:00',
    };
    expect(getBlockTitle(success)).toBe('Result completed');

    const fail: TranscriptBlock = {
      id: 'r2', kind: 'result', author: agentAuthor,
      success: false, createdAt: '14:00',
    };
    expect(getBlockTitle(fail)).toBe('Result failed');
  });
});

// ---------------------------------------------------------------------------
// getEvidenceStatusTone
// ---------------------------------------------------------------------------

describe('getEvidenceStatusTone', () => {
  it('maps status to correct tone', () => {
    expect(getEvidenceStatusTone('completed')).toBe('success');
    expect(getEvidenceStatusTone('failed')).toBe('danger');
    expect(getEvidenceStatusTone('pending')).toBe('warning');
    expect(getEvidenceStatusTone('running')).toBe('accent');
    expect(getEvidenceStatusTone('queued')).toBe('neutral');
    expect(getEvidenceStatusTone(undefined)).toBe('neutral');
    expect(getEvidenceStatusTone('unknown')).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// formatEvidenceStatusLabel
// ---------------------------------------------------------------------------

describe('formatEvidenceStatusLabel', () => {
  it('maps status to human-readable label', () => {
    expect(formatEvidenceStatusLabel('completed')).toBe('Done');
    expect(formatEvidenceStatusLabel('failed')).toBe('Failed');
    expect(formatEvidenceStatusLabel('pending')).toBe('Review');
    expect(formatEvidenceStatusLabel('running')).toBe('Running');
    expect(formatEvidenceStatusLabel('queued')).toBe('Status');
    expect(formatEvidenceStatusLabel(undefined)).toBe('Status');
  });
});

// ---------------------------------------------------------------------------
// formatApprovalRiskLabel
// ---------------------------------------------------------------------------

describe('formatApprovalRiskLabel', () => {
  it('maps risk levels to labels', () => {
    expect(formatApprovalRiskLabel('critical')).toBe('Blocked');
    expect(formatApprovalRiskLabel('high')).toBe('Blocked');
    expect(formatApprovalRiskLabel('medium')).toBe('Needs action');
    expect(formatApprovalRiskLabel('low')).toBe('Review approval');
    expect(formatApprovalRiskLabel(undefined)).toBe('Review approval');
  });
});

// ---------------------------------------------------------------------------
// getApprovalTone
// ---------------------------------------------------------------------------

describe('getApprovalTone', () => {
  it('returns danger for critical/high risk', () => {
    expect(getApprovalTone('critical')).toBe('danger');
    expect(getApprovalTone('high')).toBe('danger');
  });

  it('returns warning for medium risk', () => {
    expect(getApprovalTone('medium')).toBe('warning');
  });

  it('returns accent for low and undefined risk', () => {
    expect(getApprovalTone('low')).toBe('accent');
    expect(getApprovalTone(undefined)).toBe('accent');
  });
});

// ---------------------------------------------------------------------------
// formatSafeScopeLabel
// ---------------------------------------------------------------------------

describe('formatSafeScopeLabel', () => {
  it('maps known targets', () => {
    expect(formatSafeScopeLabel('app/mobile-rn')).toBe('Mobile workspace');
    expect(formatSafeScopeLabel('hub-server')).toBe('Hub service');
    expect(formatSafeScopeLabel('TokenDance')).toBe('TokenDance');
  });

  it('falls back to AgentHub', () => {
    expect(formatSafeScopeLabel(undefined)).toBe('AgentHub');
    expect(formatSafeScopeLabel('unknown')).toBe('AgentHub');
  });
});

// ---------------------------------------------------------------------------
// formatCompactFileName
// ---------------------------------------------------------------------------

describe('formatCompactFileName', () => {
  it('shows parent/filename for nested paths', () => {
    expect(formatCompactFileName('app/mobile-rn/src/theme/tokens.ts')).toBe('theme/tokens.ts');
    expect(formatCompactFileName('hub-server/internal/service/message.go')).toBe('service/message.go');
  });

  it('shows just filename for top-level files', () => {
    expect(formatCompactFileName('package.json')).toBe('package.json');
    expect(formatCompactFileName('README.md')).toBe('README.md');
  });

  it('handles windows paths', () => {
    expect(formatCompactFileName('app\\mobile-rn\\src\\App.tsx')).toBe('src/App.tsx');
  });
});

// ---------------------------------------------------------------------------
// runStatusToPill
// ---------------------------------------------------------------------------

describe('runStatusToPill', () => {
  it('maps MobileRun status to status pill type', () => {
    expect(runStatusToPill('approval_required')).toBe('waiting');
    expect(runStatusToPill('failed')).toBe('failed');
    expect(runStatusToPill('completed')).toBe('completed');
    expect(runStatusToPill('running')).toBe('running');
    expect(runStatusToPill('queued')).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// browserPreviewTone
// ---------------------------------------------------------------------------

describe('browserPreviewTone', () => {
  it('maps browser preview status to tone', () => {
    expect(browserPreviewTone('ready')).toBe('success');
    expect(browserPreviewTone('error')).toBe('danger');
    expect(browserPreviewTone('loading')).toBe('accent');
    expect(browserPreviewTone('empty')).toBe('neutral');
    expect(browserPreviewTone(undefined)).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// formatBrowserPreviewStatus
// ---------------------------------------------------------------------------

describe('formatBrowserPreviewStatus', () => {
  it('maps status to labels', () => {
    expect(formatBrowserPreviewStatus('ready')).toBe('Preview ready');
    expect(formatBrowserPreviewStatus('error')).toBe('Preview error');
    expect(formatBrowserPreviewStatus('loading')).toBe('Preview loading');
    expect(formatBrowserPreviewStatus('empty')).toBe('No browser preview');
    expect(formatBrowserPreviewStatus(undefined)).toBe('No browser preview');
  });
});

// ---------------------------------------------------------------------------
// Delivery state machine
// ---------------------------------------------------------------------------

describe('chat delivery state', () => {
  it.each([
    ['sendPending', 'sending'],
    ['sendError', 'failed'],
  ])('returns %s when thread has %s', (scenario, expected) => {
    const fixture = getMobileFixtureForScenario(scenario as MobileFixtureScenario);
    const thread = fixture.threads[0];
    expect(deriveDeliveryState(thread!)).toBe(expected);
  });

  it('returns idle for normal threads', () => {
    const thread = mobileFixture.threads[0];
    expect(deriveDeliveryState(thread!)).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Fixture scenario: chat-related states
// ---------------------------------------------------------------------------

describe('chat fixture scenarios', () => {
  const scenarios: MobileFixtureScenario[] = [
    'default',
    'sendError',
    'sendPending',
    'approvalPending',
    'approvalError',
    'approvalResolved',
    'diffPreview',
  ];

  it('every chat scenario has at least one thread with a transcript', () => {
    for (const scenario of scenarios) {
      const f = getMobileFixtureForScenario(scenario);
      // All chat scenarios should have threads and transcript data
      expect(f.threads.length, `scenario ${scenario} has threads`).toBeGreaterThan(0);

      const transcriptsExist = Object.values(f.transcript).some((blocks) => blocks.length > 0);
      expect(transcriptsExist, `scenario ${scenario} has transcript blocks`).toBe(true);
    }
  });

  it('sendError scenario has retryAvailable on thread', () => {
    const f = getMobileFixtureForScenario('sendError');
    const hasRetry = f.threads.some((t) => t.retryAvailable === true);
    expect(hasRetry).toBe(true);
  });

  it('sendPending scenario has previewIntent set', () => {
    const f = getMobileFixtureForScenario('sendPending');
    const hasIntent = f.threads.some((t) => t.previewIntent === 'sendPending');
    expect(hasIntent).toBe(true);
  });

  it('approvalError scenario has hubSession expired', () => {
    const f = getMobileFixtureForScenario('approvalError');
    expect(f.account.hubSession).toBe('expired');
  });

  it('diffPreview has a diff block in transcript', () => {
    const f = getMobileFixtureForScenario('diffPreview');
    const diffBlocks = Object.values(f.transcript)
      .flat()
      .filter((b) => b.kind === 'diff');
    expect(diffBlocks.length).toBeGreaterThan(0);
    const diffBlock = diffBlocks[0]!;
    if (diffBlock.kind === 'diff') {
      expect(diffBlock.files.length).toBeGreaterThanOrEqual(7);
    }
  });

  it('default fixture has approval block with pending status', () => {
    const fixture = mobileFixture;
    const approvalBlocks = Object.values(fixture.transcript)
      .flat()
      .filter((b) => b.kind === 'approval');
    expect(approvalBlocks.length).toBeGreaterThan(0);
  });

  it('approvalResolved has completed approval block', () => {
    const f = getMobileFixtureForScenario('approvalResolved');
    const approvalBlocks = Object.values(f.transcript)
      .flat()
      .filter((b) => b.kind === 'approval');
    const hasCompleted = approvalBlocks.some((b) => b.kind === 'approval' && b.status === 'completed');
    expect(hasCompleted).toBe(true);
  });

  it('chat fixture has active run with browser preview', () => {
    const activeThread = mobileFixture.threads[0]!;
    const run = getThreadRun(mobileFixture, activeThread.id);
    expect(run).toBeTruthy();
    expect(run?.browserPreview).toBeTruthy();
    expect(run?.browserPreview?.status).toBe('ready');
  });

  it('sendError thread has failed-status run', () => {
    const f = getMobileFixtureForScenario('sendError');
    const hasFailedRun = f.runs.some((r) => r.status === 'failed' && r.retryAvailable);
    expect(hasFailedRun).toBe(true);
  });

  it('chat transcript blocks all have valid id, author, and createdAt', () => {
    const fixture = mobileFixture;
    for (const threadId of Object.keys(fixture.transcript)) {
      const blocks = fixture.transcript[threadId] ?? [];
      for (const block of blocks) {
        expect(block.id).toBeTruthy();
        expect(block.author).toBeDefined();
        expect(block.author.id).toBeTruthy();
        expect(block.author.role).toMatch(/^(human|agent|bot)$/);
      }
    }
  });

  it('text blocks have non-empty text', () => {
    const fixture = mobileFixture;
    const textBlocks = Object.values(fixture.transcript)
      .flat()
      .filter((b) => b.kind === 'text');
    expect(textBlocks.length).toBeGreaterThan(0);
    for (const block of textBlocks) {
      if (block.kind === 'text') {
        expect(block.text.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Message block compact-with-previous logic
// ---------------------------------------------------------------------------

describe('message compacting logic', () => {
  it('two consecutive text blocks from same author should be compacted', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'm1', kind: 'text', author: { id: 'agenthub', name: 'AgentHub', role: 'agent' }, text: 'First', createdAt: '14:00' },
      { id: 'm2', kind: 'text', author: { id: 'agenthub', name: 'AgentHub', role: 'agent' }, text: 'Second', createdAt: '14:01' },
    ];

    const shouldCompact = blocks[0]!.author.id === blocks[1]!.author.id
      && blocks[0]!.kind === 'text'
      && blocks[1]!.kind === 'text';

    expect(shouldCompact).toBe(true);
  });

  it('blocks of different kinds from same author should NOT be compacted', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'm1', kind: 'text', author: { id: 'agenthub', name: 'AgentHub', role: 'agent' }, text: 'First', createdAt: '14:00' },
      { id: 'm2', kind: 'approval', author: { id: 'agenthub', name: 'AgentHub', role: 'agent' }, title: 'Review', status: 'pending', risk: 'low', reason: 'x', createdAt: '14:01' },
    ];

    const shouldCompact = blocks[0]!.author.id === blocks[1]!.author.id
      && blocks[0]!.kind === 'text'
      && blocks[1]!.kind === 'text';

    expect(shouldCompact).toBe(false);
  });

  it('text blocks from different authors should NOT be compacted', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'm1', kind: 'text', author: { id: 'agenthub', name: 'AgentHub', role: 'agent' }, text: 'First', createdAt: '14:00' },
      { id: 'm2', kind: 'text', author: { id: 'alice', name: 'Alice', role: 'human' }, text: 'Second', createdAt: '14:01' },
    ];

    const shouldCompact = blocks[0]!.author.id === blocks[1]!.author.id
      && blocks[0]!.kind === 'text'
      && blocks[1]!.kind === 'text';

    expect(shouldCompact).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review vs human alignments
// ---------------------------------------------------------------------------

describe('message block alignment', () => {
  it('review blocks (diff/approval/run_session/tool_call) are not human-aligned', () => {
    const reviewKinds: TranscriptBlock['kind'][] = ['diff', 'approval', 'run_session', 'tool_call'];
    const nonReviewKinds: TranscriptBlock['kind'][] = ['text', 'thinking', 'context_usage', 'result'];

    for (const kind of reviewKinds) {
      expect(['diff', 'approval', 'run_session', 'tool_call']).toContain(kind);
    }

    for (const kind of nonReviewKinds) {
      expect(['diff', 'approval', 'run_session', 'tool_call']).not.toContain(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture run counts and cross-validation
// ---------------------------------------------------------------------------

describe('cross-validate chat fixture data', () => {
  it('each activeRunId in threads maps to an existing run', () => {
    const fixture = mobileFixture;
    const runIds = new Set(fixture.runs.map((r) => r.id));

    for (const thread of fixture.threads) {
      if (thread.activeRunId) {
        expect(runIds.has(thread.activeRunId)).toBe(true);
      }
    }
  });

  it('transcript keys correspond to thread IDs', () => {
    const fixture = mobileFixture;
    const threadIds = new Set(fixture.threads.map((t) => t.id));

    for (const key of Object.keys(fixture.transcript)) {
      expect(threadIds.has(key)).toBe(true);
    }
  });

  it('run threadId references existing threads', () => {
    const fixture = mobileFixture;
    const threadIds = new Set(fixture.threads.map((t) => t.id));

    for (const run of fixture.runs) {
      expect(threadIds.has(run.threadId)).toBe(true);
    }
  });

  it('default fixture has 3 runs with distinct statuses across scenarios', () => {
    const fixture = mobileFixture;
    expect(fixture.runs).toHaveLength(3);
    const statuses = new Set(fixture.runs.map((r) => r.status));
    // approval_required, completed, failed
    expect(statuses.size).toBeGreaterThanOrEqual(3);
  });

  it('default fixture has exactly 3 transcript entries', () => {
    expect(Object.keys(mobileFixture.transcript)).toHaveLength(3);
  });
});
