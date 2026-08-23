import type { WorkbenchAgent } from '@shared/platform';
import type { AgentConfig, AgentsPaneId, ModelInfo, ModelState, ToolPermission } from './pages/AgentsPage';
import {
  WORKBENCH_MOCK_AGENT_CONFIGS,
  WORKBENCH_MOCK_AGENT_MODELS,
  WORKBENCH_MOCK_AGENT_SKILL_OPTIONS,
  WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
} from './mockData';
import {
  createMarketInstalledAgent,
  workbenchAgentToAgentConfig,
} from './workbenchAgentMapping';
import { uniqueSorted } from './agentProfileCatalogHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchAgentsRouteHelpers — pure residual slices from
   useWorkbenchAgentsRoute (#730).

   Public option/return types, source-config resolution, draft/merge
   planners, model/skill/tool catalog mapping, selection guards, dirty
   bookkeeping, field patches, and save-state labels. No React hooks /
   no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

export interface WorkbenchAgentsRouteStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  savingAgentId?: string | undefined;
  deletingAgentId?: string | undefined;
}

export interface WorkbenchAgentsModelCatalogItem {
  id: string;
  label: string;
  value: string;
  provider?: string;
  status: string;
  description?: string;
  default?: boolean;
  tags?: string[];
}

export interface UseWorkbenchAgentsRouteOptions {
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentsRouteStatus | undefined;
  focusedAgentId?: string | undefined;
  realDataMode: boolean;
  modelCatalog?: WorkbenchAgentsModelCatalogItem[] | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
}

export interface WorkbenchAgentsRoute {
  agentsPane: AgentsPaneId;
  setAgentsPane: (pane: AgentsPaneId) => void;
  agentConfigs: AgentConfig[];
  resolvedModels: ModelInfo[];
  resolvedSkills: string[];
  resolvedTools: string[];
  effectiveSelectedAgentId: string;
  selectedAgentIsDirty: boolean;
  setSelectedAgentId: (agentId: string | undefined) => void;
  handleAgentAdd: () => void;
  handleAgentSave: () => Promise<void>;
  handleAgentDelete: () => Promise<void>;
  handleAgentFieldChange: (field: string, value: string) => void;
  handleAgentSkillToggle: (skill: string) => void;
  handleToolPermissionSet: (tool: string, value: ToolPermission) => void;
  handleMarketInstall: (name: string, description: string, category: string) => void;
  agentSaveStateLabel: () => string;
}

/** Resolve mock-backed or mapped agent configs for the active data mode. */
export function resolveSourceAgentConfigs(
  agents: WorkbenchAgent[] | undefined,
  realDataMode: boolean,
  mockConfigs: AgentConfig[] = WORKBENCH_MOCK_AGENT_CONFIGS,
): AgentConfig[] {
  if (agents === undefined) {
    return realDataMode ? [] : mockConfigs;
  }
  return agents.map(workbenchAgentToAgentConfig);
}

/** Merge draft agents ahead of source agents (draft overrides win). */
export function mergeAgentConfigs(
  draftAgentIds: string[],
  agentDrafts: Record<string, AgentConfig>,
  sourceAgentConfigs: AgentConfig[],
): AgentConfig[] {
  return [
    ...draftAgentIds
      .map((id) => agentDrafts[id])
      .filter((agent): agent is AgentConfig => Boolean(agent)),
    ...sourceAgentConfigs.map((agent) => agentDrafts[agent.id] ?? agent),
  ];
}

export function resolveModelCatalogState(item: WorkbenchAgentsModelCatalogItem): ModelState {
  if (item.default) return '默认';
  if (item.status === 'healthy' || item.status === 'available') return '默认';
  if (item.status === 'experimental' || item.tags?.includes('experimental')) return '实验';
  return '备选';
}

export function resolveAssignedAgentsLabel(
  agentConfigs: AgentConfig[],
  item: WorkbenchAgentsModelCatalogItem,
): string {
  const assignedAgents = agentConfigs
    .filter((agent) => agent.model === item.value || agent.model === item.label)
    .map((agent) => agent.name)
    .join(', ');
  return assignedAgents || '—';
}

/** Map Edge model catalog to AgentsPage ModelInfo[] when available. */
export function resolveAgentModels(
  modelCatalog: WorkbenchAgentsModelCatalogItem[] | undefined,
  agentConfigs: AgentConfig[],
  mockModels: ModelInfo[] = WORKBENCH_MOCK_AGENT_MODELS,
): ModelInfo[] {
  if (!modelCatalog || modelCatalog.length === 0) return mockModels;
  return modelCatalog.map((item) => ({
    name: item.label || item.value,
    state: resolveModelCatalogState(item),
    description: item.description ?? '',
    assignedAgents: resolveAssignedAgentsLabel(agentConfigs, item),
  }));
}

