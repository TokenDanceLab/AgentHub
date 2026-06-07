import { formatComposerPromptWithContext } from '@shared/composer';
import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { EvidenceRef } from '@shared/transcript';
import type { TranscriptBlock } from '@shared/transcript';
import type { RunInfo, StartRunRequest } from '@shared/types';
import { pickDesktopComposerAttachments } from './desktopAttachments';
import { canOpenDesktopEvidencePreview, openDesktopEvidencePreview } from './desktopPreview';

export const DESKTOP_FALLBACK_CONVERSATION_ID = 'builder';

/** Role colors matching the v4 design demo */
const ROLE_BUILDER = '#5e8dcc';
const ROLE_REVIEWER = '#409467';
const ROLE_DEPLOYER = '#2b8a9e';
const ROLE_ORCHESTRATOR = '#5063e8';
const ROLE_RESEARCHER = '#c0883a';

export const desktopConversations: WorkbenchConversation[] = [
  {
    id: 'builder',
    title: 'Builder',
    kind: 'direct',
    subtitle: '正在整理 B0 SQLite 迁移方案',
    runtimeLabel: 'Claude Code',
    threadLabel: '前端实现',
    updatedLabel: '14:49',
    model: 'DeepSeek-V4-Pro',
    avatarColor: ROLE_BUILDER,
    pinnedAnnouncement: {
      title: 'Builder',
      content: '前端重构任务已置顶，Builder 正在整理 B0 SQLite 迁移方案，Reviewer 和 Deployer 后续跟进验收。',
      author: 'Delicious233',
      time: '14:49',
      sourceId: 'builder-msg-1',
    },
  },
  {
    id: 'agent-collab',
    title: 'Agent 协作群',
    kind: 'group',
    subtitle: 'Orchestrator 已汇总各 Agent 进度',
    updatedLabel: '14:58',
    unreadCount: 4,
    model: 'DeepSeek-V4-Pro',
    avatarColor: `linear-gradient(135deg, ${ROLE_ORCHESTRATOR}, ${ROLE_BUILDER})`,
  },
  {
    id: 'deployer',
    title: 'Deployer',
    kind: 'direct',
    subtitle: '静态预览已就绪，可打开检查',
    updatedLabel: '14:48',
    unreadCount: 2,
    model: 'DeepSeek-V4-Pro',
    avatarColor: ROLE_DEPLOYER,
  },
  {
    id: 'orchestrator',
    title: 'Orchestrator',
    kind: 'direct',
    subtitle: '4 个子任务已分派，等待 Builder...',
    updatedLabel: '14:32',
    model: 'DeepSeek-V4-Pro',
    avatarColor: ROLE_ORCHESTRATOR,
  },
  {
    id: 'reviewer',
    title: 'Reviewer',
    kind: 'direct',
    subtitle: '代码审查已通过，0 个阻塞项',
    updatedLabel: '12:15',
    avatarColor: ROLE_REVIEWER,
  },
  {
    id: 'johnny',
    title: 'Johnny',
    kind: 'direct',
    subtitle: '我看下项目页和私聊入口',
    updatedLabel: '11:32',
    avatarColor: '#2f8f73',
  },
  {
    id: 'trump',
    title: 'Trump',
    kind: 'direct',
    subtitle: '云文档列表可以再收紧一点',
    updatedLabel: '10:18',
    avatarColor: '#8f6b2f',
  },
  {
    id: 'project-ai',
    title: 'AI 游戏项目',
    kind: 'group',
    subtitle: '深度研究团队 · 5 人',
    updatedLabel: '6/4',
    model: '运行',
    avatarLabel: 'P',
    avatarColor: 'var(--surface-highest)',
    avatarTextColor: 'var(--text-3)',
  },
  {
    id: 'project-docs',
    title: '文档重构',
    kind: 'group',
    subtitle: '已完成',
    updatedLabel: '6/2',
    model: '运行',
    avatarLabel: 'W',
    avatarColor: 'var(--surface-highest)',
    avatarTextColor: 'var(--text-3)',
  },
];

export const desktopAgents: WorkbenchAgent[] = [
  {
    id: 'builder',
    name: 'Builder',
    description: '代码实现 · workspace-write',
    status: 'available',
    model: 'DeepSeek-V4-Pro',
    runtimeId: 'claude-code',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: '审查与验收 · read-only',
    status: 'available',
    model: 'DeepSeek-V4-Pro',
    runtimeId: 'claude-code',
  },
  {
    id: 'deployer',
    name: 'Deployer',
    description: '预览与发布',
    status: 'available',
    model: 'DeepSeek-V4-Pro',
    runtimeId: 'claude-code',
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: '资料研究',
    status: 'available',
    model: 'DeepSeek-V4-Pro',
    runtimeId: 'claude-code',
  },
];

