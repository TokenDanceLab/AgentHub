import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import type { AgentsPaneId, AgentConfig } from './pages/AgentsPage';
import {
  buildWorkbenchAgentsRouteHandlers,
  isAgentBusyWith,
  isAgentIdListed,
  mergeAgentConfigs,
  planSelectedAgentSync,
  pruneAgentDirtyIds,
  pruneAgentDrafts,
  resolveAgentModels,
  resolveAgentSkills,
  resolveAgentTools,
  resolveEffectiveSelectedAgentId,
  resolveSourceAgentConfigs,
  type UseWorkbenchAgentsRouteOptions,
  type WorkbenchAgentsRoute,
} from './workbenchAgentsRouteHelpers';

export type {
  UseWorkbenchAgentsRouteOptions,
  WorkbenchAgentsRoute,
  WorkbenchAgentsRouteStatus,
  WorkbenchAgentsModelCatalogItem,
} from './workbenchAgentsRouteHelpers';

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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const [agentsPane, setAgentsPane] = useState<AgentsPaneId>('installed');
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(focusedAgentId);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentConfig>>({});
  const [draftAgentIds, setDraftAgentIds] = useState<string[]>([]);
  const [dirtyAgentIds, setDirtyAgentIds] = useState<string[]>([]);
  const [agentDraftCounter, setAgentDraftCounter] = useState(1);

  const sourceAgentConfigs = useMemo(
    () => resolveSourceAgentConfigs(agents, realDataMode),
    [agents, realDataMode],
  );
  const agentConfigs = useMemo(
    () => mergeAgentConfigs(draftAgentIds, agentDrafts, sourceAgentConfigs),
    [agentDrafts, draftAgentIds, sourceAgentConfigs],
  );

  const resolvedModels = useMemo(
    () => resolveAgentModels(modelCatalog, agentConfigs, undefined, realDataMode),
    [modelCatalog, agentConfigs, realDataMode],
  );
  const resolvedSkills = useMemo(
    () => resolveAgentSkills(agentConfigs, undefined, realDataMode),
    [agentConfigs, realDataMode],
  );
  const resolvedTools = useMemo(
    () => resolveAgentTools(agentConfigs, undefined, realDataMode),
    [agentConfigs, realDataMode],
  );

  const effectiveSelectedAgentId = resolveEffectiveSelectedAgentId(selectedAgentId, agentConfigs);
  const selectedAgentIsDraft = isAgentIdListed(effectiveSelectedAgentId, draftAgentIds);
  const selectedAgentIsDirty = isAgentIdListed(effectiveSelectedAgentId, dirtyAgentIds);
  const selectedAgentSaving = isAgentBusyWith(effectiveSelectedAgentId, agentProfilesStatus?.savingAgentId);
  const selectedAgentDeleting = isAgentBusyWith(effectiveSelectedAgentId, agentProfilesStatus?.deletingAgentId);

  useEffect(() => {
    if (focusedAgentId) setSelectedAgentId(focusedAgentId);
  }, [focusedAgentId]);

  useEffect(() => {
    setAgentDrafts((current) => pruneAgentDrafts(current, draftAgentIds, sourceAgentConfigs));
    setDirtyAgentIds((current) => pruneAgentDirtyIds(current, draftAgentIds, sourceAgentConfigs));
  }, [draftAgentIds, sourceAgentConfigs]);

  useEffect(() => {
    const plan = planSelectedAgentSync(effectiveSelectedAgentId, agentConfigs);
    if (plan.kind === 'select') {
      setSelectedAgentId(plan.agentId);
    }
  }, [agentConfigs, effectiveSelectedAgentId]);

  const handlers = buildWorkbenchAgentsRouteHandlers({
    agentConfigs,
    draftAgentIds,
    agentDraftCounter,
    effectiveSelectedAgentId,
    selectedAgentIsDraft,
    selectedAgentDeleting,
    selectedAgentSaving,
    selectedAgentIsDirty,
    translator: t,
    ...(agentProfilesStatus !== undefined ? { agentProfilesStatus } : {}),
    ...(onAgentCreate !== undefined ? { onAgentCreate } : {}),
    ...(onAgentUpdate !== undefined ? { onAgentUpdate } : {}),
    ...(onAgentDelete !== undefined ? { onAgentDelete } : {}),
    setAgentsPane,
    setSelectedAgentId,
    setAgentDrafts,
    setDraftAgentIds,
    setDirtyAgentIds,
    setAgentDraftCounter,
  });

  return {
    agentsPane,
    setAgentsPane,
    agentConfigs,
    realDataMode,
    resolvedModels,
    resolvedSkills,
    resolvedTools,
    effectiveSelectedAgentId,
    selectedAgentIsDirty,
    setSelectedAgentId,
    ...handlers,
  };
}
