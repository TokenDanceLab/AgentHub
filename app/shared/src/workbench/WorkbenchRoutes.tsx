import React, { useState } from 'react';
import type { WorkbenchAgent } from '../platform';
import type {
  ContactGroup,
  ContactMember,
  ContactsPane,
  DocRow,
  DocsPane,
  ProjectFilter,
  ProjectTab,
  SettingsPaneId,
  TaskGroup,
  TasksPane,
  ViewMode,
} from './pages';
import {
  AgentsPage,
  ContactsPage,
  DEFAULT_PROJECTS,
  DocsPage,
  ProjectsPage,
  SettingsPage,
  TasksPage,
} from './pages';
import type {
  AgentConfig,
  AgentsPaneId,
  AuditEntry,
  MarketTemplate,
  ModelHealth,
  ModelInfo,
  PolicyRule,
} from './pages/AgentsPage';
import type { GlobalRailPage } from './GlobalRail';
import styles from './AgentHubWorkbench.module.css';

type WorkbenchPage = Exclude<GlobalRailPage, 'chat'>;

export interface WorkbenchRoutesProps {
  activePage: WorkbenchPage;
  agents: WorkbenchAgent[];
}

const CONTACT_MEMBERS: ContactMember[] = [
  { id: 'delicious', name: 'Delicious233', initials: 'D', tag: '当前用户', org: 'TokenDance', status: '在线' },
  { id: 'johnny', name: 'Johnny', initials: 'J', tag: '维护者', org: 'AgentHub Desktop', status: '刚刚活跃' },
  { id: 'trump', name: 'Trump', initials: 'T', tag: '协作者', org: '设计评审', status: '今天 10:18' },
];

const CONTACT_GROUPS: ContactGroup[] = [
  { id: 'design-review', name: 'AgentHub 设计评审', initials: 'A', count: '8 人', latestMessage: '最近消息：云文档页需要收紧表格密度' },
  { id: 'ai-game', name: 'AI 游戏项目', initials: 'P', count: '5 人', latestMessage: '最近消息：题材方向研究进行中' },
  { id: 'docs-refactor', name: '文档重构', initials: 'W', count: '3 人', latestMessage: '最近消息：等待归档确认' },
];

const DOC_ROWS: DocRow[] = [
  { id: 'desktop-design-system', title: 'AgentHub Desktop 设计系统对齐清单', tag: '内部', location: '我的文档库', owner: 'Delicious233', time: '今天 14:52' },
  { id: 'meeting-notes', title: '智能纪要：【AgentHub 设计评审】', tag: '共享', location: '与我共享', owner: 'Johnny', time: '今天 11:08' },
  { id: 'session-handoff', title: 'SESSION-HANDOFF-2026-06-05.md', location: '项目产物', owner: 'Codex', time: '昨天 22:40' },
  { id: 'im-breakdown', title: 'AgentHub IM 交互拆解', tag: '内部', location: '我的文档库', owner: 'Delicious233', time: '6月4日 15:18' },
  { id: 'design-contract', title: 'TokenDance Design Contract v3', tag: '共享', location: '知识库', owner: 'Johnny', time: '6月3日 18:33' },
  { id: 'deep-research', title: 'AgentHub 开源项目深度研究', tag: '外部', location: '我的文档库', owner: 'Trump', time: '6月2日 19:42' },
];

const TASK_GROUPS: TaskGroup[] = [
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
        creator: 'Delicious233',
        status: '进行中',
      },
      {
        id: 'embedded-docs',
        title: '云文档内嵌子页对齐',
        project: 'AgentHub 设计评审',
        assignee: 'Johnny',
        startTime: '今天 11:32',
        dueDate: '今天 22:00',
        creator: 'Delicious233',
        status: '待评审',
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
      },
    ],
  },
];

