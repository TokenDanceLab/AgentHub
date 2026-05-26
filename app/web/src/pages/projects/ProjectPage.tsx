<<<<<<< HEAD
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  mockProjects,
  mockRuns,
  mockWorkspaceFiles,
  mockRunners,
  getWorkbenchCatalogState,
  getWorkbenchSectionSource,
  type Artifact,
  type Project,
  type Run,
  type Runner,
  type WorkbenchSectionSource,
} from '@shared/index';
import { useWorkbenchProjection } from '../../hooks/useWorkbenchProjection';
=======
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, Pill, SearchInput, ProgressBar } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './ProjectPage.module.css';

/* ---- inline mock data (static prototype) ---- */

type MockProject = { id: string; name: string; description: string };
type MockRun = { runId: string; threadId: string; projectId: string; status: string; createdAt: string };
type MockFile = { path: string; sizeBytes: number; modifiedAt: string };
type MockRunner = { id: string; name: string };

const mockProjects: MockProject[] = [
  { id: 'proj_ui_coord', name: 'UI Coordination', description: 'Frontend page preview, CSS modules migration, and reactive coordination across workbench and agent pages.' },
  { id: 'proj_api_contract', name: 'API Contract Review', description: 'Review endpoint contracts, event streams, and type safety for the agent hub unified API surface.' },
  { id: 'proj_infra', name: 'Infrastructure Migration', description: 'Deploy preview pipeline and edge server configuration for the next reactive page milestone.' },
];

const mockRuns: MockRun[] = [
  { runId: 'run_ui_pass', threadId: 'thread-01', projectId: 'proj_ui_coord', status: 'running', createdAt: '2026-05-24T08:00:00Z' },
  { runId: 'run_api_smoke', threadId: 'thread-02', projectId: 'proj_api_contract', status: 'finished', createdAt: '2026-05-24T07:30:00Z' },
  { runId: 'run_infra_test', threadId: 'thread-03', projectId: 'proj_infra', status: 'queued', createdAt: '2026-05-24T08:15:00Z' },
];

const mockWorkspaceFiles: MockFile[] = [
  { path: 'src/pages/AgentSquarePage.tsx', sizeBytes: 14 * 1024, modifiedAt: '2026-05-23' },
  { path: 'src/pages/PrivateChatsPage.tsx', sizeBytes: 18 * 1024, modifiedAt: '2026-05-24' },
  { path: 'docs/api-spec.md', sizeBytes: 3 * 1024, modifiedAt: '2026-05-22' },
  { path: 'deploy/helm-values.yaml', sizeBytes: 2 * 1024, modifiedAt: '2026-05-20' },
];

const mockRunners: MockRunner[] = [
  { id: 'runner-001', name: 'Frontend page coordinator' },
  { id: 'runner-002', name: 'API review agent' },
  { id: 'runner-003', name: 'Infra specialist' },
];
>>>>>>> origin/dev/delicious233

type BoardView = 'overview' | 'tasks' | 'files';
type TaskStatus = 'Done' | 'Active' | 'Next';
type FileType = 'TSX' | 'DOC';
type FileFilter = 'All' | FileType;
type RunStatus = 'Pass' | 'Ready' | 'Deferred' | 'Local';
type RunFilter = 'All' | RunStatus;
type NoticeTone = 'success' | 'info' | 'warning';