export function resolveAgentSkills(
  agentConfigs: AgentConfig[],
  mockSkills: string[] = WORKBENCH_MOCK_AGENT_SKILL_OPTIONS,
): string[] {
  // uniqueSorted keeps the same collation that builds the mock option
  // lists — a bare .sort() orders mixed zh/en names differently (#1826).
  const fromAgents = uniqueSorted(agentConfigs.flatMap((a) => a.skills).filter(Boolean));
  return fromAgents.length > 0 ? fromAgents : mockSkills;
}

export function resolveAgentTools(
  agentConfigs: AgentConfig[],
  mockTools: string[] = WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
): string[] {
  const fromAgents = uniqueSorted(agentConfigs.flatMap((a) => Object.keys(a.tools)).filter(Boolean));
  return fromAgents.length > 0 ? fromAgents : mockTools;
}

export function resolveEffectiveSelectedAgentId(
  selectedAgentId: string | undefined,
  agentConfigs: AgentConfig[],
): string {
  return selectedAgentId ?? agentConfigs[0]?.id ?? '';
}

export function isAgentIdListed(agentId: string, ids: string[]): boolean {
  return agentId ? ids.includes(agentId) : false;
}

export function isAgentBusyWith(
  agentId: string,
  busyAgentId: string | undefined,
): boolean {
  return Boolean(agentId && busyAgentId === agentId);
}

/** Keep only drafts that still belong to draft ids or live source agents. */
export function pruneAgentDrafts(
  drafts: Record<string, AgentConfig>,
  draftAgentIds: string[],
  sourceAgentConfigs: AgentConfig[],
): Record<string, AgentConfig> {
  const sourceIds = new Set(sourceAgentConfigs.map((agent) => agent.id));
  return Object.fromEntries(
    Object.entries(drafts).filter(([id]) => draftAgentIds.includes(id) || sourceIds.has(id)),
  );
}

export function pruneAgentDirtyIds(
  dirtyAgentIds: string[],
  draftAgentIds: string[],
  sourceAgentConfigs: AgentConfig[],
): string[] {
  const sourceIds = new Set(sourceAgentConfigs.map((agent) => agent.id));
  return dirtyAgentIds.filter((id) => draftAgentIds.includes(id) || sourceIds.has(id));
}

export type SelectedAgentSyncPlan =
  | { kind: 'none' }
  | { kind: 'select'; agentId: string | undefined };

/** Keep selection pointed at a live agent when the list changes. */
export function planSelectedAgentSync(
  effectiveSelectedAgentId: string,
  agentConfigs: AgentConfig[],
): SelectedAgentSyncPlan {
  if (!effectiveSelectedAgentId && agentConfigs[0]?.id) {
    return { kind: 'select', agentId: agentConfigs[0].id };
  }
  if (effectiveSelectedAgentId && !agentConfigs.some((agent) => agent.id === effectiveSelectedAgentId)) {
    return { kind: 'select', agentId: agentConfigs[0]?.id };
  }
  return { kind: 'none' };
}

export function withAgentDirty(dirtyAgentIds: string[], agentId: string): string[] {
  return dirtyAgentIds.includes(agentId) ? dirtyAgentIds : [...dirtyAgentIds, agentId];
}

export function withoutAgentDirty(dirtyAgentIds: string[], agentId: string): string[] {
  return dirtyAgentIds.filter((id) => id !== agentId);
}

export function patchAgentDrafts(
  drafts: Record<string, AgentConfig>,
  agentId: string,
  current: AgentConfig,
  patch: Partial<AgentConfig>,
): Record<string, AgentConfig> {
  return {
    ...drafts,
    [agentId]: { ...current, ...drafts[agentId], ...patch },
  };
}

export function createAgentDraft(index: number): AgentConfig {
  return {
    id: `draft-agent-${index}`,
    name: `新 Agent ${index}`,
    role: '',
    engine: 'codex',
    runtimeId: 'codex',
    provider: 'OpenAI Compatible API',
    model: 'codex / gpt-5-codex',
    mode: 'Reasoning medium',
    approval: 'Hub 默认策略',
    approvalMode: 'approval-required',
    scope: 'default',
    targetPreference: '',
    state: 'waiting',
    skills: [],
    mcpServers: [],
    toolAllowlist: [],
    memorySources: ['agents-md', 'thread-context'],
    memoryRetention: 'thread-only',
    memorySummary: '读取 AGENTS.md 和当前 Thread 上下文',
    targetPreferences: ['local-edge'],
    avatarRef: 'agenthub:avatar/draft',
    tools: {},
  };
}