const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'builder-agent',
    name: 'Builder',
    role: '代码实现',
    engine: 'Claude Code',
    model: 'DeepSeek-V4-Pro',
    mode: 'Plan → Code',
    approval: '写文件前确认',
    scope: '当前项目',
    state: 'running',
    skills: ['Read File', 'Write File', 'Shell', 'Git Diff'],
    tools: { 'Read File': '允许', 'Write File': '允许', Shell: '允许', 'Git Diff': '需确认', 'Browser Screenshot': '需确认' },
  },
  {
    id: 'reviewer-agent',
    name: 'Reviewer',
    role: '审查与验收',
    engine: 'Claude Code',
    model: 'DeepSeek-V4-Pro',
    mode: 'Review',
    approval: '只读默认允许',
    scope: '当前项目',
    state: 'ready',
    skills: ['Read File', 'Git Diff', 'Browser Screenshot'],
    tools: { 'Read File': '允许', 'Write File': '禁止', Shell: '需确认', 'Git Diff': '允许', 'Browser Screenshot': '允许' },
  },
  {
    id: 'researcher-agent',
    name: 'Researcher',
    role: '资料研究',
    engine: 'DeepSeek',
    model: 'DeepSeek-V4-Pro',
    mode: 'Research',
    approval: '外部访问前确认',
    scope: '文档库',
    state: 'idle',
    skills: ['Web 摘要', '文档库', '引用整理'],
    tools: { 'Read File': '允许', 'Write File': '需确认', Shell: '禁止', 'Git Diff': '需确认', 'Browser Screenshot': '需确认' },
  },
  {
    id: 'deployer-agent',
    name: 'Deployer',
    role: '预览与发布',
    engine: 'Claude Code',
    model: 'DeepSeek-V4-Pro',
    mode: 'Deploy',
    approval: '生产部署前确认',
    scope: '当前项目',
    state: 'waiting',
    skills: ['Shell', '构建', '预览', '产物归档'],
    tools: { 'Read File': '允许', 'Write File': '允许', Shell: '需确认', 'Git Diff': '允许', 'Browser Screenshot': '允许' },
  },
];

const AGENT_SKILL_OPTIONS = ['Read File', 'Write File', 'Shell', 'Git Diff', 'Browser Screenshot', 'Web 摘要', '文档库', '引用整理', '构建', '预览', '产物归档'];

const AGENT_TOOL_OPTIONS = ['Read File', 'Write File', 'Shell', 'Git Diff', 'Browser Screenshot'];

const AGENT_MARKET_TEMPLATES: MarketTemplate[] = [
  { name: 'Spec Writer', description: '把聊天结论整理成需求和验收标准', category: '文档', detail: '适合需求澄清、PRD、验收标准' },
  { name: 'Data Analyst', description: '读取表格和日志，生成趋势洞察', category: '数据', detail: '适合运营报表、成本归因、日志分析' },
  { name: 'Browser QA', description: '用浏览器截图检查页面和交互', category: '测试', detail: '适合本地预览、视觉回归、可用性检查' },
  { name: 'Release Captain', description: '发布检查、版本说明、回滚清单', category: '发布', detail: '适合上线前检查、公告和回滚方案' },
  { name: 'Security Reviewer', description: '审查权限边界、密钥暴露和风险项', category: '安全', detail: '适合发布门禁、代码审计、风险登记' },
  { name: 'Docs Librarian', description: '整理云文档、Handoff 和归档索引', category: '文档', detail: '适合知识库、项目文档和长期归档' },
];

const AGENT_POLICY_RULES: PolicyRule[] = [
  { name: '写入工作区文件', riskLevel: '中风险', action: '需要确认', description: 'Write File / apply_patch / 格式化输出' },
  { name: '执行 Shell 命令', riskLevel: '中风险', action: '需要确认', description: '构建、预览、轻量诊断允许进入确认队列' },
  { name: '访问浏览器截图', riskLevel: '低风险', action: '默认允许', description: '仅用于本地 demo 视觉检查和 DOM 验证' },
  { name: '生产部署动作', riskLevel: '高风险', action: '禁止', description: '当前 demo 不连接真实部署面' },
];