<<<<<<< HEAD
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
=======
type Task = { id: string; title: string; owner: string; status: TaskStatus; detail: string };
type FileItem = { name: string; type: FileType; status: string; detail: string };
type RunRecord = { id: string; status: RunStatus; detail: string; time: string };
type RiskItem = { id: string; title: string; detail: string; status: 'Open' | 'Reviewed' | 'Tracked'; reviewable: boolean };
type TaskForm = { title: string; owner: string; detail: string };
type Notice = { tone: NoticeTone; message: string };
>>>>>>> origin/dev/delicious233

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
<<<<<<< HEAD
  {
    id: 'risk-no-api',
    title: 'Edge snapshot fallback',
    detail: 'Live Edge data is preferred; demo fallback data is labeled when that section has no snapshot data.',
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

function demoProjectCard(project: ReturnType<typeof projectFromApi>, label: (detail: string) => string) {
  return {
    ...project,
    detail: label(project.detail),
  };
}

function demoTaskCard(task: Task, label: (detail: string) => string) {
  return {
    ...task,
    detail: label(task.detail),
  };
}

function demoFileCard(file: FileItem, label: (detail: string) => string) {
  return {
    ...file,
    detail: label(file.detail),
  };
}

function demoRunCard(run: RunRecord, label: (detail: string) => string) {
  return {
    ...run,
    detail: label(run.detail),
  };
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

function sourceLabelKey(label: string) {
  if (label === 'Edge snapshot') return 'source.edgeSnapshot';
  if (label === 'Offline snapshot') return 'source.offlineSnapshot';
  if (label === 'Loading snapshot') return 'source.loadingSnapshot';
  if (label === 'Mock fallback') return 'source.mockFallback';
  if (label === 'Snapshot unavailable') return 'source.snapshotUnavailable';
  if (label.startsWith('Local dry-run / ')) return 'source.localDryRun';
  return 'source.snapshotUnavailable';
}

function SourceLabel({ source }: { source: WorkbenchSectionSource }) {
  const { t } = useTranslation('project');
  const baseLabel = source.label.startsWith('Local dry-run / ')
    ? source.label.replace('Local dry-run / ', '')
    : source.label;

  return (
    <span className={`projectSourceLabel ${source.tone}`}>
      {source.label.startsWith('Local dry-run / ')
        ? t('source.localDryRun', { source: t(sourceLabelKey(baseLabel)) })
        : t(sourceLabelKey(source.label))}
    </span>
  );
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
    box-shadow: 0 10px 22px var(--brand-glow);
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

  .projectHeaderActions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
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

  .projectSourceLabel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 22px;
    padding: 4px 8px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    color: var(--text-muted);
    background: rgba(148, 163, 184, 0.1);
    font-size: 10px;
    font-weight: 900;
    line-height: 1;
    white-space: nowrap;
  }

  .projectSourceLabel.green {
    color: var(--success);
    border-color: rgba(5, 150, 105, 0.18);
    background: var(--success-bg);
  }

  .projectSourceLabel.purple {
    color: var(--accent);
    border-color: rgba(124, 58, 237, 0.18);
    background: rgba(124, 58, 237, 0.1);
  }

  .projectSourceLabel.amber {
    color: var(--warning-dot);
    border-color: rgba(217, 119, 6, 0.2);
    background: rgba(217, 119, 6, 0.12);
  }

  .projectSourceLabel.cyan {
    color: var(--accent);
    border-color: rgba(8, 145, 178, 0.18);
    background: rgba(8, 145, 178, 0.1);
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

=======
  { id: 'risk-no-api', title: 'No live API yet', detail: 'All data is static and safe for page coordination.', status: 'Open', reviewable: true },
  { id: 'risk-parallel-edits', title: 'Parallel page edits', detail: 'This worker only changes ProjectPageInteractive.tsx.', status: 'Tracked', reviewable: false },
  { id: 'risk-local-only', title: 'Local-only state', detail: 'New tasks, risk review, filters, and sync runs reset after refresh.', status: 'Open', reviewable: true },
];

const milestones = [
  { title: 'Preview shell locked', detail: 'Route preview and project page layout are stable enough for review.', status: 'Done' },
  { title: 'Stateful React copy', detail: 'Tabs, task panel, risk review, and sync feedback are visible.', status: 'Active' },
  { title: 'Real API pass', detail: 'Deferred until contracts and backend mocks settle.', status: 'Later' },
];

function statusTone(status: string): 'blue' | 'cyan' | 'purple' | 'green' | 'amber' {
  if (status === 'Done' || status === 'Pass' || status === 'Reviewed') return 'green';
  if (status === 'Review' || status === 'Ready' || status === 'Local') return 'cyan';
  if (status === 'Queued' || status === 'Later' || status === 'Deferred') return 'purple';
  if (status === 'Next' || status === 'Open') return 'amber';
>>>>>>> origin/dev/delicious233
  return 'blue';
}

function matchesQuery(fields: string[], query: string) {
<<<<<<< HEAD
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

export function ProjectPageInteractive() {
  const { t } = useTranslation('project');
  const workbenchState = useWorkbenchProjection();
  const {
    hasLiveCatalog,
    label: catalogLabel,
    message: catalogDetail,
    mode: catalogMode,
    tone: catalogTone,
  } = getWorkbenchCatalogState(workbenchState);
  const projectSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.projects.length > 0,
  });
  const fileSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.artifacts.length > 0,
  });
  const shouldUseDemoFallback = catalogMode === 'mock';
  const demoDetailLabel = (detail: string) => t('demo.cardDetail', { detail });
  const demoProjects = useMemo(
    () => projects.map((project) => demoProjectCard(project, demoDetailLabel)),
    [t],
  );
  const demoTasks = useMemo(
    () => initialTasks.map((task) => demoTaskCard(task, demoDetailLabel)),
    [t],
  );
  const demoFiles = useMemo(
    () => initialFiles.map((file) => demoFileCard(file, demoDetailLabel)),
    [t],
  );
  const demoRuns = useMemo(
    () => initialRuns.map((run) => demoRunCard(run, demoDetailLabel)),
    [t],
  );
  const projectedProjects = hasLiveCatalog && workbenchState.projects.length
    ? workbenchState.projects.map(projectFromApi)
    : shouldUseDemoFallback
      ? demoProjects
      : [];
  const projectedTasks = hasLiveCatalog && workbenchState.runs.length
    ? workbenchState.runs.map((run, index) => taskFromRun(run, index, workbenchState.runners))
    : shouldUseDemoFallback
      ? demoTasks
      : [];
  const projectedFiles = hasLiveCatalog && workbenchState.artifacts.length
    ? workbenchState.artifacts.map(fileFromArtifact)
    : shouldUseDemoFallback
      ? demoFiles
      : [];
  const projectedRuns = hasLiveCatalog && workbenchState.runs.length
    ? workbenchState.runs.map(runRecordFromApi)
    : shouldUseDemoFallback
      ? demoRuns
      : [];
=======
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}
>>>>>>> origin/dev/delicious233

  const viewLabels: Record<BoardView, string> = {
    overview: t('sidebar.navOverview'),
    tasks: t('sidebar.navTasks'),
    files: t('sidebar.navFiles'),
  };

  const statusLabels: Record<string, string> = {
    Done: t('status.done'),
    Active: t('status.active'),
    Next: t('status.next'),
    'In progress': t('status.inProgress'),
    Pass: t('status.pass'),
    Ready: t('status.ready'),
    Deferred: t('status.deferred'),
    Local: t('status.local'),
    Reviewed: t('status.reviewed'),
    Open: t('status.open'),
    Tracked: t('status.tracked'),
    Edited: t('status.edited'),
    Later: t('status.later'),
  };

  const statusLabel = (status: string) => statusLabels[status] || status;

  const taskActionLabel = (status: TaskStatus) => {
    if (status === 'Next') return t('actions.start');
    if (status === 'Active') return t('actions.markDone');
    return t('actions.reopen');
  };

