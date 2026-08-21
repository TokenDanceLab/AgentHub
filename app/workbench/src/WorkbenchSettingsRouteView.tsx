import React, { useMemo } from 'react';
import type { LocalCliDiscoveryManifest, RuntimeSessionSummary } from '@shared/platform';
import { SettingsPage } from './pages/SettingsPage';
import type { WorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';
import { buildSettingsPageProps } from './workbenchRoutesHelpers';

export interface WorkbenchSettingsRouteViewProps {
  settingsRoute: WorkbenchSettingsRoute;
  localCliDiscovery?: LocalCliDiscoveryManifest | null | undefined;
  sessionImportItems?: RuntimeSessionSummary[] | undefined;
  sessionImportLoading?: boolean | undefined;
  sessionImportError?: string | null | undefined;
  sessionImportVisible?: boolean | undefined;
  onRefreshSessionImport?: (() => void) | undefined;
  userDisplayName?: string | undefined;
  onOpenAgentConfig: () => void;
}

/** Thin settings route shell: pure props builder + SettingsPage wiring. */
export function WorkbenchSettingsRouteView({
  settingsRoute,
  localCliDiscovery,
  sessionImportItems,
  sessionImportLoading,
  sessionImportError,
  sessionImportVisible,
  onRefreshSessionImport,
  userDisplayName,
  onOpenAgentConfig,
}: WorkbenchSettingsRouteViewProps): React.ReactElement {
  const props = useMemo(
    () => buildSettingsPageProps({
      settingsRoute,
      localCliDiscovery,
      sessionImportItems,
      sessionImportLoading,
      sessionImportError,
      sessionImportVisible,
      onRefreshSessionImport,
      userDisplayName,
      onOpenAgentConfig,
    }),
    [
      localCliDiscovery,
      onOpenAgentConfig,
      onRefreshSessionImport,
      sessionImportError,
      sessionImportItems,
      sessionImportLoading,
      sessionImportVisible,
      settingsRoute,
      userDisplayName,
    ],
  );

  return <SettingsPage {...props} />;
}
