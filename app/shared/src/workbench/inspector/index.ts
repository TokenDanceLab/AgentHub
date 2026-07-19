/* ═══ Inspector panels barrel exports ═══ */

export { OverviewPanel } from './OverviewPanel';
export type { OverviewPanelProps, TaskItem, FileItem, RunResultInfo } from './OverviewPanel';

export { FilePreview } from './FilePreview';
export type { FilePreviewProps } from './FilePreview';

export { FilePreviewRouter } from './FilePreviewRouter';
export type { FilePreviewRouterProps, PreviewFile } from './FilePreviewRouter';

export {
  BrowserPreview,
  THEMED_BLANK_PREVIEW_SRCDOC,
  THEMED_BLANK_PREVIEW_SRCDOC_DARK,
  THEMED_BLANK_PREVIEW_SRCDOC_LIGHT,
  buildThemedBlankPreviewSrcDoc,
  isThemedBlankPreviewUrl,
} from './BrowserPreview';
export type { BrowserPreviewProps } from './BrowserPreview';

export {
  RuntimeEvidencePanel,
  runtimeDiffPreviewFile,
  runtimeEvidenceOverviewFiles,
  runtimeEvidenceOverviewKicker,
  runtimeEvidenceOverviewTasks,
  fileDiffToText,
} from './RuntimeEvidencePanel';
export type { RuntimeEvidencePanelProps } from './RuntimeEvidencePanel';

export {
  BrowserPanelFallback,
  DeployStatusBar,
  FilesPanel,
  OverviewContextUsage,
  canOpenEvidence,
  evidenceOverviewFiles,
  evidenceOverviewTasks,
  fileTypeFromName,
} from './InspectorModePanels';

export {
  BrowserModeBody,
  FilesModeBody,
  OverviewModeBody,
} from './InspectorModeBodies';
export type {
  BrowserModeBodyProps,
  FilesModeBodyProps,
  OverviewModeBodyProps,
} from './InspectorModeBodies';

export {
  InspectorMonitorHead,
  defaultVisibleTabs,
  getInspectorTabs,
  getQuickOpenItems,
  inspectorTabLabel,
} from './InspectorTabChrome';
export type {
  InspectorMode,
  InspectorMonitorHeadProps,
  InspectorTabDef,
} from './InspectorTabChrome';