<<<<<<< HEAD
=======
export function ProjectPage() {
  const { t } = useTranslation();
>>>>>>> origin/dev/delicious233
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
  const taskSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.runs.length > 0,
    hasLocalDryRun: localTasks.length > 0,
  });
  const runSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.runs.length > 0,
    hasLocalDryRun: localRuns.length > 0,
  });

  const canSaveTask = taskForm.title.trim().length > 0 && taskForm.owner.trim().length > 0;
<<<<<<< HEAD
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
      return t('confirm.openRisksRemaining', { count: openRiskCount });
    }

    return t('confirm.activeTasksRemaining', { count: activeTaskCount });
  }, [activeTaskCount, notice, openRiskCount, t]);

  const boardTitle = useMemo(() => {
    if (activeView === 'tasks') {
      return t('board.tasksTitle', { count: filteredTasks.length });
    }

    if (activeView === 'files') {
      return t('board.filesTitle', { files: filteredFiles.length, runs: filteredRuns.length });
    }

    return t('board.overviewTitle', { count: filteredProjects.length });
  }, [activeView, filteredFiles.length, filteredProjects.length, filteredRuns.length, filteredTasks.length, t]);

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
        message: t('confirm.saveValidation'),
      });
      return;
    }

    const newTask: Task = {
      id: `local-task-${Date.now().toString(36)}`,
      title: taskForm.title.trim(),
      owner: taskForm.owner.trim(),
      status: 'Next',
      detail: taskForm.detail.trim() || t('confirm.fallbackNote'),
    };

    setLocalTasks((current) => [newTask, ...current]);
    setTaskForm(emptyTaskForm);
    setIsTaskPanelOpen(false);
    setActiveView('tasks');
    setNotice({
      tone: 'success',
      message: t('confirm.taskSaved', { title: newTask.title }),
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
      message: t('confirm.taskMoved', { title: currentTask.title, status: statusLabel(nextStatus) }),
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
          ? t('confirm.riskReviewed', { title: currentRisk.title })
          : t('confirm.riskReopened', { title: currentRisk.title }),
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
          ? t('confirm.allRisksReviewed')
          : t('confirm.allRisksReopened'),
    });
