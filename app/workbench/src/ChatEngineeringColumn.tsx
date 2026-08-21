import React, { useEffect, useMemo, useState } from 'react';
import type {
  AgentHubPlatform,
  RuntimeSessionSummary,
  WorkspaceFileEntry,
  WorkspaceGitChange,
  WorkspaceGitCommit,
} from '@shared/platform';
import {
  AuxPanel,
  resolveAvailableAuxTabs,
  resolveEffectiveAuxTab,
  type AuxPanelTab,
} from './auxPanel';
import shellStyles from './AgentHubWorkbench.module.css';
import styles from './ChatEngineeringColumn.module.css';

export type ChatEngineeringColumnProps = {
  inspector: React.ReactNode;
  hasWorkspace: boolean;
  localFiles: boolean;
  platform?: AgentHubPlatform | undefined;
  workDir?: string | undefined;
};

const LABELS: Record<AuxPanelTab, string> = {
  session_details: '会话',
  file_tree: '文件',
  changes: '变更',
  git_log: '提交',
};

/**
 * Desktop engineering-loop column: RightInspector + AuxPanel stack (#1181).
 * Folder-scoped aux tabs require hasWorkspace && localFiles.
 * Folder tabs filled via WorkspaceFilesPort / WorkspaceGitPort when present (#1191).
 * Shell width / collapse chrome lives on `.engineeringColumn`.
 */
export function ChatEngineeringColumn({
  inspector,
  hasWorkspace,
  localFiles,
  platform,
  workDir,
}: ChatEngineeringColumnProps): React.ReactElement {
  const available = useMemo(
    () => resolveAvailableAuxTabs({ hasWorkspace, localFiles }),
    [hasWorkspace, localFiles],
  );
  const [activeTab, setActiveTab] = useState<AuxPanelTab>('session_details');
  const effective = resolveEffectiveAuxTab(activeTab, available);
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [changes, setChanges] = useState<WorkspaceGitChange[]>([]);
  const [commits, setCommits] = useState<WorkspaceGitCommit[]>([]);
  // #1821: the 会话 tab used to be a static placeholder. Wire it to the real
  // host runtime-session list when the port exists; otherwise show an honest
  // empty state instead of fake content.
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionSummary[]>([]);

  useEffect(() => {
    if (effective !== activeTab) setActiveTab(effective);
  }, [effective, activeTab]);

  useEffect(() => {
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

  // #1821: 会话 tab — real host runtime sessions (Desktop port) or an honest
  // empty state; no more static placeholder.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = (await platform?.host?.listRuntimeSessions?.()) ?? [];
        if (!cancelled) setRuntimeSessions(next);
      } catch {
        if (!cancelled) setRuntimeSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  return (
    <div
      className={[shellStyles.engineeringColumn, styles.column].filter(Boolean).join(' ')}
      data-testid="chat-engineering-column"
    >
      <div className={styles.inspectorSlot}>{inspector}</div>
      <div className={styles.auxSlot}>
        <AuxPanel
          hasWorkspace={hasWorkspace}
          localFiles={localFiles}
          activeTab={effective}
          onActiveTabChange={setActiveTab}
          labels={LABELS}
        >
          {{
            session_details: (
              <ul className={styles.list} data-testid="aux-session-details">
                {runtimeSessions.length === 0 ? (
                  <li className={styles.placeholder}>暂无本地运行会话</li>
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
                  <li className={styles.placeholder}>工作区文件树（由 Desktop host 填充）</li>
                ) : (
                  files.map((f) => (
                    <li key={f.path} className={styles.listItem}>
                      <span className={styles.kind}>{f.kind === 'dir' ? 'DIR' : 'FILE'}</span>
                      {f.path}
                    </li>
                  ))
                )}
              </ul>
            ),
            changes: (
              <ul className={styles.list} data-testid="aux-git-changes">
                {changes.length === 0 ? (
                  <li className={styles.placeholder}>Git 变更列表（由 Desktop host 填充）</li>
                ) : (
                  changes.map((c) => (
                    <li key={c.path} className={styles.listItem}>
                      <span className={styles.status}>{c.status}</span>
                      {c.path}
                    </li>
                  ))
                )}
              </ul>
            ),
            git_log: (
              <ul className={styles.list} data-testid="aux-git-log">
                {commits.length === 0 ? (
                  <li className={styles.placeholder}>提交历史（由 Desktop host 填充）</li>
                ) : (
                  commits.map((c) => (
                    <li key={c.hash} className={styles.listItem}>
                      <span className={styles.hash}>{c.hash.slice(0, 7)}</span>
                      {c.subject}
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
