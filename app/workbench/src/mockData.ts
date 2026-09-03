import type {
  ContactGroup,
  ContactMember,
  ServiceDesk,
} from './pages/ContactsPage';
import type { DocRow } from './pages/DocsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import type { TaskGroup, TaskItem } from './pages/TasksPage';
import type {
  AgentConfig,
  AuditEntry,
  MarketTemplate,
  ModelHealth,
  ModelInfo,
  PolicyRule,
} from './pages/AgentsPage';
import {
  WORKBENCH_AGENT_MARKET_FIXTURES,
  WORKBENCH_AGENT_MODELS as AGENT_MODELS,
  WORKBENCH_AGENT_MODEL_HEALTH as AGENT_MODEL_HEALTH,
  WORKBENCH_AGENT_POLICY_RULES as AGENT_POLICY_RULES,
  WORKBENCH_AGENT_PROFILE_FIXTURES,
  WORKBENCH_AGENT_SKILL_OPTIONS as AGENT_SKILL_OPTIONS,
  WORKBENCH_AGENT_TOOL_OPTIONS as AGENT_TOOL_OPTIONS,
} from './agentProfileCatalog';

export const WORKBENCH_MOCK_CONTACT_MEMBERS: ContactMember[] = [
  { id: 'delicious', name: 'demo-user', initials: 'D', tag: '当前用户', org: 'TokenDance', status: '在线' },
  { id: 'johnny', name: 'Johnny', initials: 'J', tag: '维护者', org: 'AgentHub Desktop', status: '刚刚活跃' },
  { id: 'trump', name: 'Trump', initials: 'T', tag: '协作者', org: '设计评审', status: '今天 10:18' },
];

export const WORKBENCH_MOCK_CONTACT_GROUPS: ContactGroup[] = [
  { id: 'design-review', name: 'AgentHub 设计评审', initials: 'A', count: '8 人', latestMessage: '最近消息：云文档页需要收紧表格密度' },
  { id: 'ai-game', name: 'AI 游戏项目', initials: 'P', count: '5 人', latestMessage: '最近消息：题材方向研究进行中' },
  { id: 'docs-refactor', name: '文档重构', initials: 'W', count: '3 人', latestMessage: '最近消息：等待归档确认' },
];

export const WORKBENCH_MOCK_CONTACT_SHORTCUTS = [
  'Johnny',
  'Trump',
  'AgentHub 设计评审',
  '文档重构',
];

export const WORKBENCH_MOCK_PENDING_CONTACTS: ContactMember[] = [
  {
    id: 'nora',
    name: 'Nora Wang',
    initials: 'N',
    tag: '申请加入 TokenDance',
    org: '手机号邀请',
    status: '待确认',
  },
  {
    id: 'leo',
    name: 'Leo Xu',
    initials: 'L',
    tag: '外部联系人请求',
    org: '企业链接',
    status: '待备注',
  },
];

export const WORKBENCH_MOCK_EXTERNAL_CONTACTS: ContactMember[] = [
  {
    id: 'alex',
    name: 'Alex Chen',
    initials: 'A',
    tag: '外部 PM',
    org: 'VectorControl 合作方',
    status: '待同步项目权限',
  },
  {
    id: 'mira',
    name: 'Mira Lee',
    initials: 'M',
    tag: '设计顾问',
    org: 'UI Review',
    status: '可发起对话',
  },
];

export const WORKBENCH_MOCK_SERVICE_DESKS: ServiceDesk[] = [
  {
    id: 'account',
    name: '账号与权限',
    initials: 'S',
    description: 'TokenDance ID / 企业成员 / 外部联系人权限',
  },
  {
    id: 'agent-runtime',
    name: 'Agent 运行支持',
    initials: 'A',
    description: '项目运行卡住、工具权限、模型配置',
  },
  {
    id: 'docs',
    name: '云文档支持',
    initials: 'D',
    description: '文档分享、归档、知识库权限',
  },
];

