import { useCallback, useEffect, useState } from 'react';
import { isWorkbenchRealDataMode } from '@shared/demo';
import {
  composerSubmitBehaviorFromLabel,
  composerSubmitBehaviorLabel,
  readComposerSubmitBehavior,
  writeComposerSubmitBehavior,
} from './workbenchPreferences';
import { WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import type { SettingsService } from './settingsService';
import type { SettingsPaneId } from './pages';

export type WorkbenchSettingsValues = typeof WORKBENCH_MOCK_SETTINGS_DEFAULTS;
export type WorkbenchSettingsErrorKind = 'init' | 'write';

export interface UseWorkbenchSettingsRouteOptions {
  settingsService?: SettingsService | null | undefined;
  dataMode?: string | undefined;
}

export interface WorkbenchSettingsRoute {
  realDataMode: boolean;
  settingsPane: SettingsPaneId;
  setSettingsPane: (pane: SettingsPaneId) => void;
  settings: WorkbenchSettingsValues;
  settingsLoading: boolean;
  settingsError: string | null;
  settingsErrorKind: WorkbenchSettingsErrorKind | null;
  handleSettingChange: (key: string, value: string | boolean) => void;
  handleRetrySettingsLoad: () => void;
  handleDismissSettingsError: () => void;
  hasSettingsService: boolean;
}


function isRouteRealDataMode(value: string | undefined): boolean {
  return isWorkbenchRealDataMode(value);
}

function persistedComposerSubmitBehaviorLabel(): string {
  return composerSubmitBehaviorLabel(readComposerSubmitBehavior());
}

export function createSettingsDefaults(): WorkbenchSettingsValues {
  return {
    ...WORKBENCH_MOCK_SETTINGS_DEFAULTS,
    composerSubmitBehavior: persistedComposerSubmitBehaviorLabel(),
  };
}

export function useWorkbenchSettingsRoute({
  settingsService,
  dataMode,
}: UseWorkbenchSettingsRouteOptions): WorkbenchSettingsRoute {
  const realDataMode = isRouteRealDataMode(dataMode);
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('appearance');
  const [settings, setSettings] = useState(createSettingsDefaults);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsErrorKind, setSettingsErrorKind] = useState<WorkbenchSettingsErrorKind | null>(null);

  const syncSettingsServiceState = useCallback(() => {
    if (!settingsService) {
      setSettingsLoading(false);
      setSettingsError(null);
      setSettingsErrorKind(null);
      return;
    }
    setSettings(settingsService.readAll() as WorkbenchSettingsValues);
    setSettingsLoading(settingsService.loading);
    setSettingsError(settingsService.error);
    setSettingsErrorKind(settingsService.errorKind);
  }, [settingsService]);

  // When a settingsService is provided, initialize it and subscribe to remote changes.
  useEffect(() => {
    if (!settingsService) {
      setSettingsLoading(false);
      setSettingsError(null);
      setSettingsErrorKind(null);
      return;
    }
    const unsub = settingsService.subscribe(syncSettingsServiceState);
    syncSettingsServiceState();
    settingsService.init().catch((err) => {
      console.error('settingsService.init failed in WorkbenchRoutes:', err);
      /* init failure is surfaced via settingsService.error */
      syncSettingsServiceState();
    });
    return unsub;
  }, [settingsService, syncSettingsServiceState]);

  const handleRetrySettingsLoad = useCallback(() => {
    if (!settingsService) return;
    settingsService.init().catch((err) => {
      console.error('settingsService.init retry failed in WorkbenchRoutes:', err);
      syncSettingsServiceState();
    });
  }, [settingsService, syncSettingsServiceState]);

  const handleDismissSettingsError = useCallback(() => {
    if (!settingsService) {
      setSettingsError(null);
      setSettingsErrorKind(null);
      return;
    }
    settingsService.clearError();
    syncSettingsServiceState();
  }, [settingsService, syncSettingsServiceState]);

  function handleSettingChange(key: string, value: string | boolean): void {
    if (key === 'composerSubmitBehavior' && typeof value === 'string') {
      writeComposerSubmitBehavior(composerSubmitBehaviorFromLabel(value));
    }
    setSettings((current) => {
      let next: typeof current;
      if (key.startsWith('perm_')) {
        next = {
          ...current,
          permissions: { ...current.permissions, [key.slice(5)]: String(value) },
        };
      } else if (key.startsWith('stateStrategy_')) {
        const strategy = key.slice('stateStrategy_'.length) as keyof typeof current.stateStrategies;
        next = {
          ...current,
          stateStrategies: { ...current.stateStrategies, [strategy]: Boolean(value) },
        };
      } else {
        next = { ...current, [key]: value };
      }
      // Persist to settingsService (fire-and-forget)
      if (settingsService) {
        if (key.startsWith('perm_')) {
          settingsService.write('permissions', next.permissions);
        } else if (key.startsWith('stateStrategy_')) {
          settingsService.write('stateStrategies', next.stateStrategies);
        } else {
          settingsService.write(key, value);
        }
      }
      return next;
    });
  }

  return {
    realDataMode,
    settingsPane,
    setSettingsPane,
    settings,
    settingsLoading,
    settingsError,
    settingsErrorKind,
    handleSettingChange,
    handleRetrySettingsLoad,
    handleDismissSettingsError,
    hasSettingsService: Boolean(settingsService),
  };
}
