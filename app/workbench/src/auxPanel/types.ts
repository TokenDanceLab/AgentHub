/**
 * Aux panel tabs for local engineering-loop chrome (#1172).
 * Folder-scoped tabs require an open workspace; content is slot-driven only.
 */

export type AuxPanelTab = 'session_details' | 'file_tree' | 'changes' | 'git_log';

export const AUX_PANEL_TAB_ORDER: readonly AuxPanelTab[] = [
  'session_details',
  'file_tree',
  'changes',
  'git_log',
] as const;

export const FOLDER_SCOPED_AUX_TABS: readonly AuxPanelTab[] = [
  'file_tree',
  'changes',
  'git_log',
] as const;

export type AuxPanelAvailabilityInput = {
  /** True when a local workspace/folder is open (Desktop + localFiles). */
  hasWorkspace: boolean;
  /** When false (Web), folder-scoped tabs stay hidden. Defaults true for Desktop. */
  localFiles?: boolean;
};
