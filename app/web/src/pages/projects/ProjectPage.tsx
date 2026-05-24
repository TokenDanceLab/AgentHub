import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  listApprovals,
  listArtifacts,
  listPreviews,
  listProjects,
  listRunners,
  listRuns,
  listThreads,
  mockProjects,
  mockRuns,
  mockWorkspaceFiles,
  mockRunners,
  workbenchReducer,
  type Artifact,
  type Project,
  type Run,
  type Runner,
  type WorkbenchState,
} from '@shared/index';

type BoardView = 'overview' | 'tasks' | 'files';
type TaskStatus = 'Done' | 'Active' | 'Next';
type FileType = 'TSX' | 'DOC';
type FileFilter = 'All' | FileType;
type RunStatus = 'Pass' | 'Ready' | 'Deferred' | 'Local';
type RunFilter = 'All' | RunStatus;
type NoticeTone = 'success' | 'info' | 'warning';

type Task = {
  id: string;
  title: string;
  owner: string;
  status: TaskStatus;
  detail: string;
};

type FileItem = {
  name: string;
  type: FileType;
  status: string;
  detail: string;
};

type RunRecord = {
  id: string;
  status: RunStatus;
  detail: string;
  time: string;
};

type RiskItem = {
  id: string;
  title: string;
  detail: string;
  status: 'Open' | 'Reviewed' | 'Tracked';
  reviewable: boolean;
};

type TaskForm = {
  title: string;
  owner: string;
  detail: string;
};

type Notice = {
  tone: NoticeTone;
  message: string;
};

type DataMode = 'loading' | 'live' | 'offline-snapshot' | 'mock' | 'unavailable';

const viewLabels: Record<BoardView, string> = {
  overview: 'Overview',
  tasks: 'Tasks',
  files: 'Files',
};

const emptyTaskForm: TaskForm = {
  title: 'Review project page responsive states',
  owner: 'Frontend page coordinator',
  detail: 'Check tabs, risk toggle, sync feedback, and drawer spacing.',
};

const fileFilters: FileFilter[] = ['All', 'TSX', 'DOC'];
const runFilters: RunFilter[] = ['All', 'Pass', 'Ready', 'Deferred', 'Local'];

const projects = mockProjects.map((p) => ({
  code: p.id.split('_').pop()?.toUpperCase().slice(0, 2) ?? p.id.slice(0, 2).toUpperCase(),
  name: p.name,
  detail: p.description ?? '',
  status: 'In progress' as const,
}));

const initialTasks: Task[] = mockRuns.map((run, i) => ({
  id: `task-${run.runId}`,
  title: `Run ${run.runId.split('_').pop()} on ${run.threadId}`,
  owner: mockRunners[i % mockRunners.length]?.name ?? 'Agent',
  status: (run.status === 'finished' ? 'Done' : run.status === 'running' ? 'Active' : 'Next') as TaskStatus,
  detail: `Status: ${run.status}. Project: ${run.projectId}, Thread: ${run.threadId}`,
}));

const initialFiles: FileItem[] = mockWorkspaceFiles.map((f) => ({
  name: f.path.split('/').pop() ?? f.path,
  type: (f.path.endsWith('.tsx') || f.path.endsWith('.ts') ? 'TSX' : 'DOC') as FileType,
  status: 'Edited',
  detail: `${f.path} - ${(f.sizeBytes / 1024).toFixed(1)} KB, modified ${f.modifiedAt.slice(0, 10)}`,
}));

const initialRuns: RunRecord[] = mockRuns.map((run) => ({
  id: run.runId,
  status: (run.status === 'finished' ? 'Pass' : run.status === 'running' ? 'Ready' : run.status === 'queued' ? 'Deferred' : 'Local') as RunStatus,
  detail: `Run on thread ${run.threadId}, project ${run.projectId}. Status: ${run.status}.`,
  time: run.createdAt.slice(11, 16),
}));

const initialRisks: RiskItem[] = [
  {
    id: 'risk-no-api',
    title: 'Edge snapshot fallback',
    detail: 'Live Edge data is preferred; mock preview data is shown only when no snapshot is available.',
    status: 'Open',
    reviewable: true,
  },
  {
    id: 'risk-parallel-edits',
    title: 'Parallel page edits',
    detail: 'This worker only changes ProjectPageInteractive.tsx.',
    status: 'Tracked',
    reviewable: false,
  },
  {
    id: 'risk-local-only',
    title: 'Local overlay state',
    detail: 'New tasks, risk review, filters, and simulated sync runs stay local and reset after refresh.',
    status: 'Open',
    reviewable: true,
  },
];

const milestones = [
  {
    title: 'Preview shell locked',
    detail: 'Route preview and project page layout are stable enough for review.',
    status: 'Done',
  },
  {
    title: 'Stateful React copy',
    detail: 'Tabs, task panel, risk review, and sync feedback are visible.',
    status: 'Active',
  },
  {
    title: 'Real API pass',
    detail: 'Deferred until contracts and backend mocks settle.',
    status: 'Later',
  },
];

const initialWorkbenchProjectionState: WorkbenchState = {
  projects: [],
  threads: [],
  runners: [],
  runs: [],
  threadItems: [],
  approvals: [],
  artifacts: [],
  previews: [],
  runLogs: {},
  connection: { status: 'idle' },
  lastSeq: 0,
};

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Edge catalog unavailable');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Edge catalog did not respond.')), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function dataModeFromState(state: WorkbenchState): DataMode {
  const hasSnapshot =
    state.projects.length > 0 ||
    state.threads.length > 0 ||
    state.runners.length > 0 ||
    state.runs.length > 0 ||
    state.artifacts.length > 0 ||
    state.approvals.length > 0 ||
    state.previews.length > 0;

  if (state.connection.status === 'loading') return 'loading';
  if (state.connection.status === 'connected' && hasSnapshot) return 'live';
  if ((state.connection.status === 'disconnected' || state.connection.status === 'error') && hasSnapshot) {
    return 'offline-snapshot';
  }
  if (state.connection.status === 'error' || state.connection.status === 'disconnected') return 'mock';
  return 'unavailable';
}

