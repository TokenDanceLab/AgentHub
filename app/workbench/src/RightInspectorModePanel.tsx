import React from 'react';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { PreviewPort } from '@shared/platform';
import type { EvidenceRef, ContextUsageTranscriptBlock } from '@shared/transcript';
import {
  BrowserModeBody,
  FilesModeBody,
  OverviewModeBody,
  type FileItem,
  type InspectorMode,
  type PreviewFile,
  type RunResultInfo,
  type TaskItem,
} from './inspector';
import type { DagNode } from '@shared/ui/DagTree';
import type { FileDiff } from '@shared/types/chat';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   RightInspectorModePanel — mode tabpanel bodies for RightInspector (#661).

   Pure presentational host for overview / browser / files mode content.
   No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface RightInspectorModePanelProps {
  activeMode: InspectorMode;
  visibleTabs: ReadonlySet<InspectorMode>;
  contextBlocks: ContextUsageTranscriptBlock[] | undefined;
  dagNodes: DagNode[];
  overviewFiles: PreviewFile[];
  overviewTasks: TaskItem[];
  runResult: RunResultInfo | undefined;
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined;
  artifacts: EvidenceRef[];
  browserPreviewEnabled: boolean;
  browserPreviewUrl: string;
  canOpenPreview: ((evidence: EvidenceRef) => boolean) | undefined;
  deployPreviewUrl: string | undefined;
  deployStatus: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed' | undefined;
  files: EvidenceRef[];
  previewFile: PreviewFile | null;
  /** Platform preview port for the file preview router (#1817). */
  previewPort?: PreviewPort | undefined;
  onFileClick: (file: FileItem) => void;
  onClosePreview: () => void;
  onOpenPreview: ((evidence: EvidenceRef) => Promise<void>) | undefined;
  onOpenUrl: (url: string) => void;
  onOpenDiff: (file: FileDiff) => void;
  onOpenPreviewUrl: (url: string) => void;
}

export function RightInspectorModePanel({
  activeMode,
  visibleTabs,
  contextBlocks,
  dagNodes,
  overviewFiles,
  overviewTasks,
  runResult,
  runtimeEvidence,
  artifacts,
  browserPreviewEnabled,
  browserPreviewUrl,
  canOpenPreview,
  deployPreviewUrl,
  deployStatus,
  files,
  previewFile,
  previewPort,
  onFileClick,
  onClosePreview,
  onOpenPreview,
  onOpenUrl,
  onOpenDiff,
  onOpenPreviewUrl,
}: RightInspectorModePanelProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.inspectorPanel} role="tabpanel">
      {visibleTabs.size === 0 && (
        <p className={styles.inspectorEmpty}>{t('inspector.emptyPanel')}</p>
      )}

      {activeMode === 'overview' && visibleTabs.has('overview') && (
        <OverviewModeBody
          contextBlocks={contextBlocks}
          dagNodes={dagNodes}
          overviewFiles={overviewFiles}
          overviewTasks={overviewTasks}
          runResult={runResult}
          runtimeEvidence={runtimeEvidence}
          onFileClick={onFileClick}
        />
      )}

      {activeMode === 'browser' && visibleTabs.has('browser') && (
        <BrowserModeBody
          artifacts={artifacts}
          browserPreviewEnabled={browserPreviewEnabled}
          browserPreviewUrl={browserPreviewUrl}
          canOpenPreview={canOpenPreview}
          deployPreviewUrl={deployPreviewUrl}
          deployStatus={deployStatus}
          onClose={onClosePreview}
          onOpenPreview={onOpenPreview}
          onOpenUrl={onOpenUrl}
        />
      )}

      {activeMode === 'files' && visibleTabs.has('files') && (
        <FilesModeBody
          canOpenPreview={canOpenPreview}
          files={files}
          overviewFiles={overviewFiles}
          previewFile={previewFile}
          previewPort={previewPort}
          runtimeEvidence={runtimeEvidence}
          onClose={onClosePreview}
          onFallbackFileClick={onFileClick}
          onOpenDiff={onOpenDiff}
          onOpenPreview={onOpenPreview}
          onOpenPreviewUrl={onOpenPreviewUrl}
        />
      )}
    </div>
  );
}