export function resolveAdjacentAgentId(
  agentConfigs: AgentConfig[],
  deletedId: string,
): string | undefined {
  return agentConfigs.filter((agent) => agent.id !== deletedId)[0]?.id;
}

export interface AgentAddPlan {
  draft: AgentConfig;
  nextCounter: number;
}

export function planAgentAdd(agentDraftCounter: number): AgentAddPlan {
  const draft = createAgentDraft(agentDraftCounter);
  return {
    draft,
    nextCounter: agentDraftCounter + 1,
  };
}

export interface MarketInstallPlan {
  installed: AgentConfig;
  nextCounter: number;
  agentsPane: 'installed';
}

export function planMarketInstall(
  name: string,
  description: string,
  category: string,
  agentDraftCounter: number,
): MarketInstallPlan {
  return {
    installed: createMarketInstalledAgent(name, description, category, agentDraftCounter),
    nextCounter: agentDraftCounter + 1,
    agentsPane: 'installed',
  };
}

export function removeAgentDraftId(draftAgentIds: string[], agentId: string): string[] {
  return draftAgentIds.filter((id) => id !== agentId);
}

export function omitAgentDraft(
  drafts: Record<string, AgentConfig>,
  agentId: string,
): Record<string, AgentConfig> {
  const { [agentId]: _removed, ...rest } = drafts;
  return rest;
}

export function toggleAgentSkill(skills: string[], skill: string): string[] {
  return skills.includes(skill)
    ? skills.filter((item) => item !== skill)
    : [...skills, skill];
}

export function withToolPermission(
  tools: Record<string, ToolPermission> | undefined,
  tool: string,
  value: ToolPermission,
): Record<string, ToolPermission> {
  return { ...(tools ?? {}), [tool]: value };
}

export function buildAgentFieldPatch(field: string, value: string): Partial<AgentConfig> {
  if (field === 'state') {
    return { state: value as AgentConfig['state'] };
  }
  return { [field]: value } as Partial<AgentConfig>;
}

export interface AgentSaveStateLabelInput {
  selectedAgentDeleting: boolean;
  selectedAgentSaving: boolean;
  selectedAgentIsDraft: boolean;
  selectedAgentIsDirty: boolean;
  actionError?: string | undefined;
}

export function resolveAgentSaveStateLabel(input: AgentSaveStateLabelInput): string {
  if (input.selectedAgentDeleting) return '删除中';
  if (input.selectedAgentSaving) return input.selectedAgentIsDraft ? '创建中' : '保存中';
  if (input.actionError) return '保存失败';
  if (input.selectedAgentIsDraft) return '草稿';
  if (input.selectedAgentIsDirty) return '未保存';
  return '已同步';
}

export type AgentsRouteSetState<T> = (value: T | ((prev: T) => T)) => void;

export interface WorkbenchAgentsRouteStateAccessors {
  agentConfigs: AgentConfig[];
  draftAgentIds: string[];
  agentDraftCounter: number;
  effectiveSelectedAgentId: string;
  selectedAgentIsDraft: boolean;
  agentProfilesStatus?: WorkbenchAgentsRouteStatus | undefined;
  selectedAgentDeleting: boolean;
  selectedAgentSaving: boolean;
  selectedAgentIsDirty: boolean;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  setAgentsPane: AgentsRouteSetState<AgentsPaneId>;
  setSelectedAgentId: AgentsRouteSetState<string | undefined>;
  setAgentDrafts: AgentsRouteSetState<Record<string, AgentConfig>>;
  setDraftAgentIds: AgentsRouteSetState<string[]>;
  setDirtyAgentIds: AgentsRouteSetState<string[]>;
  setAgentDraftCounter: AgentsRouteSetState<number>;
}

export type WorkbenchAgentsRouteHandlers = Pick<
  WorkbenchAgentsRoute,
  | 'handleAgentAdd'
  | 'handleAgentSave'
  | 'handleAgentDelete'
  | 'handleAgentFieldChange'
  | 'handleAgentSkillToggle'
  | 'handleToolPermissionSet'
  | 'handleMarketInstall'
  | 'agentSaveStateLabel'
>;

function setAgentDirty(
  setDirtyAgentIds: AgentsRouteSetState<string[]>,
  agentId: string,
): void {
  setDirtyAgentIds((current) => withAgentDirty(current, agentId));
}

function clearAgentDirty(
  setDirtyAgentIds: AgentsRouteSetState<string[]>,
  agentId: string,
): void {
  setDirtyAgentIds((current) => withoutAgentDirty(current, agentId));
}

