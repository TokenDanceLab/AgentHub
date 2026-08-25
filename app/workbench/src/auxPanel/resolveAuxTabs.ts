import {
  AUX_PANEL_TAB_ORDER,
  FOLDER_SCOPED_AUX_TABS,
  type AuxPanelAvailabilityInput,
  type AuxPanelTab,
} from './types';

export function resolveAvailableAuxTabs(input: AuxPanelAvailabilityInput): AuxPanelTab[] {
  const localFiles = input.localFiles !== false;
  const tabs: AuxPanelTab[] = localFiles ? ['session_details'] : [];
  if (input.hasWorkspace && localFiles) {
    tabs.push('file_tree', 'changes');
  }
  if (input.previewAvailable) tabs.push('preview');
  if (input.hasWorkspace && localFiles) tabs.push('git_log');
  return tabs.length > 0 ? tabs : ['session_details'];
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
