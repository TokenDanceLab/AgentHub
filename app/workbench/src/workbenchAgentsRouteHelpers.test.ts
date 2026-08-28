import { describe, expect, it, vi } from 'vitest';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { createTestI18n } from '@shared/testing/i18n';
import type { AgentConfig } from './pages/AgentsPage';
import {
  buildAgentFieldPatch,
  buildWorkbenchAgentsRouteHandlers,
  createAgentDraft,
  isAgentBusyWith,
  isAgentIdListed,
  mergeAgentConfigs,
  omitAgentDraft,
  planAgentAdd,
  planMarketInstall,
  planSelectedAgentSync,
  pruneAgentDirtyIds,
  pruneAgentDrafts,
  removeAgentDraftId,
  resolveAdjacentAgentId,
  resolveAgentModels,
  resolveAgentSaveStateLabel,
  resolveAgentSkills,
  resolveAgentTools,
  resolveAssignedAgentsLabel,
  resolveEffectiveSelectedAgentId,
  resolveModelCatalogState,
  resolveSourceAgentConfigs,
  toggleAgentSkill,
  withAgentDirty,
  withoutAgentDirty,
  withToolPermission,
  type WorkbenchAgentsRouteStateAccessors,
} from './workbenchAgentsRouteHelpers';

const AGENT_A: AgentConfig = {
  id: 'a1',
  name: 'Builder',
  role: 'coding',
  engine: 'codex',
  model: 'openai / gpt-5',
  mode: 'Reasoning medium',
  approval: 'Hub 默认策略',
  scope: 'default',
  state: 'ready',
  skills: ['code', 'review'],
  tools: { Shell: '需确认', 'Read File': '允许' },
};

const AGENT_B: AgentConfig = {
  id: 'a2',
  name: 'Browser QA',
  role: 'qa',
  engine: 'claude-code',
  model: 'anthropic / sonnet',
  mode: 'Review',
  approval: 'on-request',
  scope: 'read-only',
  state: 'idle',
  skills: ['browser'],
  tools: { 'Browser Screenshot': '允许' },
};

/** Real zh bundle keeps historical copy expectations honest (#2023). */
const tZh = createTestI18n({ lng: 'zh' }).getFixedT('zh', SHARED_WORKBENCH_I18N_NAMESPACE);

