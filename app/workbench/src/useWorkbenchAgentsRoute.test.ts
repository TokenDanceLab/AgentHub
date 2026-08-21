// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchAgent } from '@shared/platform';
import {
  WORKBENCH_MOCK_AGENT_CONFIGS,
  WORKBENCH_MOCK_AGENT_MODELS,
  WORKBENCH_MOCK_AGENT_SKILL_OPTIONS,
  WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
} from './mockData';
import {
  useWorkbenchAgentsRoute,
  type UseWorkbenchAgentsRouteOptions,
  type WorkbenchAgentsModelCatalogItem,
} from './useWorkbenchAgentsRoute';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchAgentsRoute — demo-mode mock fallback, draft lifecycle,
   selection sync, save-state labels and parent-driven real-data mapping.

   The route has no pagination/loadMore surface; its reentry guards are
   the empty-selection no-ops, the save/delete failure short-circuits and
   the selection-repair effect.
   ═══════════════════════════════════════════════════════════════════════ */

function renderAgentsRoute(options: UseWorkbenchAgentsRouteOptions) {
  return renderHook((props: UseWorkbenchAgentsRouteOptions) => useWorkbenchAgentsRoute(props), {
    initialProps: options,
  });
}

function hubAgent(id: string, name: string, overrides: Partial<WorkbenchAgent> = {}): WorkbenchAgent {
  return {
    id,
    name,
    ...overrides,
  };
}

describe('useWorkbenchAgentsRoute — demo mode mock fallback', () => {
  it('loads mock agent configs, selects the first agent and exposes mock catalogs', () => {
    const { result } = renderAgentsRoute({ realDataMode: false });

    expect(result.current.agentConfigs).toHaveLength(WORKBENCH_MOCK_AGENT_CONFIGS.length);
    expect(result.current.agentConfigs[0]?.id).toBe('builder-agent');
    expect(result.current.agentConfigs[0]?.name).toBe('Builder');
    expect(result.current.effectiveSelectedAgentId).toBe('builder-agent');
    expect(result.current.agentsPane).toBe('installed');
    expect(result.current.selectedAgentIsDirty).toBe(false);
    expect(result.current.resolvedModels).toEqual(WORKBENCH_MOCK_AGENT_MODELS);
    expect(result.current.resolvedSkills).toEqual(WORKBENCH_MOCK_AGENT_SKILL_OPTIONS);
    expect(result.current.resolvedTools).toEqual(WORKBENCH_MOCK_AGENT_TOOL_OPTIONS);
    expect(result.current.agentSaveStateLabel()).toBe('已同步');
  });

  it('steers the initial selection from focusedAgentId and re-syncs on rerender', () => {
    const { result, rerender } = renderAgentsRoute({
      realDataMode: false,
      focusedAgentId: 'reviewer-agent',
    });

    expect(result.current.effectiveSelectedAgentId).toBe('reviewer-agent');

    rerender({ realDataMode: false, focusedAgentId: 'researcher-agent' });
    expect(result.current.effectiveSelectedAgentId).toBe('researcher-agent');
  });

  it('uses parent-supplied agents even in demo mode (mock fallback only when agents is undefined)', () => {
    const { result } = renderAgentsRoute({ realDataMode: false, agents: [] });

    expect(result.current.agentConfigs).toEqual([]);
    expect(result.current.effectiveSelectedAgentId).toBe('');
  });
});