export const WORKBENCH_MOCK_DOC_ROWS: DocRow[] = [
  { id: 'desktop-design-system', title: 'AgentHub Desktop 设计系统对齐清单', tag: '内部', location: '我的文档库', owner: 'demo-user', time: '今天 14:52' },
  { id: 'meeting-notes', title: '智能纪要：【AgentHub 设计评审】', tag: '共享', location: '与我共享', owner: 'Johnny', time: '今天 11:08' },
  { id: 'session-handoff', title: 'SESSION-HANDOFF-2026-06-05.md', location: '项目产物', owner: 'Codex', time: '昨天 22:40' },
  { id: 'im-breakdown', title: 'AgentHub IM 交互拆解', tag: '内部', location: '我的文档库', owner: 'demo-user', time: '6月4日 15:18' },
  { id: 'design-contract', title: 'TokenDance Design Contract v3', tag: '共享', location: '知识库', owner: 'Johnny', time: '6月3日 18:33' },
  { id: 'deep-research', title: 'AgentHub 开源项目深度研究', tag: '外部', location: '我的文档库', owner: 'Trump', time: '6月2日 19:42' },
];

/**
 * Demo-only "我的文档库" shortcut names (#2154 P2-2b). These used to be the
 * DocsPage default, which rendered repository-internal document titles in real
 * data mode. They now belong to the mock data source: useWorkbenchDocsRoute
 * only surfaces them when the shell is NOT in real data mode.
 */
export const WORKBENCH_MOCK_DOC_SHORTCUTS: string[] = [
  'NewAPI注册和导入CC-switch',
  '知识问答',
  'AgentHub 设计评审',
  '白盒方向调研报告',
];

export const WORKBENCH_MOCK_TASK_GROUPS: TaskGroup[] = [
  {
    label: '默认分组',
    tasks: [
      {
        id: 'sqlite-plan',
        title: 'B0 SQLite 迁移方案',
        project: '前端重构任务',
        assignee: 'Builder',
        startTime: '今天 14:49',
        dueDate: '明天 18:00',
        creator: 'demo-user',
        status: '进行中',
        // Demo hosting-conversation binding (#1963); ids match the shared
        // demo conversation seeds (workbenchDemoAgents).
        conversationId: 'builder',
      },
      {
        id: 'embedded-docs',
        title: '云文档内嵌子页对齐',
        project: 'AgentHub 设计评审',
        assignee: 'Johnny',
        startTime: '今天 11:32',
        dueDate: '今天 22:00',
        creator: 'demo-user',
        status: '待评审',
        conversationId: 'johnny',
      },
      {
        id: 'project-announcement',
        title: '项目公告收敛成群公告',
        project: '文档重构',
        assignee: 'Reviewer',
        startTime: '昨天 12:20',
        dueDate: '6月8日',
        creator: 'Trump',
        status: '待确认',
        conversationId: 'reviewer',
      },
      {
        id: 'agent-market',
        title: 'Agent 市场卡片完善',
        project: 'Agent 配置',
        assignee: 'Builder',
        startTime: '6月6日',
        dueDate: '6月9日',
        creator: 'Johnny',
        status: '未开始',
        conversationId: 'builder',
      },
    ],
  },
];

export const WORKBENCH_MOCK_AGENT_CONFIGS: AgentConfig[] = WORKBENCH_AGENT_PROFILE_FIXTURES;
export const WORKBENCH_MOCK_AGENT_SKILL_OPTIONS = AGENT_SKILL_OPTIONS;
export const WORKBENCH_MOCK_AGENT_TOOL_OPTIONS = AGENT_TOOL_OPTIONS;
export const WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES: MarketTemplate[] = WORKBENCH_AGENT_MARKET_FIXTURES;
export const WORKBENCH_MOCK_AGENT_POLICY_RULES: PolicyRule[] = AGENT_POLICY_RULES;
export const WORKBENCH_MOCK_AGENT_MODELS: ModelInfo[] = AGENT_MODELS;
export const WORKBENCH_MOCK_AGENT_MODEL_HEALTH: ModelHealth[] = AGENT_MODEL_HEALTH;

export const WORKBENCH_MOCK_AGENT_AUDIT_ROWS: AuditEntry[] = [
  { time: '14:59', agent: 'Builder', tool: 'Write File', result: '需确认', target: 'migrations/0007_chat_threads.sql' },
  { time: '14:57', agent: 'Reviewer', tool: 'Git Diff', result: '允许', target: 'desktop/app.js' },
  { time: '14:52', agent: 'Browser QA', tool: 'Browser Screenshot', result: '允许', target: 'http://127.0.0.1:5176/desktop/' },
  { time: '14:41', agent: 'Researcher', tool: 'Shell', result: '禁止', target: '外部网络检索未授权' },
];