describe('workbenchAgentsRouteHelpers', () => {
  it('resolves source agent configs for mock and real modes', () => {
    const mock = [AGENT_A];
    expect(resolveSourceAgentConfigs(undefined, true, mock)).toEqual([]);
    expect(resolveSourceAgentConfigs(undefined, false, mock)).toEqual(mock);
    expect(resolveSourceAgentConfigs([], false, mock)).toEqual([]);
    expect(resolveSourceAgentConfigs([
      {
        id: 'hub-1',
        name: 'Hub Agent',
        status: 'available',
        skills: ['code'],
      },
    ], true, mock)).toEqual([
      expect.objectContaining({
        id: 'hub-1',
        name: 'Hub Agent',
        state: 'ready',
        skills: ['code'],
      }),
    ]);
  });

  it('merges drafts ahead of source agents and prunes stale drafts', () => {
    const draft: AgentConfig = { ...AGENT_A, id: 'draft-1', name: 'Draft' };
    const overridden: AgentConfig = { ...AGENT_A, name: 'Builder edited' };
    expect(mergeAgentConfigs(['draft-1'], { 'draft-1': draft, a1: overridden }, [AGENT_A, AGENT_B])).toEqual([
      draft,
      overridden,
      AGENT_B,
    ]);

    const pruned = pruneAgentDrafts(
      { 'draft-1': draft, a1: overridden, gone: AGENT_B },
      ['draft-1'],
      [AGENT_A],
    );
    expect(pruned).toEqual({ 'draft-1': draft, a1: overridden });
    expect(pruneAgentDirtyIds(['draft-1', 'a1', 'gone'], ['draft-1'], [AGENT_A])).toEqual(['draft-1', 'a1']);
  });

  it('maps model catalog state/assignment and falls back for skills/tools', () => {
    expect(resolveModelCatalogState({
      id: 'm1',
      label: 'GPT',
      value: 'gpt',
      status: 'down',
      default: true,
    })).toBe('默认');
    expect(resolveModelCatalogState({
      id: 'm2',
      label: 'Exp',
      value: 'exp',
      status: 'experimental',
    })).toBe('实验');
    expect(resolveModelCatalogState({
      id: 'm3',
      label: 'Alt',
      value: 'alt',
      status: 'degraded',
      tags: ['experimental'],
    })).toBe('实验');
    expect(resolveModelCatalogState({
      id: 'm4',
      label: 'Ok',
      value: 'ok',
      status: 'healthy',
    })).toBe('默认');
    expect(resolveModelCatalogState({
      id: 'm5',
      label: 'Backup',
      value: 'backup',
      status: 'unknown',
    })).toBe('备选');

    expect(resolveAssignedAgentsLabel([AGENT_A, AGENT_B], {
      id: 'm1',
      label: 'openai / gpt-5',
      value: 'openai / gpt-5',
      status: 'healthy',
    })).toBe('Builder');
    expect(resolveAssignedAgentsLabel([AGENT_A], {
      id: 'm2',
      label: 'unused',
      value: 'unused',
      status: 'healthy',
    })).toBe('—');

    expect(resolveAgentModels(undefined, [AGENT_A], [{
      name: 'mock',
      state: '默认',
      description: 'd',
      assignedAgents: '—',
    }])).toEqual([{
      name: 'mock',
      state: '默认',
      description: 'd',
      assignedAgents: '—',
    }]);
    expect(resolveAgentModels([], [AGENT_A], [{
      name: 'mock',
      state: '默认',
      description: 'd',
      assignedAgents: '—',
    }])[0]?.name).toBe('mock');
    expect(resolveAgentModels([
      {
        id: 'm1',
        label: 'GPT-5',
        value: 'openai / gpt-5',
        status: 'available',
        description: 'flagship',
      },
    ], [AGENT_A])).toEqual([{
      name: 'GPT-5',
      state: '默认',
      description: 'flagship',
      assignedAgents: 'Builder',
    }]);

    expect(resolveAgentSkills([AGENT_A, AGENT_B])).toEqual(['browser', 'code', 'review']);
    expect(resolveAgentSkills([], ['skill-a'])).toEqual(['skill-a']);
    expect(resolveAgentTools([AGENT_A, AGENT_B])).toEqual(['Browser Screenshot', 'Read File', 'Shell']);
    expect(resolveAgentTools([], ['tool-a'])).toEqual(['tool-a']);

    // #1872: real mode must not silently fall back to mock catalogs.
    expect(resolveAgentModels(undefined, [AGENT_A], undefined, true)).toEqual([]);
    expect(resolveAgentSkills([], undefined, true)).toEqual([]);
    expect(resolveAgentTools([], undefined, true)).toEqual([]);
  });

  it('resolves selection guards and adjacent agent ids', () => {
    expect(resolveEffectiveSelectedAgentId(undefined, [AGENT_A, AGENT_B])).toBe('a1');
    expect(resolveEffectiveSelectedAgentId('a2', [AGENT_A, AGENT_B])).toBe('a2');
    expect(resolveEffectiveSelectedAgentId(undefined, [])).toBe('');

    expect(isAgentIdListed('a1', ['a1'])).toBe(true);
    expect(isAgentIdListed('', ['a1'])).toBe(false);
    expect(isAgentBusyWith('a1', 'a1')).toBe(true);
    expect(isAgentBusyWith('a1', 'a2')).toBe(false);

    expect(planSelectedAgentSync('', [AGENT_A])).toEqual({ kind: 'select', agentId: 'a1' });
    expect(planSelectedAgentSync('missing', [AGENT_A, AGENT_B])).toEqual({ kind: 'select', agentId: 'a1' });
    expect(planSelectedAgentSync('a2', [AGENT_A, AGENT_B])).toEqual({ kind: 'none' });
    expect(resolveAdjacentAgentId([AGENT_A, AGENT_B], 'a1')).toBe('a2');
    expect(resolveAdjacentAgentId([AGENT_A], 'a1')).toBeUndefined();
  });

  it('creates drafts, market installs, and field/tool patches', () => {
    const draft = createAgentDraft(3);
    expect(draft).toMatchObject({
      id: 'draft-agent-3',
      name: '新 Agent 3',
      engine: 'codex',
      state: 'waiting',
      tools: {},
    });
    expect(planAgentAdd(2)).toEqual({
      draft: createAgentDraft(2),
      nextCounter: 3,
    });

    const installed = planMarketInstall('Browser Bot', 'desc', '测试', 4);
    expect(installed.nextCounter).toBe(5);
    expect(installed.agentsPane).toBe('installed');
    expect(installed.installed.id).toBe('installed-market-4');
    expect(installed.installed.name).toBe('Browser Bot');

    expect(withAgentDirty(['a1'], 'a2')).toEqual(['a1', 'a2']);
    expect(withAgentDirty(['a1'], 'a1')).toEqual(['a1']);
    expect(withoutAgentDirty(['a1', 'a2'], 'a1')).toEqual(['a2']);
    expect(removeAgentDraftId(['d1', 'd2'], 'd1')).toEqual(['d2']);
    expect(omitAgentDraft({ d1: AGENT_A, d2: AGENT_B }, 'd1')).toEqual({ d2: AGENT_B });

    expect(toggleAgentSkill(['code'], 'review')).toEqual(['code', 'review']);
    expect(toggleAgentSkill(['code', 'review'], 'code')).toEqual(['review']);
    expect(withToolPermission(undefined, 'Shell', '允许')).toEqual({ Shell: '允许' });
    expect(withToolPermission({ Shell: '禁止' }, 'Shell', '允许')).toEqual({ Shell: '允许' });
    expect(buildAgentFieldPatch('state', 'ready')).toEqual({ state: 'ready' });
    expect(buildAgentFieldPatch('name', 'N')).toEqual({ name: 'N' });
  });

  it('resolves save-state labels', () => {
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: true,
      selectedAgentSaving: false,
      selectedAgentIsDraft: false,
      selectedAgentIsDirty: false,
    })).toBe('删除中');
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: false,
      selectedAgentSaving: true,
      selectedAgentIsDraft: true,
      selectedAgentIsDirty: false,
    })).toBe('创建中');
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: false,
      selectedAgentSaving: true,
      selectedAgentIsDraft: false,
      selectedAgentIsDirty: false,
    })).toBe('保存中');
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: false,
      selectedAgentSaving: false,
      selectedAgentIsDraft: false,
      selectedAgentIsDirty: false,
      actionError: 'boom',
    })).toBe('保存失败');
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: false,
      selectedAgentSaving: false,
      selectedAgentIsDraft: true,
      selectedAgentIsDirty: false,
    })).toBe('草稿');
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: false,
      selectedAgentSaving: false,
      selectedAgentIsDraft: false,
      selectedAgentIsDirty: true,
    })).toBe('未保存');
    expect(resolveAgentSaveStateLabel(tZh, {
      selectedAgentDeleting: false,
      selectedAgentSaving: false,
      selectedAgentIsDraft: false,
      selectedAgentIsDirty: false,
    })).toBe('已同步');
  });

  it('builds route handlers that apply add/save/delete plans to state setters', async () => {
    let agentsPane: import('./pages/AgentsPage').AgentsPaneId = 'market';
    let selectedAgentId: string | undefined = 'a1';
    let agentDrafts: Record<string, AgentConfig> = {};
    let draftAgentIds: string[] = [];
    let dirtyAgentIds: string[] = [];
    let agentDraftCounter = 1;
    let agentConfigs = [AGENT_A, AGENT_B];

    const onAgentCreate = vi.fn(async () => undefined);
    const onAgentUpdate = vi.fn(async () => undefined);
    const onAgentDelete = vi.fn(async () => undefined);

    const access: WorkbenchAgentsRouteStateAccessors = {
      get agentConfigs() { return agentConfigs; },
      get draftAgentIds() { return draftAgentIds; },
      get agentDraftCounter() { return agentDraftCounter; },
      get effectiveSelectedAgentId() { return selectedAgentId ?? agentConfigs[0]?.id ?? ''; },
      get selectedAgentIsDraft() {
        const id = selectedAgentId ?? '';
        return id ? draftAgentIds.includes(id) : false;
      },
      selectedAgentDeleting: false,
      selectedAgentSaving: false,
      selectedAgentIsDirty: false,
      translator: tZh,
      onAgentCreate,
      onAgentUpdate,
      onAgentDelete,
      setAgentsPane: (value) => {
        agentsPane = typeof value === 'function' ? value(agentsPane) : value;
      },
      setSelectedAgentId: (value) => {
        selectedAgentId = typeof value === 'function' ? value(selectedAgentId) : value;
      },
      setAgentDrafts: (value) => {
        agentDrafts = typeof value === 'function' ? value(agentDrafts) : value;
      },
      setDraftAgentIds: (value) => {
        draftAgentIds = typeof value === 'function' ? value(draftAgentIds) : value;
      },
      setDirtyAgentIds: (value) => {
        dirtyAgentIds = typeof value === 'function' ? value(dirtyAgentIds) : value;
      },
      setAgentDraftCounter: (value) => {
        agentDraftCounter = typeof value === 'function' ? value(agentDraftCounter) : value;
      },
    };

    const buildHandlers = () => buildWorkbenchAgentsRouteHandlers(access);

    buildHandlers().handleAgentAdd();
    expect(agentDraftCounter).toBe(2);
    expect(selectedAgentId).toBe('draft-agent-1');
    expect(draftAgentIds).toEqual(['draft-agent-1']);
    expect(agentDrafts['draft-agent-1']?.name).toBe('新 Agent 1');
    expect(dirtyAgentIds).toContain('draft-agent-1');

    agentConfigs = mergeAgentConfigs(draftAgentIds, agentDrafts, [AGENT_A, AGENT_B]);
    await buildHandlers().handleAgentSave();
    expect(onAgentCreate).toHaveBeenCalledTimes(1);
    expect(draftAgentIds).toEqual([]);
    expect(agentDrafts['draft-agent-1']).toBeUndefined();
    expect(dirtyAgentIds).not.toContain('draft-agent-1');

    selectedAgentId = 'a1';
    agentConfigs = [AGENT_A, AGENT_B];
    dirtyAgentIds = ['a1'];
    buildHandlers().handleAgentFieldChange('name', 'Builder+');
    expect(agentDrafts.a1?.name).toBe('Builder+');
    expect(dirtyAgentIds).toContain('a1');

    buildHandlers().handleAgentSkillToggle('docs');
    expect(agentDrafts.a1?.skills).toEqual(['code', 'review', 'docs']);
    buildHandlers().handleToolPermissionSet('Shell', '允许');
    expect(agentDrafts.a1?.tools.Shell).toBe('允许');

    agentConfigs = mergeAgentConfigs(draftAgentIds, agentDrafts, [AGENT_A, AGENT_B]);
    await buildHandlers().handleAgentSave();
    expect(onAgentUpdate).toHaveBeenCalledTimes(1);
    expect(dirtyAgentIds).not.toContain('a1');

    buildHandlers().handleMarketInstall('Market Agent', 'from market', '文档');
    expect(agentsPane).toBe('installed');
    expect(selectedAgentId).toBe('installed-market-2');
    expect(draftAgentIds[0]).toBe('installed-market-2');
    expect(dirtyAgentIds).not.toContain('installed-market-2');

    agentConfigs = mergeAgentConfigs(draftAgentIds, agentDrafts, [AGENT_A, AGENT_B]);
    await buildHandlers().handleAgentDelete();
    expect(onAgentDelete).not.toHaveBeenCalled();
    expect(draftAgentIds).not.toContain('installed-market-2');
    expect(selectedAgentId).toBe('a1');

    selectedAgentId = 'a2';
    agentConfigs = [AGENT_A, AGENT_B];
    await buildHandlers().handleAgentDelete();
    expect(onAgentDelete).toHaveBeenCalledWith('a2');
    expect(selectedAgentId).toBe('a1');

    expect(buildHandlers().agentSaveStateLabel()).toBe('已同步');
  });
});
