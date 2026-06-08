import type { TranscriptBlock } from '@agenthub/shared/transcript';

import type { MobileAppFixture } from '@/types';

const agentAuthor = { id: 'builder', name: 'Builder', role: 'agent' } as const;
const humanAuthor = { id: 'delicious', name: 'Delicious233', role: 'human' } as const;

const designThreadTranscript: TranscriptBlock[] = [
  {
    id: 'm1',
    kind: 'text',
    author: humanAuthor,
    text: '把 Mobile 迁移成 Expo/RN，但视觉和组件语义要继承 AgentHub Desktop v4。',
    createdAt: '14:02',
    badgeLabel: 'Plan',
    badgeVariant: 'primary',
  },
  {
    id: 'm2',
    kind: 'run_session',
    author: agentAuthor,
    title: 'Expo RN design foundation',
    status: 'running',
    meta: '3 workers active',
    runId: 'run-mobile-design',
    createdAt: '14:06',
  },
  {
    id: 'm3',
    kind: 'approval',
    author: agentAuthor,
    title: 'Approve RN design foundation package writes',
    status: 'pending',
    risk: 'medium',
    reason: 'Workspace-level pnpm and lockfile updates are required for app/mobile-rn.',
    createdAt: '14:12',
  },
  {
    id: 'm4',
    kind: 'diff',
    author: agentAuthor,
    title: 'Design token and primitive scaffold',
    files: ['app/mobile-rn/src/theme/tokens.ts', 'app/mobile-rn/src/components/primitives/Button.tsx'],
    additions: 312,
    deletions: 0,
    lines: [
      { type: 'add', content: '+ export const agentHubThemes = {' },
      { type: 'add', content: '+ export function Button({ label, loading, disabled }) {' },
      { type: 'ctx', content: '  // RN-safe primitives only' },
    ],
    createdAt: '14:16',
  },
];

const backendThreadTranscript: TranscriptBlock[] = [
  {
    id: 'b1',
    kind: 'text',
    author: humanAuthor,
    text: '确认 Hub message forwarding 不要重复推送 agent 消息。',
    createdAt: '13:41',
  },
  {
    id: 'b2',
    kind: 'tool_call',
    author: agentAuthor,
    toolName: 'go test',
    status: 'completed',
    target: 'hub-server/internal/service',
    summary: 'Forwarded sender identity tests passed.',
    createdAt: '13:46',
  },
];

export const mobileFixture: MobileAppFixture = {
  threads: [
    {
      id: 'mobile-design',
      title: 'Mobile RN design foundation',
      subtitle: 'Expo/RN 主线，继承 Desktop v4 视觉和组件语义。',
      initials: 'M',
      unread: 4,
      participantKind: 'group',
      status: 'running',
      lastActivity: 'now',
      activeRunId: 'run-mobile-design',
    },
    {
      id: 'backend-forwarding',
      title: 'Hub message forwarding',
      subtitle: '后端并行线已修复 sender identity，Mobile 只读观察。',
      initials: 'H',
      unread: 0,
      participantKind: 'agent',
      status: 'online',
      lastActivity: '12m',
      activeRunId: 'run-backend-forwarding',
    },
    {
      id: 'feishu-reference',
      title: 'Feishu mobile reference',
      subtitle: '只借鉴信息架构和移动密度，不复制视觉语言。',
      initials: 'F',
      unread: 1,
      participantKind: 'external',
      status: 'muted',
      lastActivity: '1h',
    },
  ],
  runs: [
    {
      id: 'run-mobile-design',
      threadId: 'mobile-design',
      title: 'RN design foundation scaffold',
      status: 'approval_required',
      target: 'app/mobile-rn',
      updatedAt: '14:16',
      summary: '新增 Expo/RN package、AgentHub tokens、RN primitives、layout shell 和状态化 surfaces。',
      changedFiles: [
        'app/mobile-rn/package.json',
        'app/mobile-rn/src/theme/tokens.ts',
        'app/mobile-rn/src/components/primitives/Button.tsx',
      ],
      approvalRisk: 'medium',
    },
    {
      id: 'run-backend-forwarding',
      threadId: 'backend-forwarding',
      title: 'Preserve forwarded sender identity',
      status: 'completed',
      target: 'hub-server',
      updatedAt: '13:49',
      summary: 'Backend commit landed on origin/dev; Mobile branch rebased over it.',
      changedFiles: ['hub-server/internal/service/message.go', 'hub-server/internal/service/message_test.go'],
    },
    {
      id: 'run-hub-recovery',
      threadId: 'mobile-design',
      title: 'Mock Hub recovery path',
      status: 'failed',
      target: 'mock/local Hub',
      updatedAt: '13:22',
      summary: 'Simulated 503 keeps queue visible and exposes contextual retry.',
      changedFiles: ['app/mobile-rn/src/api/hubClient.ts'],
    },
  ],
  transcript: {
    'mobile-design': designThreadTranscript,
    'backend-forwarding': backendThreadTranscript,
    'feishu-reference': [
      {
        id: 'f1',
        kind: 'text',
        author: agentAuthor,
        text: 'Feishu reference applies to bottom tabs, dense queue scanning, badges, and sheet flows only.',
        createdAt: '12:03',
        badgeLabel: 'Reference',
        badgeVariant: 'warning',
      },
    ],
  },
  account: {
    tokenDanceId: 'recovering',
    hubSession: 'expired',
    notification: 'prompt',
    websocket: 'reconnecting',
    deviceLabel: 'Expo dev build / local mock',
  },
};

export function getPendingReviewCount(fixture: MobileAppFixture): number {
  return fixture.runs.filter((run) => run.status === 'approval_required').length;
}

export function getUnreadThreadCount(fixture: MobileAppFixture): number {
  return fixture.threads.reduce((total, thread) => total + thread.unread, 0);
}

export function getThreadRun(fixture: MobileAppFixture, threadId: string) {
  return fixture.runs.find((run) => run.threadId === threadId);
}
