import type { ComposerIntent, ComposerSubmitResult } from '../composer';
import type { WorkbenchAgent, WorkbenchConversation } from '../platform';
import type { TranscriptBlock } from '../transcript';

export type WorkbenchDemoSurface = 'desktop' | 'web';

export interface WorkbenchDemoMessagePin {
  conversationId: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: string;
}

export interface WorkbenchDemoStore {
  conversations: WorkbenchConversation[];
  agents: WorkbenchAgent[];
  transcripts: Record<string, TranscriptBlock[]>;
  pins: WorkbenchDemoMessagePin[];
}

export interface WorkbenchDemoRuntimeStore {
  getSnapshot(): WorkbenchDemoStore;
  subscribe(listener: () => void): () => void;
  resolveTranscript(conversationId: string): TranscriptBlock[];
  submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult>;
  pinMessage(conversationId: string, messageId: string, pinnedBy?: string): void;
  unpinMessage(conversationId: string, messageId: string): void;
}

const ROLE_BUILDER = '#5e8dcc';
const ROLE_REVIEWER = '#409467';
const ROLE_DEPLOYER = '#2b8a9e';
const ROLE_ORCHESTRATOR = '#5063e8';

export const WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID = 'builder';
const BUILDER_PINNED_ANNOUNCEMENT =
  '前端重构任务已置顶，Builder 正在整理 B0 SQLite 迁移方案，Reviewer 和 Deployer 后续跟进验收。';

