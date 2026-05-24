import { useEffect, useMemo, useRef, useState } from 'react';
import { mockProjects, mockRuns, mockWorkspaceFiles, mockRunners } from '@shared/index';

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
  detail: `${f.path} — ${(f.sizeBytes / 1024).toFixed(1)} KB, modified ${f.modifiedAt.slice(0, 10)}`,
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
    title: 'No live API yet',
    detail: 'All data is static and safe for page coordination.',
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
    title: 'Local-only state',
    detail: 'New tasks, risk review, filters, and sync runs reset after refresh.',
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

const pageStyles = `
  @import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");

  .projectReactRoot {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    color: #172033;
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
      linear-gradient(135deg, #f7fbff, #edf6ff);
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

  .projectReactShell {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 18px;
    min-height: 100vh;
    padding: 18px;
  }

  .projectGlass {
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
  }

  .projectSidebar {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: calc(100vh - 36px);
    padding: 18px;
  }

  .projectBrand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  }

  .projectBrandMark,
  .projectIconTile,
  .projectFileType {
    display: grid;
    place-items: center;
    color: #ffffff;
    font-weight: 900;
    background: linear-gradient(135deg, #1769e8, #08a7cf);
  }

  .projectBrandMark {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    border-radius: 10px;
    box-shadow: 0 10px 22px rgba(23, 105, 232, 0.24);
  }

  .projectTitle h2 {
    margin: 0;
    font-size: 15px;
    line-height: 1.25;
    color: #172033;
  }

  .projectTitle p {
    margin: 0;
    color: #667085;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    line-height: normal;
  }

  .projectMuted {
    margin: 4px 0 0;
    color: #667085;
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
    color: #334155;
    text-align: left;
    background: transparent;
  }

  .projectNav button.isActive {
    color: #2563eb;
    background: rgba(37, 99, 235, 0.1);
    box-shadow: inset 3px 0 0 #2563eb;
  }

  .projectSidebarNote {
    margin-top: auto;
    padding: 14px;
    border: 1px solid rgba(37, 99, 235, 0.12);
    border-radius: 12px;
    background: rgba(37, 99, 235, 0.08);
  }

  .projectSidebarNote strong {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
  }

  .projectMain {
    min-width: 0;
    max-height: calc(100vh - 36px);
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
    background: rgba(255, 255, 255, 0.58);
  }

  .projectSearch input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    color: #172033;
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
    color: #334155;
    background: rgba(255, 255, 255, 0.58);
    border: 1px solid rgba(148, 163, 184, 0.22);
  }

  .projectAvatar {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    color: #ffffff;
    border-radius: 50%;
    font-size: 13px;
    font-weight: 800;
    background: linear-gradient(135deg, #7c3aed, #2563eb);
  }

  .projectHero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 18px;
    padding: 22px;
  }

  .projectEyebrow {
    margin: 0 0 8px;
    color: #0891b2;
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
    color: #667085;
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
    padding: 10px 14px;
    font-weight: 700;
  }

  .projectPrimaryButton:disabled,
  .projectSecondaryButton:disabled,
  .projectGhostButton:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .projectPrimaryButton {
    color: #ffffff;
    background: linear-gradient(135deg, #2563eb, #0891b2);
    box-shadow: 0 12px 28px rgba(37, 99, 235, 0.24);
  }

  .projectSecondaryButton,
  .projectGhostButton {
    color: #1f3a63;
    background: rgba(255, 255, 255, 0.64);
    border: 1px solid rgba(148, 163, 184, 0.25);
  }

  .projectSyncMessage {
    display: inline-flex;
    align-items: center;
    min-height: 38px;
    padding: 9px 12px;
    color: #2563eb;
    border: 1px solid rgba(37, 99, 235, 0.16);
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.08);
    font-size: 13px;
    font-weight: 700;
  }

  .projectSyncMessage.success {
    color: #059669;
    border-color: rgba(5, 150, 105, 0.18);
    background: rgba(5, 150, 105, 0.1);
  }

  .projectSyncMessage.warning {
    color: #d97706;
    border-color: rgba(217, 119, 6, 0.2);
    background: rgba(217, 119, 6, 0.12);
  }

  .projectHeroSide {
    display: grid;
    gap: 12px;
  }

  .projectProgressCard {
    padding: 14px;
    border: 1px solid rgba(255, 255, 255, 0.62);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.52);
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
    background: linear-gradient(90deg, #2563eb, #0891b2);
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
    color: #2563eb;
    border-radius: 12px;
    background: rgba(37, 99, 235, 0.1);
    font-weight: 800;
  }

  .projectMetric strong {
    display: block;
    font-size: 22px;
    line-height: 1.1;
  }

  .projectMetric span {
    color: #667085;
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
    color: #667085;
    background: transparent;
    font-weight: 700;
  }

  .projectTab.isActive {
    color: #2563eb;
    background: rgba(255, 255, 255, 0.72);
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
    color: #667085;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .projectMiniButton {
    min-height: 30px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 8px;
    padding: 6px 9px;
    color: #334155;
    background: rgba(255, 255, 255, 0.58);
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .projectMiniButton.isActive {
    color: #2563eb;
    border-color: rgba(37, 99, 235, 0.2);
    background: rgba(37, 99, 235, 0.1);
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
    border: 1px solid rgba(255, 255, 255, 0.62);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.5);
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
    min-height: 26px;
    padding: 5px 9px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
  }

  .projectPill.blue {
    color: #2563eb;
    background: rgba(37, 99, 235, 0.1);
  }

  .projectPill.cyan {
    color: #0891b2;
    background: rgba(8, 145, 178, 0.1);
  }

  .projectPill.purple {
    color: #7c3aed;
    background: rgba(124, 58, 237, 0.1);
  }

  .projectPill.green {
    color: #059669;
    background: rgba(5, 150, 105, 0.1);
  }

  .projectPill.amber {
    color: #d97706;
    background: rgba(217, 119, 6, 0.12);
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
    color: #2563eb;
    background: rgba(37, 99, 235, 0.1);
    font-weight: 800;
  }

  .projectTaskRow.done .projectCheck {
    color: #059669;
    background: rgba(5, 150, 105, 0.1);
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
    color: #667085;
    text-align: center;
    border: 1px dashed rgba(148, 163, 184, 0.34);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.38);
  }

  .projectEmptyState strong {
    color: #334155;
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
    background: #2563eb;
    box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.1);
  }

  .projectDot.cyan {
    background: #0891b2;
    box-shadow: 0 0 0 5px rgba(8, 145, 178, 0.1);
  }

  .projectDot.purple {
    background: #7c3aed;
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
    color: #334155;
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
    color: #172033;
    background: rgba(255, 255, 255, 0.62);
    font: inherit;
  }

  .projectField textarea {
    min-height: 92px;
    resize: vertical;
  }

  @media (max-width: 1080px) {
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

  @media (max-width: 720px) {
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
  const [activeView, setActiveView] = useState<BoardView>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [projectTasks, setProjectTasks] = useState<Task[]>(initialTasks);
  const [projectRuns, setProjectRuns] = useState<RunRecord[]>(initialRuns);
  const [projectRisks, setProjectRisks] = useState<RiskItem[]>(initialRisks);
  const [fileFilter, setFileFilter] = useState<FileFilter>('All');
  const [runFilter, setRunFilter] = useState<RunFilter>('All');
  const [lastSyncAt, setLastSyncAt] = useState('Not synced yet');
  const [syncStatus, setSyncStatus] = useState('Idle');
  const [notice, setNotice] = useState<Notice | null>(null);

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
    () => projects.filter((project) => matchesQuery([project.name, project.detail, project.status], searchTerm)),
    [searchTerm],
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
      initialFiles.filter(
        (file) =>
          (fileFilter === 'All' || file.type === fileFilter) &&
          matchesQuery([file.name, file.type, file.status, file.detail], searchTerm),
      ),
    [fileFilter, searchTerm],
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

    setProjectTasks((current) => [...current, newTask]);
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

    setProjectTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: nextStatus,
            }
          : task,
      ),
    );

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
    setProjectRuns((current) => [syncRun, ...current]);
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
            <strong>Project signal</strong>
            <span>{activityPrompt}</span>
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
                Coordinate frontend preview pages, milestones, task readiness, design files, and dry-run records before
                real API integration.
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
                      background: 'linear-gradient(90deg, #7c3aed, #2563eb)',
                    }}
                  />
                </div>
              </div>
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>Sync status</span>
                  <strong>{syncStatus}</strong>
                </div>
                <p className="projectMuted">{lastSyncAt}</p>
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
                <strong>{initialFiles.length}</strong>
                <span>Shared files</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">RN</span>
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