describe('useWorkbenchAgentsRoute — real data mode', () => {
  it('shows an empty, inert route when real mode has no agents yet', async () => {
    const onAgentCreate = vi.fn();
    const onAgentUpdate = vi.fn();
    const onAgentDelete = vi.fn();
    const { result } = renderAgentsRoute({
      realDataMode: true,
      onAgentCreate,
      onAgentUpdate,
      onAgentDelete,
    });

    expect(result.current.agentConfigs).toEqual([]);
    expect(result.current.effectiveSelectedAgentId).toBe('');
    expect(result.current.selectedAgentIsDirty).toBe(false);
    expect(result.current.agentSaveStateLabel()).toBe('已同步');
    // Mock catalogs still back the pickers when the list is empty.
    expect(result.current.resolvedSkills).toEqual(WORKBENCH_MOCK_AGENT_SKILL_OPTIONS);
    expect(result.current.resolvedModels).toEqual(WORKBENCH_MOCK_AGENT_MODELS);

    // Save/delete are guarded no-ops without a selection.
    await act(async () => {
      await result.current.handleAgentSave();
      await result.current.handleAgentDelete();
    });
    expect(onAgentCreate).not.toHaveBeenCalled();
    expect(onAgentUpdate).not.toHaveBeenCalled();
    expect(onAgentDelete).not.toHaveBeenCalled();
  });

  it('maps parent WorkbenchAgent[] to configs and derives skill/tool catalogs from them', () => {
    const { result } = renderAgentsRoute({
      realDataMode: true,
      agents: [
        hubAgent('hub-1', 'Hub Alpha', {
          description: 'alpha agent',
          status: 'available',
          runtimeId: 'codex',
          provider: 'OpenAI',
          model: 'gpt-5-codex',
          reasoningEffort: 'medium',
          skills: ['Search', 'Read File'],
          mcpServers: ['fs'],
          toolAllowlist: ['Read File', 'Shell'],
          memorySources: ['agents-md'],
          targetPreferences: ['local-edge'],
          approvalPolicy: 'ask-before-write',
        }),
        hubAgent('hub-2', 'Hub Beta', {
          status: 'unavailable',
          skills: ['Read File'],
        }),
      ],
    });

    expect(result.current.agentConfigs).toHaveLength(2);
    expect(result.current.effectiveSelectedAgentId).toBe('hub-1');

    const first = result.current.agentConfigs.find((agent) => agent.id === 'hub-1');
    expect(first?.state).toBe('ready');
    expect(first?.model).toBe('OpenAI / gpt-5-codex');
    expect(first?.mode).toBe('推理 medium');
    expect(first?.tools['Read File']).toBe('允许');
    expect(first?.tools['Shell']).toBe('允许');

    // Skills derive from agent configs (sorted unique), tools from tool keys.
    expect(result.current.resolvedSkills).toEqual(['Read File', 'Search']);
    expect(result.current.resolvedTools).toEqual(WORKBENCH_MOCK_AGENT_TOOL_OPTIONS);
  });

  it('maps a model catalog to ModelInfo rows with states and assigned agents', () => {
    const modelCatalog: WorkbenchAgentsModelCatalogItem[] = [
      { id: 'm1', label: 'DeepSeek-V4-Pro', value: 'DeepSeek-V4-Pro', status: 'healthy' },
      { id: 'm2', label: 'gpt-5-codex', value: 'gpt-5-codex', status: 'experimental' },
      { id: 'm3', label: 'glm-5.1', value: 'glm-5.1', status: 'down' },
      { id: 'm4', label: 'Default X', value: 'x-default', status: 'down', default: true },
    ];
    const { result } = renderAgentsRoute({ realDataMode: false, modelCatalog });

    expect(result.current.resolvedModels).toHaveLength(4);
    expect(result.current.resolvedModels[0]).toEqual({
      name: 'DeepSeek-V4-Pro',
      state: '默认',
      description: '',
      assignedAgents: 'Builder, Reviewer, Deployer',
    });
    expect(result.current.resolvedModels[1]?.state).toBe('实验');
    expect(result.current.resolvedModels[1]?.assignedAgents).toBe('Researcher');
    expect(result.current.resolvedModels[2]?.state).toBe('备选');
    expect(result.current.resolvedModels[2]?.assignedAgents).toBe('—');
    // The `default` flag wins over an unhealthy status.
    expect(result.current.resolvedModels[3]?.state).toBe('默认');
  });
});

