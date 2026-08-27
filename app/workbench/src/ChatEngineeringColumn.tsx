import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import type {
  AgentHubPlatform,
  RuntimeSessionSummary,
  WorkspaceFileEntry,
  WorkspaceGitChange,
  WorkspaceGitCommit,
} from '@shared/platform';
import {
  BrowserPreview,
  FilePreviewRouter,
  runtimeEvidenceOverviewFiles,
  type PreviewFile,
} from './inspector';
import {
  AuxPanel,
  resolveAvailableAuxTabs,
  resolveEffectiveAuxTab,
  type AuxPanelTab,
} from './auxPanel';
import { WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT } from './desktopChromeEvents';
import { WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, type EngineeringPreviewFocusDetail } from './workbenchPreviewEvents';
import shellStyles from './AgentHubWorkbench.module.css';
import styles from './ChatEngineeringColumn.module.css';

export type ChatEngineeringColumnProps = {
  inspector: React.ReactNode;
  hasWorkspace: boolean;
  localFiles: boolean;
  conversationId: string;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  platform?: AgentHubPlatform | undefined;
  workDir?: string | undefined;
  /** #1823: when the inspector column is collapsed, the whole column —
   * including the AuxPanel tab strip below the inspector — leaves the
   * keyboard/AT order. */
  inspectorCollapsed?: boolean | undefined;
};

export function engineeringPreviewSignal(
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
): string | null {
  const artifact = runtimeEvidence?.artifacts.at(-1);
  const preview = runtimeEvidence?.previews.at(-1);
  if (!artifact && !preview) return null;
  return [
    artifact ? `artifact:${artifact.id}:${artifact.createdAt ?? ''}` : 'artifact:none',
    preview ? `preview:${preview.id}:${preview.status}:${preview.url ?? ''}` : 'preview:none',
  ].join('|');
}

export function resolveEngineeringPreview(
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
  focus?: Pick<EngineeringPreviewFocusDetail, 'artifactId' | 'artifactRunId'> | undefined,
): { kind: 'browser'; url: string } | { kind: 'file'; file: PreviewFile } | null {
  if (!runtimeEvidence) return null;
  const artifactFiles = runtimeEvidenceOverviewFiles(runtimeEvidence).slice(
    0,
    runtimeEvidence.artifacts.length,
  );

  // A user click is stronger than the automatic "newest evidence" rule. If
  // the requested artifact is not in the current snapshot, return null rather
  // than silently showing a different artifact (F10 honesty contract).
  if (focus) {
    const index = runtimeEvidence.artifacts.findIndex((artifact) => (
      artifact.id === focus.artifactId
      && (!focus.artifactRunId || !artifact.runId || artifact.runId === focus.artifactRunId)
    ));
    const focusedFile = index >= 0 ? artifactFiles[index] : undefined;
    return focusedFile ? { kind: 'file', file: focusedFile } : null;
  }

  const browserPreview = [...runtimeEvidence.previews]
    .reverse()
    .find((preview) => preview.status === 'ready' && Boolean(preview.url));
  if (browserPreview?.url) return { kind: 'browser', url: browserPreview.url };
  const file = artifactFiles.at(-1);
  return file ? { kind: 'file', file } : null;
}

/**
 * Engineering-loop column: inspector detail above, fast-switch aux surface below.
 * Preview follows the newest normalized artifact/preview but never changes the
 * inspector's selected detail mode. The explicit "details" action is the only
 * bridge that asks RightInspector to switch, preventing two surfaces from
 * fighting for focus (#1966).
 */