const AGENT_MODELS: ModelInfo[] = [
  { name: 'DeepSeek-V4-Pro', state: '默认', description: '长上下文推理与代码实现', assignedAgents: 'Builder, Reviewer, Deployer' },
  { name: 'kimi-k2.6', state: '备选', description: '前端视觉和多模态审查', assignedAgents: 'Browser QA' },
  { name: 'glm-5.1', state: '备选', description: '中文文档和知识整理', assignedAgents: 'Docs Librarian' },
  { name: 'gpt-5-codex', state: '实验', description: '复杂代码任务和工具编排', assignedAgents: 'Researcher' },
];

const AGENT_MODEL_HEALTH: ModelHealth[] = [
  { name: 'DeepSeek-V4-Pro', status: '可用', meta: '延迟 680ms' },
  { name: 'kimi-k2.6', status: '可用', meta: '视觉评审优先' },
  { name: 'gpt-5-codex', status: '实验', meta: '需要手动选择' },
];

const AGENT_AUDIT_ROWS: AuditEntry[] = [
  { time: '14:59', agent: 'Builder', tool: 'Write File', result: '需确认', target: 'migrations/0007_chat_threads.sql' },
  { time: '14:57', agent: 'Reviewer', tool: 'Git Diff', result: '允许', target: 'desktop/app.js' },
  { time: '14:52', agent: 'Browser QA', tool: 'Browser Screenshot', result: '允许', target: 'http://127.0.0.1:5176/desktop/' },
  { time: '14:41', agent: 'Researcher', tool: 'Shell', result: '禁止', target: '外部网络检索未授权' },
];

function agentColor(agent: Pick<AgentConfig, 'id' | 'name'>): string {
  const key = (agent.id || agent.name || '').toLowerCase();
  if (key.includes('builder')) return 'var(--role-builder)';
  if (key.includes('reviewer')) return 'var(--role-reviewer)';
  if (key.includes('researcher')) return 'var(--role-researcher)';
  if (key.includes('deployer') || key.includes('release')) return 'var(--role-deployer)';
  if (key.includes('security')) return 'var(--danger)';
  if (key.includes('browser')) return 'var(--role-deployer)';
  if (key.includes('data')) return 'var(--warning)';
  return 'var(--primary)';
}

const SETTINGS_DEFAULTS = {
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
  workspacePath: 'D:\\Code\\TokenDance\\agenthub-design',
  targetProjectPath: 'D:\\Code\\TokenDance\\AgentHub',
  hrmOverlayEnabled: true,
  visualQaMode: '按需',
  logLevel: '标准',
  designSystemValidation: '手动',
  stateStrategies: { empty: true, invalid: true, missing: true },
};

