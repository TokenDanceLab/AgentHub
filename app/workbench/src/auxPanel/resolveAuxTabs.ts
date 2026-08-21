import {
  AUX_PANEL_TAB_ORDER,
  FOLDER_SCOPED_AUX_TABS,
  type AuxPanelAvailabilityInput,
  type AuxPanelTab,
} from './types';

export function resolveAvailableAuxTabs(input: AuxPanelAvailabilityInput): AuxPanelTab[] {
  const localFiles = input.localFiles !== false;
  if (!input.hasWorkspace || !localFiles) {
    return ['session_details'];
  }
  return [...AUX_PANEL_TAB_ORDER];
}

/**
 * Keep the rendered selection valid when availability shrinks (e.g. workspace closed).
 */
export function resolveEffectiveAuxTab(
  activeTab: AuxPanelTab,
  available: readonly AuxPanelTab[],
): AuxPanelTab {
  if (available.includes(activeTab)) return activeTab;
  return available[0] ?? 'session_details';
}

export function isFolderScopedAuxTab(tab: AuxPanelTab): boolean {
  return (FOLDER_SCOPED_AUX_TABS as readonly string[]).includes(tab);
}