export function ChatEngineeringColumn({
  inspector,
  hasWorkspace,
  localFiles,
  conversationId,
  runtimeEvidence,
  platform,
  workDir,
  inspectorCollapsed,
}: ChatEngineeringColumnProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const [focusedArtifact, setFocusedArtifact] = useState<
    Pick<EngineeringPreviewFocusDetail, 'artifactId' | 'artifactRunId'> | undefined
  >(undefined);
  const preview = useMemo(
    () => resolveEngineeringPreview(runtimeEvidence, focusedArtifact),
    [focusedArtifact, runtimeEvidence],
  );
  const previewSignal = engineeringPreviewSignal(runtimeEvidence);
  const previewAvailable = localFiles || Boolean(previewSignal);
  const available = useMemo(
    () => resolveAvailableAuxTabs({ hasWorkspace, localFiles, previewAvailable }),
    [hasWorkspace, localFiles, previewAvailable],
  );
  const [activeTab, setActiveTab] = useState<AuxPanelTab>(() =>
    previewSignal ? 'preview' : available[0] ?? 'session_details',
  );
  const activeTabByConversation = useRef(new Map<string, AuxPanelTab>());
  const consumedPreviewSignals = useRef(new Map<string, string>());
  const effective = resolveEffectiveAuxTab(activeTab, available);
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [changes, setChanges] = useState<WorkspaceGitChange[]>([]);
  const [commits, setCommits] = useState<WorkspaceGitCommit[]>([]);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionSummary[]>([]);

  const labels = useMemo<Record<AuxPanelTab, string>>(() => ({
    session_details: t('engineering.session'),
    file_tree: t('engineering.files'),
    changes: t('engineering.changes'),
    preview: t('engineering.preview'),
    git_log: t('engineering.commits'),
  }), [t]);

  const selectTab = useCallback((tab: AuxPanelTab): void => {
    activeTabByConversation.current.set(conversationId, tab);
    setActiveTab(tab);
  }, [conversationId]);

  // F10: transcript artifact clicks arrive as a transient, conversation-
  // scoped UI intent. The engineering column owns the selection and Preview
  // tab; RightInspector and transcript state are intentionally untouched.
  useEffect(() => {
    const handlePreviewFocus = (event: Event): void => {
      const detail = (event as CustomEvent<EngineeringPreviewFocusDetail>).detail;
      if (!detail || detail.conversationId !== conversationId || !detail.artifactId) return;
      setFocusedArtifact({
        artifactId: detail.artifactId,
        ...(detail.artifactRunId ? { artifactRunId: detail.artifactRunId } : {}),
      });
      activeTabByConversation.current.set(conversationId, 'preview');
      setActiveTab('preview');
    };
    window.addEventListener(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, handlePreviewFocus);
    return () => window.removeEventListener(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, handlePreviewFocus);
  }, [conversationId]);

  useEffect(() => {
    setFocusedArtifact(undefined);
    const remembered = activeTabByConversation.current.get(conversationId);
    setActiveTab(remembered ?? (previewSignal ? 'preview' : available[0] ?? 'session_details'));
  }, [conversationId]); // available and signal are handled by the effects below.

  useEffect(() => {
    if (effective !== activeTab) setActiveTab(effective);
  }, [effective, activeTab]);

  useEffect(() => {
    if (!previewSignal) return;
    if (consumedPreviewSignals.current.get(conversationId) === previewSignal) return;
    consumedPreviewSignals.current.set(conversationId, previewSignal);
    activeTabByConversation.current.set(conversationId, 'preview');
    setActiveTab('preview');
  }, [conversationId, previewSignal]);

  useEffect(() => {
    if (!platform?.workspaceFiles?.list && !platform?.workspaceGit?.listChanges && !platform?.workspaceGit?.listLog) {
      return undefined;
    }
    let cancelled = false;
    const root = workDir?.trim() || undefined;
    (async () => {
      try {
        const nextFiles = (await platform?.workspaceFiles?.list?.(root)) ?? [];
        const nextChanges = (await platform?.workspaceGit?.listChanges?.(root)) ?? [];
        const nextCommits = (await platform?.workspaceGit?.listLog?.(root, 30)) ?? [];
        if (!cancelled) {
          setFiles(nextFiles);
          setChanges(nextChanges);
          setCommits(nextCommits);
        }
      } catch {
        if (!cancelled) {
          setFiles([]);
          setChanges([]);
          setCommits([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, workDir, hasWorkspace]);

  useEffect(() => {
    if (!platform?.host?.listRuntimeSessions) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const next = (await platform.host?.listRuntimeSessions?.()) ?? [];
        if (!cancelled) setRuntimeSessions(next);
      } catch {
        if (!cancelled) setRuntimeSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const openPreviewDetails = useCallback((): void => {
    window.dispatchEvent(new CustomEvent(WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT, {
      detail: { mode: preview?.kind === 'browser' ? 'browser' : 'files' },
    }));
  }, [preview?.kind]);

  return (
    <div
      className={[shellStyles.engineeringColumn, styles.column].filter(Boolean).join(' ')}
      data-testid="chat-engineering-column"
      data-local-files={localFiles ? 'true' : 'false'}
      data-has-workspace={hasWorkspace ? 'true' : 'false'}
      data-preview-signal={previewSignal ?? 'none'}
      {...(inspectorCollapsed ? { inert: true } : {})}
    >
      <div className={styles.inspectorSlot}>{inspector}</div>
      <div className={styles.auxSlot}>
        <AuxPanel
          hasWorkspace={hasWorkspace}
          localFiles={localFiles}
          previewAvailable={previewAvailable}
          activeTab={effective}
          onActiveTabChange={selectTab}
          labels={labels}
        >
          {{
            session_details: (
              <ul className={styles.list} data-testid="aux-session-details">
                {runtimeSessions.length === 0 ? (
                  <li className={styles.placeholder}>{t('engineering.noSessions')}</li>
                ) : (
                  runtimeSessions.map((session) => (
                    <li key={session.id} className={styles.listItem}>
                      <span className={styles.kind}>{session.runtime}</span>
                      {session.title ?? session.path ?? session.id}
                    </li>
                  ))
                )}
              </ul>
            ),
            file_tree: (
              <ul className={styles.list} data-testid="aux-file-tree">
                {files.length === 0 ? (
                  <li className={styles.placeholder}>{t('engineering.filesHostOnly')}</li>
                ) : (
                  files.map((file) => (
                    <li key={file.path} className={styles.listItem}>
                      <span className={styles.kind}>{file.kind === 'dir' ? 'DIR' : 'FILE'}</span>
                      {file.path}
                    </li>
                  ))
                )}
              </ul>
            ),
            changes: (
              <ul className={styles.list} data-testid="aux-git-changes">
                {changes.length === 0 ? (
                  <li className={styles.placeholder}>{t('engineering.changesHostOnly')}</li>
                ) : (
                  changes.map((change) => (
                    <li key={change.path} className={styles.listItem}>
                      <span className={styles.status}>{change.status}</span>
                      {change.path}
                    </li>
                  ))
                )}
              </ul>
            ),
            preview: (
              <div className={styles.previewPane} data-testid="engineering-preview-pane">
                <div className={styles.previewToolbar}>
                  <span>{t('engineering.previewLatest')}</span>
                  <button
                    type="button"
                    className={styles.previewDetailButton}
                    disabled={!preview}
                    onClick={openPreviewDetails}
                  >
                    {t('engineering.openDetails')}
                  </button>
                </div>
                <div className={styles.previewBody}>
                  {!preview ? (
                    <div className={styles.placeholder}>{t('engineering.previewUnavailable')}</div>
                  ) : preview.kind === 'browser' ? (
                    <BrowserPreview url={preview.url} onClose={() => undefined} />
                  ) : (
                    <FilePreviewRouter
                      file={preview.file}
                      previewPort={platform?.preview}
                      onClose={() => selectTab(available[0] ?? 'session_details')}
                    />
                  )}
                </div>
              </div>
            ),
            git_log: (
              <ul className={styles.list} data-testid="aux-git-log">
                {commits.length === 0 ? (
                  <li className={styles.placeholder}>{t('engineering.commitsHostOnly')}</li>
                ) : (
                  commits.map((commit) => (
                    <li key={commit.hash} className={styles.listItem}>
                      <span className={styles.hash}>{commit.hash.slice(0, 7)}</span>
                      {commit.subject}
                    </li>
                  ))
                )}
              </ul>
            ),
          }}
        </AuxPanel>
      </div>
    </div>
  );
}