describe('useWorkbenchAgentsRoute — draft lifecycle', () => {
  it('handleAgentAdd creates a draft at the top, selects it and marks it dirty', () => {
    const { result } = renderAgentsRoute({ realDataMode: false });

    act(() => {
      result.current.handleAgentAdd();
    });

    expect(result.current.agentConfigs[0]?.id).toBe('draft-agent-1');
    expect(result.current.agentConfigs[0]?.name).toBe('新 Agent 1');
    expect(result.current.effectiveSelectedAgentId).toBe('draft-agent-1');
    expect(result.current.selectedAgentIsDirty).toBe(true);
    expect(result.current.agentSaveStateLabel()).toBe('草稿');
  });

  it('handleAgentFieldChange patches the selected agent and marks it dirty', () => {
    const { result } = renderAgentsRoute({ realDataMode: false });

    act(() => {
      result.current.handleAgentFieldChange('name', 'Builder Prime');
    });

    const patched = result.current.agentConfigs.find((agent) => agent.id === 'builder-agent');
    expect(patched?.name).toBe('Builder Prime');
    expect(result.current.selectedAgentIsDirty).toBe(true);
    expect(result.current.agentSaveStateLabel()).toBe('未保存');
  });

  it('handleAgentSave saves an existing agent through onAgentUpdate and clears dirty', async () => {
    const onAgentUpdate = vi.fn();
    const { result } = renderAgentsRoute({ realDataMode: false, onAgentUpdate });

    act(() => {
      result.current.handleAgentFieldChange('name', 'Builder Prime');
    });

    await act(async () => {
      await result.current.handleAgentSave();
    });

    expect(onAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'builder-agent', name: 'Builder Prime' }),
    );
    expect(result.current.selectedAgentIsDirty).toBe(false);
    expect(result.current.agentSaveStateLabel()).toBe('已同步');
    // The local draft override for a source agent survives the save.
    expect(result.current.agentConfigs.find((agent) => agent.id === 'builder-agent')?.name).toBe('Builder Prime');
  });

  it('handleAgentSave creates a draft through onAgentCreate, removes the draft and repairs selection', async () => {
    const onAgentCreate = vi.fn();
    const { result } = renderAgentsRoute({ realDataMode: false, onAgentCreate });

    act(() => {
      result.current.handleAgentAdd();
    });
    act(() => {
      result.current.handleAgentFieldChange('role', '自动化');
    });

    await act(async () => {
      await result.current.handleAgentSave();
    });

    expect(onAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft-agent-1', role: '自动化' }),
    );
    expect(result.current.agentConfigs.some((agent) => agent.id === 'draft-agent-1')).toBe(false);
    expect(result.current.agentConfigs).toHaveLength(WORKBENCH_MOCK_AGENT_CONFIGS.length);
    expect(result.current.effectiveSelectedAgentId).toBe('builder-agent');
    expect(result.current.selectedAgentIsDirty).toBe(false);
  });

  it('keeps the draft selected and dirty when onAgentCreate fails (reentry guard)', async () => {
    const onAgentCreate = vi.fn(() => {
      throw new Error('create exploded');
    });
    const { result } = renderAgentsRoute({ realDataMode: false, onAgentCreate });

    act(() => {
      result.current.handleAgentAdd();
    });

    await act(async () => {
      await result.current.handleAgentSave();
    });

    expect(onAgentCreate).toHaveBeenCalledTimes(1);
    // Failure short-circuits before any cleanup: draft, selection and dirty survive.
    expect(result.current.agentConfigs[0]?.id).toBe('draft-agent-1');
    expect(result.current.effectiveSelectedAgentId).toBe('draft-agent-1');
    expect(result.current.selectedAgentIsDirty).toBe(true);
    expect(result.current.agentSaveStateLabel()).toBe('草稿');
  });

  it('handleAgentDelete removes a draft without calling onAgentDelete and moves selection to the first live agent', async () => {
    const onAgentDelete = vi.fn();
    const { result } = renderAgentsRoute({ realDataMode: false, onAgentDelete });

    act(() => {
      result.current.handleAgentAdd();
    });

    await act(async () => {
      await result.current.handleAgentDelete();
    });

    expect(onAgentDelete).not.toHaveBeenCalled();
    expect(result.current.agentConfigs.some((agent) => agent.id === 'draft-agent-1')).toBe(false);
    expect(result.current.effectiveSelectedAgentId).toBe('builder-agent');
  });

  it('handleAgentDelete deletes a live agent through onAgentDelete and selects the adjacent agent', async () => {
    const onAgentDelete = vi.fn();
    const { result } = renderAgentsRoute({ realDataMode: false, onAgentDelete });

    await act(async () => {
      await result.current.handleAgentDelete();
    });

    expect(onAgentDelete).toHaveBeenCalledWith('builder-agent');
    expect(result.current.effectiveSelectedAgentId).toBe('reviewer-agent');
    // Source agents stay in the list: the parent owns the actual removal.
    expect(result.current.agentConfigs.some((agent) => agent.id === 'builder-agent')).toBe(true);
  });

  it('keeps the live agent selected when onAgentDelete fails', async () => {
    const onAgentDelete = vi.fn(() => {
      throw new Error('delete exploded');
    });
    const { result } = renderAgentsRoute({ realDataMode: false, onAgentDelete });

    await act(async () => {
      await result.current.handleAgentDelete();
    });

    expect(onAgentDelete).toHaveBeenCalledTimes(1);
    expect(result.current.effectiveSelectedAgentId).toBe('builder-agent');
  });
});