export const WORKBENCH_MOCK_PROJECTS: ProjectInfo[] = [
  {
    id: 'ai-game',
    name: 'AI 游戏项目',
    description: '深度研究团队 · 5 人',
    status: '研究中',
    meta: '3 runs',
    themeColor: 'emerald',
    members: ['demo-user', 'Johnny', 'Trump', 'Builder', 'Researcher'],
    announcement: '题材方向已收敛到二次元卡牌 Roguelite，下一步生成 prototype checklist。',
    runs: [
      { id: 'r1', name: '题材方向研究', status: 'running', owner: 'Researcher', meta: '35%' },
      { id: 'r2', name: '玩法拆解', status: 'completed', owner: 'Builder', meta: '8 docs' },
      { id: 'r3', name: '原型清单', status: 'waiting', owner: 'Orchestrator', meta: '待启动' },
    ],
    artifacts: [
      { id: 'a1', type: 'md', name: 'game-research-brief.md' },
      { id: 'a2', type: 'xlsx', name: '竞品矩阵.xlsx' },
      { id: 'a3', type: 'md', name: 'prototype-tasks.md' },
    ],
    feed: [
      { id: 'f1', time: '16:20', text: 'Researcher 更新题材方向' },
      { id: 'f2', time: '15:42', text: 'Johnny 上传竞品矩阵' },
      { id: 'f3', time: '14:25', text: 'Builder 完成玩法拆解' },
    ],
  },
  {
    id: 'docs-refactor',
    name: '文档重构',
    description: '产物归档完成',
    status: '待归档确认',
    meta: '12 docs',
    themeColor: 'amber',
    members: ['demo-user', 'Johnny', 'Reviewer'],
    announcement: 'README、roadmap、handoff 已完成，Reviewer 正在做最终归档确认。',
    runs: [
      { id: 'r4', name: 'README 结构更新', status: 'completed', owner: 'Builder', meta: '12 files' },
      { id: 'r5', name: 'Handoff 生成', status: 'completed', owner: 'Deployer', meta: '3 docs' },
      { id: 'r6', name: '归档审查', status: 'running', owner: 'Reviewer', meta: '72%' },
    ],
    artifacts: [
      { id: 'a4', type: 'md', name: 'docs-refactor-handoff.md' },
      { id: 'a5', type: 'md', name: 'README.md' },
      { id: 'a6', type: 'md', name: 'roadmap.md' },
    ],
    feed: [
      { id: 'f4', time: '12:20', text: 'Reviewer 补充归档建议' },
      { id: 'f5', time: '11:54', text: 'README 入口整理完成' },
      { id: 'f6', time: '11:36', text: 'roadmap 旧内容完成归档' },
    ],
  },
];

export const WORKBENCH_MOCK_SETTINGS_DEFAULTS = {
  theme: '浅色',
  density: '标准',
  runStepDefault: '折叠',
  animationIntensity: '标准',
  inspectorVisible: true,
  stackedAvatars: true,
  taskCompleteNotify: true,
  approvalNotifyLevel: '强提醒',
  failureNotify: true,
  projectGroupNotifyLevel: '提及',
  docUpdateNotifyLevel: '重要',
  dndWindow: '23:30 - 09:00',
  defaultModel: 'DeepSeek-V4-Pro',
  defaultExecutor: 'Claude Code',
  toolCallDisplay: '摘要',
  deepThinkingDisplay: '摘要',
  permissions: { Read: '允许', Write: '需确认', Shell: '需确认', Browser: '允许' },
  vitePreviewUrl: 'http://127.0.0.1:5176/desktop/',
  dataMode: '自动',
  composerSubmitBehavior: 'Enter 发送',
  workspacePath: 'D:\\Code\\TokenDance\\tokendance-design',
  targetProjectPath: 'D:\\Code\\TokenDance\\AgentHub',
  hrmOverlayEnabled: true,
  visualQaMode: '按需',
  logLevel: '标准',
  designSystemValidation: '手动',
  stateStrategies: { empty: true, invalid: true, missing: true },
};

/* ═══════════════════════════════════════════════════════════════════════
   Cursor-pagination mock data layer (#1510).

   Mock pools are intentionally larger than one page (PAGE_SIZE=50) so the
   contacts/tasks infinite-scroll path can be exercised before the backend
   API exposes a pageCursor. `readMockCursorPage` slices any pool with an
   opaque numeric cursor (offset index) and reports hasMore/nextCursor —
   the shape the route hooks consume.
   ═══════════════════════════════════════════════════════════════════════ */