=======
  const completedTaskCount = projectTasks.filter((t) => t.status === 'Done').length;
  const activeTaskCount = projectTasks.filter((t) => t.status !== 'Done').length;
  const deliveryProgress = Math.round((completedTaskCount / Math.max(projectTasks.length, 1)) * 100);
  const reviewableRisks = projectRisks.filter((r) => r.reviewable);
  const openRiskCount = projectRisks.filter((r) => r.status === 'Open').length;
  const reviewedRiskCount = projectRisks.filter((r) => r.status === 'Reviewed').length;
  const riskProgress = Math.round((reviewedRiskCount / Math.max(reviewableRisks.length, 1)) * 100);
  const allReviewableRisksClosed = reviewableRisks.every((r) => r.status === 'Reviewed');

  const filteredProjects = useMemo(() => projects.filter((p) => matchesQuery([p.name, p.detail, p.status], searchTerm)), [searchTerm]);
  const filteredTasks = useMemo(() => projectTasks.filter((t) => matchesQuery([t.title, t.owner, t.detail, t.status], searchTerm)), [projectTasks, searchTerm]);
  const filteredFiles = useMemo(() => initialFiles.filter((f) => (fileFilter === 'All' || f.type === fileFilter) && matchesQuery([f.name, f.type, f.status, f.detail], searchTerm)), [fileFilter, searchTerm]);
  const filteredRuns = useMemo(() => projectRuns.filter((r) => (runFilter === 'All' || r.status === runFilter) && matchesQuery([r.id, r.status, r.detail, r.time], searchTerm)), [projectRuns, runFilter, searchTerm]);

  const activityPrompt = useMemo(() => {
    if (notice) return notice.message;
    if (openRiskCount > 0) return `${openRiskCount} open risk${openRiskCount === 1 ? '' : 's'} still need review.`;
    return `${activeTaskCount} active task${activeTaskCount === 1 ? '' : 's'} remain after local review.`;
  }, [activeTaskCount, notice, openRiskCount]);

  const boardTitle = useMemo(() => {
    if (activeView === 'tasks') return t('pj.board.tasks', { count: filteredTasks.length });
    if (activeView === 'files') return t('pj.board.files', { count: filteredFiles.length });
    return t('pj.board.overview', { count: filteredProjects.length });
  }, [activeView, filteredFiles.length, filteredProjects.length, filteredTasks.length, t]);

  /* ---- Actions ---- */
  const openTaskPanel = () => { setIsTaskPanelOpen(true); setNotice(null); };
  const closeTaskPanel = () => setIsTaskPanelOpen(false);
  const updateTaskForm = (field: keyof TaskForm, value: string) => setTaskForm((cur) => ({ ...cur, [field]: value }));

  const saveTask = () => {
    if (!canSaveTask) { setNotice({ tone: 'warning', message: 'Add a task title and owner before saving.' }); return; }
    const newTask: Task = { id: `local-task-${Date.now().toString(36)}`, title: taskForm.title.trim(), owner: taskForm.owner.trim(), status: 'Next', detail: taskForm.detail.trim() || 'No additional note was added.' };
    setProjectTasks((cur) => [...cur, newTask]);
    setTaskForm(emptyTaskForm);
    setIsTaskPanelOpen(false);
    setActiveView('tasks');
    setNotice({ tone: 'success', message: `Saved "${newTask.title}" as a local task.` });
  };

  const toggleTaskStatus = (taskId: string) => {
    const ct = projectTasks.find((t) => t.id === taskId);
    if (!ct) return;
    const ns = nextTaskStatus(ct.status);
    setProjectTasks((cur) => cur.map((t) => t.id === taskId ? { ...t, status: ns } : t));
    setNotice({ tone: ns === 'Done' ? 'success' : 'info', message: `"${ct.title}" moved to ${ns}.` });
  };

  const toggleRisk = (riskId: string) => {
    const cr = projectRisks.find((r) => r.id === riskId);
    if (!cr || !cr.reviewable) return;
    const ns = cr.status === 'Reviewed' ? 'Open' : 'Reviewed' as const;
    setProjectRisks((cur) => cur.map((r) => r.id === riskId ? { ...r, status: ns } : r));
    setNotice({ tone: ns === 'Reviewed' ? 'success' : 'warning', message: ns === 'Reviewed' ? `"${cr.title}" marked reviewed.` : `"${cr.title}" reopened for review.` });
  };

  const toggleAllReviewableRisks = () => {
    const ns = allReviewableRisksClosed ? 'Open' : 'Reviewed' as const;
    setProjectRisks((cur) => cur.map((r) => r.reviewable ? { ...r, status: ns } : r));
    setNotice({ tone: ns === 'Reviewed' ? 'success' : 'warning', message: ns === 'Reviewed' ? 'All reviewable risks are marked reviewed.' : 'Reviewable risks were reopened.' });
>>>>>>> origin/dev/delicious233
  };

  const simulateSync = () => {
    const syncTime = formatLocalTime();
<<<<<<< HEAD
    const syncRun: RunRecord = {
      id: `local-sync-${String(projectRuns.length + 1).padStart(3, '0')}`,
      status: 'Local',
      detail: t('confirm.localSyncDetail', { tasks: activeTaskCount, risks: openRiskCount }),
      time: syncTime,
    };

    setLastSyncAt(syncTime);
    setSyncStatus('Local sync complete');
    setLocalRuns((current) => [syncRun, ...current]);
    setRunFilter('All');
    setNotice({
      tone: 'info',
      message: t('confirm.syncComplete', { time: syncTime }),
    });
  };

  return (
    <div className="projectReactRoot">
      <style>{pageStyles}</style>
      <ProjectParticles />

      <div className="projectReactShell">
        <aside className="projectSidebar projectGlass" aria-label={t('sidebar.navigationAria')}>
          <div className="projectBrand">
            <span className="projectBrandMark">AH</span>
            <div className="projectTitle">
              <h2>{t('sidebar.brandName')}</h2>
              <p>{t('sidebar.workspaceLabel')}</p>
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
              <span>{t('sidebar.navNewTask')}</span>
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
              <span>{t('header.searchLabel')}</span>
              <input
                aria-label={t('header.searchAria')}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t('header.searchPlaceholder')}
                value={searchTerm}
              />
            </label>
            <div className="projectTopActions">
              <button
                className="projectIconButton"
                disabled={!searchTerm}
                onClick={() => setSearchTerm('')}
                type="button"
                aria-label={t('header.clearSearch')}
              >
                C
              </button>
              <button className="projectIconButton" type="button" aria-label={t('header.notifications')}>
                N
              </button>
              <button className="projectIconButton" type="button" aria-label={t('header.settings')}>
                S
              </button>
              <div className="projectAvatar" aria-label={t('header.currentUser')}>
                PM
              </div>
            </div>
          </header>

          <section className="projectHero projectGlass">
            <div>
              <p className="projectEyebrow">{t('hero.eyebrow')}</p>
              <h2>Workspace Preview Foundation</h2>
              <p>{t('hero.description')}</p>
              <div className="projectButtonRow">
                <button
                  className="projectPrimaryButton"
                  onClick={simulateSync}
                  type="button"
                >
                  {syncStatus === 'Idle' ? t('hero.simulateSync') : t('hero.syncAgain')}
                </button>
                <button
                  className="projectSecondaryButton"
                  disabled={reviewableRisks.length === 0}
                  onClick={toggleAllReviewableRisks}
                  type="button"
                >
                  {allReviewableRisksClosed ? t('hero.reopenRisks') : t('hero.markRisksReviewed')}
                </button>
                <button className="projectGhostButton" onClick={openTaskPanel} type="button">
                  {t('hero.newTask')}
                </button>
                {notice ? <span className={`projectSyncMessage ${notice.tone}`}>{notice.message}</span> : null}
              </div>
            </div>

            <div className="projectHeroSide">
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>{t('hero.deliveryProgress')}</span>
                  <strong>{deliveryProgress}%</strong>
                </div>
                <div className="projectMeter" aria-label={t('hero.deliveryProgressAria', { percent: deliveryProgress })}>
                  <span style={{ width: `${deliveryProgress}%` }} />
                </div>
              </div>
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>{t('hero.openRisks')}</span>
                  <strong>{openRiskCount}</strong>
                </div>
                <div className="projectMeter" aria-label={t('hero.riskReviewAria')}>
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
                  <span>{t('hero.catalogStatus')}</span>
                  <strong>{catalogLabel}</strong>
                </div>
                <p className="projectMuted">{syncStatus === 'Idle' ? t('status.idle') : syncStatus === 'Local sync complete' ? t('status.localSyncComplete') : syncStatus} - {lastSyncAt === 'Not synced yet' ? t('status.notSyncedYet') : lastSyncAt}</p>
