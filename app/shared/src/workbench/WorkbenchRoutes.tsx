import React, { useMemo, useState } from 'react';
import {
  normalizeWorkbenchDataMode,
  readWorkbenchDataModeOverride,
  writeWorkbenchDataModeOverride,
} from '../demo';
import {
  composerSubmitBehaviorFromLabel,
  composerSubmitBehaviorLabel,
  readComposerSubmitBehavior,
  writeComposerSubmitBehavior,
} from './workbenchPreferences';
import type { WorkbenchAgent } from '../platform';
import type {
  ContactsPane,
  ContactGroup,
  ContactMember,
  DocRow,
  DocsPane,
  ProjectArtifact,
  ProjectDraft,
  ProjectFilter,
  ProjectInfo,
  ProjectTab,
  SettingsPaneId,
  ServiceDesk,
  TaskGroup,
  TaskItem,
  TaskStatus,
  TasksPane,
  ViewMode,
} from './pages';
import {
  AgentsPage,
  ContactsPage,
  DocsPage,
  ProjectsPage,
  SettingsPage,
  TasksPage,
} from './pages';
import type { AgentConfig, AgentsPaneId, ToolPermission } from './pages/AgentsPage';
import type { TaskEditDraft } from './pages/TasksPage';
import type { GlobalRailPage } from './GlobalRail';
import {
  fileTypeFromPreviewName,
  previewFilenameFromTitle,
  type WorkbenchDocumentPreview,
} from './documentPreview';
import {
  WORKBENCH_MOCK_AGENT_AUDIT_ROWS,
  WORKBENCH_MOCK_AGENT_CONFIGS,
  WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES,
  WORKBENCH_MOCK_AGENT_MODEL_HEALTH,
  WORKBENCH_MOCK_AGENT_MODELS,
  WORKBENCH_MOCK_AGENT_POLICY_RULES,
  WORKBENCH_MOCK_AGENT_SKILL_OPTIONS,
  WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
  WORKBENCH_MOCK_CONTACT_GROUPS,
  WORKBENCH_MOCK_CONTACT_MEMBERS,
  WORKBENCH_MOCK_CONTACT_SHORTCUTS,
  WORKBENCH_MOCK_DOC_ROWS,
  WORKBENCH_MOCK_EXTERNAL_CONTACTS,
  WORKBENCH_MOCK_PENDING_CONTACTS,
  WORKBENCH_MOCK_PROJECTS,
  WORKBENCH_MOCK_SERVICE_DESKS,
  WORKBENCH_MOCK_SETTINGS_DEFAULTS,
  WORKBENCH_MOCK_TASK_GROUPS,
} from './mockData';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import styles from './AgentHubWorkbench.module.css';

type WorkbenchPage = Exclude<GlobalRailPage, 'chat'>;
type TaskSortMode = 'custom' | 'due';
type TaskGroupMode = 'custom' | 'project' | 'status';

const TASK_STATUS_SEQUENCE: TaskStatus[] = ['未开始', '进行中', '待评审', '待确认', '已完成'];

export interface WorkbenchRoutesProps {
  activePage: WorkbenchPage;
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  focusedAgentId?: string | undefined;
  projects?: ProjectInfo[] | undefined;
  projectsStatus?: WorkbenchProjectsStatus | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
}

export interface WorkbenchAgentProfilesStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  savingAgentId?: string | undefined;
  deletingAgentId?: string | undefined;
}

export interface WorkbenchProjectsStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  saving?: boolean | undefined;
}

export interface WorkbenchContactsData {
  members: ContactMember[];
  externalContacts?: ContactMember[] | undefined;
  pendingContacts?: ContactMember[] | undefined;
  starredContacts?: ContactMember[] | undefined;
  groups?: ContactGroup[] | undefined;
  serviceDesks?: ServiceDesk[] | undefined;
  recentShortcuts?: string[] | undefined;
  orgName?: string | undefined;
  orgInitials?: string | undefined;
}

function persistDataModeLabel(value: string): void {
  writeWorkbenchDataModeOverride(normalizeWorkbenchDataMode(value));
}

function dataModeLabel(): string {
  switch (readWorkbenchDataModeOverride()) {
    case 'demo':
      return 'Mock';
    case 'real':
      return '正常';
    case 'auto':
    default:
      return '自动';
  }
}

function createDocPreview(doc: DocRow): WorkbenchDocumentPreview {
  const filename = previewFilenameFromTitle(doc.title);
  const tagLine = doc.tag ? `- 标签：${doc.tag}` : '- 标签：未标记';
  return {
    id: `doc:${doc.id}`,
    name: filename,
    type: fileTypeFromPreviewName(filename),
    owner: doc.owner,
    sourceLabel: doc.location,
    content: [
      `# ${doc.title}`,
      '',
      '## 文档信息',
      `- 所有者：${doc.owner}`,
      `- 位置：${doc.location}`,
      `- 创建时间：${doc.time}`,
      tagLine,
      '',
      '## 摘要',
      '这是 AgentHub 轻量文档预览。当前内容来自文档索引，后续可由 Hub artifact store、workspace 文件或外部文档 provider 提供正文。',
      '',
      '## 下一步',
      '- 接入全文搜索与项目归档索引。',
      '- 将外部云文档 provider 映射为同一预览合同。',
      '- 对 Markdown、Diff、表格和链接产物使用统一只读预览。',
    ].join('\n'),
  };
}