export const WORKBENCH_MOCK_PAGE_SIZE = 50;

export interface WorkbenchMockCursorPage<T> {
  items: T[];
  /** Opaque cursor for the next page; undefined when the pool is exhausted. */
  nextCursor: string | undefined;
  /** Whether another page is available after this one. */
  hasMore: boolean;
}

/** Slice a mock pool by cursor offset. Pools ≤ PAGE_SIZE simply report hasMore=false. */
export function readMockCursorPage<T>(
  pool: readonly T[],
  pageSize: number,
  cursor: string | undefined,
): WorkbenchMockCursorPage<T> {
  const parsed = cursor === undefined ? 0 : Number(cursor);
  const start = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  const items = pool.slice(start, start + pageSize);
  const nextOffset = start + items.length;
  return {
    items,
    nextCursor: nextOffset < pool.length ? String(nextOffset) : undefined,
    hasMore: nextOffset < pool.length,
  };
}

/** Contact member pool: the 3 hand-written seeds plus generated rows so the
 *  internal contacts pane has more than one page (mock pagination path). */
const WORKBENCH_MOCK_CONTACT_POOL_SIZE = 63;

export const WORKBENCH_MOCK_CONTACT_MEMBER_POOL: ContactMember[] = (() => {
  const pool = [...WORKBENCH_MOCK_CONTACT_MEMBERS];
  for (let i = pool.length + 1; i <= WORKBENCH_MOCK_CONTACT_POOL_SIZE; i += 1) {
    const member: ContactMember = {
      id: `member-${String(i).padStart(3, '0')}`,
      name: `成员 ${String(i).padStart(2, '0')}`,
      initials: `M${i}`,
      org: 'TokenDance',
      status: i % 3 === 0 ? '在线' : '离线',
    };
    if (i % 4 === 0) member.tag = '协作者';
    pool.push(member);
  }
  return pool;
})();

/** Task pool: the hand-written seeds plus generated rows (> one page). */
const WORKBENCH_MOCK_TASK_POOL_SIZE = 63;
const MOCK_TASK_PROJECTS = ['前端重构任务', 'AgentHub 设计评审', '文档重构', 'Agent 配置'] as const;
const MOCK_TASK_ASSIGNEES = ['Builder', 'Johnny', 'Reviewer', 'Trump'] as const;
const MOCK_TASK_STATUSES = ['未开始', '进行中', '待评审', '待确认', '已完成'] as const;

/** Demo hosting-conversation binding by assignee (#1963). Ids mirror the
 *  shared demo conversation seeds; assignees without a conversation (Trump)
 *  stay unbound and their task cards offer no conversation deep link. */
const MOCK_TASK_HOST_CONVERSATION_BY_ASSIGNEE: Record<string, string> = {
  Builder: 'builder',
  Johnny: 'johnny',
  Reviewer: 'reviewer',
};

export const WORKBENCH_MOCK_TASK_POOL: TaskItem[] = (() => {
  const pool = WORKBENCH_MOCK_TASK_GROUPS.flatMap((group) => group.tasks);
  for (let i = pool.length + 1; i <= WORKBENCH_MOCK_TASK_POOL_SIZE; i += 1) {
    const assignee = MOCK_TASK_ASSIGNEES[(i - 1) % MOCK_TASK_ASSIGNEES.length] ?? 'Builder';
    const task: TaskItem = {
      id: `task-${String(i).padStart(3, '0')}`,
      title: `分页任务 ${String(i).padStart(2, '0')}`,
      project: MOCK_TASK_PROJECTS[(i - 1) % MOCK_TASK_PROJECTS.length] ?? '前端重构任务',
      assignee,
      startTime: '刚刚',
      dueDate: i % 2 === 0 ? '今天 18:00' : '明天 18:00',
      creator: 'demo-user',
      status: MOCK_TASK_STATUSES[(i - 1) % MOCK_TASK_STATUSES.length] ?? '未开始',
    };
    const hostConversationId = MOCK_TASK_HOST_CONVERSATION_BY_ASSIGNEE[assignee];
    if (hostConversationId) task.conversationId = hostConversationId;
    pool.push(task);
  }
  return pool;
})();
