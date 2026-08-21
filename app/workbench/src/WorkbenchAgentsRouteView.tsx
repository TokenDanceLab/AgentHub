import React, { useMemo } from 'react';
import type { WorkbenchAgent } from '@shared/platform';
import type { AgentConfig, SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import { AgentsPage } from './pages/AgentsPage';
import {
  WORKBENCH_MOCK_AGENT_AUDIT_ROWS,
  WORKBENCH_MOCK_AGENT_MODEL_HEALTH,
  WORKBENCH_MOCK_AGENT_POLICY_RULES,
  WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
} from './mockData';
import type {
  WorkbenchAgentsRoute,
  WorkbenchAgentsRouteStatus,
} from './useWorkbenchAgentsRoute';
import { buildAgentsPageDerivedModel } from './workbenchAgentsPageModel';

export interface WorkbenchAgentsRouteViewProps {
  agents?: WorkbenchAgent[] | undefined;
  agentsRoute: WorkbenchAgentsRoute;
  agentProfilesStatus?: WorkbenchAgentsRouteStatus | undefined;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  skillMarketItems?: SkillMarketItem[] | undefined;
  skillMarketLoading?: boolean | undefined;
  mcpMarketItems?: MCPMarketItem[] | undefined;
  mcpMarketLoading?: boolean | undefined;
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
}

/** Thin agents route shell: pure model + AgentsPage prop wiring. */
export function WorkbenchAgentsRouteView({
  agents,
  agentsRoute,
  agentProfilesStatus,
  onAgentProfileOpen,
  onAgentsRetry,
  skillMarketItems,
  skillMarketLoading,
  mcpMarketItems,
  mcpMarketLoading,
  ccSwitchStatus,
  ccSwitchProviders,
}: WorkbenchAgentsRouteViewProps): React.ReactElement {
  const model = useMemo(
    () => buildAgentsPageDerivedModel(
      agentsRoute.agentConfigs,
      agentsRoute.resolvedTools,
      agents !== undefined,
    ),
    [agents, agentsRoute.agentConfigs, agentsRoute.resolvedTools],
  );

  return (
    <AgentsPage
      activePane={agentsRoute.agentsPane}
      agents={agentsRoute.agentConfigs}
      agentActionError={agentProfilesStatus?.actionError}
      agentsError={agentProfilesStatus?.error}
      agentsLoading={agentProfilesStatus?.loading}
      allSkills={agentsRoute.resolvedSkills}
      allTools={agentsRoute.resolvedTools}
      auditEntries={WORKBENCH_MOCK_AGENT_AUDIT_ROWS}
      confirmCount={model.confirmCount}
      defaultModelLabel={model.defaultModelLabel}
      installedCount={model.installedCount}
      marketFeatured={model.marketFeatured}
      marketTemplates={model.marketTemplates}
      modelHealthRows={WORKBENCH_MOCK_AGENT_MODEL_HEALTH}
      modelRoutes={model.modelRoutes}
      models={agentsRoute.resolvedModels}
      onPaneChange={agentsRoute.setAgentsPane}
      onAgentAdd={agentsRoute.handleAgentAdd}
      onAgentDelete={agentsRoute.handleAgentDelete}
      onAgentFieldChange={agentsRoute.handleAgentFieldChange}
      onAgentProfileOpen={onAgentProfileOpen}
      onAgentSave={agentsRoute.handleAgentSave}
      onAgentSelect={agentsRoute.setSelectedAgentId}
      onAgentSkillToggle={agentsRoute.handleAgentSkillToggle}
      onMarketInstall={agentsRoute.handleMarketInstall}
      onAgentsRetry={onAgentsRetry}
      onToolPermissionSet={agentsRoute.handleToolPermissionSet}
      policyRules={WORKBENCH_MOCK_AGENT_POLICY_RULES}
      recentShortcuts={model.recentShortcuts}
      runnableCount={model.runnableCount}
      saveStateLabel={agentsRoute.agentSaveStateLabel()}
      isDirty={agentsRoute.selectedAgentIsDirty}
      savingAgentId={agentProfilesStatus?.savingAgentId}
      deletingAgentId={agentProfilesStatus?.deletingAgentId}
      toolMatrixAgents={model.toolMatrixAgents}
      toolMatrixTools={WORKBENCH_MOCK_AGENT_TOOL_OPTIONS}
      {...(agentsRoute.effectiveSelectedAgentId ? { selectedAgentId: agentsRoute.effectiveSelectedAgentId } : {})}
      skillMarketItems={skillMarketItems ?? []}
      skillMarketLoading={skillMarketLoading ?? false}
      mcpMarketItems={mcpMarketItems ?? []}
      mcpMarketLoading={mcpMarketLoading ?? false}
      ccSwitchStatus={ccSwitchStatus}
      ccSwitchProviders={ccSwitchProviders}
    />
  );
}
