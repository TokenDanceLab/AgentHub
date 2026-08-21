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

/** localStorage key for the persisted inspector width (px number). */
export const INSPECTOR_WIDTH_STORAGE_KEY = 'agenthub.workbench.inspectorWidth';
/** localStorage key for the persisted inspector collapsed state ('true'/'false'). */
export const INSPECTOR_COLLAPSED_STORAGE_KEY = 'agenthub.workbench.inspectorCollapsed';
/** Window CustomEvent: settings (inspectorVisible=false) ask the inspector to start collapsed. */
export const INSPECTOR_DEFAULT_COLLAPSE_EVENT = 'agenthub:inspector-default-collapse';
