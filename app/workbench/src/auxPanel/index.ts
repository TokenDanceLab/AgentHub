export type { AuxPanelTab, AuxPanelAvailabilityInput } from './types';
export { AUX_PANEL_TAB_ORDER, FOLDER_SCOPED_AUX_TABS } from './types';
export {
  isFolderScopedAuxTab,
  resolveAvailableAuxTabs,
  resolveEffectiveAuxTab,
} from './resolveAuxTabs';
export { AuxPanel, type AuxPanelProps } from './AuxPanel';