describe('useWorkbenchAgentsRoute — edits, installs and save-state labels', () => {
  it('handleAgentSkillToggle toggles a skill on the selected agent', () => {
    const { result } = renderAgentsRoute({ realDataMode: false });

    act(() => {
      result.current.handleAgentSkillToggle('Shell');
    });
    const afterRemove = result.current.agentConfigs.find((agent) => agent.id === 'builder-agent');
    expect(afterRemove?.skills).not.toContain('Shell');
    expect(result.current.selectedAgentIsDirty).toBe(true);

    act(() => {
      result.current.handleAgentSkillToggle('Shell');
    });
    const afterAdd = result.current.agentConfigs.find((agent) => agent.id === 'builder-agent');
    expect(afterAdd?.skills).toContain('Shell');
  });

  it('handleToolPermissionSet sets a tool permission on the selected agent', () => {
    const { result } = renderAgentsRoute({ realDataMode: false });

    act(() => {
      result.current.handleToolPermissionSet('Shell', '禁止');
    });

    const patched = result.current.agentConfigs.find((agent) => agent.id === 'builder-agent');
    expect(patched?.tools['Shell']).toBe('禁止');
    expect(result.current.selectedAgentIsDirty).toBe(true);
  });

  it('handleMarketInstall installs a market agent, switches pane and selects it', () => {
    const { result } = renderAgentsRoute({ realDataMode: false });

    act(() => {
      result.current.handleMarketInstall('Browser Copilot', 'does browser stuff', '研发');
    });

    const installed = result.current.agentConfigs[0];
    expect(installed?.id).toBe('installed-market-1');
    expect(installed?.name).toBe('Browser Copilot');
    expect(installed?.engine).toBe('claude-code');
    expect(installed?.model).toBe('anthropic / sonnet');
    expect(installed?.tools['Write File']).toBe('禁止');
    expect(installed?.tools['Browser Screenshot']).toBe('需确认');
    expect(result.current.agentsPane).toBe('installed');
    expect(result.current.effectiveSelectedAgentId).toBe('installed-market-1');
    expect(result.current.selectedAgentIsDirty).toBe(false);
    expect(result.current.agentSaveStateLabel()).toBe('草稿');
  });

  it('reflects saving/deleting/actionError statuses in the save-state label', () => {
    const { result, rerender } = renderAgentsRoute({
      realDataMode: false,
      agentProfilesStatus: { savingAgentId: 'builder-agent' },
    });
    expect(result.current.agentSaveStateLabel()).toBe('保存中');

    rerender({
      realDataMode: false,
      agentProfilesStatus: { deletingAgentId: 'builder-agent' },
    });
    expect(result.current.agentSaveStateLabel()).toBe('删除中');

    rerender({
      realDataMode: false,
      agentProfilesStatus: { actionError: 'boom' },
    });
    expect(result.current.agentSaveStateLabel()).toBe('保存失败');
  });

  it('labels a saving draft as 创建中', () => {
    const { result, rerender } = renderAgentsRoute({ realDataMode: false });

    act(() => {
      result.current.handleAgentAdd();
    });

    rerender({
      realDataMode: false,
      agentProfilesStatus: { savingAgentId: 'draft-agent-1' },
    });
    expect(result.current.agentSaveStateLabel()).toBe('创建中');
  });
});