=======
    const syncRun: RunRecord = { id: `local-sync-${String(projectRuns.length + 1).padStart(3, '0')}`, status: 'Local', detail: `Local sync captured ${activeTaskCount} active tasks and ${openRiskCount} open risks.`, time: syncTime };
    setLastSyncAt(syncTime);
    setSyncStatus('Local sync complete');
    setProjectRuns((cur) => [syncRun, ...cur]);
    setRunFilter('All');
    setNotice({ tone: 'info', message: `Sync updated local run records at ${syncTime}.` });
  };

  const taskActionLabel = (s: TaskStatus) => s === 'Next' ? t('pj.tasks.start') : s === 'Active' ? t('pj.tasks.markDone') : t('pj.tasks.reopen');

  /* ---- Nav items ---- */
  const navItems = [
    { icon: 'overview', label: t('pj.nav.overview'), active: activeView === 'overview', onClick: () => setActiveView('overview') },
    { icon: 'checklist', label: t('pj.nav.tasks'), active: activeView === 'tasks', onClick: () => setActiveView('tasks') },
    { icon: 'folder', label: t('pj.nav.files'), active: activeView === 'files', onClick: () => setActiveView('files') },
  ];

  const sidebarAction = (
    <Button variant="primary" size="md" onClick={openTaskPanel} style={{ width: '100%' }}>
      <Icon name="add" size={16} />{t('pj.nav.newTask')}
    </Button>
  );

  const sidebarBottom = (
    <div className={styles.sidebarSignal}>
      <strong className={styles.sidebarSignalTitle}>{t('pj.sidebar.signal')}</strong>
      <span className={styles.sidebarSignalText}>{activityPrompt}</span>
    </div>
  );

  /* ---- Drawer: task creation ---- */
  const drawer = isTaskPanelOpen ? (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
        <h3 className={styles.drawerTitle}>{t('pj.drawer.title')}</h3>
        <Button variant="icon" onClick={closeTaskPanel} aria-label="Close"><Icon name="close" /></Button>
      </div>
      <p className={styles.drawerHint}>{t('pj.drawer.description')}</p>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-title">{t('pj.drawer.fieldTitle')}</label>
        <input id="task-title" className={styles.fieldInput} value={taskForm.title} onChange={(e) => updateTaskForm('title', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-owner">{t('pj.drawer.fieldOwner')}</label>
        <input id="task-owner" className={styles.fieldInput} value={taskForm.owner} onChange={(e) => updateTaskForm('owner', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-note">{t('pj.drawer.fieldNote')}</label>
        <textarea id="task-note" className={styles.fieldTextarea} value={taskForm.detail} onChange={(e) => updateTaskForm('detail', e.target.value)} />
      </div>
      <div className={styles.drawerActions}>
        <Button variant="primary" disabled={!canSaveTask} onClick={saveTask}>{t('pj.drawer.save')}</Button>
        <Button variant="secondary" onClick={closeTaskPanel}>{t('pj.drawer.close')}</Button>
      </div>
      {!canSaveTask ? <span className={styles.drawerWarning}>{t('pj.drawer.required')}</span> : null}
    </>
  ) : undefined;

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />
      <WebLayout
        brandName={t('pj.brand')}
        brandSubtitle={t('pj.subtitle')}
        navItems={navItems}
        sidebarAction={sidebarAction}
        sidebarBottom={sidebarBottom}
        topbarLeft={<SearchInput placeholder={t('pj.topbar.search')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />}
        topbarRight={
          <div className={styles.topbarActions}>
            <Button variant="icon" disabled={!searchTerm} onClick={() => setSearchTerm('')} aria-label="Clear search"><Icon name="close" /></Button>
            <Button variant="icon" aria-label="Notifications"><Icon name="notifications" /></Button>
            <Button variant="icon" aria-label="Settings"><Icon name="settings" /></Button>
            <div className={styles.avatarBtn} aria-label="Current user">PM</div>
          </div>
        }
        drawer={drawer}
      >
        <div className={styles.scrollArea}>
          {/* Hero */}
          <section className={styles.hero}>
            <div>
              <p className={styles.heroEyebrow}>{t('pj.hero.eyebrow')}</p>
              <h2 className={styles.heroTitle}>{t('pj.hero.title')}</h2>
              <p className={styles.heroDesc}>{t('pj.hero.description')}</p>
              <div className={styles.heroActions}>
                <Button variant="primary" onClick={simulateSync}>{syncStatus === 'Idle' ? t('pj.hero.sync') : t('pj.hero.syncAgain')}</Button>
                <Button variant="secondary" disabled={reviewableRisks.length === 0} onClick={toggleAllReviewableRisks}>
                  {allReviewableRisksClosed ? t('pj.hero.risksReopen') : t('pj.hero.risksReviewed')}
                </Button>
                <Button variant="ghost" onClick={openTaskPanel}>{t('pj.hero.newTask')}</Button>
                {notice ? <span className={`${styles.syncMessage} ${notice.tone === 'success' ? styles.syncSuccess : notice.tone === 'warning' ? styles.syncWarning : ''}`}>{notice.message}</span> : null}
              </div>
            </div>
            <div className={styles.heroSide}>
              <div className={styles.progressCard}>
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{t('pj.progress.delivery')}</span>
                  <strong className={styles.progressValue}>{deliveryProgress}%</strong>
                </div>
                <ProgressBar value={deliveryProgress} label={`${deliveryProgress}%`} />
              </div>
              <div className={styles.progressCard}>
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{t('pj.progress.openRisks')}</span>
                  <strong className={styles.progressValue}>{openRiskCount}</strong>
                </div>
                <ProgressBar value={riskProgress} />
              </div>
              <div className={styles.progressCard}>
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{t('pj.progress.syncStatus')}</span>
                  <strong className={styles.progressValue}>{syncStatus === 'Idle' ? t('pj.progress.idle') : t('pj.progress.complete')}</strong>
                </div>
                <p className={styles.progressMuted}>{lastSyncAt === 'Not synced yet' ? t('pj.progress.notSynced') : lastSyncAt}</p>
>>>>>>> origin/dev/delicious233
              </div>
            </div>
          </section>

<<<<<<< HEAD
          <section className="projectMetricGrid" aria-label={t('metrics.aria')}>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">TK</span>
              <div>
                <strong>{activeTaskCount}</strong>
                <span>
                  {shouldUseDemoFallback
                    ? t('metrics.demoActiveTasks', { defaultValue: t('metrics.activeTasks') })
                    : t('metrics.activeTasks')}
                </span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">M1</span>
              <div>
                <strong>{milestones.length}</strong>
                <span>
                  {shouldUseDemoFallback
                    ? t('metrics.demoMilestones')
                    : t('metrics.milestones')}
                </span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">FL</span>
              <div>
                <strong>{projectedFiles.length}</strong>
                <span>
                  {shouldUseDemoFallback
                    ? t('metrics.demoSharedFiles', { defaultValue: t('metrics.sharedFiles') })
                    : t('metrics.sharedFiles')}
                </span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className={`projectPill ${catalogTone}`}>{catalogLabel}</span>
              <div>
                <strong>{projectRuns.length}</strong>
                <span>
                  {shouldUseDemoFallback
                    ? t('metrics.demoDryRuns', { defaultValue: t('metrics.dryRuns') })
                    : t('metrics.dryRuns')}
                </span>
=======
          {/* Metrics */}
          <section className={styles.metricsGrid} aria-label="Project metrics">
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>TK</span>
              <div>
                <span className={styles.metricValue}>{activeTaskCount}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.activeTasks')}</span>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>M1</span>
              <div>
                <span className={styles.metricValue}>{milestones.length}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.milestones')}</span>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>FL</span>
              <div>
                <span className={styles.metricValue}>{initialFiles.length}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.sharedFiles')}</span>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>RN</span>
              <div>
                <span className={styles.metricValue}>{projectRuns.length}</span>
                <span className={styles.metricLabel}>{t('pj.metrics.dryRuns')}</span>
>>>>>>> origin/dev/delicious233
              </div>
            </article>
          </section>

<<<<<<< HEAD
          <div className="projectBoardGrid">
            <section className="projectPanel projectGlass">
              <div className="projectCardHeader">
                <h3>{boardTitle}</h3>
                <div className="projectHeaderActions">
                  <SourceLabel source={activeView === 'tasks' ? taskSource : activeView === 'files' ? fileSource : projectSource} />
                  <div className="projectTabs" role="tablist" aria-label={t('board.tabsAria')}>
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
                      <span className={`projectPill ${statusTone(project.status)}`}>{statusLabel(project.status)}</span>
                    </article>
                    ))
                  ) : (
                    <div className="projectEmptyState">
                      <strong>{t('overview.emptyTitle')}</strong>
                      <span>{t('overview.emptyHint')}</span>
=======
          {/* Board grid */}
          <div className={styles.boardGrid}>
            {/* Main panel */}
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>{boardTitle}</h3>
                <div className={styles.tabBar} role="tablist" aria-label="Project board sections">
                  {(['overview', 'tasks', 'files'] as BoardView[]).map((view) => (
                    <button
                      key={view}
                      role="tab"
                      type="button"
                      aria-selected={activeView === view}
                      className={activeView === view ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setActiveView(view)}
                    >
                      {view === 'overview' ? t('pj.nav.overview') : view === 'tasks' ? t('pj.nav.tasks') : t('pj.nav.files')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Overview */}
              {activeView === 'overview' ? (
                <div className={styles.list}>
                  {filteredProjects.length > 0 ? (
                    filteredProjects.map((project) => (
                      <article className={styles.projectRow} key={project.name}>
                        <div className={styles.rowTitle}>
                          <span className={styles.iconTile}>{project.code}</span>
                          <div>
                            <span className={styles.rowName}>{project.name}</span>
                            <p className={styles.rowDetail}>{project.detail}</p>
                          </div>
                        </div>
                        <Pill variant={statusTone(project.status) === 'green' ? 'green' : statusTone(project.status) === 'cyan' ? 'cyan' : statusTone(project.status) === 'purple' ? 'purple' : statusTone(project.status) === 'amber' ? 'amber' : 'default'}>
                          {project.status}
                        </Pill>
                      </article>
                    ))
                  ) : (
                    <div className={styles.emptyState}>
                      <strong className={styles.emptyTitle}>{t('pj.empty.noProjects')}</strong>
                      <span className={styles.emptyText}>{t('pj.empty.clearSearch')}</span>
>>>>>>> origin/dev/delicious233
                    </div>
                  )}
                </div>
              ) : null}

<<<<<<< HEAD
              {activeView === 'tasks' ? (
                <div className="projectList">
                  <div className="projectFilterBar">
                    <span className="projectMuted">
                      {t('board.doneTotal', { done: completedTaskCount, total: projectTasks.length })}
                    </span>
                    <SourceLabel source={taskSource} />
                    <button className="projectSecondaryButton" onClick={openTaskPanel} type="button">
                      {t('tasks.newTask')}
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
                      <span className={`projectPill ${statusTone(task.status)}`}>{statusLabel(task.status)}</span>
                      <div className="projectInlineActions">
                        <button className="projectMiniButton" onClick={() => toggleTaskStatus(task.id)} type="button">
                          {taskActionLabel(task.status)}
                        </button>
                      </div>
                    </article>
                    ))
                  ) : (
                    <div className="projectEmptyState">
                      <strong>{t('tasks.emptyTitle')}</strong>
                      <span>{t('tasks.emptyHint')}</span>
=======
              {/* Tasks */}
              {activeView === 'tasks' ? (
                <div className={styles.list}>
                  <div className={styles.filterBar}>
                    <span className={styles.progressMuted}>{t('pj.tasks.doneCount', { done: completedTaskCount, total: projectTasks.length })}</span>
                    <Button variant="secondary" size="sm" onClick={openTaskPanel}>{t('pj.tasks.new')}</Button>
                  </div>
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map((task) => (
                      <article className={styles.taskRow} key={task.id}>
                        <span className={styles.checkIcon}>{task.status === 'Done' ? (
                          <Icon name="check_circle" filled size={18} />
                        ) : (
                          <Icon name="circle" size={18} />
                        )}</span>
                        <div>
                          <span className={styles.taskRef}>{task.title}</span>
                          <p className={styles.taskDetail}>{task.owner}: {task.detail}</p>
                        </div>
                        <Pill variant={statusTone(task.status) === 'green' ? 'green' : 'amber'}>{task.status}</Pill>
                        <div>
                          <Button variant="secondary" size="sm" onClick={() => toggleTaskStatus(task.id)}>{taskActionLabel(task.status)}</Button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className={styles.emptyState}>
                      <strong className={styles.emptyTitle}>{t('pj.empty.noTasks')}</strong>
                      <span className={styles.emptyText}>{t('pj.empty.noTasksHint')}</span>
>>>>>>> origin/dev/delicious233
                    </div>
                  )}
                </div>
              ) : null}

<<<<<<< HEAD
              {activeView === 'files' ? (
                <div className="projectStack">
                  <div className="projectFilterBar">
                    <div className="projectFilterGroup" aria-label={t('files.filterAria')}>
                      <span className="projectFilterLabel">{t('files.label')}</span>
                      <SourceLabel source={fileSource} />
                      {fileFilters.map((filter) => (
                        <button
                          className={fileFilter === filter ? 'projectMiniButton isActive' : 'projectMiniButton'}
                          key={filter}
                          onClick={() => setFileFilter(filter)}
                          type="button"
                        >
                          {filter === 'All' ? t('filter.all') : filter}
                        </button>
                      ))}
                    </div>
                    <div className="projectFilterGroup" aria-label={t('runs.filterAria')}>
                      <span className="projectFilterLabel">{t('runs.label')}</span>
                      <SourceLabel source={runSource} />
                      {runFilters.map((filter) => (
                        <button
                          className={runFilter === filter ? 'projectMiniButton isActive' : 'projectMiniButton'}
                          key={filter}
                          onClick={() => setRunFilter(filter)}
                          type="button"
                        >
                          {filter === 'All' ? t('filter.all') : statusLabel(filter)}
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
                          <span className={`projectPill ${statusTone(file.status)}`}>{statusLabel(file.status)}</span>
                        </article>
                      ))
                    ) : (
                      <div className="projectEmptyState">
                        <strong>{t('files.emptyTitle')}</strong>
                        <span>{t('files.emptyHint')}</span>
                      </div>
                    )}
                  </div>

                  <div className="projectList" aria-label={t('runs.recordsAria')}>
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
                          <span className={`projectPill ${statusTone(run.status)}`}>{statusLabel(run.status)}</span>
                        </article>
                      ))
                    ) : (
                      <div className="projectEmptyState">
                        <strong>{t('runs.emptyTitle')}</strong>
                        <span>{t('runs.emptyHint')}</span>
=======
              {/* Files */}
              {activeView === 'files' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className={styles.filterBar}>
                    <div className={styles.filterGroup} aria-label="File type filters">
                      <span className={styles.filterLabel}>{t('pj.files.filter.label')}</span>
                      {fileFilters.map((f) => (
                        <button key={f} type="button" className={fileFilter === f ? `${styles.filterBtn} ${styles.filterBtnActive}` : styles.filterBtn} onClick={() => setFileFilter(f)}>{f}</button>
                      ))}
                    </div>
                    <div className={styles.filterGroup} aria-label="Run status filters">
                      <span className={styles.filterLabel}>{t('pj.runs.filter.label')}</span>
                      {runFilters.map((f) => (
                        <button key={f} type="button" className={runFilter === f ? `${styles.filterBtn} ${styles.filterBtnActive}` : styles.filterBtn} onClick={() => setRunFilter(f)}>{f}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.list}>
                    {filteredFiles.length > 0 ? (
                      filteredFiles.map((file) => (
                        <article className={styles.fileRow} key={file.name}>
                          <span className={styles.fileType}>{file.type}</span>
                          <div>
                            <span className={styles.rowName}>{file.name}</span>
                            <p className={styles.rowDetail}>{file.detail}</p>
                          </div>
                          <Pill variant={statusTone(file.status) === 'green' ? 'green' : 'default'}>{file.status}</Pill>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        <strong className={styles.emptyTitle}>{t('pj.empty.noFiles')}</strong>
                        <span className={styles.emptyText}>{t('pj.empty.noFilesHint')}</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.list} aria-label="Run records">
                    {filteredRuns.length > 0 ? (
                      filteredRuns.map((run) => (
                        <article className={styles.runRow} key={run.id}>
                          <span className={styles.runIcon}>RN</span>
                          <div>
                            <span className={styles.rowName}>{run.id}</span>
                            <p className={styles.rowDetail}>{run.detail}</p>
                            <div className={styles.metaLine}>
                              <Pill variant="default">{run.time}</Pill>
                            </div>
                          </div>
                          <Pill variant={statusTone(run.status) === 'green' ? 'green' : statusTone(run.status) === 'cyan' ? 'cyan' : statusTone(run.status) === 'purple' ? 'purple' : 'default'}>{run.status}</Pill>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        <strong className={styles.emptyTitle}>{t('pj.empty.noRuns')}</strong>
                        <span className={styles.emptyText}>{t('pj.empty.noRunsHint')}</span>
>>>>>>> origin/dev/delicious233
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

<<<<<<< HEAD
            <aside className="projectSideStack">
              <section className="projectPanel projectGlass">
                <div className="projectCardHeader">
                  <h3>{t('milestones.title')}</h3>
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
                      <span className={`projectPill ${statusTone(milestone.status)}`}>{statusLabel(milestone.status)}</span>
=======
            {/* Side stack: milestones + risks */}
            <aside className={styles.sideStack}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>{t('pj.milestones.title')}</h3>
                  <Pill variant="default">M1</Pill>
                </div>
                <div className={styles.list}>
                  {milestones.map((ml, i) => (
                    <article className={styles.milestoneRow} key={ml.title}>
                      <span className={`${styles.milestoneDot} ${i === 1 ? styles.dotCyan : i === 2 ? styles.dotPurple : ''}`} />
                      <div>
                        <span className={styles.milestoneName}>{ml.title}</span>
                        <p className={styles.milestoneMeta}>{ml.detail}</p>
                      </div>
                      <Pill variant={statusTone(ml.status) === 'green' ? 'green' : statusTone(ml.status) === 'cyan' ? 'cyan' : 'purple'}>{ml.status}</Pill>
>>>>>>> origin/dev/delicious233
                    </article>
                  ))}
                </div>
              </section>

<<<<<<< HEAD
              <section className="projectPanel projectGlass">
                <div className="projectCardHeader">
                  <h3>{t('risks.title')}</h3>
                  <span className={`projectPill ${openRiskCount === 0 ? 'green' : 'amber'}`}>
                    {openRiskCount === 0 ? t('risks.reviewed') : t('risks.needsReview')}
                  </span>
                </div>
                <div className="projectList">
                  {projectRisks.map((risk) => (
                    <article className="projectRiskRow" key={risk.id}>
                      <div>
                        <strong>{risk.title}</strong>
                        <p className="projectMuted">{risk.detail}</p>
                      </div>
                      <span className={`projectPill ${statusTone(risk.status)}`}>{statusLabel(risk.status)}</span>
                      <button
                        className="projectMiniButton"
                        disabled={!risk.reviewable}
                        onClick={() => toggleRisk(risk.id)}
                        type="button"
                      >
                        {risk.reviewable && risk.status === 'Reviewed' ? t('risks.reopen') : t('risks.review')}
                      </button>
=======
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>{t('pj.risks.title')}</h3>
                  <Pill variant={openRiskCount === 0 ? 'green' : 'amber'}>
                    {openRiskCount === 0 ? t('pj.risks.reviewed') : t('pj.risks.needsReview')}
                  </Pill>
                </div>
                <div className={styles.list}>
                  {projectRisks.map((risk) => (
                    <article className={styles.riskRow} key={risk.id}>
                      <div>
                        <span className={styles.rowName}>{risk.title}</span>
                        <p className={styles.rowDetail}>{risk.detail}</p>
                      </div>
                      <Pill variant={risk.status === 'Reviewed' ? 'green' : risk.status === 'Tracked' ? 'cyan' : 'amber'}>{risk.status}</Pill>
                      <Button variant="secondary" size="sm" disabled={!risk.reviewable} onClick={() => toggleRisk(risk.id)}>
                        {risk.reviewable && risk.status === 'Reviewed' ? t('pj.risks.reopen') : t('pj.risks.review')}
                      </Button>
>>>>>>> origin/dev/delicious233
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </div>
<<<<<<< HEAD
        </main>
      </div>

      {isTaskPanelOpen ? (
        <aside className="projectDrawer projectGlass" aria-label={t('taskForm.drawerAria')}>
          <div className="projectCardHeader">
            <h3>{t('taskForm.title')}</h3>
            <button className="projectIconButton" onClick={closeTaskPanel} type="button" aria-label={t('taskForm.closeAria')}>
              X
            </button>
          </div>
          <p className="projectMuted">{t('taskForm.description')}</p>
          <div className="projectField">
            <label htmlFor="task-title">{t('taskForm.fieldTitle')}</label>
            <input
              id="task-title"
              onChange={(event) => updateTaskForm('title', event.target.value)}
              value={taskForm.title}
            />
          </div>
          <div className="projectField">
            <label htmlFor="task-owner">{t('taskForm.fieldOwner')}</label>
            <input
              id="task-owner"
              onChange={(event) => updateTaskForm('owner', event.target.value)}
              value={taskForm.owner}
            />
          </div>
          <div className="projectField">
            <label htmlFor="task-note">{t('taskForm.fieldNote')}</label>
            <textarea
              id="task-note"
              onChange={(event) => updateTaskForm('detail', event.target.value)}
              value={taskForm.detail}
            />
          </div>
          <div className="projectButtonRow">
            <button className="projectPrimaryButton" disabled={!canSaveTask} onClick={saveTask} type="button">
              {t('taskForm.saveLocal')}
            </button>
            <button className="projectSecondaryButton" onClick={closeTaskPanel} type="button">
              {t('taskForm.close')}
            </button>
          </div>
          {!canSaveTask ? <span className="projectSyncMessage warning">{t('taskForm.validationRequired')}</span> : null}
        </aside>
      ) : null}
=======
        </div>
      </WebLayout>
>>>>>>> origin/dev/delicious233
    </div>
  );
}

<<<<<<< HEAD
export default ProjectPageInteractive;
=======
export default ProjectPage;
>>>>>>> origin/dev/delicious233