function createProjectArtifactPreview(projectId: string, artifact: ProjectArtifact): WorkbenchDocumentPreview {
  const name = artifact.name ?? 'artifact.txt';
  const type = fileTypeFromPreviewName(name);
  return {
    id: `project:${projectId}:${artifact.id}`,
    name,
    type,
    owner: 'AgentHub',
    sourceLabel: `项目产物 / ${projectId}`,
    content: projectArtifactContent(projectId, name, type),
    diffContent: projectArtifactDiff(name, type),
  };
}

function projectArtifactContent(projectId: string, name: string, type: string): string {
  if (type === 'xlsx') {
    return [
      `# ${name}`,
      '',
      '| 维度 | 状态 | 备注 |',
      '|---|---|---|',
      '| 项目 | 已索引 | ' + projectId + ' |',
      '| 类型 | 表格产物 | 轻量预览先以 Markdown 表格呈现 |',
      '| 后续 | 待接入 | Sheet viewer / 导出 / provider sync |',
    ].join('\n');
  }

  if (type === 'md') {
    return [
      `# ${name}`,
      '',
      '## 项目产物',
      `- 项目：${projectId}`,
      '- 来源：Agent run / 项目归档',
      '- 浏览：当前使用 AgentHub 轻量预览，后续可接 Hub artifact store 正文。',
      '',
      '## 内容摘要',
      '这个文件已进入项目产物索引。项目页负责展示上下文，预览区负责阅读正文、源码和 Diff。',
    ].join('\n');
  }

  return [
    `// ${name}`,
    `// project: ${projectId}`,
    '// readonly artifact preview',
    '',
    'export const artifact = {',
    `  name: ${JSON.stringify(name)},`,
    `  projectId: ${JSON.stringify(projectId)},`,
    '  source: "AgentHub project artifact index",',
    '};',
  ].join('\n');
}

function projectArtifactDiff(name: string, type: string): string | undefined {
  if (type === 'xlsx') return undefined;
  return [
    `diff --git a/${name} b/${name}`,
    `--- a/${name}`,
    `+++ b/${name}`,
    '@@ project artifact preview @@',
    `+${name}`,
    '+已接入 AgentHub 轻量项目产物预览。',
  ].join('\n');
}

function persistedComposerSubmitBehaviorLabel(): string {
  return composerSubmitBehaviorLabel(readComposerSubmitBehavior());
}

function createSettingsDefaults(): typeof WORKBENCH_MOCK_SETTINGS_DEFAULTS {
  return {
    ...WORKBENCH_MOCK_SETTINGS_DEFAULTS,
    dataMode: dataModeLabel(),
    composerSubmitBehavior: persistedComposerSubmitBehaviorLabel(),
  };
}

const DESIGN_DONE_TASK: TaskItem = {
  id: 'readme-structure-done',
  title: 'README 结构更新',
  project: '文档重构',
  assignee: 'Builder',
  startTime: '6月2日',
  dueDate: '6月2日',
  creator: 'Johnny',
  status: '已完成',
};

const WATCHING_TASK_IDS = new Set(['embedded-docs', 'project-announcement']);
const ACTIVITY_TASK_IDS = new Set(['sqlite-plan', 'project-announcement', 'agent-market']);

function flattenTaskGroups(groups: TaskGroup[]): TaskItem[] {
  return groups.flatMap((group) => group.tasks);
}

function taskMatchesPane(task: TaskItem, pane: TasksPane): boolean {
  switch (pane) {
    case 'watching':
      return WATCHING_TASK_IDS.has(task.id) || task.project === 'AgentHub 设计评审';
    case 'activity':
      return ACTIVITY_TASK_IDS.has(task.id) || task.startTime === '刚刚';
    case 'created':
      return task.creator === 'Delicious233';
    case 'assigned':
      return task.creator === 'Delicious233' && task.assignee !== 'Delicious233';
    case 'done':
      return task.status === '已完成';
    case 'owned':
    case 'all':
    default:
      return true;
  }
}

function dueRank(label: string): number {
  if (label.includes('今天')) return 0;
  if (label.includes('明天')) return 1;
  const match = /(\d+)月(\d+)日/.exec(label);
  if (match) return Number(match[1]) * 100 + Number(match[2]);
  return 9999;
}