const demoConversationsBase: WorkbenchConversation[] = [
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

export const demoWorkbenchAgents: WorkbenchAgent[] = [
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

const builderTranscript: TranscriptBlock[] = [
  {
    id: 'builder-user-1',
    kind: 'text',
    createdAt: '2026-06-06T14:42:00+08:00',
    author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
    text: '帮我给 AgentHub Desktop 做 B0 SQLite 迁移方案。要先看现有消息模型和索引路径，输出迁移 SQL、回滚点和需要验证的 UI 历史消息块。',
  },
  {
    id: 'builder-msg-1',
    kind: 'text',
    createdAt: '2026-06-06T14:43:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '收到，我会先做运行隔离和代码定位。这次任务会按真实执行流推进：建立 worktree、加载调试和验证 skill、读取消息块类型、搜索 SQLite/FTS 入口，再生成迁移草案。',
    displayTitle: '收到，我会先做运行隔离和代码定位',
    displayDetail: '这次任务会按真实执行流推进：建立 worktree、加载调试和验证 skill、读取消息块类型、搜索 SQLite/FTS 入口，再生成迁移草案。',
    badgeLabel: '运行中',
    badgeVariant: 'thinking',
    evidenceRefs: [
      { id: 'run-b0-sqlite-msg', kind: 'run', label: 'Builder 正在运行', status: 'running' },
    ],
  },
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
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'rg',
        status: 'completed',
        target: 'MessageBlock|tool_use|context_usage|approval',
        summary: '确认 Desktop 历史消息里会出现的结构化块类型。',
        evidenceRefs: [
          { id: 'ev-grep-blocks', kind: 'tool', label: 'rg MessageBlock|tool_use|approval', status: 'completed' },
        ],
      },
      {
        id: 'builder-tool-3',
        kind: 'tool_call',
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
    id: 'builder-found-boundary',
    kind: 'text',
    createdAt: '2026-06-06T14:49:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '找到迁移边界。消息正文、工具调用、文件变更、审批、上下文使用和子 Agent 事件需要保留 block kind。搜索只走 text/code/status/citation 的摘要字段，其他结构保持 JSON。',
    displayTitle: '找到迁移边界',
    displayDetail: '消息正文、工具调用、文件变更、审批、上下文使用和子 Agent 事件需要保留 block kind。搜索只走 text/code/status/citation 的摘要字段，其他结构保持 JSON。',
    badgeLabel: '定位完成',
    badgeVariant: 'success',
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
    id: 'builder-route-1',
    kind: 'route_decision',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    action: 'continue',
    targetAgent: 'Builder',
    summary: 'Builder 继续产出迁移 SQL；Reviewer 并行复核风险；Browser QA 等待 UI 历史消息块验证。',
  },
  {
    id: 'builder-context-1',
    kind: 'context_usage',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    modelLabel: 'DeepSeek / DeepSeek-V4-Pro',
    inputTokens: 38400,
    outputTokens: 6200,
    contextLimit: 128000,
    cost: '$0.31',
    usagePercent: 35,
  },
  {
    id: 'builder-writing-1',
    kind: 'text',
    createdAt: '2026-06-06T14:53:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '生成迁移草案。我会新增线程表、消息块表和 FTS shadow index。回滚点放在切换查询路径之前，避免旧历史消息不可读。',
    displayTitle: '生成迁移草案',
    displayDetail: '我会新增线程表、消息块表和 FTS shadow index。回滚点放在切换查询路径之前，避免旧历史消息不可读。',
    badgeLabel: '写入中',
    badgeVariant: 'thinking',
  },
  {
    id: 'builder-edit-step-1',
    kind: 'run_step_group',
    createdAt: '2026-06-06T14:54:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    icon: 'E',
    title: '已编辑 2 个文件',
    meta: '生成迁移 SQL，并把线程导航切到新的 updated_at 顺序',
    status: 'completed',
    open: true,
    children: [
      {
        id: 'builder-file-1',
        kind: 'artifact',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'migrations/0007_chat_threads.sql',
        action: 'created',
        additions: 86,
        deletions: 0,
        evidenceRefs: [
          {
            id: 'file-chat-threads-sql',
            kind: 'file',
            label: 'migrations/0007_chat_threads.sql',
            path: 'migrations/0007_chat_threads.sql',
            status: 'completed',
          },
        ],
      },
      {
        id: 'builder-file-2',
        kind: 'artifact',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'hooks/useThreadNavigation.ts',
        action: 'modified',
        additions: 24,
        deletions: 8,
        evidenceRefs: [
          {
            id: 'file-thread-navigation',
            kind: 'file',
            label: 'hooks/useThreadNavigation.ts',
            path: 'hooks/useThreadNavigation.ts',
            status: 'completed',
          },
        ],
      },
      {
        id: 'builder-diff-1',
        kind: 'diff',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'migrations/0007_chat_threads.sql',
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
    ],
  },
  {
    id: 'approval_b0_sqlite_write',
    kind: 'approval',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '部署/写入审批',
    status: 'pending',
    toolName: 'Write File',
    risk: 'medium',
    reason: '生成迁移 SQL 和导航 hook 更新，需要写入工作区文件。',
  },
  {
    id: 'builder-verify-step-1',
    kind: 'run_step_group',
    createdAt: '2026-06-06T14:56:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    icon: 'T',
    title: '已验证历史消息渲染',
    meta: 'ChatView snapshot、timeline 展开态、回滚说明均通过',
    status: 'completed',
    open: false,
    children: [
      {
        id: 'builder-tool-verify-1',
        kind: 'tool_call',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'Shell',
        status: 'completed',
        target: 'pnpm test ChatView --runInBand',
        summary: '验证历史消息块、timeline snapshot 和回滚说明渲染。',
      },
    ],
  },
  {
    id: 'builder-browser-qa-1',
    kind: 'child_agent',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'Browser QA 截图验证',
    agent: 'Browser QA',
    status: 'completed',
    summary: 'Desktop 历史消息中 thinking、tool、subagent、diff、approval 块均可见，左边缘已按消息列对齐。',
    runId: 'browser-qa-b0',
    parentRunId: 'run_b0_sqlite_1849',
  },
  {
    id: 'builder-final-1',
    kind: 'text',
    createdAt: '2026-06-06T14:57:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '迁移方案已完成。产物包括迁移 SQL、线程导航 hook 调整、回滚说明和验证清单。下一步交给 Reviewer 做风险复核，确认后再由 Deployer 做预览发布。',
    displayTitle: '迁移方案已完成',
    displayDetail: '产物包括迁移 SQL、线程导航 hook 调整、回滚说明和验证清单。下一步交给 Reviewer 做风险复核，确认后再由 Deployer 做预览发布。',
    badgeLabel: '完成',
    badgeVariant: 'success',
  },
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

export const demoWorkbenchPins: WorkbenchDemoMessagePin[] = [
  {
    conversationId: 'builder',
    messageId: 'builder-msg-1',
    pinnedBy: 'Delicious233',
    pinnedAt: '2026-06-06T14:49:00+08:00',
  },
];

export const demoWorkbenchTranscripts: Record<string, TranscriptBlock[]> = {
  builder: builderTranscript,
};

export function createWorkbenchDemoStore(): WorkbenchDemoStore {
  return {
    conversations: demoConversationsBase.map((conversation) => conversationWithDemoPin(conversation)),
    agents: demoWorkbenchAgents,
    transcripts: demoWorkbenchTranscripts,
    pins: demoWorkbenchPins,
  };
}

export function createWorkbenchDemoRuntimeStore(initialStore: WorkbenchDemoStore = createWorkbenchDemoStore()): WorkbenchDemoRuntimeStore {
  let transcripts = cloneTranscripts(initialStore.transcripts);
  let pins = initialStore.pins.map((pin) => ({ ...pin }));
  let sequence = 0;
  const listeners = new Set<() => void>();
  let currentSnapshot = createSnapshot();

  function emit(): void {
    currentSnapshot = createSnapshot();
    for (const listener of listeners) listener();
  }

  function createSnapshot(): WorkbenchDemoStore {
    return {
      conversations: demoConversationsBase.map((conversation) => conversationWithPins(conversation, transcripts, pins)),
      agents: demoWorkbenchAgents.map((agent) => ({ ...agent })),
      transcripts: cloneTranscripts(transcripts),
      pins: pins.map((pin) => ({ ...pin })),
    };
  }

  return {
    getSnapshot: () => currentSnapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveTranscript(conversationId: string): TranscriptBlock[] {
      return transcripts[conversationId] ?? createConversationPreviewTranscript(conversationId);
    },
    async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
      sequence += 1;
      const now = new Date().toISOString();
      const userMessageId = `demo-user-${sequence}`;
      const agentMessageId = `demo-agent-${sequence}`;
      const current = transcripts[intent.conversationId] ?? createConversationPreviewTranscript(intent.conversationId);
      transcripts = {
        ...transcripts,
        [intent.conversationId]: [
          ...current,
          {
            id: userMessageId,
            kind: 'text',
            createdAt: now,
            author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
            text: intent.text,
          },
          {
            id: agentMessageId,
            kind: 'text',
            createdAt: now,
            author: { id: 'demo-agent', name: 'AgentHub Demo', role: 'agent' },
            text: `已收到 mock 输入：${intent.text}`,
            displayTitle: 'Demo 模式已记录输入',
            displayDetail: '这条回复由 shared demo runtime store 生成，用于前端开发时验证消息追加、滚动、选择和 inspector evidence 行为。',
            badgeLabel: 'mock',
            badgeVariant: 'thinking',
          },
        ],
      };
      emit();
      return { intentId: agentMessageId };
    },
    pinMessage(conversationId: string, messageId: string, pinnedBy = 'Demo'): void {
      const current = transcripts[conversationId] ?? createConversationPreviewTranscript(conversationId);
      const exists = current.some((block) => block.id === messageId);
      if (!exists) return;
      if (!transcripts[conversationId]) {
        transcripts = {
          ...transcripts,
          [conversationId]: current,
        };
      }
      const nextPin = {
        conversationId,
        messageId,
        pinnedBy,
        pinnedAt: new Date().toISOString(),
      };
      pins = [
        nextPin,
        ...pins.filter((pin) => pin.conversationId !== conversationId || pin.messageId !== messageId),
      ];
      emit();
    },
    unpinMessage(conversationId: string, messageId: string): void {
      const nextPins = pins.filter((pin) => pin.conversationId !== conversationId || pin.messageId !== messageId);
      if (nextPins.length === pins.length) return;
      pins = nextPins;
      emit();
    },
  };
}

export const workbenchDemoRuntimeStore = createWorkbenchDemoRuntimeStore();

export function resolveDemoWorkbenchTranscript(conversationId: string): TranscriptBlock[] {
  return demoWorkbenchTranscripts[conversationId] ?? createConversationPreviewTranscript(conversationId);
}

function conversationWithDemoPin(conversation: WorkbenchConversation): WorkbenchConversation {
  return conversationWithPins(conversation, demoWorkbenchTranscripts, demoWorkbenchPins);
}

function conversationWithPins(
  conversation: WorkbenchConversation,
  transcripts: Record<string, TranscriptBlock[]>,
  pins: WorkbenchDemoMessagePin[],
): WorkbenchConversation {
  const pin = pins.find((item) => item.conversationId === conversation.id);
  if (!pin) return { ...conversation };
  const conversationTranscript = transcripts[conversation.id] ?? createConversationPreviewTranscript(conversation.id);
  const message = conversationTranscript.find((block) => block.id === pin.messageId);
  if (!message || !('text' in message)) return { ...conversation };
  const content = conversation.id === WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID
    ? BUILDER_PINNED_ANNOUNCEMENT
    : message.text;
  return {
    ...conversation,
    pinnedAnnouncement: {
      title: conversation.title,
      content,
      author: pin.pinnedBy,
      time: formatDemoPinTime(pin.pinnedAt),
      sourceId: pin.messageId,
    },
  };
}

function cloneTranscripts(source: Record<string, TranscriptBlock[]>): Record<string, TranscriptBlock[]> {
  return Object.fromEntries(
    Object.entries(source).map(([conversationId, transcript]) => [
      conversationId,
      transcript.map((block) => ({ ...block })),
    ]),
  );
}

function createConversationPreviewTranscript(conversationId: string): TranscriptBlock[] {
  const conversation = demoConversationsBase.find((item) => item.id === conversationId);
  const agentName = conversation?.title ?? 'AgentHub';
  const subtitle = conversation?.subtitle ?? 'AgentHub v4 会话';
  const replyRole = conversation?.kind === 'group'
    ? 'system'
    : isDemoHumanContact(conversationId)
      ? 'human'
      : 'agent';
  return [
    {
      id: `${conversationId}-user-1`,
      kind: 'text',
      author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
      text: `打开 ${agentName} 会话，继续按 agenthub-design v4 工作台检查当前任务。`,
    },
    {
      id: `${conversationId}-reply-1`,
      kind: 'text',
      author: { id: conversationId, name: agentName, role: replyRole },
      text: `${subtitle}。当前预览会话已切换，消息区、右侧概览和输入目标都应跟随左侧选择更新。`,
    },
    {
      id: `${conversationId}-session-1`,
      kind: 'run_session',
      author: { id: conversationId, name: agentName, role: 'agent' },
      title: `${agentName} 工作流`,
      status: conversationId === 'project-docs' ? 'completed' : 'running',
      meta: `${agentName} · ${conversation?.model ?? 'v4 shared UI'}`,
      runId: `run_${conversationId.replace(/[^a-z0-9]+/gi, '_')}_preview`,
    },
  ];
}

function isDemoHumanContact(conversationId: string): boolean {
  return ['johnny', 'trump'].includes(conversationId);
}

function formatDemoPinTime(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
