/**
 * Workbench demo agents and conversation base fixtures.
 * Peel companion of workbenchDemo (#1131). Pure only; zero behavior change.
 */

import type { WorkbenchAgent, WorkbenchConversation } from '../platform';
import { TEAMRUN_DEMO_CONVERSATION_ID } from './teamrunDemo';

const ROLE_BUILDER = '#5e8dcc';
const ROLE_REVIEWER = '#409467';
const ROLE_DEPLOYER = '#2b8a9e';
const ROLE_ORCHESTRATOR = '#0071BC';

export const demoConversationsBase: WorkbenchConversation[] = [
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
    members: ['Orchestrator', 'Builder', 'Reviewer', 'Deployer'],
  },
  {
    id: TEAMRUN_DEMO_CONVERSATION_ID,
    title: 'TeamRun Fixture',
    kind: 'group',
    subtitle: 'fixture-only UI evidence capture',
    updatedLabel: '10:11',
    unreadCount: 3,
    model: 'fixture-only',
    avatarLabel: 'T',
    avatarColor: `linear-gradient(135deg, ${ROLE_ORCHESTRATOR}, ${ROLE_REVIEWER})`,
    members: ['Builder', 'Reviewer', 'Deployer'],
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
    avatarTextColor: 'var(--td-ink-subtle)',
    members: ['Delicious233', 'Builder', 'Reviewer', 'Johnny', 'Trump'],
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
    avatarTextColor: 'var(--td-ink-subtle)',
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