function sortTasks(tasks: TaskItem[], mode: TaskSortMode): TaskItem[] {
  if (mode === 'custom') return tasks;
  return [...tasks].sort((a, b) => (
    dueRank(a.dueDate) - dueRank(b.dueDate)
    || a.title.localeCompare(b.title, 'zh-Hans-CN')
  ));
}

function groupTasks(tasks: TaskItem[], mode: TaskGroupMode): TaskGroup[] {
  if (mode === 'custom') return [{ label: '默认分组', tasks }];

  const labels = mode === 'status'
    ? ['进行中', '待评审', '待确认', '未开始', '已完成']
    : Array.from(new Set(tasks.map((task) => task.project)));

  return labels
    .map((label) => ({
      label,
      tasks: tasks.filter((task) => (mode === 'status' ? task.status : task.project) === label),
    }))
    .filter((group) => group.tasks.length > 0);
}

function buildTaskGroups(
  sourceGroups: TaskGroup[],
  pane: TasksPane,
  filterActive: boolean,
  sortMode: TaskSortMode,
  groupMode: TaskGroupMode,
  viewMode: ViewMode,
): TaskGroup[] {
  const filteredGroups = sourceGroups
    .map((group) => ({
      ...group,
      tasks: sortTasks(
        group.tasks.filter((task) => (
          taskMatchesPane(task, pane)
          && (pane === 'done' || !filterActive || task.status !== '已完成')
        )),
        sortMode,
      ),
    }))
    .filter((group) => group.tasks.length > 0 || (
      groupMode === 'custom' && group.label.startsWith('自定义分组')
    ));

  let groups = filteredGroups;
  if (pane === 'done' && flattenTaskGroups(groups).length === 0) {
    groups = [{ label: '默认分组', tasks: [DESIGN_DONE_TASK] }];
  }

  const nextGroupMode = viewMode === 'board'
    ? 'status'
    : viewMode === 'dashboard'
      ? 'project'
      : groupMode;
  if (nextGroupMode !== 'custom') {
    return groupTasks(sortTasks(flattenTaskGroups(groups), sortMode), nextGroupMode);
  }

  return groups.length > 0 ? groups : [{ label: '默认分组', tasks: [] }];
}

function createLocalTask(index: number): TaskItem {
  return {
    id: `local-task-${index}`,
    title: `未命名任务 ${index}`,
    project: '前端重构任务',
    assignee: 'Builder',
    startTime: '刚刚',
    dueDate: '今天 22:00',
    creator: 'Delicious233',
    status: '未开始',
  };
}

function workbenchAgentStateToAgentState(status: WorkbenchAgent['status']): AgentConfig['state'] {
  switch (status) {
    case 'available':
      return 'ready';
    case 'configuring':
      return 'waiting';
    case 'unavailable':
    default:
      return 'idle';
  }
}

function toolPermissionFromAgent(agent: WorkbenchAgent): Record<string, ToolPermission> {
  const allowedTools = new Set(agent.toolAllowlist ?? []);
  if (allowedTools.size === 0) return {};
  return Object.fromEntries(
    WORKBENCH_MOCK_AGENT_TOOL_OPTIONS.map((tool) => [
      tool,
      allowedTools.has(tool) ? '允许' : '需确认',
    ]),
  ) as Record<string, ToolPermission>;
}

function workbenchAgentToAgentConfig(agent: WorkbenchAgent): AgentConfig {
  const runtimeLabel = agent.runtimeId?.trim() || 'Hub AgentProfile';
  const providerLabel = agent.provider?.trim();
  const modelLabel = [providerLabel, agent.model?.trim()].filter(Boolean).join(' / ') || '未配置模型';
  return {
    id: agent.id,
    name: agent.name,
    role: agent.description?.trim() || 'Hub AgentProfile',
    engine: runtimeLabel,
    model: modelLabel,
    mode: agent.reasoningEffort ? `Reasoning ${agent.reasoningEffort}` : 'Hub read-through',
    approval: agent.approvalPolicy?.trim() || agent.permissionMode?.trim() || 'Hub 默认策略',
    scope: agent.permissionMode?.trim() || 'Hub owner scope',
    state: workbenchAgentStateToAgentState(agent.status),
    skills: agent.skills ?? [],
    tools: toolPermissionFromAgent(agent),
  };
}