function dataModeLabel(mode: DataMode) {
  switch (mode) {
    case 'loading':
      return 'Loading catalog';
    case 'live':
      return 'Live';
    case 'offline-snapshot':
      return 'Offline snapshot';
    case 'mock':
      return 'Mock fallback';
    case 'unavailable':
      return 'Snapshot unavailable';
    default:
      return 'Snapshot unavailable';
  }
}

function projectFromApi(project: Project) {
  return {
    code: project.id.split('_').pop()?.toUpperCase().slice(0, 2) ?? project.id.slice(0, 2).toUpperCase(),
    name: project.name,
    detail: project.description ?? `Created ${project.createdAt.slice(0, 10)}`,
    status: 'In progress' as const,
  };
}

function taskFromRun(run: Run, index: number, runners: Runner[]): Task {
  return {
    id: `task-${run.runId}`,
    title: `Run ${run.runId.split('_').pop()} on ${run.threadId}`,
    owner: runners[index % Math.max(runners.length, 1)]?.name ?? 'Agent',
    status: run.status === 'finished' ? 'Done' : run.status === 'running' || run.status === 'starting' ? 'Active' : 'Next',
    detail: `Status: ${run.status}. Project: ${run.projectId}, Thread: ${run.threadId}`,
  };
}

function fileFromArtifact(artifact: Artifact): FileItem {
  const name = artifact.path.split('/').pop() ?? artifact.path;
  return {
    name,
    type: artifact.path.endsWith('.tsx') || artifact.path.endsWith('.ts') ? 'TSX' : 'DOC',
    status: artifact.kind,
    detail: `${artifact.path} - ${(artifact.sizeBytes / 1024).toFixed(1)} KB, created ${artifact.createdAt.slice(0, 10)}`,
  };
}

function runRecordFromApi(run: Run): RunRecord {
  return {
    id: run.runId,
    status: run.status === 'finished' ? 'Pass' : run.status === 'running' || run.status === 'starting' ? 'Ready' : run.status === 'queued' ? 'Deferred' : 'Local',
    detail: `Run on thread ${run.threadId}, project ${run.projectId}. Status: ${run.status}.`,
    time: run.createdAt.slice(11, 16),
  };
}

