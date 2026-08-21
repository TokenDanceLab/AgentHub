import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { EvidenceRef, RouteDecisionTranscriptBlock, SubagentTranscriptBlock, SubtaskTranscriptBlock, ChildAgentTranscriptBlock } from '@shared/transcript';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { FileDiff } from '@shared/types/chat';
import type { DagNode } from '@shared/ui/DagTree';
import { buildDagNodesFromTranscript } from '@shared/ui/DagTree';
import { isThemedBlankPreviewUrl } from './inspector/BrowserPreview';
import type { PreviewFile } from './inspector/FilePreviewRouter';
import {
  evidenceOverviewFiles,
  evidenceOverviewTasks,
} from './inspector/InspectorModePanels';
import type { InspectorMode, InspectorTabDef } from './inspector/InspectorTabChrome';
import type { FileItem, TaskItem } from './inspector/OverviewPanel';
import {
  runtimeDiffPreviewFile,
  runtimeEvidenceOverviewFiles,
  runtimeEvidenceOverviewTasks,
} from './inspector/RuntimeEvidencePanel';

/* ═══════════════════════════════════════════════════════════════════════
   rightInspectorHelpers — pure residual slices from RightInspector (#661).

   Tab visibility planners, overview/browser selection mappers, resizer
   handlers, and fallback-mode resolution. No React hooks / no intentional
   UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type InspectorRouteBlock =
  | RouteDecisionTranscriptBlock
  | SubagentTranscriptBlock
  | SubtaskTranscriptBlock
  | ChildAgentTranscriptBlock;

export type ShellBooleanAttr = 'true' | 'false';

export function shellBooleanAttr(value: boolean): ShellBooleanAttr {
  return value ? 'true' : 'false';
}

/** data-preview on the inspector shell: overview is non-preview. */
export function inspectorDataPreviewAttr(activeMode: InspectorMode): ShellBooleanAttr {
  return activeMode === 'overview' ? 'false' : 'true';
}

export function resolveDagNodesFromRouteBlocks(
  routeBlocks: Array<InspectorRouteBlock> | undefined,
): DagNode[] {
  if (!routeBlocks || routeBlocks.length === 0) return [];
  return buildDagNodesFromTranscript(routeBlocks);
}

export function resolveOverviewTasks(
  evidence: EvidenceRef[],
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
): TaskItem[] {
  if (runtimeEvidence) return runtimeEvidenceOverviewTasks(runtimeEvidence);
  return evidenceOverviewTasks(evidence);
}

/** Mark the currently open overview file for OverviewPanel highlight. */
export function resolveOverviewFiles(
  evidence: EvidenceRef[],
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
  openFileName: string | undefined,
): PreviewFile[] {
  const files = runtimeEvidence
    ? runtimeEvidenceOverviewFiles(runtimeEvidence)
    : evidenceOverviewFiles(evidence);
  return files.map((file) => ({
    ...file,
    isOpen: openFileName === file.name,
  }));
}

/** Prefer rich PreviewFile from overview when OverviewPanel only has FileItem. */
export function resolveFileClickTarget(
  overviewFiles: readonly PreviewFile[],
  file: FileItem,
): PreviewFile | FileItem {
  return overviewFiles.find((candidate) => candidate.name === file.name) ?? file;
}

export function resolveRuntimePreviewUrl(
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
): string | undefined {
  return runtimeEvidence?.previews.find((preview) => (
    preview.status === 'ready' && Boolean(preview.url)
  ))?.url;
}

export function resolveBrowserPreviewUrl(
  browserUrl: string | null,
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
  defaultBrowserUrl: string,
): string {
  return browserUrl ?? resolveRuntimePreviewUrl(runtimeEvidence) ?? defaultBrowserUrl;
}

export function withInspectorTab(
  current: ReadonlySet<InspectorMode>,
  mode: InspectorMode,
): Set<InspectorMode> {
  const next = new Set(current);
  next.add(mode);
  return next;
}

export function withoutInspectorTab(
  current: ReadonlySet<InspectorMode>,
  mode: InspectorMode,
): Set<InspectorMode> {
  const next = new Set(current);
  next.delete(mode);
  return next;
}

/**
 * Fallback active mode when closing a tab.
 * Uses pre-close visibleTabs (mode excluded by mode !== closingMode), matching
 * the prior RightInspector closure behavior.
 */
export function resolveFallbackInspectorMode(
  currentMode: InspectorMode,
  closingMode: InspectorMode,
  inspectorTabs: readonly Pick<InspectorTabDef, 'mode'>[],
  visibleTabs: ReadonlySet<InspectorMode>,
): InspectorMode {
  if (currentMode !== closingMode) return currentMode;
  const fallback = inspectorTabs.find((tab) => tab.mode !== closingMode && visibleTabs.has(tab.mode));
  return fallback?.mode ?? 'overview';
}

