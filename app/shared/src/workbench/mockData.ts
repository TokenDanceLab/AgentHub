import type {
  ContactGroup,
  ContactMember,
  ServiceDesk,
} from './pages/ContactsPage';
import type { DocRow } from './pages/DocsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import type { TaskGroup } from './pages/TasksPage';
import type {
  AgentConfig,
  AuditEntry,
  MarketTemplate,
  ModelHealth,
  ModelInfo,
  PolicyRule,
} from './pages/AgentsPage';

export const WORKBENCH_MOCK_CONTACT_MEMBERS: ContactMember[] = [
  { id: 'delicious', name: 'Delicious233', initials: 'D', tag: '当前用户', org: 'TokenDance', status: '在线' },
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
  { id: 'desktop-design-system', title: 'AgentHub Desktop 设计系统对齐清单', tag: '内部', location: '我的文档库', owner: 'Delicious233', time: '今天 14:52' },
  { id: 'meeting-notes', title: '智能纪要：【AgentHub 设计评审】', tag: '共享', location: '与我共享', owner: 'Johnny', time: '今天 11:08' },
  { id: 'session-handoff', title: 'SESSION-HANDOFF-2026-06-05.md', location: '项目产物', owner: 'Codex', time: '昨天 22:40' },
  { id: 'im-breakdown', title: 'AgentHub IM 交互拆解', tag: '内部', location: '我的文档库', owner: 'Delicious233', time: '6月4日 15:18' },
  { id: 'design-contract', title: 'TokenDance Design Contract v3', tag: '共享', location: '知识库', owner: 'Johnny', time: '6月3日 18:33' },
  { id: 'deep-research', title: 'AgentHub 开源项目深度研究', tag: '外部', location: '我的文档库', owner: 'Trump', time: '6月2日 19:42' },
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

export const WORKBENCH_MOCK_AGENT_CONFIGS: AgentConfig[] = [
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

export const WORKBENCH_MOCK_AGENT_SKILL_OPTIONS = ['Read File', 'Write File', 'Shell', 'Git Diff', 'Browser Screenshot', 'Web 摘要', '文档库', '引用整理', '构建', '预览', '产物归档'];

export const WORKBENCH_MOCK_AGENT_TOOL_OPTIONS = ['Read File', 'Write File', 'Shell', 'Git Diff', 'Browser Screenshot'];

export const WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES: MarketTemplate[] = [
  { name: 'Spec Writer', description: '把聊天结论整理成需求和验收标准', category: '文档', detail: '适合需求澄清、PRD、验收标准' },
  { name: 'Data Analyst', description: '读取表格和日志，生成趋势洞察', category: '数据', detail: '适合运营报表、成本归因、日志分析' },
  { name: 'Browser QA', description: '用浏览器截图检查页面和交互', category: '测试', detail: '适合本地预览、视觉回归、可用性检查' },
  { name: 'Release Captain', description: '发布检查、版本说明、回滚清单', category: '发布', detail: '适合上线前检查、公告和回滚方案' },
  { name: 'Security Reviewer', description: '审查权限边界、密钥暴露和风险项', category: '安全', detail: '适合发布门禁、代码审计、风险登记' },
  { name: 'Docs Librarian', description: '整理云文档、Handoff 和归档索引', category: '文档', detail: '适合知识库、项目文档和长期归档' },
];

export const WORKBENCH_MOCK_AGENT_POLICY_RULES: PolicyRule[] = [
  { name: '写入工作区文件', riskLevel: '中风险', action: '需要确认', description: 'Write File / apply_patch / 格式化输出' },
  { name: '执行 Shell 命令', riskLevel: '中风险', action: '需要确认', description: '构建、预览、轻量诊断允许进入确认队列' },
  { name: '访问浏览器截图', riskLevel: '低风险', action: '默认允许', description: '仅用于本地 demo 视觉检查和 DOM 验证' },
  { name: '生产部署动作', riskLevel: '高风险', action: '禁止', description: '当前 demo 不连接真实部署面' },
];

export const WORKBENCH_MOCK_AGENT_MODELS: ModelInfo[] = [
  { name: 'DeepSeek-V4-Pro', state: '默认', description: '长上下文推理与代码实现', assignedAgents: 'Builder, Reviewer, Deployer' },
  { name: 'kimi-k2.6', state: '备选', description: '前端视觉和多模态审查', assignedAgents: 'Browser QA' },
  { name: 'glm-5.1', state: '备选', description: '中文文档和知识整理', assignedAgents: 'Docs Librarian' },
  { name: 'gpt-5-codex', state: '实验', description: '复杂代码任务和工具编排', assignedAgents: 'Researcher' },
];

export const WORKBENCH_MOCK_AGENT_MODEL_HEALTH: ModelHealth[] = [
  { name: 'DeepSeek-V4-Pro', status: '可用', meta: '延迟 680ms' },
  { name: 'kimi-k2.6', status: '可用', meta: '视觉评审优先' },
  { name: 'gpt-5-codex', status: '实验', meta: '需要手动选择' },
];

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
    members: ['Delicious233', 'Johnny', 'Trump', 'Builder', 'Researcher'],
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
    members: ['Delicious233', 'Johnny', 'Reviewer'],
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
  workspacePath: 'D:\\Code\\TokenDance\\agenthub-design',
  targetProjectPath: 'D:\\Code\\TokenDance\\AgentHub',
  hrmOverlayEnabled: true,
  visualQaMode: '按需',
  logLevel: '标准',
  designSystemValidation: '手动',
  stateStrategies: { empty: true, invalid: true, missing: true },
};