const pageStyles = `
  @import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");

  .projectReactRoot {
    position: relative;
    height: 100%;
    overflow: hidden;
    color: var(--text);
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
      linear-gradient(135deg, var(--surface-alt), var(--bg));
    font-family: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .projectReactRoot * {
    box-sizing: border-box;
  }

  .projectParticles {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  [data-theme="dark"] .projectReactRoot {
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.1), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.1), transparent 30%),
      linear-gradient(135deg, var(--surface-alt), var(--bg));
  }

  .projectReactShell {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 18px;
    height: 100%;
    padding: 18px;
  }

  .projectGlass {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    box-shadow: 0 18px 48px var(--glass-shadow);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
  }

  .projectSidebar {
    display: flex;
    flex-direction: column;
    gap: 18px;
    height: 100%;
    padding: 18px;
  }

  .projectBrand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .projectBrandMark,
  .projectIconTile,
  .projectFileType {
    display: grid;
    place-items: center;
    color: var(--white);
    font-weight: 900;
    background: var(--accent-gradient);
  }

  .projectBrandMark {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    border-radius: 10px;
    font-size: 16px;
    line-height: 1;
    box-shadow: 0 10px 22px var(--shadow);
  }

  .projectTitle h2 {
    margin: 0;
    font-size: 15px;
    line-height: 1.25;
    color: var(--text);
  }

  .projectTitle p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    line-height: 1.236;
  }

  .projectMuted {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    line-height: 1.2;
  }

  .projectNav {
    display: grid;
    gap: 8px;
  }

  .projectNav button,
  .projectTab,
  .projectPrimaryButton,
  .projectSecondaryButton,
  .projectGhostButton,
  .projectIconButton {
    border: 0;
    border-radius: 8px;
    font: inherit;
    cursor: pointer;
  }

  .projectNav button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    color: var(--text-secondary);
    text-align: left;
    background: transparent;
  }

  .projectNav button.isActive {
    color: var(--accent);
    background: var(--accent-light);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .projectSidebarNote {
    margin-top: auto;
    padding: 14px;
    border: 1px solid rgba(37, 99, 235, 0.12);
    border-radius: 12px;
    background: var(--accent-lighter);
  }

  .projectSidebarNote strong {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
  }

  .projectMain {
    min-width: 0;
    max-height: 100%;
    overflow: auto;
    padding-right: 2px;
  }

  .projectTopbar,
  .projectHero,
  .projectMetricGrid,
  .projectBoardGrid {
    margin-bottom: 18px;
  }

  .projectTopbar {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
  }

  .projectSearch {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: min(430px, 100%);
    padding: 10px 12px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 8px;
    background: var(--surface);
  }

  .projectSearch input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
  }

  .projectTopActions,
  .projectButtonRow,
  .projectCardHeader,
  .projectStatusRow,
  .projectRowTitle {
    display: flex;
    align-items: center;
  }

  .projectTopActions,
  .projectButtonRow {
    gap: 10px;
  }

  .projectIconButton {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid rgba(148, 163, 184, 0.22);
  }

  .projectAvatar {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    color: var(--white);
    border-radius: 50%;
    font-size: 13px;
    font-weight: 800;
    background: linear-gradient(135deg, var(--accent), var(--accent));
  }

  .projectHero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 18px;
    padding: 22px;
  }

  .projectEyebrow {
    margin: 0 0 8px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .projectHero h2 {
    max-width: 720px;
    margin: 0 0 8px;
    font-size: 34px;
    line-height: 1.12;
    letter-spacing: 0;
  }

  .projectHero p {
    max-width: 700px;
    margin: 0 0 18px;
    color: var(--text-muted);
    line-height: 1.55;
  }

  .projectPrimaryButton,
  .projectSecondaryButton,
  .projectGhostButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 38px;
    padding: 9px 14px;
    font-weight: 700;
    line-height: 1;
  }

  .projectPrimaryButton:disabled,
  .projectSecondaryButton:disabled,
  .projectGhostButton:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .projectPrimaryButton {
    color: var(--white);
    background: var(--brand-gradient);
    box-shadow: 0 12px 28px rgba(37, 99, 235, 0.24);
  }

  .projectSecondaryButton,
  .projectGhostButton {
    color: var(--text);
    background: var(--surface);
    border: 1px solid rgba(148, 163, 184, 0.25);
  }

  .projectSyncMessage {
    display: inline-flex;
    align-items: center;
    min-height: 38px;
    padding: 9px 12px;
    color: var(--accent);
    border: 1px solid rgba(37, 99, 235, 0.16);
    border-radius: 8px;
    background: var(--accent-lighter);
    font-size: 13px;
    font-weight: 700;
  }

  .projectSyncMessage.success {
    color: var(--success);
    border-color: rgba(5, 150, 105, 0.18);
    background: var(--success-bg);
  }

  .projectSyncMessage.warning {
    color: var(--warning-dot);
    border-color: rgba(217, 119, 6, 0.2);
    background: rgba(217, 119, 6, 0.12);
  }

  .projectHeroSide {
    display: grid;
    gap: 12px;
  }

  .projectProgressCard {
    padding: 14px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--surface);
  }

  .projectStatusRow {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .projectStatusRow strong {
    font-size: 20px;
  }

  .projectMeter {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.08);
  }

  .projectMeter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent), var(--accent));
  }

  .projectMetricGrid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px;
  }

  .projectMetric {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 16px;
  }

  .projectMetricIcon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    color: var(--accent);
    border-radius: 12px;
    background: var(--accent-light);
    font-weight: 800;
  }

  .projectMetric strong {
    display: block;
    font-size: 22px;
    line-height: 1.1;
  }

  .projectMetric span {
    color: var(--text-muted);
    font-size: 12px;
  }

  .projectBoardGrid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.85fr);
    gap: 18px;
  }

  .projectPanel {
    padding: 18px;
  }

  .projectCardHeader {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .projectCardHeader h3 {
    margin: 0;
    font-size: 18px;
  }

  .projectTabs {
    display: flex;
    gap: 6px;
    padding: 4px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.06);
  }

  .projectTab {
    padding: 8px 10px;
    color: var(--text-muted);
    background: transparent;
    font-weight: 700;
  }

  .projectTab.isActive {
    color: var(--accent);
    background: var(--glass-bg);
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  }

  .projectFilterBar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .projectFilterGroup {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .projectFilterLabel {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .projectMiniButton {
    min-height: 28px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 8px;
    padding: 6px 9px;
    color: var(--text-secondary);
    background: var(--surface);
    font: inherit;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
  }

  .projectMiniButton.isActive {
    color: var(--accent);
    border-color: rgba(37, 99, 235, 0.2);
    background: var(--accent-light);
  }

  .projectMiniButton:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .projectList,
  .projectStack {
    display: grid;
    gap: 10px;
  }

  .projectRow,
  .projectTaskRow,
  .projectFileRow,
  .projectRunRow,
  .projectMilestoneRow,
  .projectRiskRow {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--surface);
  }

  .projectRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px;
  }

  .projectRowTitle {
    min-width: 0;
    gap: 12px;
  }

  .projectIconTile {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    border-radius: 12px;
  }

  .projectRowTitle strong,
  .projectTaskRow strong,
  .projectFileRow strong,
  .projectRunRow strong,
  .projectMilestoneRow strong,
  .projectRiskRow strong {
    display: block;
    margin-bottom: 4px;
  }

  .projectPill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 24px;
    padding: 4px 9px;
    border: 1px solid rgba(37, 99, 235, 0.13);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    white-space: nowrap;
  }

  .projectPill.blue {
    color: var(--accent);
    border-color: rgba(37, 99, 235, 0.18);
    background: var(--accent-light);
  }

  .projectPill.cyan {
    color: var(--accent);
    border-color: rgba(8, 145, 178, 0.18);
    background: rgba(8, 145, 178, 0.1);
  }

  .projectPill.purple {
    color: var(--accent);
    border-color: rgba(124, 58, 237, 0.18);
    background: rgba(124, 58, 237, 0.1);
  }

  .projectPill.green {
    color: var(--success);
    border-color: rgba(5, 150, 105, 0.18);
    background: var(--success-bg);
  }

  .projectPill.amber {
    color: var(--warning-dot);
    border-color: rgba(217, 119, 6, 0.2);
    background: rgba(217, 119, 6, 0.12);
  }

  .projectPill.neutral {
    color: var(--text-muted);
    border-color: rgba(148, 163, 184, 0.25);
    background: rgba(148, 163, 184, 0.12);
  }

  .projectTaskRow,
  .projectFileRow,
  .projectRunRow {
    display: grid;
    gap: 12px;
    align-items: center;
    padding: 12px;
  }

  .projectTaskRow {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
  }

  .projectFileRow,
  .projectRunRow {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .projectCheck,
  .projectRunIcon,
  .projectFileType {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    font-size: 12px;
  }

  .projectCheck,
  .projectRunIcon {
    display: grid;
    place-items: center;
    color: var(--accent);
    background: var(--accent-light);
    font-weight: 800;
  }

  .projectTaskRow.done .projectCheck {
    color: var(--success);
    background: var(--success-bg);
  }

  .projectInlineActions {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
  }

  .projectEmptyState {
    display: grid;
    gap: 8px;
    place-items: center;
    min-height: 150px;
    padding: 24px;
    color: var(--text-muted);
    text-align: center;
    border: 1px dashed rgba(148, 163, 184, 0.34);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.38);
  }

  .projectEmptyState strong {
    color: var(--text-secondary);
  }

  .projectMetaLine {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
  }

  .projectSideStack {
    display: grid;
    gap: 18px;
  }

  .projectMilestoneRow {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    padding: 12px;
  }

  .projectDot {
    width: 10px;
    height: 10px;
    margin-top: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.1);
  }

  .projectDot.cyan {
    background: var(--accent);
    box-shadow: 0 0 0 5px rgba(8, 145, 178, 0.1);
  }

  .projectDot.purple {
    background: var(--accent);
    box-shadow: 0 0 0 5px rgba(124, 58, 237, 0.1);
  }

  .projectRiskRow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    padding: 12px;
    border-color: rgba(217, 119, 6, 0.18);
  }

  .projectDrawer {
    position: fixed;
    inset: 18px 18px 18px auto;
    z-index: 10;
    display: grid;
    width: min(420px, calc(100vw - 36px));
    align-content: start;
    gap: 14px;
    padding: 18px;
  }

  .projectDrawer h3 {
    margin: 0;
    font-size: 20px;
  }

  .projectField {
    display: grid;
    gap: 7px;
  }

  .projectField label {
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .projectField input,
  .projectField textarea {
    width: 100%;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    padding: 10px 12px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  .projectField textarea {
    min-height: 92px;
    resize: vertical;
  }

  @media (max-width: 1180px) {
    .projectReactShell {
      grid-template-columns: 1fr;
    }

    .projectSidebar {
      min-height: auto;
    }

    .projectNav {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .projectHero,
    .projectBoardGrid {
      grid-template-columns: 1fr;
    }

    .projectMetricGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 820px) {
    .projectReactRoot {
      overflow: auto;
    }

    .projectReactShell {
      padding: 12px;
    }

    .projectMain {
      max-height: none;
      overflow: visible;
    }

    .projectTopbar,
    .projectRow,
    .projectCardHeader,
    .projectFilterBar {
      align-items: stretch;
      flex-direction: column;
    }

    .projectTaskRow,
    .projectFileRow,
    .projectRunRow,
    .projectRiskRow {
      grid-template-columns: 1fr;
    }

    .projectMetricGrid {
      grid-template-columns: 1fr;
    }
  }
`;