export const desktopTranscript: TranscriptBlock[] = [
  /* ── User request ── */
  {
    id: 'builder-user-1',
    kind: 'text',
    createdAt: '2026-06-06T14:42:00+08:00',
    author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
    text: '帮我给 AgentHub Desktop 做 B0 SQLite 迁移方案。要先看现有消息模型和索引路径，输出迁移 SQL、回滚点和需要验证的 UI 历史消息块。',
  },
  /* ── Builder thinking ── */
  {
    id: 'builder-msg-1',
    kind: 'text',
    createdAt: '2026-06-06T14:43:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '收到，我会先做运行隔离和代码定位。这次任务会按真实执行流推进：建立 worktree、加载调试和验证 skill、读取消息块类型、搜索 SQLite/FTS 入口，再生成迁移草案。',
  },
  /* ── Run session ── */
  {
    id: 'builder-run-1',
    kind: 'run_session',
    createdAt: '2026-06-06T14:44:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'B0 SQLite 迁移任务',
    status: 'running',
    meta: 'DeepSeek-V4-Pro · Claude Code · workspace-write · isolated worktree',
    runId: 'run_b0_sqlite_1849',
    evidenceRefs: [
      { id: 'run-b0-sqlite', kind: 'run', label: 'run_b0_sqlite_1849', status: 'running' },
    ],
  },
  {
    id: 'builder-timeline-1',
    kind: 'agent_timeline',
    createdAt: '2026-06-06T14:44:05+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '运行时间线',
    items: [
      { status: 'completed', label: '初始化会话', detail: '模型、工具权限和当前项目上下文已加载' },
      { status: 'completed', label: '创建隔离 worktree', detail: 'AgentHub/.worktrees/b0-sqlite' },
      { status: 'completed', label: '加载 skill', detail: 'systematic-debugging · verification-before-completion' },
      { status: 'running', label: '进入代码定位阶段', detail: '读取消息模型和 SQLite 索引入口' },
    ],
  },
  {
    id: 'builder-thinking-step-1',
    kind: 'run_step_group',
    createdAt: '2026-06-06T14:44:10+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    icon: 'T',
    title: '深度思考',
    meta: '正在分析 schema 边界和回滚风险',
    status: 'running',
    open: true,
    children: [
      {
        id: 'builder-thinking-1',
        kind: 'thinking',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        content: '正在分析当前 Desktop 消息模型、Edge Server 会话表和本地缓存边界。需要避免把搜索索引和用户草稿放进同一事务。',
        isThinking: true,
        evidenceRefs: [
          { id: 'run-b0-sqlite-thinking', kind: 'run', label: '深度思考 · B0 SQLite', status: 'running' },
        ],
      },
    ],
  },
  {
    id: 'builder-command-step-1',
    kind: 'run_step_group',
    createdAt: '2026-06-06T14:45:30+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    icon: '>',
    title: '已运行 3 条命令',
    meta: '读取消息模型、搜索结构化块、定位 SQLite/FTS 入口',
    status: 'completed',
    open: false,
    children: [
      {
        id: 'builder-tool-1',
        kind: 'tool_call',
        createdAt: '2026-06-06T14:44:30+08:00',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'Read',
        status: 'completed',
        target: 'app/desktop/src/components/ChatView.types.ts',
        summary: '读取 MessageBlock 联合类型和 ToolResultBlock 子类型。',
        evidenceRefs: [
          { id: 'ev-read-types', kind: 'tool', label: 'Read ChatView.types.ts', status: 'completed' },
        ],
      },
      {
        id: 'builder-tool-2',
        kind: 'tool_call',
        createdAt: '2026-06-06T14:45:00+08:00',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'rg',
        status: 'completed',
        target: 'MessageBlock|tool_use|context_usage|approval',
        summary: '确认 Desktop 历史消息里会出现的结构化块类型。',
        evidenceRefs: [
          { id: 'ev-grep-sqlite', kind: 'tool', label: 'Grep SQLite/FTS 入口', status: 'completed' },
        ],
      },
      {
        id: 'builder-tool-3',
        kind: 'tool_call',
        createdAt: '2026-06-06T14:45:30+08:00',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'rg',
        status: 'completed',
        target: 'thread_messages|chat_messages|fts|sqlite',
        summary: '定位 Hub/Edge/Desktop 侧的消息持久化和搜索入口。',
        evidenceRefs: [
          { id: 'ev-rg-persistence', kind: 'tool', label: 'rg thread_messages|chat_messages|fts|sqlite', status: 'completed' },
        ],
      },
    ],
  },
  {
    id: 'builder-route-1',
    kind: 'route_decision',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    action: 'fanout',
    targetAgent: 'Reviewer',
    summary: '把 schema 风险、历史消息回放和审批状态恢复拆给 Reviewer 并行复核。',
  },
  {
    id: 'builder-subagent-1',
    kind: 'subagent',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'Reviewer 复核 schema 风险',
    worker: 'Reviewer',
    status: 'running',
    summary: '检查历史消息、附件索引、搜索回放和审批记录是否会被迁移破坏。',
    runId: 'review-b0-migration',
  },
  {
    id: 'builder-context-1',
    kind: 'context_usage',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    inputTokens: 38400,
    outputTokens: 6200,
    contextLimit: 200000,
    cost: '$0.44',
    modelLabel: 'GLM-5.1 / Claude CLI sonnet route',
  },
  /* ── File change artifacts ── */
  {
    id: 'builder-artifact-1',
    kind: 'artifact',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'migrations/0007_chat_threads.sql',
    evidenceRefs: [
      { id: 'ev-artifact-sqlite-plan', kind: 'artifact', label: 'sqlite-migration-plan.md', status: 'completed', path: 'sqlite-migration-plan.md' },
      { id: 'ev-sql-migration', kind: 'file', label: 'migrations/0007_chat_threads.sql', status: 'completed', path: 'migrations/0007_chat_threads.sql' },
    ],
  },
  {
    id: 'builder-artifact-2',
    kind: 'artifact',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'hooks/useThreadNavigation.ts',
    evidenceRefs: [
      { id: 'ev-hook-nav', kind: 'file', label: 'hooks/useThreadNavigation.ts', status: 'completed', path: 'hooks/useThreadNavigation.ts' },
    ],
  },
  /* ── Diff block ── */
  {
    id: 'builder-diff-1',
    kind: 'diff',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'migrations/0007_chat_threads.sql (+86 −0)',
    files: ['migrations/0007_chat_threads.sql'],
    additions: 86,
    deletions: 0,
    lines: [
      {
        type: 'add',
        content: 'CREATE TABLE chat_threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL);',
      },
      {
        type: 'add',
        content: "CREATE VIRTUAL TABLE chat_messages_fts USING fts5(thread_id, author, body, tokenize='unicode61');",
      },
      {
        type: 'add',
        content: 'CREATE INDEX idx_chat_threads_updated ON chat_threads(updated_at DESC);',
      },
    ],
  },
  {
    id: 'builder-diff-2',
    kind: 'diff',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'hooks/useThreadNavigation.ts (+24 −8)',
    files: ['hooks/useThreadNavigation.ts'],
    additions: 24,
    deletions: 8,
    lines: [
      {
        type: 'del',
        content: 'const activeThread = threads[0];',
      },
      {
        type: 'add',
        content: 'const activeThread = findThreadByRoute(threadId) ?? threads[0];',
      },
      {
        type: 'add',
        content: 'restoreStructuredBlocks(activeThread.messages);',
      },
    ],
  },
  /* ── Builder summary ── */
  {
    id: 'builder-msg-3',
    kind: 'text',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '迁移草案已写好。我保留了 thread、message block、tool event 三层结构。FTS 只索引可搜索摘要，审批和上下文使用保留 JSON block，避免回放丢状态。',
  },
  {
    id: 'builder-child-1',
    kind: 'child_agent',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'Browser QA 截图验证',
    agent: 'Browser QA',
    status: 'completed',
    summary: 'Desktop 历史消息中 thinking、tool、subagent、diff、approval 块均可见，左边缘已按消息列对齐。',
    runId: 'browser-qa-b0',
    parentRunId: 'run_b0_sqlite_1849',
  },
  /* ── More file artifacts for inspector ── */
  {
    id: 'builder-artifact-3',
    kind: 'artifact',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'docs/B0-SQLITE-ROLLBACK.md',
    evidenceRefs: [
      { id: 'ev-risks-doc', kind: 'file', label: 'B0-SQLITE-RISKS.md', status: 'completed', path: 'docs/B0-SQLITE-RISKS.md' },
    ],
  },
  /* ── Approval: FTS field boundary check ── */
  {
    id: 'builder-approval-1',
    kind: 'approval',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '部署/写入审批',
    status: 'pending',
    toolName: 'Write File',
    risk: 'medium',
    reason: '确认 FTS5 只索引可搜索摘要字段',
  },
  /* ── Run complete ── */
  {
    id: 'builder-run-complete',
    kind: 'result',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    success: true,
    duration: '8m12s',
    turns: 7,
    summary: '输入 38.4k · 输出 6.2k · 工具 7 次 · 子 Agent 2 个 · 耗时 8m12s',
    evidenceRefs: [
      { id: 'run-b0-sqlite-done', kind: 'run', label: '迁移 SQL · 线程导航 hook · 回滚说明', status: 'completed' },
    ],
  },
];