function patchSelectedAgent(
  access: WorkbenchAgentsRouteStateAccessors,
  patch: Partial<AgentConfig>,
): void {
  const { effectiveSelectedAgentId, agentConfigs, setAgentDrafts, setDirtyAgentIds } = access;
  if (!effectiveSelectedAgentId) return;
  const current = agentConfigs.find((agent) => agent.id === effectiveSelectedAgentId);
  if (!current) return;
  setAgentDrafts((drafts) => patchAgentDrafts(drafts, effectiveSelectedAgentId, current, patch));
  setAgentDirty(setDirtyAgentIds, effectiveSelectedAgentId);
}

function selectAdjacentAgent(
  access: WorkbenchAgentsRouteStateAccessors,
  deletedId: string,
): void {
  access.setSelectedAgentId(resolveAdjacentAgentId(access.agentConfigs, deletedId));
}

/** Build AgentsRoute event handlers from pure planners + state setters. */
export function buildWorkbenchAgentsRouteHandlers(
  access: WorkbenchAgentsRouteStateAccessors,
): WorkbenchAgentsRouteHandlers {
  const {
    agentConfigs,
    draftAgentIds,
    agentDraftCounter,
    effectiveSelectedAgentId,
    selectedAgentIsDraft,
    agentProfilesStatus,
    selectedAgentDeleting,
    selectedAgentSaving,
    selectedAgentIsDirty,
    onAgentCreate,
    onAgentUpdate,
    onAgentDelete,
    setAgentsPane,
    setSelectedAgentId,
    setAgentDrafts,
    setDraftAgentIds,
    setDirtyAgentIds,
    setAgentDraftCounter,
  } = access;

  return {
    handleAgentAdd() {
      const plan = planAgentAdd(agentDraftCounter);
      setAgentDraftCounter(plan.nextCounter);
      setDraftAgentIds((current) => [plan.draft.id, ...current]);
      setAgentDrafts((current) => ({ ...current, [plan.draft.id]: plan.draft }));
      setAgentDirty(setDirtyAgentIds, plan.draft.id);
      setSelectedAgentId(plan.draft.id);
    },
    handleMarketInstall(name, description, category) {
      const plan = planMarketInstall(name, description, category, agentDraftCounter);
      setAgentDraftCounter(plan.nextCounter);
      setDraftAgentIds((current) => [plan.installed.id, ...current]);
      setAgentDrafts((current) => ({ ...current, [plan.installed.id]: plan.installed }));
      setSelectedAgentId(plan.installed.id);
      setAgentsPane(plan.agentsPane);
      clearAgentDirty(setDirtyAgentIds, plan.installed.id);
    },
    async handleAgentSave() {
      if (!effectiveSelectedAgentId) return;
      const agent = agentConfigs.find((item) => item.id === effectiveSelectedAgentId);
      if (!agent) return;
      if (selectedAgentIsDraft) {
        try {
          await onAgentCreate?.(agent);
        } catch {
          return;
        }
        setDraftAgentIds((current) => removeAgentDraftId(current, agent.id));
        setAgentDrafts((current) => omitAgentDraft(current, agent.id));
        clearAgentDirty(setDirtyAgentIds, agent.id);
        return;
      }
      try {
        await onAgentUpdate?.(agent);
      } catch {
        return;
      }
      clearAgentDirty(setDirtyAgentIds, agent.id);
    },
    async handleAgentDelete() {
      if (!effectiveSelectedAgentId) return;
      const agentId = effectiveSelectedAgentId;
      if (draftAgentIds.includes(agentId)) {
        setDraftAgentIds((current) => removeAgentDraftId(current, agentId));
        setAgentDrafts((current) => omitAgentDraft(current, agentId));
        clearAgentDirty(setDirtyAgentIds, agentId);
        selectAdjacentAgent(access, agentId);
        return;
      }
      try {
        await onAgentDelete?.(agentId);
      } catch {
        return;
      }
      selectAdjacentAgent(access, agentId);
    },
    handleAgentSkillToggle(skill) {
      const current = agentConfigs.find((agent) => agent.id === effectiveSelectedAgentId);
      if (!current) return;
      patchSelectedAgent(access, { skills: toggleAgentSkill(current.skills, skill) });
    },
    handleToolPermissionSet(tool, value) {
      const current = agentConfigs.find((agent) => agent.id === effectiveSelectedAgentId);
      patchSelectedAgent(access, { tools: withToolPermission(current?.tools, tool, value) });
    },
    handleAgentFieldChange(field, value) {
      patchSelectedAgent(access, buildAgentFieldPatch(field, value));
    },
    agentSaveStateLabel() {
      return resolveAgentSaveStateLabel({
        selectedAgentDeleting,
        selectedAgentSaving,
        selectedAgentIsDraft,
        selectedAgentIsDirty,
        ...(agentProfilesStatus?.actionError !== undefined
          ? { actionError: agentProfilesStatus.actionError }
          : {}),
      });
    },
  };
}
