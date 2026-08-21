/* ═══════════════════════════════════════════════════════════════════════
   InspectorModePanels — residual barrel for evidence overview mappers +
   mode-specific sub-panels used by RightInspector (#731 / #550).

   Pure helpers live in InspectorModePanelHelpers.
   Presentational subcomponents live in InspectorModePanelParts.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  canOpenEvidence,
  evidenceOverviewFiles,
  evidenceOverviewTasks,
  fileTypeFromName,
} from './InspectorModePanelHelpers';

export {
  BrowserPanelFallback,
  DeployStatusBar,
  FilesPanel,
  OverviewContextUsage,
} from './InspectorModePanelParts';