export interface CloseInspectorTabPlan {
  visibleTabs: Set<InspectorMode>;
  clearPreviewFile: boolean;
  clearBrowserUrl: boolean;
  nextActiveMode: InspectorMode;
}

export function planCloseInspectorTab(input: {
  mode: InspectorMode;
  activeMode: InspectorMode;
  visibleTabs: ReadonlySet<InspectorMode>;
  inspectorTabs: readonly Pick<InspectorTabDef, 'mode'>[];
}): CloseInspectorTabPlan {
  return {
    visibleTabs: withoutInspectorTab(input.visibleTabs, input.mode),
    clearPreviewFile: input.mode === 'files',
    clearBrowserUrl: input.mode === 'browser',
    nextActiveMode: resolveFallbackInspectorMode(
      input.activeMode,
      input.mode,
      input.inspectorTabs,
      input.visibleTabs,
    ),
  };
}

export interface RestoreInspectorTabPlan {
  visibleTabs: Set<InspectorMode>;
  activeMode: InspectorMode;
  quickOpenVisible: false;
}

export function planRestoreInspectorTab(
  current: ReadonlySet<InspectorMode>,
  mode: InspectorMode,
): RestoreInspectorTabPlan {
  return {
    visibleTabs: withInspectorTab(current, mode),
    activeMode: mode,
    quickOpenVisible: false,
  };
}

/**
 * Auto-switch only on NEW real deploy URLs (not re-renders of the same URL).
 * Themed blank placeholders (`about:blank`) must not steal the overview tab
 * — demo fixtures use them for empty browser chrome (#1318 / rescore-9).
 */
export function shouldAutoSwitchDeployPreview(
  deployPreviewUrl: string | undefined,
  browserPreviewEnabled: boolean,
  lastAutoSwitchedUrl: string | null,
): boolean {
  if (!deployPreviewUrl || !browserPreviewEnabled) return false;
  if (isThemedBlankPreviewUrl(deployPreviewUrl)) return false;
  return lastAutoSwitchedUrl !== deployPreviewUrl;
}

export interface DeployAutoSwitchPlan {
  visibleTabs: Set<InspectorMode>;
  browserUrl: string;
  activeMode: 'browser';
  lastAutoSwitchedUrl: string;
}

export function planDeployAutoSwitch(
  currentVisibleTabs: ReadonlySet<InspectorMode>,
  deployPreviewUrl: string,
): DeployAutoSwitchPlan {
  return {
    visibleTabs: withInspectorTab(currentVisibleTabs, 'browser'),
    browserUrl: deployPreviewUrl,
    activeMode: 'browser',
    lastAutoSwitchedUrl: deployPreviewUrl,
  };
}

export interface ReviewFileRequestPlan {
  visibleTabs: Set<InspectorMode>;
  previewFile: FileItem;
  activeMode: 'files';
}

export function planReviewFileRequest(
  currentVisibleTabs: ReadonlySet<InspectorMode>,
  reviewFileRequest: FileItem,
): ReviewFileRequestPlan {
  return {
    visibleTabs: withInspectorTab(currentVisibleTabs, 'files'),
    previewFile: reviewFileRequest,
    activeMode: 'files',
  };
}

export interface OpenPreviewUrlPlan {
  visibleTabs: Set<InspectorMode>;
  browserUrl: string;
  activeMode: 'browser';
}

export function planOpenPreviewUrl(
  currentVisibleTabs: ReadonlySet<InspectorMode>,
  url: string,
): OpenPreviewUrlPlan {
  return {
    visibleTabs: withInspectorTab(currentVisibleTabs, 'browser'),
    browserUrl: url,
    activeMode: 'browser',
  };
}

export function planOpenDiffPreview(
  file: FileDiff,
  runId: string | undefined,
  workDir: string | undefined,
): PreviewFile {
  return runtimeDiffPreviewFile(file, runId, workDir);
}

/**
 * Right-edge inspector resizer: ArrowLeft widens (panel grows leftward),
 * ArrowRight narrows — opposite of left-sidebar resizer direction.
 */
export function createInspectorResizerKeyDownHandler(
  resizeBy: (delta: number) => void,
): (event: ReactKeyboardEvent) => void {
  return (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    resizeBy(event.key === 'ArrowLeft' ? step : -step);
  };
}

export function createInspectorResizerPointerDownHandler(
  collapsed: boolean,
  beginResize: (clientX: number) => void,
): (event: ReactPointerEvent<HTMLDivElement>) => void {
  return (event) => {
    if (collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginResize(event.clientX);
  };
}
