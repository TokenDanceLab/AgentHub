import React from 'react';
import { buildRuntimeEvidenceInspectorModel } from '@shared/inspector';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { FileDiff } from '@shared/types/chat';
import styles from '../AgentHubWorkbench.module.css';
import {
  RuntimeEvidenceArtifactsSection,
  RuntimeEvidenceDiffSection,
  RuntimeEvidenceEmptyState,
  RuntimeEvidencePreviewsSection,
} from './RuntimeEvidenceParts';

export {
  fileDiffToText,
  runtimeDiffPreviewFile,
  runtimeEvidenceOverviewFiles,
  runtimeEvidenceOverviewKicker,
  runtimeEvidenceOverviewTasks,
} from './RuntimeEvidenceHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   RuntimeEvidencePanel — Hub-replay runtime evidence files-mode host.

   Residual helpers/parts live in RuntimeEvidenceHelpers /
   RuntimeEvidenceParts (#733). CSS remains on shared
   AgentHubWorkbench.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface RuntimeEvidencePanelProps {
  runtimeEvidence: RuntimeEvidenceSnapshot;
  onOpenDiff: (file: FileDiff) => void;
  onOpenPreviewUrl: (url: string) => void;
}

export function RuntimeEvidencePanel({
  runtimeEvidence,
  onOpenDiff,
  onOpenPreviewUrl,
}: RuntimeEvidencePanelProps): React.ReactElement {
  const evidenceModel = buildRuntimeEvidenceInspectorModel(runtimeEvidence);
  const diffSummary = evidenceModel.channels.find((channel) => channel.channel === 'diff');
  const artifactSummary = evidenceModel.channels.find((channel) => channel.channel === 'artifacts');
  const previewSummary = evidenceModel.channels.find((channel) => channel.channel === 'previews');

  return (
    <div className={styles.runtimeEvidence}>
      <div className={styles.runtimeEvidenceHead}>
        <strong>运行证据</strong>
        <span>{evidenceModel.runLabel}</span>
      </div>

      {evidenceModel.stateItems.length > 0 && (
        <ul className={styles.runtimeEvidenceStateList} aria-label="Runtime evidence state">
          {evidenceModel.stateItems.map((item) => (
            <li key={`${item.kind}-${item.channel}`} className={styles.runtimeEvidenceState} data-state={item.kind}>{item.label}</li>
          ))}
        </ul>
      )}

      {!evidenceModel.hasEvidence && evidenceModel.stateItems.length === 0 && (
        <RuntimeEvidenceEmptyState
          emptyDetail={evidenceModel.emptyDetail}
          emptyTitle={evidenceModel.emptyTitle}
        />
      )}

      {runtimeEvidence.diffs.length > 0 && (
        <RuntimeEvidenceDiffSection
          count={diffSummary?.count}
          diffs={runtimeEvidence.diffs}
          onOpenDiff={onOpenDiff}
          sourceLabel={diffSummary?.sourceLabel}
        />
      )}

      {runtimeEvidence.artifacts.length > 0 && (
        <RuntimeEvidenceArtifactsSection
          artifacts={runtimeEvidence.artifacts}
          count={artifactSummary?.count}
          diffCount={runtimeEvidence.diffs.length}
          previews={runtimeEvidence.previews}
          runId={runtimeEvidence.runId}
          sourceLabel={artifactSummary?.sourceLabel}
        />
      )}

      {runtimeEvidence.previews.length > 0 && (
        <RuntimeEvidencePreviewsSection
          count={previewSummary?.count}
          onOpenPreviewUrl={onOpenPreviewUrl}
          previews={runtimeEvidence.previews}
          sourceLabel={previewSummary?.sourceLabel}
        />
      )}
    </div>
  );
}