export function resolveDesktopPreviewTranscript(conversationId: string): TranscriptBlock[] {
  if (conversationId === DESKTOP_FALLBACK_CONVERSATION_ID) return desktopTranscript;

  const conversation = desktopConversations.find((item) => item.id === conversationId);
  if (!conversation) return desktopTranscript;

  const agentName = conversation.title;
  const agentId = conversation.id;
  const subtitle = conversation.subtitle ?? 'AgentHub v4 会话';
  return [
    {
      id: `${agentId}-user-1`,
      kind: 'text',
      author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
      text: `打开 ${agentName} 会话，继续按 agenthub-design v4 工作台检查当前任务。`,
    },
    {
      id: `${agentId}-reply-1`,
      kind: 'text',
      author: { id: agentId, name: agentName, role: conversation.kind === 'group' ? 'system' : 'agent' },
      text: `${subtitle}。当前预览会话已切换，消息区、右侧概览和输入目标都应跟随左侧选择更新。`,
    },
    {
      id: `${agentId}-session-1`,
      kind: 'run_session',
      author: { id: agentId, name: agentName, role: 'agent' },
      title: `${agentName} 工作流`,
      status: conversation.id === 'project-docs' ? 'completed' : 'running',
      meta: `${agentName} · ${conversation.model ?? 'v4 shared UI'}`,
      runId: `run_${agentId.replace(/[^a-z0-9]+/gi, '_')}_preview`,
      evidenceRefs: [
        {
          id: `ev-${agentId}-run`,
          kind: 'run',
          label: `${agentName} preview run`,
          status: conversation.id === 'project-docs' ? 'completed' : 'running',
        },
      ],
    },
    {
      id: `${agentId}-result-1`,
      kind: 'result',
      author: { id: agentId, name: agentName, role: 'agent' },
      success: true,
      summary: `${agentName} 会话切换 smoke：active item、header、composer placeholder 和 inspector evidence 已更新。`,
      evidenceRefs: [
        {
          id: `ev-${agentId}-switch`,
          kind: 'artifact',
          label: `${agentName} conversation switch`,
          status: 'completed',
        },
      ],
    },
  ];
}

