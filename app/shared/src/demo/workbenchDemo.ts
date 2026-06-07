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

const ROLE_BUILDER = '#5e8dcc';
const ROLE_REVIEWER = '#409467';
const ROLE_DEPLOYER = '#f59e0b';
const ROLE_ORCHESTRATOR = '#6366f1';

export const WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID = 'builder';

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
      },
      {
        id: 'builder-tool-2',
        kind: 'tool_call',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'rg',
        status: 'completed',
        target: 'MessageBlock|tool_use|context_usage|approval',
        summary: '确认 Desktop 历史消息里会出现的结构化块类型。',
      },
      {
        id: 'builder-tool-3',
        kind: 'tool_call',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'rg',
        status: 'completed',
        target: 'thread_messages|chat_messages|fts|sqlite',
        summary: '定位 Hub/Edge/Desktop 侧的消息持久化和搜索入口。',
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
    id: 'builder-approval-1',
    kind: 'approval',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '部署/写入审批',
    status: 'pending',
    toolName: 'Write File',
    risk: 'medium',
    reason: '确认 FTS5 只索引可搜索摘要字段',
  },
  {
    id: 'builder-run-complete',
    kind: 'result',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    success: true,
    duration: '8m12s',
    turns: 7,
    summary: '输入 38.4k · 输出 6.2k · 工具 7 次 · 子 Agent 2 个 · 耗时 8m12s',
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

export function resolveDemoWorkbenchTranscript(conversationId: string): TranscriptBlock[] {
  return demoWorkbenchTranscripts[conversationId] ?? createConversationPreviewTranscript(conversationId);
}

function conversationWithDemoPin(conversation: WorkbenchConversation): WorkbenchConversation {
  const pin = demoWorkbenchPins.find((item) => item.conversationId === conversation.id);
  if (!pin) return { ...conversation };
  const message = demoWorkbenchTranscripts[conversation.id]?.find((block) => block.id === pin.messageId);
  if (!message || !('text' in message)) return { ...conversation };
  return {
    ...conversation,
    pinnedAnnouncement: {
      title: conversation.title,
      content: message.text,
      author: pin.pinnedBy,
      time: formatDemoPinTime(pin.pinnedAt),
      sourceId: pin.messageId,
    },
  };
}

function createConversationPreviewTranscript(conversationId: string): TranscriptBlock[] {
  const conversation = demoConversationsBase.find((item) => item.id === conversationId);
  const agentName = conversation?.title ?? 'AgentHub';
  const subtitle = conversation?.subtitle ?? 'AgentHub v4 会话';
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
      author: { id: conversationId, name: agentName, role: conversation?.kind === 'group' ? 'system' : 'agent' },
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

function formatDemoPinTime(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
