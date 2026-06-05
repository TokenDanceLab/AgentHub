import { useState, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  Package,
  XCircle,
  Wrench,
  ListTree,
} from 'lucide-react';
import type { RunInfo } from '@shared/types';
import type { FileDiff } from './ChatView.types';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';
import { RunState, RunStateMachine } from '@/utils/runStateMachine';
import styles from './RightInspector.module.css';

// ── Tab IDs ──

export type InspectorTab = 'progress' | 'taskPlan' | 'toolTimeline' | 'artifacts' | 'workFolder';

// ── Data types (all props-only) ──

export interface ToolCallEntry {
  callId: string;
  toolName: string;
  status: string;
  timestamp: string;
  durationMs?: number;
  output?: string;
}

export interface TaskPlanItem {
  taskId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assignee?: string;
  objective?: string;
}

export interface ArtifactEntry {
  id: string;
  path: string;
  kind: string;
  createdAt: string;
  sizeBytes?: number;
}

export interface ChangedFileEntry {
  path: string;
  action: string;
  timestamp: string;
}

export interface InspectorProps {
  /** Active tab; component manages its own state if omitted */
  activeTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;

  // ── Run progress ──
  run: RunInfo | null;
  onCancel?: () => void;
  approvals?: PermissionRequestItem[];
  onDecideApproval?: (requestId: string, decision: 'allow' | 'deny') => Promise<void> | void;

  // ── Task plan (TeamRun) ──
  tasks?: TaskPlanItem[];
  teamName?: string;
  teamMembers?: number;
  activeTaskCount?: number;

  // ── Tool timeline ──
  toolCalls?: ToolCallEntry[];

  // ── Artifacts + diffs ──
  artifacts?: ArtifactEntry[];
  changedFiles?: ChangedFileEntry[];
  diffs?: FileDiff[];
  outputText?: string;