export interface DesktopPlatformOptions {
  activeProjectId?: string;
  activeThreadId?: string;
  openPreview?: (evidence: EvidenceRef) => Promise<void>;
  pickLocalAttachments?: NonNullable<AgentHubPlatform['attachments']>['pickFiles'];
  submitRun?: (request: StartRunRequest) => Promise<RunInfo>;
}

export function createDesktopPlatform(options: DesktopPlatformOptions = {}): AgentHubPlatform {
  const submittedIntents: ComposerIntent[] = [];

  return {
    surface: 'desktop',
    capabilities: {
      localEdge: true,
      localFiles: true,
      browserPreview: true,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return desktopConversations;
      },
    },
    attachments: {
      pickFiles: options.pickLocalAttachments ?? pickDesktopComposerAttachments,
    },
    preview: {
      canOpenEvidence: canOpenDesktopEvidencePreview,
      openEvidence: options.openPreview ?? openDesktopEvidencePreview,
    },
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        submittedIntents.push(intent);
        if (options.submitRun) {
          if (!options.activeProjectId || !options.activeThreadId) {
            throw new Error('Desktop v4 composer requires an active Edge thread');
          }
          const run = await options.submitRun({
            projectId: options.activeProjectId,
            threadId: options.activeThreadId,
            prompt: formatComposerPromptWithContext(intent.text, intent.attachments, intent.mentions),
            ...edgePermissionMode(intent),
            ...edgeWorkDir(intent),
          });
          return {
            intentId: run.runId,
          };
        }

        return {
          intentId: `desktop-intent-${submittedIntents.length}`,
        };
      },
    },
  };
}

function edgePermissionMode(intent: ComposerIntent): Pick<StartRunRequest, 'permissionMode'> {
  switch (intent.approvalMode) {
    case 'workspace-write':
      return { permissionMode: 'acceptEdits' };
    case 'read-only':
      return { permissionMode: 'plan' };
    case 'suggest':
    default:
      return {};
  }
}

function edgeWorkDir(intent: ComposerIntent): Pick<StartRunRequest, 'workDir'> {
  const workDir = intent.workDir?.trim();
  return workDir ? { workDir } : {};
}