export function WorkbenchRoutes({
  activePage,
  agents,
  agentProfilesStatus,
  contacts,
  focusedAgentId,
  projects,
  projectsStatus,
  onProjectCreate,
  onProjectUpdate,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onAgentProfileOpen,
}: WorkbenchRoutesProps): React.ReactElement {
  const [contactsPane, setContactsPane] = useState<ContactsPane>('internal');
  const [docsNav, setDocsNav] = useState('home');
  const [docsTab, setDocsTab] = useState<DocsPane>('recent');
  const [agentsPane, setAgentsPane] = useState<AgentsPaneId>('installed');
  const [tasksPane, setTasksPane] = useState<TasksPane>('owned');
  const [taskViewMode, setTaskViewMode] = useState<ViewMode>('list');
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>(WORKBENCH_MOCK_TASK_GROUPS);
  const [taskFilterActive, setTaskFilterActive] = useState(true);
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>('custom');
  const [taskGroupMode, setTaskGroupMode] = useState<TaskGroupMode>('custom');
  const [taskShowCreator, setTaskShowCreator] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskNavMenuOpen, setTaskNavMenuOpen] = useState(false);
  const [taskActionLabel, setTaskActionLabel] = useState('筛选已启用');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState<TaskEditDraft | null>(null);
  const [localTaskCounter, setLocalTaskCounter] = useState(1);
  const sourceProjects = projects ?? WORKBENCH_MOCK_PROJECTS;
  const [projectId, setProjectId] = useState(sourceProjects[0]?.id ?? null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [projectTab, setProjectTab] = useState<ProjectTab>('overview');
  const [docsPreview, setDocsPreview] = useState<WorkbenchDocumentPreview | null>(null);
  const [projectPreview, setProjectPreview] = useState<WorkbenchDocumentPreview | null>(null);
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('appearance');
  const [settings, setSettings] = useState(createSettingsDefaults);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(focusedAgentId);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentConfig>>({});
  const [draftAgentIds, setDraftAgentIds] = useState<string[]>([]);
  const [dirtyAgentIds, setDirtyAgentIds] = useState<string[]>([]);
  const [agentDraftCounter, setAgentDraftCounter] = useState(1);

  const sourceAgentConfigs = useMemo(
    () => (agents === undefined ? WORKBENCH_MOCK_AGENT_CONFIGS : agents.map(workbenchAgentToAgentConfig)),
    [agents],
  );
  const agentConfigs = useMemo(() => [
    ...draftAgentIds
      .map((id) => agentDrafts[id])
      .filter((agent): agent is AgentConfig => Boolean(agent)),
    ...sourceAgentConfigs.map((agent) => agentDrafts[agent.id] ?? agent),
  ], [agentDrafts, draftAgentIds, sourceAgentConfigs]);
  const contactsData = contacts ?? {
    members: WORKBENCH_MOCK_CONTACT_MEMBERS,
    externalContacts: WORKBENCH_MOCK_EXTERNAL_CONTACTS,
    pendingContacts: WORKBENCH_MOCK_PENDING_CONTACTS,
    starredContacts: WORKBENCH_MOCK_CONTACT_MEMBERS.slice(0, 2),
    groups: WORKBENCH_MOCK_CONTACT_GROUPS,
    serviceDesks: WORKBENCH_MOCK_SERVICE_DESKS,
    recentShortcuts: WORKBENCH_MOCK_CONTACT_SHORTCUTS,
    orgName: 'TokenDance',
    orgInitials: 'TD',
  };
  const profileSources = useMemo(() => [
    ...agentConfigs.map((agent) => ({ ...agent, kind: 'agent' as const })),
    ...contactsData.members.map((member) => ({ ...member, kind: 'user' as const })),
  ], [agentConfigs, contactsData.members]);
  const effectiveSelectedAgentId = selectedAgentId ?? agentConfigs[0]?.id ?? '';
  const selectedAgentIsDraft = effectiveSelectedAgentId ? draftAgentIds.includes(effectiveSelectedAgentId) : false;
  const selectedAgentIsDirty = effectiveSelectedAgentId ? dirtyAgentIds.includes(effectiveSelectedAgentId) : false;
  const selectedAgentSaving = effectiveSelectedAgentId && agentProfilesStatus?.savingAgentId === effectiveSelectedAgentId;
  const selectedAgentDeleting = effectiveSelectedAgentId && agentProfilesStatus?.deletingAgentId === effectiveSelectedAgentId;

  React.useEffect(() => {
    if (focusedAgentId) setSelectedAgentId(focusedAgentId);
  }, [focusedAgentId]);

  React.useEffect(() => {
    if (sourceProjects.length === 0) {
      setProjectId(null);
      return;
    }
    if (!projectId || !sourceProjects.some((project) => project.id === projectId)) {
      setProjectId(sourceProjects[0]?.id ?? null);
    }
  }, [projectId, sourceProjects]);

  React.useEffect(() => {
    const sourceIds = new Set(sourceAgentConfigs.map((agent) => agent.id));
    setAgentDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => draftAgentIds.includes(id) || sourceIds.has(id)),
    ));
    setDirtyAgentIds((current) => current.filter((id) => draftAgentIds.includes(id) || sourceIds.has(id)));
  }, [draftAgentIds, sourceAgentConfigs]);

  React.useEffect(() => {
    if (!effectiveSelectedAgentId && agentConfigs[0]?.id) {
      setSelectedAgentId(agentConfigs[0].id);
      return;
    }
    if (effectiveSelectedAgentId && !agentConfigs.some((agent) => agent.id === effectiveSelectedAgentId)) {
      setSelectedAgentId(agentConfigs[0]?.id);
    }
  }, [agentConfigs, effectiveSelectedAgentId]);

  function setAgentDirty(agentId: string): void {
    setDirtyAgentIds((current) => current.includes(agentId) ? current : [...current, agentId]);
  }

  function clearAgentDirty(agentId: string): void {
    setDirtyAgentIds((current) => current.filter((id) => id !== agentId));
  }

  function patchSelectedAgent(patch: Partial<AgentConfig>): void {
    if (!effectiveSelectedAgentId) return;
    const current = agentConfigs.find((agent) => agent.id === effectiveSelectedAgentId);
    if (!current) return;
    setAgentDrafts((drafts) => ({
      ...drafts,
      [effectiveSelectedAgentId]: { ...current, ...drafts[effectiveSelectedAgentId], ...patch },
    }));
    setAgentDirty(effectiveSelectedAgentId);
  }

  function createAgentDraft(index: number): AgentConfig {
    return {
      id: `draft-agent-${index}`,
      name: `新 Agent ${index}`,
      role: '',
      engine: 'codex',
      model: 'codex / gpt-5-codex',
      mode: 'Reasoning medium',
      approval: 'Hub 默认策略',
      scope: 'default',
      state: 'waiting',
      skills: [],
      tools: {},
    };
  }

  function selectAdjacentAgent(deletedId: string): void {
    const remaining = agentConfigs.filter((agent) => agent.id !== deletedId);
    setSelectedAgentId(remaining[0]?.id);
  }

  function handleAgentAdd(): void {
    const nextIndex = agentDraftCounter;
    const draft = createAgentDraft(nextIndex);
    setAgentDraftCounter((current) => current + 1);
    setDraftAgentIds((current) => [draft.id, ...current]);
    setAgentDrafts((current) => ({ ...current, [draft.id]: draft }));
    setAgentDirty(draft.id);
    setSelectedAgentId(draft.id);
  }

  async function handleAgentSave(): Promise<void> {
    if (!effectiveSelectedAgentId) return;
    const agent = agentConfigs.find((item) => item.id === effectiveSelectedAgentId);
    if (!agent) return;
    if (selectedAgentIsDraft) {
      try {
        await onAgentCreate?.(agent);
      } catch {
        return;
      }
      setDraftAgentIds((current) => current.filter((id) => id !== agent.id));
      setAgentDrafts((current) => {
        const { [agent.id]: _removed, ...rest } = current;
        return rest;
      });
      clearAgentDirty(agent.id);
      return;
    }
    try {
      await onAgentUpdate?.(agent);
    } catch {
      return;
    }
    clearAgentDirty(agent.id);
  }

  async function handleAgentDelete(): Promise<void> {
    if (!effectiveSelectedAgentId) return;
    const agentId = effectiveSelectedAgentId;
    if (draftAgentIds.includes(agentId)) {
      setDraftAgentIds((current) => current.filter((id) => id !== agentId));
      setAgentDrafts((current) => {
        const { [agentId]: _removed, ...rest } = current;
        return rest;
      });
      clearAgentDirty(agentId);
      selectAdjacentAgent(agentId);
      return;
    }
    try {
      await onAgentDelete?.(agentId);
    } catch {
      return;
    }
    selectAdjacentAgent(agentId);
  }

  function handleAgentSkillToggle(skill: string): void {
    const current = agentConfigs.find((agent) => agent.id === effectiveSelectedAgentId);
    if (!current) return;
    const skills = current.skills.includes(skill)
      ? current.skills.filter((item) => item !== skill)
      : [...current.skills, skill];
    patchSelectedAgent({ skills });
  }

  function handleToolPermissionSet(tool: string, value: ToolPermission): void {
    const current = agentConfigs.find((agent) => agent.id === effectiveSelectedAgentId);
    patchSelectedAgent({ tools: { ...(current?.tools ?? {}), [tool]: value } });
  }

  function handleAgentFieldChange(field: string, value: string): void {
    if (field === 'state') {
      patchSelectedAgent({ state: value as AgentConfig['state'] });
      return;
    }
    patchSelectedAgent({ [field]: value } as Partial<AgentConfig>);
  }

  function agentSaveStateLabel(): string {
    if (selectedAgentDeleting) return '删除中';
    if (selectedAgentSaving) return selectedAgentIsDraft ? '创建中' : '保存中';
    if (agentProfilesStatus?.actionError) return '保存失败';
    if (selectedAgentIsDraft) return '草稿';
    if (selectedAgentIsDirty) return '未保存';
    return '已同步';
  }

  function handleSettingChange(key: string, value: string | boolean): void {
    if (key === 'dataMode' && typeof value === 'string') {
      persistDataModeLabel(value);
    }
    if (key === 'composerSubmitBehavior' && typeof value === 'string') {
      writeComposerSubmitBehavior(composerSubmitBehaviorFromLabel(value));
    }
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

  const visibleTaskGroups = useMemo(() => buildTaskGroups(
    taskGroups,
    tasksPane,
    taskFilterActive,
    taskSortMode,
    taskGroupMode,
    taskViewMode,
  ), [taskFilterActive, taskGroupMode, taskGroups, taskSortMode, taskViewMode, tasksPane]);
  const visibleTasks = flattenTaskGroups(visibleTaskGroups);
  const allTasks = flattenTaskGroups(taskGroups);
  const selectedTask = allTasks.find((task) => task.id === selectedTaskId) ?? null;

  function handleTaskPaneChange(pane: TasksPane): void {
    setTasksPane(pane);
    setSelectedTaskId(null);
    setEditingTaskId(null);
    setEditingTaskDraft(null);
    setTaskNavMenuOpen(false);
    setTaskActionLabel(`已切换到${pane === 'owned' ? '我负责的' : pane === 'watching' ? '我关注的' : pane === 'activity' ? '动态' : pane === 'done' ? '已完成' : '任务视图'}`);
  }

  function handleCreateTask(): void {
    const nextTask = createLocalTask(localTaskCounter);
    setLocalTaskCounter((current) => current + 1);
    setTaskGroups((current) => {
      const [first, ...rest] = current;
      if (!first) return [{ label: '默认分组', tasks: [nextTask] }];
      return [{ ...first, tasks: [nextTask, ...first.tasks] }, ...rest];
    });
    setTasksPane('owned');
    setTaskViewMode('list');
    setSelectedTaskId(nextTask.id);
    setEditingTaskId(nextTask.id);
    setEditingTaskDraft({
      title: nextTask.title,
      project: nextTask.project,
      assignee: nextTask.assignee,
      startTime: nextTask.startTime,
      dueDate: nextTask.dueDate,
      creator: nextTask.creator,
    });
    setTaskActionLabel(`已创建 ${nextTask.title}`);
  }

  function handleNewTaskGroup(): void {
    const nextIndex = taskGroups.length + 1;
    setTaskGroups((current) => [...current, { label: `自定义分组 ${nextIndex}`, tasks: [] }]);
    setTaskGroupMode('custom');
    setTaskViewMode('list');
    setTaskActionLabel(`已创建自定义分组 ${nextIndex}`);
  }

  function handleTaskList(): void {
    setTaskViewMode('list');
    setTaskGroupMode('custom');
    setTaskNavMenuOpen(false);
    setTaskActionLabel('已回到任务清单');
  }

  function handleTaskSort(): void {
    setTaskSortMode((current) => {
      const next = current === 'custom' ? 'due' : 'custom';
      setTaskActionLabel(next === 'due' ? '已按截止时间排序' : '已恢复拖拽自定义排序');
      return next;
    });
  }

  function handleTaskGroup(): void {
    setTaskGroupMode((current) => (
      current === 'custom' ? 'project' : current === 'project' ? 'status' : 'custom'
    ));
    setTaskActionLabel('已切换任务分组方式');
  }

  function updateTask(taskId: string, patch: Partial<TaskItem>): void {
    setTaskGroups((current) => current.map((group) => ({
      ...group,
      tasks: group.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    })));
  }

  function startTaskEdit(task: TaskItem): void {
    setSelectedTaskId(task.id);
    setEditingTaskId(task.id);
    setEditingTaskDraft({
      title: task.title,
      project: task.project,
      assignee: task.assignee,
      startTime: task.startTime,
      dueDate: task.dueDate,
      creator: task.creator,
    });
    setTaskViewMode('list');
    setTaskActionLabel(`正在编辑 ${task.title}`);
  }

  function handleEditSelectedTask(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    startTaskEdit(selectedTask);
  }

  function handleEditTaskDraftChange(field: keyof TaskEditDraft, value: string): void {
    setEditingTaskDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function handleSaveTaskEdit(): void {
    if (!editingTaskId || !editingTaskDraft) {
      setTaskActionLabel('没有正在编辑的任务');
      return;
    }
    const title = editingTaskDraft.title.trim() || '未命名任务';
    const nextDraft = { ...editingTaskDraft, title };
    updateTask(editingTaskId, nextDraft);
    setEditingTaskId(null);
    setEditingTaskDraft(null);
    setTaskActionLabel(`${title} 已保存`);
  }

  function handleCancelTaskEdit(): void {
    if (editingTaskDraft) {
      setTaskActionLabel('已取消编辑');
    }
    setEditingTaskId(null);
    setEditingTaskDraft(null);
  }

  function handleDeleteSelectedTask(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    const deletedTitle = selectedTask.title;
    setTaskGroups((current) => current
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((task) => task.id !== selectedTask.id),
      }))
      .filter((group) => group.tasks.length > 0 || group.label.startsWith('自定义分组')));
    setSelectedTaskId(null);
    setEditingTaskId(null);
    setEditingTaskDraft(null);
    setTaskActionLabel(`${deletedTitle} 已删除`);
  }

  function handleCycleSelectedTaskStatus(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    const currentIndex = TASK_STATUS_SEQUENCE.indexOf(selectedTask.status ?? TASK_STATUS_SEQUENCE[0]!);
    const nextStatus = TASK_STATUS_SEQUENCE[(currentIndex + 1) % TASK_STATUS_SEQUENCE.length]
      ?? TASK_STATUS_SEQUENCE[0]!;
    updateTask(selectedTask.id, { status: nextStatus });
    setTaskActionLabel(`${selectedTask.title} 已推进到 ${nextStatus}`);
  }

  function handleAssignSelectedTaskToMe(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    updateTask(selectedTask.id, { assignee: 'Delicious233' });
    setTaskActionLabel(`${selectedTask.title} 已指派给 Delicious233`);
  }

  function handleGroupBySelectedTaskProject(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    setTaskGroupMode('project');
    setTaskViewMode('list');
    setTaskActionLabel(`已按项目查看：${selectedTask.project}`);
  }

  function handleFilterBySelectedTaskAssignee(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    setTasksPane(selectedTask.assignee === 'Delicious233' ? 'owned' : 'all');
    setTaskFilterActive(false);
    setTaskActionLabel(`当前负责人：${selectedTask.assignee}`);
  }

  switch (activePage) {
    case 'contacts':
      return (
        <ContactsPage
          activePane={contactsPane}
          externalContacts={contactsData.externalContacts ?? []}
          groups={contactsData.groups ?? []}
          members={contactsData.members}
          onPaneChange={setContactsPane}
          orgInitials={contactsData.orgInitials ?? 'TD'}
          orgName={contactsData.orgName ?? 'TokenDance'}
          pendingContacts={contactsData.pendingContacts ?? []}
          recentShortcuts={contactsData.recentShortcuts ?? []}
          serviceDesks={contactsData.serviceDesks ?? []}
          starredContacts={contactsData.starredContacts ?? []}
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
          profiles={profileSources}
          activePreview={docsPreview}
          onClosePreview={() => setDocsPreview(null)}
          onDocClick={(doc) => setDocsPreview(createDocPreview(doc))}
          rows={WORKBENCH_MOCK_DOC_ROWS}
        />
      );
    case 'agents':
      return (
        <AgentsPage
          activePane={agentsPane}
          agents={agentConfigs}
          agentActionError={agentProfilesStatus?.actionError}
          agentsError={agentProfilesStatus?.error}
          agentsLoading={agentProfilesStatus?.loading}
          allSkills={WORKBENCH_MOCK_AGENT_SKILL_OPTIONS}
          allTools={WORKBENCH_MOCK_AGENT_TOOL_OPTIONS}
          auditEntries={WORKBENCH_MOCK_AGENT_AUDIT_ROWS}
          confirmCount={agentConfigs.reduce((total, agent) => total + WORKBENCH_MOCK_AGENT_TOOL_OPTIONS.filter((tool) => agent.tools[tool] === '需确认').length, 0)}
          defaultModelLabel={agentConfigs[0]?.model ?? '未配置模型'}
          installedCount={agentConfigs.length}
          marketFeatured={WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES.slice(0, 3)}
          marketTemplates={WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES.slice(3)}
          modelHealthRows={WORKBENCH_MOCK_AGENT_MODEL_HEALTH}
          modelRoutes={agentConfigs.map((agent) => ({
            agentId: agent.id,
            agentName: agent.name,
            agentInitials: workbenchProfileInitials(agent.name),
            agentColor: workbenchAgentColor(agent),
            role: agent.role,
            mode: agent.mode,
            model: agent.model,
          }))}
          models={WORKBENCH_MOCK_AGENT_MODELS}
          onPaneChange={setAgentsPane}
          onAgentAdd={handleAgentAdd}
          onAgentDelete={handleAgentDelete}
          onAgentFieldChange={handleAgentFieldChange}
          onAgentProfileOpen={onAgentProfileOpen}
          onAgentSave={handleAgentSave}
          onAgentSelect={setSelectedAgentId}
          onAgentSkillToggle={handleAgentSkillToggle}
          onAgentsRetry={onAgentsRetry}
          onToolPermissionSet={handleToolPermissionSet}
          policyRules={WORKBENCH_MOCK_AGENT_POLICY_RULES}
          recentShortcuts={agents === undefined ? ['Builder 权限更新', 'Browser QA 已安装', 'DeepSeek-V4-Pro 路由'] : agentConfigs.slice(0, 3).map((agent) => `${agent.name} 已同步`)}
          runnableCount={agentConfigs.filter((agent) => agent.state === 'running' || agent.state === 'ready').length}
          saveStateLabel={agentSaveStateLabel()}
          isDirty={selectedAgentIsDirty}
          savingAgentId={agentProfilesStatus?.savingAgentId}
          deletingAgentId={agentProfilesStatus?.deletingAgentId}
          toolMatrixAgents={agentConfigs.map((agent) => ({
            id: agent.id,
            name: agent.name,
            initials: workbenchProfileInitials(agent.name),
            color: workbenchAgentColor(agent),
            permissions: agent.tools,
          }))}
          toolMatrixTools={WORKBENCH_MOCK_AGENT_TOOL_OPTIONS}
          {...(effectiveSelectedAgentId ? { selectedAgentId: effectiveSelectedAgentId } : {})}
        />
      );
    case 'runs':
      return (
        <TasksPage
          activePane={tasksPane}
          activeFilterCount={taskFilterActive ? 1 : 0}
          crossProjectCount={new Set(visibleTasks.map((task) => task.project)).size}
          dueTodayCount={visibleTasks.filter((task) => task.dueDate.includes('今天')).length}
          fieldConfigActive={!taskShowCreator}
          fieldConfigLabel={taskShowCreator ? '字段配置' : '字段配置 5/6'}
          groupActive={taskGroupMode !== 'custom' || taskViewMode !== 'list'}
          groupLabel={
            taskViewMode === 'board'
              ? '分组：状态看板'
              : taskViewMode === 'dashboard'
                ? '分组：项目仪表盘'
                : taskGroupMode === 'project'
                  ? '分组：所属项目'
                  : taskGroupMode === 'status'
                    ? '分组：任务状态'
                    : '分组：自定义分组'
          }
          groups={visibleTaskGroups}
          profiles={profileSources}
          editingDraft={editingTaskDraft}
          editingTaskId={editingTaskId}
          navMenuOpen={taskNavMenuOpen}
          incompleteCount={visibleTasks.filter((task) => task.status !== '已完成').length}
          onAddTaskRow={handleCreateTask}
          onAssignSelectedTaskToMe={handleAssignSelectedTaskToMe}
          onCycleSelectedTaskStatus={handleCycleSelectedTaskStatus}
          onCreateTask={handleCreateTask}
          onCancelTaskEdit={handleCancelTaskEdit}
          onDeleteSelectedTask={handleDeleteSelectedTask}
          onEditDraftChange={handleEditTaskDraftChange}
          onEditSelectedTask={handleEditSelectedTask}
          onFilterBySelectedTaskAssignee={handleFilterBySelectedTaskAssignee}
          onGroupBySelectedTaskProject={handleGroupBySelectedTaskProject}
          onNewGroup={handleNewTaskGroup}
          onNavMore={() => {
            setTaskNavMenuOpen((current) => !current);
            setTaskActionLabel('任务更多操作');
          }}
          onPaneChange={handleTaskPaneChange}
          onTaskClick={(task) => {
            setSelectedTaskId(task.id);
            if (editingTaskId && editingTaskId !== task.id) {
              setEditingTaskId(null);
              setEditingTaskDraft(null);
            }
            setTaskActionLabel(`已选中 ${task.title}`);
          }}
          onSaveTaskEdit={handleSaveTaskEdit}
          onTaskList={handleTaskList}
          onToolbarFieldConfig={() => setTaskShowCreator((current) => {
            setTaskActionLabel(current ? '已隐藏创建人字段' : '已显示创建人字段');
            return !current;
          })}
          onToolbarFilter={() => setTaskFilterActive((current) => {
            setTaskActionLabel(current ? '已关闭筛选' : '筛选已启用');
            return !current;
          })}
          onToolbarGroup={handleTaskGroup}
          onToolbarSort={handleTaskSort}
          onViewModeChange={setTaskViewMode}
          selectedTaskId={selectedTaskId}
          selectedTask={selectedTask}
          showCreatorColumn={taskShowCreator}
          sortActive={taskSortMode !== 'custom'}
          sortLabel={taskSortMode === 'custom' ? '排序：拖拽自定义' : '排序：截止时间'}
          taskActionLabel={taskActionLabel}
          viewMode={taskViewMode}
        />
      );
    case 'projects':
      return (
        <ProjectsPage
          activeFilter={projectFilter}
          activeProjectId={projectId}
          activeTab={projectTab}
          activePreview={projectPreview}
          onFilterChange={setProjectFilter}
          profiles={profileSources}
          onArtifactClick={(id, artifact) => {
            setProjectId(id);
            setProjectPreview(createProjectArtifactPreview(id, artifact));
          }}
          onClosePreview={() => setProjectPreview(null)}
          onProjectCreate={onProjectCreate}
          onProjectSelect={setProjectId}
          onProjectUpdate={onProjectUpdate}
          onTabChange={setProjectTab}
          projectActionError={projectsStatus?.actionError}
          projectSaving={projectsStatus?.saving}
          projects={sourceProjects}
          projectsError={projectsStatus?.error}
          projectsLoading={projectsStatus?.loading}
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
