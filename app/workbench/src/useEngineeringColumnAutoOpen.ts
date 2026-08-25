import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { AgentHubPlatform } from '@shared/platform';
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import {
  readEngineeringColumnPreference,
  writeEngineeringColumnPreference,
} from './workbenchPreferences';
import { WORKSPACE_MOUNT_COLLAPSE_INSPECTOR_WIDTH } from './workbenchLayoutConstants';

export interface EngineeringColumnActivityInput {
  isAgentRunning?: boolean | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
}

export function engineeringColumnActivitySignal({
  isAgentRunning,
  runtimeEvidence,
}: EngineeringColumnActivityInput): string | null {
  const loading = runtimeEvidence?.loading;
  const hasActiveRun = Boolean(
    isAgentRunning
      || loading?.diff
      || loading?.artifacts
      || loading?.previews,
  );
  const artifacts = runtimeEvidence?.artifacts ?? [];
  const previews = runtimeEvidence?.previews ?? [];
  const newestArtifact = artifacts.at(-1);
  const newestPreview = previews.at(-1);
  if (!hasActiveRun && !newestArtifact && !newestPreview) return null;
  return [
    hasActiveRun ? `run:${runtimeEvidence?.runId ?? 'active'}` : 'run:none',
    newestArtifact ? `artifact:${newestArtifact.id}:${newestArtifact.createdAt ?? ''}` : 'artifact:none',
    newestPreview
      ? `preview:${newestPreview.id}:${newestPreview.status}:${newestPreview.url ?? ''}`
      : 'preview:none',
  ].join('|');
}

export function canAutoOpenEngineeringColumn(
  surface: AgentHubPlatform['surface'],
  viewportWidth: number,
): boolean {
  if (surface === 'mobile') return false;
  if (surface === 'desktop') return viewportWidth >= WORKSPACE_MOUNT_COLLAPSE_INSPECTOR_WIDTH;
  return viewportWidth >= 720;
}

export function useEngineeringColumnAutoOpen(params: {
  conversationId: string;
  isChatPage: boolean;
  platformSurface: AgentHubPlatform['surface'];
  activitySignal: string | null;
  layout: WorkbenchPanelLayout;
}): {
  layout: WorkbenchPanelLayout;
  toggleInspector: () => void;
} {
  const {
    conversationId,
    isChatPage,
    platformSurface,
    activitySignal,
    layout,
  } = params;
  const previousConversationId = useRef<string | null>(null);
  const consumedSignals = useRef(new Map<string, string>());

  useEffect(() => {
    if (!isChatPage || !conversationId) return;
    const preference = readEngineeringColumnPreference(conversationId);
    const switchedConversation = previousConversationId.current !== conversationId;
    previousConversationId.current = conversationId;

    if (switchedConversation && preference) {
      if (preference.collapsed) layout.closeInspector();
      else layout.openInspector();
    }

    if (!activitySignal || preference?.autoOpenSuppressed) return;
    const alreadyConsumed = consumedSignals.current.get(conversationId) === activitySignal;
    if (alreadyConsumed && !switchedConversation) return;
    consumedSignals.current.set(conversationId, activitySignal);

    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    if (!canAutoOpenEngineeringColumn(platformSurface, viewportWidth)) return;
    layout.openInspector();
    writeEngineeringColumnPreference(conversationId, {
      collapsed: false,
      autoOpenSuppressed: false,
    });
  }, [
    activitySignal,
    conversationId,
    isChatPage,
    layout.closeInspector,
    layout.openInspector,
    platformSurface,
  ]);

  const toggleInspector = useCallback((): void => {
    const nextCollapsed = !layout.inspectorCollapsed;
    if (conversationId) {
      writeEngineeringColumnPreference(conversationId, {
        collapsed: nextCollapsed,
        // Suppression is created only when the user closes an active surface.
        // Closing an idle chat still allows its first future run to auto-open.
        autoOpenSuppressed: nextCollapsed && Boolean(activitySignal),
      });
    }
    if (nextCollapsed) layout.closeInspector();
    else layout.openInspector();
  }, [activitySignal, conversationId, layout.closeInspector, layout.inspectorCollapsed, layout.openInspector]);

  const managedLayout = useMemo<WorkbenchPanelLayout>(
    () => ({ ...layout, toggleInspector }),
    [layout, toggleInspector],
  );

  return { layout: managedLayout, toggleInspector };
}
