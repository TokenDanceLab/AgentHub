import React, { useMemo } from 'react';
import type { LocalCliDiscoveryManifest } from '../platform';
import { SettingsPage } from './pages/SettingsPage';
import type { WorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';
import { buildSettingsPageProps } from './workbenchRoutesHelpers';

export interface WorkbenchSettingsRouteViewProps {
  settingsRoute: WorkbenchSettingsRoute;
  localCliDiscovery?: LocalCliDiscoveryManifest | null | undefined;
  userDisplayName?: string | undefined;
  onOpenAgentConfig: () => void;
}

/** Thin settings route shell: pure props builder + SettingsPage wiring. */
export function WorkbenchSettingsRouteView({
  settingsRoute,
  localCliDiscovery,
  userDisplayName,
  onOpenAgentConfig,
}: WorkbenchSettingsRouteViewProps): React.ReactElement {
  const props = useMemo(
    () => buildSettingsPageProps({
      settingsRoute,
      localCliDiscovery,
      userDisplayName,
      onOpenAgentConfig,
    }),
    [localCliDiscovery, onOpenAgentConfig, settingsRoute, userDisplayName],
  );

  return <SettingsPage {...props} />;
}
