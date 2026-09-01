import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildRuntimeEvidenceInspectorModel } from '@shared/inspector';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { PreviewPort } from '@shared/platform';
import type { FileDiff } from '@shared/types/chat';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
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
  /**
   * Platform preview port forwarded to the artifacts section (#1945) so the
   * artifact row can expose a download action on surfaces that own the
   * backing runtime. Optional so fixture/demo shells keep rendering; absent
   * `downloadArtifactContent` degrades to the unavailable notice.
   */
  previewPort?: PreviewPort | undefined;
}

export function RuntimeEvidencePanel({
  runtimeEvidence,
  onOpenDiff,
  onOpenPreviewUrl,
  previewPort,
}: RuntimeEvidencePanelProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const evidenceModel = buildRuntimeEvidenceInspectorModel(runtimeEvidence);
  const diffSummary = evidenceModel.channels.find((channel) => channel.channel === 'diff');
  const artifactSummary = evidenceModel.channels.find((channel) => channel.channel === 'artifacts');
  const previewSummary = evidenceModel.channels.find((channel) => channel.channel === 'previews');

  return (
    <div className={styles.runtimeEvidence}>
      <div className={styles.runtimeEvidenceHead}>
        <strong>{t('inspector.runtimeEvidence')}</strong>
        <span>{evidenceModel.runLabel}</span>
      </div>

      {evidenceModel.stateItems.length > 0 && (
        <ul className={styles.runtimeEvidenceStateList} aria-label={t('aria.runtimeEvidence')}>
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
          previewPort={previewPort}
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
