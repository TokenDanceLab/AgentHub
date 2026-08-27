export const INSPECTOR_MIN_WIDTH = 48;
export const INSPECTOR_MAX_WIDTH = 760;
export const INSPECTOR_DEFAULT_WIDTH = 400;
export const INSPECTOR_READABLE_WIDTH = 360;
export const INSPECTOR_COLLAPSE_SNAP_WIDTH = 96;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_COLLAPSE_SNAP_WIDTH = 96;
export const WORKSPACE_AUTO_COLLAPSE_WIDTH = 560;
// Narrow-window mount threshold (#1874): collapse the sidebar on first render only
// when the chat column would be crushed below this width. Deliberately tighter than
// the live-resize comfort threshold above so a 1024px desktop window keeps its shell.
export const WORKSPACE_MOUNT_COLLAPSE_WIDTH = 200;
// Narrow-window mount threshold for the inspector (#1910 follow-up): on first
// render of a Desktop chat page, collapse the inspector below this viewport width
// so its fixed 400px column does not crush the chat main area at e.g. 800px.
export const WORKSPACE_MOUNT_COLLAPSE_INSPECTOR_WIDTH = 880;

/** localStorage key for the persisted inspector width (px number). */
export const INSPECTOR_WIDTH_STORAGE_KEY = 'agenthub.workbench.inspectorWidth';
/** localStorage key for the persisted inspector collapsed state ('true'/'false'). */
export const INSPECTOR_COLLAPSED_STORAGE_KEY = 'agenthub.workbench.inspectorCollapsed';
/** Window CustomEvent: settings (inspectorVisible=false) ask the inspector to start collapsed. */
export const INSPECTOR_DEFAULT_COLLAPSE_EVENT = 'agenthub:inspector-default-collapse';

/** localStorage key for the persisted split-view layout tree blob (#1997). */
export const SPLIT_LAYOUT_STORAGE_KEY = 'agenthub.workbench.splitLayout';