function statusTone(status: string): 'blue' | 'cyan' | 'purple' | 'green' | 'amber' {
  if (status === 'Done' || status === 'Pass' || status === 'Reviewed') {
    return 'green';
  }

  if (status === 'Review' || status === 'Ready' || status === 'Local') {
    return 'cyan';
  }

  if (status === 'Queued' || status === 'Later' || status === 'Deferred') {
    return 'purple';
  }

  if (status === 'Next' || status === 'Open') {
    return 'amber';
  }

  return 'blue';
}

function matchesQuery(fields: string[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return fields.some((field) => field.toLowerCase().includes(normalizedQuery));
}

function nextTaskStatus(status: TaskStatus): TaskStatus {
  if (status === 'Next') {
    return 'Active';
  }

  if (status === 'Active') {
    return 'Done';
  }

  return 'Active';
}

function taskActionLabel(status: TaskStatus) {
  if (status === 'Next') {
    return 'Start';
  }

  if (status === 'Active') {
    return 'Mark done';
  }

  return 'Reopen';
}

function formatLocalTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProjectParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      alpha: number;
      hue: number;
    };

    const particles: Particle[] = [];
    let frameId = 0;

    const createParticle = (index: number): Particle => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: -0.18 + Math.random() * 0.36,
      vy: -0.18 - Math.random() * 0.48,
      radius: 1.6 + Math.random() * 2.6,
      alpha: 0.18 + Math.random() * 0.2,
      hue: index % 3 === 0 ? 196 : 210,
    });

    const resetParticles = () => {
      particles.length = 0;
      for (let index = 0; index < 56; index += 1) {
        particles.push(createParticle(index));
      }
    };

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      resetParticles();
    };

    const draw = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        if (!particle) {
          continue;
        }

        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.y < -16) {
          particle.y = window.innerHeight + 16;
          particle.x = Math.random() * window.innerWidth;
        }

        if (particle.x < -16) {
          particle.x = window.innerWidth + 16;
        }

        if (particle.x > window.innerWidth + 16) {
          particle.x = -16;
        }

        context.beginPath();
        context.fillStyle = `hsla(${particle.hue}, 84%, 48%, ${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (let inner = index + 1; inner < particles.length; inner += 1) {
          const other = particles[inner];
          if (!other) {
            continue;
          }

          const distance = Math.hypot(particle.x - other.x, particle.y - other.y);
          if (distance < 126) {
            context.beginPath();
            context.strokeStyle = `rgba(23, 105, 232, ${(1 - distance / 126) * 0.07})`;
            context.lineWidth = 1;
            context.moveTo(particle.x, particle.y);
            context.lineTo(other.x, other.y);
            context.stroke();
          }
        }
      }

      frameId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas aria-hidden="true" className="projectParticles" ref={canvasRef} />;
}

function useWorkbenchProjection() {
  const [state, dispatch] = useReducer(
    workbenchReducer,
    initialWorkbenchProjectionState,
    (initialState) => workbenchReducer(initialState, { type: 'connection.loading' }),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      dispatch({ type: 'connection.loading' });
      try {
        const [projects, threads, runners, runs, approvals, artifacts, previews] =
          await withTimeout(Promise.all([
            listProjects({ pageSize: 50 }),
            listThreads({ pageSize: 50 }),
            listRunners(),
            listRuns({ pageSize: 50 }),
            listApprovals(),
            listArtifacts(),
            listPreviews(),
          ]));

        if (cancelled) return;

        dispatch({
          type: 'snapshot.loaded',
          snapshot: {
            projects,
            threads,
            runners,
            runs,
            approvals,
            artifacts,
            previews,
          },
        });
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: 'connection.error', error: formatError(error) });
        }
      }
    }

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function ProjectPageInteractive() {
  const workbenchState = useWorkbenchProjection();
  const dataMode = dataModeFromState(workbenchState);
  const hasLiveCatalog = dataMode === 'live' || dataMode === 'offline-snapshot';
  const catalogLabel = dataModeLabel(dataMode);
  const catalogTone = dataMode === 'live' ? 'green' : dataMode === 'loading' ? 'cyan' : dataMode === 'offline-snapshot' ? 'purple' : dataMode === 'mock' ? 'amber' : 'neutral';
  const catalogDetail =
    dataMode === 'live'
      ? 'Project catalog is loaded from Edge.'
      : dataMode === 'offline-snapshot'
        ? 'Edge is offline; preserving the last reducer snapshot.'
        : dataMode === 'mock'
          ? `Edge catalog unavailable: ${workbenchState.connection.error ?? 'no snapshot loaded'}. Showing mock demo data.`
          : dataMode === 'loading'
            ? 'Loading Edge catalog snapshot...'
            : 'No Edge snapshot is available yet.';
  const projectedProjects = hasLiveCatalog && workbenchState.projects.length
    ? workbenchState.projects.map(projectFromApi)
    : projects;
  const projectedTasks = hasLiveCatalog && workbenchState.runs.length
    ? workbenchState.runs.map((run, index) => taskFromRun(run, index, workbenchState.runners))
    : initialTasks;
  const projectedFiles = hasLiveCatalog && workbenchState.artifacts.length
    ? workbenchState.artifacts.map(fileFromArtifact)
    : initialFiles;
  const projectedRuns = hasLiveCatalog && workbenchState.runs.length
    ? workbenchState.runs.map(runRecordFromApi)
    : initialRuns;
  const [activeView, setActiveView] = useState<BoardView>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [localRuns, setLocalRuns] = useState<RunRecord[]>([]);
  const [projectRisks, setProjectRisks] = useState<RiskItem[]>(initialRisks);
  const [fileFilter, setFileFilter] = useState<FileFilter>('All');
  const [runFilter, setRunFilter] = useState<RunFilter>('All');
  const [lastSyncAt, setLastSyncAt] = useState('Not synced yet');
  const [syncStatus, setSyncStatus] = useState('Idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const taskOverrides = useMemo(
    () => new Map(localTasks.filter((task) => !task.id.startsWith('local-task-')).map((task) => [task.id, task])),
    [localTasks],
  );
  const projectTasks = useMemo(
    () => [
      ...localTasks.filter((task) => task.id.startsWith('local-task-')),
      ...projectedTasks.map((task) => taskOverrides.get(task.id) ?? task),
    ],
    [localTasks, projectedTasks, taskOverrides],
  );
  const projectRuns = useMemo(() => [...localRuns, ...projectedRuns], [localRuns, projectedRuns]);

  const canSaveTask = taskForm.title.trim().length > 0 && taskForm.owner.trim().length > 0;
  const completedTaskCount = projectTasks.filter((task) => task.status === 'Done').length;
  const activeTaskCount = projectTasks.filter((task) => task.status !== 'Done').length;
  const deliveryProgress = Math.round((completedTaskCount / Math.max(projectTasks.length, 1)) * 100);
  const reviewableRisks = projectRisks.filter((risk) => risk.reviewable);
  const openRiskCount = projectRisks.filter((risk) => risk.status === 'Open').length;
  const reviewedRiskCount = projectRisks.filter((risk) => risk.status === 'Reviewed').length;
  const riskProgress = Math.round((reviewedRiskCount / Math.max(reviewableRisks.length, 1)) * 100);
  const allReviewableRisksClosed = reviewableRisks.every((risk) => risk.status === 'Reviewed');

  const filteredProjects = useMemo(
    () => projectedProjects.filter((project) => matchesQuery([project.name, project.detail, project.status], searchTerm)),
    [projectedProjects, searchTerm],
  );

  const filteredTasks = useMemo(
    () =>
      projectTasks.filter((task) =>
        matchesQuery([task.title, task.owner, task.detail, task.status], searchTerm),
      ),
    [projectTasks, searchTerm],
  );

  const filteredFiles = useMemo(
    () =>
      projectedFiles.filter(
        (file) =>
          (fileFilter === 'All' || file.type === fileFilter) &&
          matchesQuery([file.name, file.type, file.status, file.detail], searchTerm),
      ),
    [fileFilter, projectedFiles, searchTerm],
  );

  const filteredRuns = useMemo(
    () =>
      projectRuns.filter(
        (run) =>
          (runFilter === 'All' || run.status === runFilter) &&
          matchesQuery([run.id, run.status, run.detail, run.time], searchTerm),
      ),
    [projectRuns, runFilter, searchTerm],
  );

  const activityPrompt = useMemo(() => {
    if (notice) {
      return notice.message;
    }

    if (openRiskCount > 0) {
      return `${openRiskCount} open risk${openRiskCount === 1 ? '' : 's'} still need review.`;
    }

    return `${activeTaskCount} active task${activeTaskCount === 1 ? '' : 's'} remain after local review.`;
  }, [activeTaskCount, notice, openRiskCount]);

  const boardTitle = useMemo(() => {
    if (activeView === 'tasks') {
      return `Task status (${filteredTasks.length})`;
    }

    if (activeView === 'files') {
      return `Files and run records (${filteredFiles.length}/${filteredRuns.length})`;
    }

    return `Project overview (${filteredProjects.length})`;
  }, [activeView, filteredFiles.length, filteredProjects.length, filteredRuns.length, filteredTasks.length]);

  const openTaskPanel = () => {
    setIsTaskPanelOpen(true);
    setNotice(null);
  };

  const closeTaskPanel = () => {
    setIsTaskPanelOpen(false);
  };

  const updateTaskForm = (field: keyof TaskForm, value: string) => {
    setTaskForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveTask = () => {
    if (!canSaveTask) {
      setNotice({
        tone: 'warning',
        message: 'Add a task title and owner before saving.',
      });
      return;
    }

    const newTask: Task = {
      id: `local-task-${Date.now().toString(36)}`,
      title: taskForm.title.trim(),
      owner: taskForm.owner.trim(),
      status: 'Next',
      detail: taskForm.detail.trim() || 'No additional note was added.',
    };

    setLocalTasks((current) => [newTask, ...current]);
    setTaskForm(emptyTaskForm);
    setIsTaskPanelOpen(false);
    setActiveView('tasks');
    setNotice({
      tone: 'success',
      message: `Saved "${newTask.title}" as a local task.`,
    });
  };

  const toggleTaskStatus = (taskId: string) => {
    const currentTask = projectTasks.find((task) => task.id === taskId);

    if (!currentTask) {
      return;
    }

    const nextStatus = nextTaskStatus(currentTask.status);

    setLocalTasks((current) => {
      const hasLocalTask = current.some((task) => task.id === taskId);
      if (!hasLocalTask) {
        return [...current, { ...currentTask, status: nextStatus }];
      }

      return current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: nextStatus,
            }
          : task,
      );
    });

    setNotice({
      tone: nextStatus === 'Done' ? 'success' : 'info',
      message: `"${currentTask.title}" moved to ${nextStatus}.`,
    });
  };

  const toggleRisk = (riskId: string) => {
    const currentRisk = projectRisks.find((risk) => risk.id === riskId);

    if (!currentRisk || !currentRisk.reviewable) {
      return;
    }

    const nextStatus = currentRisk.status === 'Reviewed' ? 'Open' : 'Reviewed';

    setProjectRisks((current) =>
      current.map((risk) =>
        risk.id === riskId
          ? {
              ...risk,
              status: nextStatus,
            }
          : risk,
      ),
    );

    setNotice({
      tone: nextStatus === 'Reviewed' ? 'success' : 'warning',
      message:
        nextStatus === 'Reviewed'
          ? `"${currentRisk.title}" marked reviewed.`
          : `"${currentRisk.title}" reopened for review.`,
    });
  };

  const toggleAllReviewableRisks = () => {
    const nextStatus = allReviewableRisksClosed ? 'Open' : 'Reviewed';

    setProjectRisks((current) =>
      current.map((risk) =>
        risk.reviewable
          ? {
              ...risk,
              status: nextStatus,
            }
          : risk,
      ),
    );

    setNotice({
      tone: nextStatus === 'Reviewed' ? 'success' : 'warning',
      message:
        nextStatus === 'Reviewed'
          ? 'All reviewable risks are marked reviewed.'
          : 'Reviewable risks were reopened.',
    });
  };

  const simulateSync = () => {
    const syncTime = formatLocalTime();
    const syncRun: RunRecord = {
      id: `local-sync-${String(projectRuns.length + 1).padStart(3, '0')}`,
      status: 'Local',
      detail: `Local sync captured ${activeTaskCount} active tasks and ${openRiskCount} open risks.`,
      time: syncTime,
    };

    setLastSyncAt(syncTime);
    setSyncStatus('Local sync complete');
    setLocalRuns((current) => [syncRun, ...current]);
    setRunFilter('All');
    setNotice({
      tone: 'info',
      message: `Sync updated local run records at ${syncTime}.`,
    });
  };

  return (
    <div className="projectReactRoot">
      <style>{pageStyles}</style>
      <ProjectParticles />

      <div className="projectReactShell">
        <aside className="projectSidebar projectGlass" aria-label="Project navigation">
          <div className="projectBrand">
            <span className="projectBrandMark">AH</span>
            <div className="projectTitle">
              <h2>AGENTHUB</h2>
              <p>Project workspace</p>
            </div>
          </div>

          <nav className="projectNav">
            {(['overview', 'tasks', 'files'] as BoardView[]).map((view) => (
              <button
                className={activeView === view ? 'isActive' : undefined}
                key={view}
                onClick={() => setActiveView(view)}
                type="button"
              >
                <span>{view === 'overview' ? 'OV' : view === 'tasks' ? 'TK' : 'FL'}</span>
                <span>{viewLabels[view]}</span>
              </button>
            ))}
            <button onClick={openTaskPanel} type="button">
              <span>NT</span>
              <span>New task</span>
            </button>
          </nav>

          <div className="projectSidebarNote">
            <strong>{catalogLabel}</strong>
            <span>{catalogDetail} {activityPrompt}</span>
          </div>
        </aside>

        <main className="projectMain">
          <header className="projectTopbar projectGlass">
            <label className="projectSearch">
              <span>Search</span>
              <input
                aria-label="Search projects"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Projects, tasks, files..."
                value={searchTerm}
              />
            </label>
            <div className="projectTopActions">
              <button
                className="projectIconButton"
                disabled={!searchTerm}
                onClick={() => setSearchTerm('')}
                type="button"
                aria-label="Clear search"
              >
                C
              </button>
              <button className="projectIconButton" type="button" aria-label="Notifications">
                N
              </button>
              <button className="projectIconButton" type="button" aria-label="Settings">
                S
              </button>
              <div className="projectAvatar" aria-label="Current user">
                PM
              </div>
            </div>
          </header>

          <section className="projectHero projectGlass">
            <div>
              <p className="projectEyebrow">Project detail</p>
              <h2>Workspace Preview Foundation</h2>
              <p>
                Coordinate frontend preview pages, milestones, task readiness, design files, and dry-run records with
                clear live, offline snapshot, and mock fallback status.
              </p>
              <div className="projectButtonRow">
                <button
                  className="projectPrimaryButton"
                  onClick={simulateSync}
                  type="button"
                >
                  {syncStatus === 'Idle' ? 'Simulate sync' : 'Sync again'}
                </button>
                <button
                  className="projectSecondaryButton"
                  disabled={reviewableRisks.length === 0}
                  onClick={toggleAllReviewableRisks}
                  type="button"
                >
                  {allReviewableRisksClosed ? 'Reopen risks' : 'Mark risks reviewed'}
                </button>
                <button className="projectGhostButton" onClick={openTaskPanel} type="button">
                  New task
                </button>
                {notice ? <span className={`projectSyncMessage ${notice.tone}`}>{notice.message}</span> : null}
              </div>
            </div>

            <div className="projectHeroSide">
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>Delivery progress</span>
                  <strong>{deliveryProgress}%</strong>
                </div>
                <div className="projectMeter" aria-label={`Delivery progress ${deliveryProgress} percent`}>
                  <span style={{ width: `${deliveryProgress}%` }} />
                </div>
              </div>
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>Open risks</span>
                  <strong>{openRiskCount}</strong>
                </div>
                <div className="projectMeter" aria-label="Risk review progress">
                  <span
                    style={{
                      width: `${riskProgress}%`,
                      background: 'linear-gradient(90deg, var(--accent), var(--accent))',
                    }}
                  />
                </div>
              </div>
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>Catalog status</span>
                  <strong>{catalogLabel}</strong>
                </div>
                <p className="projectMuted">{syncStatus} - {lastSyncAt}</p>
              </div>
            </div>
          </section>

          <section className="projectMetricGrid" aria-label="Project metrics">
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">TK</span>
              <div>
                <strong>{activeTaskCount}</strong>
                <span>Active tasks</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">M1</span>
              <div>
                <strong>{milestones.length}</strong>
                <span>Milestones</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">FL</span>
              <div>
                <strong>{projectedFiles.length}</strong>
                <span>Shared files</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className={`projectPill ${catalogTone}`}>{catalogLabel}</span>
              <div>
                <strong>{projectRuns.length}</strong>
                <span>Dry runs</span>
              </div>
            </article>
          </section>

          <div className="projectBoardGrid">
            <section className="projectPanel projectGlass">
              <div className="projectCardHeader">
                <h3>{boardTitle}</h3>
                <div className="projectTabs" role="tablist" aria-label="Project board sections">
                  {(['overview', 'tasks', 'files'] as BoardView[]).map((view) => (
                    <button
                      aria-selected={activeView === view}
                      className={activeView === view ? 'projectTab isActive' : 'projectTab'}
                      key={view}
                      onClick={() => setActiveView(view)}
                      role="tab"
                      type="button"
                    >
                      {viewLabels[view]}
                    </button>
                  ))}
                </div>
              </div>

              {activeView === 'overview' ? (
                <div className="projectList">
                  {filteredProjects.length > 0 ? (
                    filteredProjects.map((project) => (
                    <article className="projectRow" key={project.name}>
                      <div className="projectRowTitle">
                        <span className="projectIconTile">{project.code}</span>
                        <div>
                          <strong>{project.name}</strong>
                          <p className="projectMuted">{project.detail}</p>
                        </div>
                      </div>
                      <span className={`projectPill ${statusTone(project.status)}`}>{project.status}</span>
                    </article>
                    ))
                  ) : (
                    <div className="projectEmptyState">
                      <strong>No projects match this search.</strong>
                      <span>Clear the search box to restore the overview list.</span>
                    </div>
                  )}
                </div>
              ) : null}

              {activeView === 'tasks' ? (
                <div className="projectList">
                  <div className="projectFilterBar">
                    <span className="projectMuted">
                      {completedTaskCount} done / {projectTasks.length} total
                    </span>
                    <button className="projectSecondaryButton" onClick={openTaskPanel} type="button">
                      New task
                    </button>
                  </div>
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map((task) => (
                    <article className={task.status === 'Done' ? 'projectTaskRow done' : 'projectTaskRow'} key={task.id}>
                      <span className="projectCheck">{task.status === 'Done' ? 'OK' : 'IN'}</span>
                      <div>
                        <strong>{task.title}</strong>
                        <p className="projectMuted">
                          {task.owner}: {task.detail}
                        </p>
                      </div>
                      <span className={`projectPill ${statusTone(task.status)}`}>{task.status}</span>
                      <div className="projectInlineActions">
                        <button className="projectMiniButton" onClick={() => toggleTaskStatus(task.id)} type="button">
                          {taskActionLabel(task.status)}
                        </button>
                      </div>
                    </article>
                    ))
                  ) : (
                    <div className="projectEmptyState">
                      <strong>No tasks are visible.</strong>
                      <span>Clear search or add a local task to repopulate the board.</span>
                    </div>
                  )}
                </div>
              ) : null}

              {activeView === 'files' ? (
                <div className="projectStack">
                  <div className="projectFilterBar">
                    <div className="projectFilterGroup" aria-label="File type filters">
                      <span className="projectFilterLabel">Files</span>
                      {fileFilters.map((filter) => (
                        <button
                          className={fileFilter === filter ? 'projectMiniButton isActive' : 'projectMiniButton'}
                          key={filter}
                          onClick={() => setFileFilter(filter)}
                          type="button"
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                    <div className="projectFilterGroup" aria-label="Run status filters">
                      <span className="projectFilterLabel">Runs</span>
                      {runFilters.map((filter) => (
                        <button
                          className={runFilter === filter ? 'projectMiniButton isActive' : 'projectMiniButton'}
                          key={filter}
                          onClick={() => setRunFilter(filter)}
                          type="button"
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="projectList">
                    {filteredFiles.length > 0 ? (
                      filteredFiles.map((file) => (
                        <article className="projectFileRow" key={file.name}>
                          <span className="projectFileType">{file.type}</span>
                          <div>
                            <strong>{file.name}</strong>
                            <p className="projectMuted">{file.detail}</p>
                          </div>
                          <span className={`projectPill ${statusTone(file.status)}`}>{file.status}</span>
                        </article>
                      ))
                    ) : (
                      <div className="projectEmptyState">
                        <strong>No files match this filter.</strong>
                        <span>Use All or clear search to show project files.</span>
                      </div>
                    )}
                  </div>

                  <div className="projectList" aria-label="Run records">
                    {filteredRuns.length > 0 ? (
                      filteredRuns.map((run) => (
                        <article className="projectRunRow" key={run.id}>
                          <span className="projectRunIcon">RN</span>
                          <div>
                            <strong>{run.id}</strong>
                            <p className="projectMuted">{run.detail}</p>
                            <div className="projectMetaLine">
                              <span className="projectPill blue">{run.time}</span>
                            </div>
                          </div>
                          <span className={`projectPill ${statusTone(run.status)}`}>{run.status}</span>
                        </article>
                      ))
                    ) : (
                      <div className="projectEmptyState">
                        <strong>No run records match this filter.</strong>
                        <span>Run a local sync or switch the run status filter.</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="projectSideStack">
              <section className="projectPanel projectGlass">
                <div className="projectCardHeader">
                  <h3>Milestones</h3>
                  <span className="projectPill blue">M1</span>
                </div>
                <div className="projectList">
                  {milestones.map((milestone, index) => (
                    <article className="projectMilestoneRow" key={milestone.title}>
                      <span className={index === 1 ? 'projectDot cyan' : index === 2 ? 'projectDot purple' : 'projectDot'} />
                      <div>
                        <strong>{milestone.title}</strong>
                        <p className="projectMuted">{milestone.detail}</p>
                      </div>
                      <span className={`projectPill ${statusTone(milestone.status)}`}>{milestone.status}</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="projectPanel projectGlass">
                <div className="projectCardHeader">
                  <h3>Risks</h3>
                  <span className={`projectPill ${openRiskCount === 0 ? 'green' : 'amber'}`}>
                    {openRiskCount === 0 ? 'Reviewed' : 'Needs review'}
                  </span>
                </div>
                <div className="projectList">
                  {projectRisks.map((risk) => (
                    <article className="projectRiskRow" key={risk.id}>
                      <div>
                        <strong>{risk.title}</strong>
                        <p className="projectMuted">{risk.detail}</p>
                      </div>
                      <span className={`projectPill ${statusTone(risk.status)}`}>{risk.status}</span>
                      <button
                        className="projectMiniButton"
                        disabled={!risk.reviewable}
                        onClick={() => toggleRisk(risk.id)}
                        type="button"
                      >
                        {risk.reviewable && risk.status === 'Reviewed' ? 'Reopen' : 'Review'}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>

      {isTaskPanelOpen ? (
        <aside className="projectDrawer projectGlass" aria-label="New task panel">
          <div className="projectCardHeader">
            <h3>New task draft</h3>
            <button className="projectIconButton" onClick={closeTaskPanel} type="button" aria-label="Close">
              X
            </button>
          </div>
          <p className="projectMuted">
            This panel is local UI only. It demonstrates how the project page will expose task creation without connecting
            a backend.
          </p>
          <div className="projectField">
            <label htmlFor="task-title">Title</label>
            <input
              id="task-title"
              onChange={(event) => updateTaskForm('title', event.target.value)}
              value={taskForm.title}
            />
          </div>
          <div className="projectField">
            <label htmlFor="task-owner">Owner</label>
            <input
              id="task-owner"
              onChange={(event) => updateTaskForm('owner', event.target.value)}
              value={taskForm.owner}
            />
          </div>
          <div className="projectField">
            <label htmlFor="task-note">Note</label>
            <textarea
              id="task-note"
              onChange={(event) => updateTaskForm('detail', event.target.value)}
              value={taskForm.detail}
            />
          </div>
          <div className="projectButtonRow">
            <button className="projectPrimaryButton" disabled={!canSaveTask} onClick={saveTask} type="button">
              Save draft locally
            </button>
            <button className="projectSecondaryButton" onClick={closeTaskPanel} type="button">
              Close
            </button>
          </div>
          {!canSaveTask ? <span className="projectSyncMessage warning">Title and owner are required.</span> : null}
        </aside>
      ) : null}
    </div>
  );
}

export default ProjectPageInteractive;