  // ── Work folder ──
  workDir?: string;
  fileTree?: TreeNode[];
  onFileSelect?: (path: string) => void;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

// ── Helpers ──

function statusIcon(state: RunState) {
  switch (state) {
    case RunState.COMPLETED:
      return <CheckCircle2 size={14} className={styles.iconDone} />;
    case RunState.FAILED:
    case RunState.CANCELLED:
      return <XCircle size={14} className={styles.iconFailed} />;
    case RunState.RUNNING:
    case RunState.STREAMING:
    case RunState.WAITING_FOR_INPUT:
      return <Loader2 size={14} className={styles.iconRunning} />;
    default:
      return <Clock size={14} className={styles.iconPending} />;
  }
}

function formatRelativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function statusLabelKey(state: RunState): string {
  return `run.status.${state.toLowerCase()}`;
}

// ── Sub-sections ──

function ProgressSection({
  run,
  onCancel,
  approvals = [],
  onDecideApproval,
}: Pick<InspectorProps, 'run' | 'onCancel' | 'approvals' | 'onDecideApproval'>) {
  const { t } = useTranslation();

  if (!run) {
    return (
      <div className={styles.emptyState} data-testid="inspector-progress-empty">
        <BarChart3 size={24} />
        <span>{t('inspector.noRun')}</span>
      </div>
    );
  }

  const state = RunStateMachine.fromLegacyStatus(run.status);
  const isActive = state !== RunState.COMPLETED && state !== RunState.FAILED
    && state !== RunState.CANCELLED && state !== RunState.IDLE;
  const pendingApprovals = approvals.filter((a) => !a.decision && a.runId === run.runId);

  return (
    <div className={styles.sectionContent} data-testid="inspector-progress">
      <div className={styles.statusRow}>
        {statusIcon(state)}
        <span className={`${styles.statusLabel} ${statusClass(state)}`}>
          {t(statusLabelKey(state))}
        </span>
        {run.runId && <span className={styles.runIdBadge}>{run.runId.slice(0, 12)}</span>}
      </div>

      {isActive && onCancel && (
        <button className={styles.cancelBtn} onClick={onCancel} data-testid="inspector-cancel">
          {t('action.cancelRun')}
        </button>
      )}

      {pendingApprovals.length > 0 && (
        <div className={styles.approvalList}>
          <div className={styles.subHeader}>
            <span>{t('inspector.pendingApprovals')}</span>
            <span className={styles.badge}>{pendingApprovals.length}</span>
          </div>
          {pendingApprovals.slice(-3).reverse().map((approval) => (
            <div key={approval.requestId} className={styles.approvalItem}>
              <code className={styles.mono}>{approval.toolName}</code>
              {onDecideApproval && (
                <span className={styles.approvalActions}>
                  <button
                    className={styles.actionAllow}
                    onClick={() => void onDecideApproval(approval.requestId, 'allow')}
                    aria-label={t('run.reviewAllow')}
                    data-testid={`inspector-allow-${approval.requestId}`}
                  >
                    <CheckCircle2 size={12} />
                  </button>
                  <button
                    className={styles.actionDeny}
                    onClick={() => void onDecideApproval(approval.requestId, 'deny')}
                    aria-label={t('run.reviewDeny')}
                    data-testid={`inspector-deny-${approval.requestId}`}
                  >
                    <XCircle size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskPlanSection({
  tasks = [],
  teamName,
  teamMembers = 0,
  activeTaskCount = 0,
}: Pick<InspectorProps, 'tasks' | 'teamName' | 'teamMembers' | 'activeTaskCount'>) {
  const { t } = useTranslation();

  if (tasks.length === 0 && !teamName) {
    return (
      <div className={styles.emptyState} data-testid="inspector-tasks-empty">
        <ListTree size={24} />
        <span>{t('inspector.noTasks')}</span>
      </div>
    );
  }

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;

  return (
    <div className={styles.sectionContent} data-testid="inspector-tasks">
      {teamName && (
        <div className={styles.teamHeader}>
          <span className={styles.teamName}>{teamName}</span>
          {teamMembers > 0 && (
            <span className={styles.badge}>{t('inspector.members', { count: teamMembers })}</span>
          )}
        </div>
      )}

      {tasks.length > 0 && (
        <div className={styles.taskSummary}>
          <span>{t('inspector.taskProgress', { completed, total: tasks.length })}</span>
          {activeTaskCount > 0 && (
            <span className={styles.badgeActive}>{t('inspector.activeTasks', { count: activeTaskCount })}</span>
          )}
          {failed > 0 && (
            <span className={styles.badgeFailed}>{t('inspector.failedTasks', { count: failed })}</span>
          )}
        </div>
      )}

      {tasks.length > 0 ? (
        <div className={styles.taskList}>
          {tasks.map((task) => (
            <div key={task.taskId} className={`${styles.taskItem} ${styles[`taskStatus_${task.status}`]}`}>
              <span className={styles.taskStatusIcon}>
                {task.status === 'completed' ? <CheckCircle2 size={12} /> :
                 task.status === 'failed' ? <XCircle size={12} /> :
                 task.status === 'running' ? <Loader2 size={12} /> :
                 <Clock size={12} />}
              </span>
              <span className={styles.taskTitle}>{task.title}</span>
              {task.assignee && <span className={styles.taskAssignee}>{task.assignee}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <ListTree size={18} />
          <span>{t('inspector.noTasks')}</span>
        </div>
      )}
    </div>
  );
}

function ToolTimelineSection({ toolCalls = [] }: Pick<InspectorProps, 'toolCalls'>) {
  const { t } = useTranslation();

  if (toolCalls.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="inspector-tools-empty">
        <Wrench size={24} />
        <span>{t('inspector.noToolCalls')}</span>
      </div>
    );
  }

  const completed = toolCalls.filter((tc) => tc.status === 'completed').length;

  return (
    <div className={styles.sectionContent} data-testid="inspector-tools">
      <div className={styles.toolSummary}>
        <span>{t('inspector.toolProgress', { completed, total: toolCalls.length })}</span>
      </div>

      <div className={styles.timeline}>
        {toolCalls.map((tc) => (
          <div key={tc.callId} className={styles.timelineItem}>
            <span className={`${styles.timelineDot} ${tc.status === 'completed' ? styles.dotDone : tc.status === 'failed' ? styles.dotFailed : styles.dotRunning}`} />
            <div className={styles.timelineContent}>
              <span className={styles.toolName}>{tc.toolName}</span>
              <span className={styles.toolTime}>{formatRelativeTime(tc.timestamp)}</span>
              {tc.durationMs != null && (
                <span className={styles.toolDuration}>{tc.durationMs}ms</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtifactsSection({
  artifacts = [],
  changedFiles = [],
  diffs = [],
  outputText,
}: Pick<InspectorProps, 'artifacts' | 'changedFiles' | 'diffs' | 'outputText'>) {
  const { t } = useTranslation();
  const hasContent = artifacts.length > 0 || changedFiles.length > 0 || diffs.length > 0 || !!outputText;

  if (!hasContent) {
    return (
      <div className={styles.emptyState} data-testid="inspector-artifacts-empty">
        <Package size={24} />
        <span>{t('inspector.noArtifacts')}</span>
      </div>
    );
  }

  return (
    <div className={styles.sectionContent} data-testid="inspector-artifacts">
      {diffs.length > 0 && (
        <div className={styles.artifactGroup}>
          <div className={styles.subHeader}>
            <GitBranch size={12} />
            <span>{t('inspector.changedFiles')}</span>
            <span className={styles.badge}>{diffs.length}</span>
          </div>
          {diffs.slice(0, 8).map((file) => (
            <div key={file.filePath} className={styles.fileRow}>
              <code className={styles.mono}>{file.filePath}</code>
              <span className={styles.fileAction}>{file.status}</span>
              <span className={styles.fileStats}>
                +{file.additions} -{file.deletions}
              </span>
            </div>
          ))}
        </div>
      )}

      {changedFiles.length > 0 && diffs.length === 0 && (
        <div className={styles.artifactGroup}>
          <div className={styles.subHeader}>
            <FileText size={12} />
            <span>{t('inspector.changedFiles')}</span>
            <span className={styles.badge}>{changedFiles.length}</span>
          </div>
          {changedFiles.slice(0, 8).map((f) => (
            <div key={`${f.path}-${f.timestamp}`} className={styles.fileRow}>
              <code className={styles.mono}>{f.path}</code>
              <span className={styles.fileAction}>{f.action}</span>
            </div>
          ))}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className={styles.artifactGroup}>
          <div className={styles.subHeader}>
            <Package size={12} />
            <span>{t('inspector.artifactsList')}</span>
            <span className={styles.badge}>{artifacts.length}</span>
          </div>
          {artifacts.slice(0, 8).map((art) => (
            <div key={art.id} className={styles.fileRow}>
              <code className={styles.mono}>{art.path}</code>
              <span className={styles.fileAction}>{art.kind}</span>
            </div>
          ))}
        </div>
      )}

      {outputText && (
        <div className={styles.artifactGroup}>
          <div className={styles.subHeader}>
            <span>{t('inspector.output')}</span>
          </div>
          <pre className={styles.outputBlock}>{outputText.slice(0, 2000)}</pre>
        </div>
      )}
    </div>
  );
}

function WorkFolderSection({
  workDir,
  fileTree = [],
  onFileSelect,
}: Pick<InspectorProps, 'workDir' | 'fileTree' | 'onFileSelect'>) {
  const { t } = useTranslation();

  if (!workDir && fileTree.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="inspector-folder-empty">
        <FolderOpen size={24} />
        <span>{t('inspector.noWorkspace')}</span>
      </div>
    );
  }

  return (
    <div className={styles.sectionContent} data-testid="inspector-folder">
      {workDir && (
        <div className={styles.folderPath}>
          <FolderOpen size={12} />
          <code className={styles.mono} title={workDir}>{workDir.split(/[/\\]/).pop() ?? workDir}</code>
        </div>
      )}

      {fileTree.length > 0 ? (
        <div className={styles.fileTree} role="tree">
          {fileTree.map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} onFileSelect={onFileSelect} />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <span>{t('inspector.emptyFolder')}</span>
        </div>
      )}
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  onFileSelect,
}: {
  node: TreeNode;
  depth: number;
  onFileSelect?: (path: string) => void;
}) {
  return (
    <div role="treeitem">
      <div
        className={styles.treeRow}
        style={{ '--depth': `${depth * 16}px` } as CSSProperties}
        onClick={() => !node.isDir && onFileSelect?.(node.path)}
      >
        <span className={styles.treeIcon}>
          {node.isDir ? <FolderOpen size={12} /> : <FileText size={12} />}
        </span>
        <span className={styles.treeName}>{node.name}</span>
      </div>
      {node.isDir && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} onFileSelect={onFileSelect} />
      ))}
    </div>
  );
}

function statusClass(state: RunState): string {
  switch (state) {
    case RunState.COMPLETED: return styles.statusDone ?? '';
    case RunState.FAILED:
    case RunState.CANCELLED: return styles.statusFailed ?? '';
    case RunState.RUNNING:
    case RunState.STREAMING:
    case RunState.WAITING_FOR_INPUT: return styles.statusRunning ?? '';
    default: return styles.statusPending ?? '';
  }
}

// ── Tab definitions ──

interface TabDef {
  id: InspectorTab;
  icon: ReactNode;
  labelKey: string;
  testId: string;
}

function useTabs(): TabDef[] {
  const { t } = useTranslation();
  return [
    { id: 'progress', icon: <BarChart3 size={14} />, labelKey: t('inspector.tab.progress'), testId: 'tab-progress' },
    { id: 'taskPlan', icon: <ListTree size={14} />, labelKey: t('inspector.tab.taskPlan'), testId: 'tab-taskPlan' },
    { id: 'toolTimeline', icon: <Wrench size={14} />, labelKey: t('inspector.tab.toolTimeline'), testId: 'tab-toolTimeline' },
    { id: 'artifacts', icon: <Package size={14} />, labelKey: t('inspector.tab.artifacts'), testId: 'tab-artifacts' },
    { id: 'workFolder', icon: <FolderOpen size={14} />, labelKey: t('inspector.tab.workFolder'), testId: 'tab-workFolder' },
  ];
}

// ── Main component ──

export default function RightInspector(props: InspectorProps) {
  const {
    activeTab: controlledTab,
    onTabChange,
    run,
    onCancel,
    approvals,
    onDecideApproval,
    tasks,
    teamName,
    teamMembers,
    activeTaskCount,
    toolCalls,
    artifacts,
    changedFiles,
    diffs,
    outputText,
    workDir,
    fileTree,
    onFileSelect,
  } = props;

  const [internalTab, setInternalTab] = useState<InspectorTab>('progress');
  const activeTab = controlledTab ?? internalTab;
  const tabs = useTabs();

  const handleTabChange = (tab: InspectorTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  // Badge counts for tab indicators
  const tabBadges = useMemo(() => ({
    progress: approvals?.filter((a) => !a.decision && a.runId === run?.runId).length ?? 0,
    taskPlan: tasks?.filter((t) => t.status === 'running').length ?? 0,
    toolTimeline: toolCalls?.length ?? 0,
    artifacts: (artifacts?.length ?? 0) + Math.max(diffs?.length ?? 0, changedFiles?.length ?? 0),
    workFolder: fileTree?.length ?? 0,
  }), [approvals, run, tasks, toolCalls, artifacts, changedFiles, diffs, fileTree]);

  return (
    <aside className={styles.root} aria-label="Right Inspector" data-testid="right-inspector">
      <nav className={styles.tabBar} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => handleTabChange(tab.id)}
            data-testid={tab.testId}
            title={tab.labelKey}
          >
            {tab.icon}
            {tabBadges[tab.id] > 0 && (
              <span className={styles.tabBadge}>{tabBadges[tab.id]}</span>
            )}
          </button>
        ))}
      </nav>

      <div className={styles.tabPanel} role="tabpanel">
        {activeTab === 'progress' && (
          <ProgressSection run={run} onCancel={onCancel} approvals={approvals} onDecideApproval={onDecideApproval} />
        )}
        {activeTab === 'taskPlan' && (
          <TaskPlanSection tasks={tasks} teamName={teamName} teamMembers={teamMembers} activeTaskCount={activeTaskCount} />
        )}
        {activeTab === 'toolTimeline' && (
          <ToolTimelineSection toolCalls={toolCalls} />
        )}
        {activeTab === 'artifacts' && (
          <ArtifactsSection artifacts={artifacts} changedFiles={changedFiles} diffs={diffs} outputText={outputText} />
        )}
        {activeTab === 'workFolder' && (
          <WorkFolderSection workDir={workDir} fileTree={fileTree} onFileSelect={onFileSelect} />
        )}
      </div>
    </aside>
  );
}