export function WorkbenchRoutes({ activePage, agents }: WorkbenchRoutesProps): React.ReactElement {
  const [contactsPane, setContactsPane] = useState<ContactsPane>('internal');
  const [docsNav, setDocsNav] = useState('home');
  const [docsTab, setDocsTab] = useState<DocsPane>('recent');
  const [agentsPane, setAgentsPane] = useState<AgentsPaneId>('installed');
  const [tasksPane, setTasksPane] = useState<TasksPane>('owned');
  const [taskViewMode, setTaskViewMode] = useState<ViewMode>('list');
  const [projectId, setProjectId] = useState(DEFAULT_PROJECTS[0]?.id ?? null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [projectTab, setProjectTab] = useState<ProjectTab>('overview');
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('appearance');
  const [settings, setSettings] = useState(SETTINGS_DEFAULTS);

  void agents;
  const agentConfigs = DEFAULT_AGENT_CONFIGS;

  function handleSettingChange(key: string, value: string | boolean): void {
    setSettings((current) => {
      if (key.startsWith('perm_')) {
        return {
          ...current,
          permissions: { ...current.permissions, [key.slice(5)]: String(value) },
        };
      }
      if (key.startsWith('stateStrategy_')) {
        const strategy = key.slice('stateStrategy_'.length) as keyof typeof current.stateStrategies;
        return {
          ...current,
          stateStrategies: { ...current.stateStrategies, [strategy]: Boolean(value) },
        };
      }
      return { ...current, [key]: value };
    });
  }

  switch (activePage) {
    case 'contacts':
      return (
        <ContactsPage
          activePane={contactsPane}
          groups={CONTACT_GROUPS}
          members={CONTACT_MEMBERS}
          onPaneChange={setContactsPane}
          orgInitials="TD"
          orgName="TokenDance"
          starredContacts={CONTACT_MEMBERS.slice(0, 2)}
        />
      );
    case 'docs':
      return (
        <DocsPage
          activeNav={docsNav}
          activeTab={docsTab}
          navItems={[]}
          onNavChange={setDocsNav}
          onTabChange={setDocsTab}
          rows={DOC_ROWS}
        />
      );
    case 'agents':
      return (
        <AgentsPage
          activePane={agentsPane}
          agents={agentConfigs}
          allSkills={AGENT_SKILL_OPTIONS}
          allTools={AGENT_TOOL_OPTIONS}
          auditEntries={AGENT_AUDIT_ROWS}
          confirmCount={agentConfigs.reduce((total, agent) => total + AGENT_TOOL_OPTIONS.filter((tool) => agent.tools[tool] === '需确认').length, 0)}
          defaultModelLabel="DeepSeek-V4-Pro"
          installedCount={agentConfigs.length}
          marketFeatured={AGENT_MARKET_TEMPLATES.slice(0, 3)}
          marketTemplates={AGENT_MARKET_TEMPLATES.slice(3)}
          modelHealthRows={AGENT_MODEL_HEALTH}
          modelRoutes={agentConfigs.map((agent) => ({
            agentId: agent.id,
            agentName: agent.name,
            agentInitials: agent.name.slice(0, 1).toUpperCase(),
            agentColor: agentColor(agent),
            role: agent.role,
            mode: agent.mode,
            model: agent.model,
          }))}
          models={AGENT_MODELS}
          onPaneChange={setAgentsPane}
          policyRules={AGENT_POLICY_RULES}
          recentShortcuts={['Builder 权限更新', 'Browser QA 已安装', 'DeepSeek-V4-Pro 路由']}
          runnableCount={agentConfigs.filter((agent) => agent.state === 'running' || agent.state === 'ready').length}
          {...(agentConfigs[0]?.id ? { selectedAgentId: agentConfigs[0].id } : {})}
          toolMatrixAgents={agentConfigs.map((agent) => ({
            id: agent.id,
            name: agent.name,
            initials: agent.name.slice(0, 1).toUpperCase(),
            color: agentColor(agent),
            permissions: agent.tools,
          }))}
          toolMatrixTools={AGENT_TOOL_OPTIONS}
        />
      );
    case 'runs':
      return (
        <TasksPage
          activePane={tasksPane}
          activeFilterCount={1}
          crossProjectCount={new Set(TASK_GROUPS.flatMap((group) => group.tasks.map((task) => task.project))).size}
          dueTodayCount={1}
          groups={TASK_GROUPS}
          incompleteCount={TASK_GROUPS.flatMap((group) => group.tasks).filter((task) => task.status !== '已完成').length}
          onPaneChange={setTasksPane}
          onViewModeChange={setTaskViewMode}
          viewMode={taskViewMode}
        />
      );
    case 'projects':
      return (
        <ProjectsPage
          activeFilter={projectFilter}
          activeProjectId={projectId}
          activeTab={projectTab}
          onFilterChange={setProjectFilter}
          onProjectSelect={setProjectId}
          onTabChange={setProjectTab}
          projects={DEFAULT_PROJECTS}
        />
      );
    case 'settings':
      return (
        <SettingsPage
          {...settings}
          activePane={settingsPane}
          onChangeSetting={handleSettingChange}
          onSelectPane={setSettingsPane}
          spaceMeta="桌面设计 demo"
          spaceTitle="AgentHub Desktop"
        />
      );
    default:
      return (
        <div className={styles.routeMissing} role="status">
          路由未配置：{activePage}
        </div>
      );
  }
}
