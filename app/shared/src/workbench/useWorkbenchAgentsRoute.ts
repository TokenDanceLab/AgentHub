import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchAgent } from '../platform';
import type { AgentConfig, AgentsPaneId, ToolPermission } from './pages/AgentsPage';
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

export interface WorkbenchAgentsRouteStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  savingAgentId?: string | undefined;
  deletingAgentId?: string | undefined;
}

export interface UseWorkbenchAgentsRouteOptions {
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentsRouteStatus | undefined;
  focusedAgentId?: string | undefined;
  realDataMode: boolean;
  modelCatalog?: Array<{
    id: string;
    label: string;
    value: string;
    provider?: string;
    status: string;
    description?: string;
    default?: boolean;
    tags?: string[];
  }> | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
}

export interface WorkbenchAgentsRoute {
  agentsPane: AgentsPaneId;
  setAgentsPane: (pane: AgentsPaneId) => void;
  agentConfigs: AgentConfig[];
  resolvedModels: Array<{
    name: string;
    state: '默认' | '备选' | '实验';
    description: string;
    assignedAgents: string;
  }>;
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

export function useWorkbenchAgentsRoute({
  agents,
  agentProfilesStatus,
  focusedAgentId,
  realDataMode,
  modelCatalog,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
}: UseWorkbenchAgentsRouteOptions): WorkbenchAgentsRoute {
  const [agentsPane, setAgentsPane] = useState<AgentsPaneId>('installed');
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(focusedAgentId);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentConfig>>({});
  const [draftAgentIds, setDraftAgentIds] = useState<string[]>([]);
  const [dirtyAgentIds, setDirtyAgentIds] = useState<string[]>([]);
  const [agentDraftCounter, setAgentDraftCounter] = useState(1);

  const sourceAgentConfigs = useMemo(
    () => (agents === undefined
      ? realDataMode ? [] : WORKBENCH_MOCK_AGENT_CONFIGS
      : agents.map(workbenchAgentToAgentConfig)),
    [agents, realDataMode],
  );
  const agentConfigs = useMemo(() => [
    ...draftAgentIds
      .map((id) => agentDrafts[id])
      .filter((agent): agent is AgentConfig => Boolean(agent)),
    ...sourceAgentConfigs.map((agent) => agentDrafts[agent.id] ?? agent),
  ], [agentDrafts, draftAgentIds, sourceAgentConfigs]);

  // Map Edge model catalog to AgentsPage ModelInfo[] when available.
  const resolvedModels = useMemo(() => {
    if (!modelCatalog || modelCatalog.length === 0) return WORKBENCH_MOCK_AGENT_MODELS;
    return modelCatalog.map((item) => {
      const assignedAgents = agentConfigs
        .filter((agent) => agent.model === item.value || agent.model === item.label)
        .map((agent) => agent.name)
        .join(', ');
      let state: '默认' | '备选' | '实验' = '备选';
      if (item.default) state = '默认';
      else if (item.status === 'healthy' || item.status === 'available') state = '默认';
      else if (item.status === 'experimental' || item.tags?.includes('experimental')) state = '实验';
      return {
        name: item.label || item.value,
        state,
        description: item.description ?? '',
        assignedAgents: assignedAgents || '—',
      };
    });
  }, [modelCatalog, agentConfigs]);

  // Extract unique skills and tools from agent configs; fall back to catalog fixtures.
  const resolvedSkills = useMemo(() => {
    const fromAgents = Array.from(new Set(agentConfigs.flatMap((a) => a.skills))).filter(Boolean).sort();
    return fromAgents.length > 0 ? fromAgents : WORKBENCH_MOCK_AGENT_SKILL_OPTIONS;
  }, [agentConfigs]);

  const resolvedTools = useMemo(() => {
    const fromAgents = Array.from(new Set(agentConfigs.flatMap((a) => Object.keys(a.tools)))).filter(Boolean).sort();
    return fromAgents.length > 0 ? fromAgents : WORKBENCH_MOCK_AGENT_TOOL_OPTIONS;
  }, [agentConfigs]);

  const effectiveSelectedAgentId = selectedAgentId ?? agentConfigs[0]?.id ?? '';
  const selectedAgentIsDraft = effectiveSelectedAgentId ? draftAgentIds.includes(effectiveSelectedAgentId) : false;
  const selectedAgentIsDirty = effectiveSelectedAgentId ? dirtyAgentIds.includes(effectiveSelectedAgentId) : false;
  const selectedAgentSaving = effectiveSelectedAgentId && agentProfilesStatus?.savingAgentId === effectiveSelectedAgentId;
  const selectedAgentDeleting = effectiveSelectedAgentId && agentProfilesStatus?.deletingAgentId === effectiveSelectedAgentId;

  useEffect(() => {
    if (focusedAgentId) setSelectedAgentId(focusedAgentId);
  }, [focusedAgentId]);

  useEffect(() => {
    const sourceIds = new Set(sourceAgentConfigs.map((agent) => agent.id));
    setAgentDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => draftAgentIds.includes(id) || sourceIds.has(id)),
    ));
    setDirtyAgentIds((current) => current.filter((id) => draftAgentIds.includes(id) || sourceIds.has(id)));
  }, [draftAgentIds, sourceAgentConfigs]);

  useEffect(() => {
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

  function handleMarketInstall(name: string, description: string, category: string): void {
    const nextIndex = agentDraftCounter;
    const installed = createMarketInstalledAgent(name, description, category, nextIndex);
    setAgentDraftCounter((current) => current + 1);
    setDraftAgentIds((current) => [installed.id, ...current]);
    setAgentDrafts((current) => ({ ...current, [installed.id]: installed }));
    setSelectedAgentId(installed.id);
    setAgentsPane('installed');
    clearAgentDirty(installed.id);
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

  return {
    agentsPane,
    setAgentsPane,
    agentConfigs,
    resolvedModels,
    resolvedSkills,
    resolvedTools,
    effectiveSelectedAgentId,
    selectedAgentIsDirty,
    setSelectedAgentId,
    handleAgentAdd,
    handleAgentSave,
    handleAgentDelete,
    handleAgentFieldChange,
    handleAgentSkillToggle,
    handleToolPermissionSet,
    handleMarketInstall,
    agentSaveStateLabel,
  };
}
