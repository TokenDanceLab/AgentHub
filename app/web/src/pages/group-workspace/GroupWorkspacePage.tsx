import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from 'react-i18next';
import {
  mockRunners,
  mockRuns,
  mockWorkspaceFiles,
  getWorkbenchCatalogState,
  getWorkbenchSectionSource,
  MockEventStream,
  playRunLifecycle,
  type Run,
  type Runner,
  type WorkbenchSectionSource,
} from '@shared/index';
import { useWorkbenchProjection } from '../../hooks/useWorkbenchProjection';

type TaskStatus = "backlog" | "active" | "review";
type ApprovalState = "pending" | "approved" | "changes";
type MemberPresence = "online" | "busy" | "offline";
type MemberFilter = "all" | MemberPresence;
type ConfirmationTone = "info" | "success" | "warning";

type Member = {
  initials: string;
  name: string;
  role: string;
  accent: "blue" | "cyan" | "purple" | "teal";
  presence: MemberPresence;
};

type WorkspaceTask = {
  id: string;
  title: string;
  summary: string;
  owner: string;
  status: TaskStatus;
  tag: string;
  progress: number;
};

type FileItem = {
  name: string;
  detail: string;
  size: string;
  accent: "blue" | "cyan" | "purple" | "teal";
};

type ActivityItem = {
  title: string;
  detail: string;
  time: string;
  accent: "blue" | "cyan" | "purple" | "teal";
};

type SyncState = {
  complete: boolean;
  fileCount: number;
  lastSyncedAt: string;
  progress: number;
  revision: number;
};

type Confirmation = {
  detail: string;
  title: string;
  tone: ConfirmationTone;
};

const accentPalette = ["blue", "purple", "teal", "cyan"] as const;
const fileAccentPalette = ["cyan", "purple", "teal", "blue"] as const;
const activityAccentPalette = ["cyan", "purple", "teal"] as const;

const members: Member[] = mockRunners.map((runner, i) => ({
  initials: runner.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2),
  name: runner.name,
  role: runner.capabilities ?? 'No capability info',
  accent: accentPalette[i % accentPalette.length] ?? "blue",
  presence: (runner.status === 'online' ? 'online' : 'offline') as MemberPresence,
}));

const baseTasks: WorkspaceTask[] = mockRuns.map((run, i) => ({
  id: run.runId,
  title: `Run ${run.runId.split('_').pop()} — ${run.status}`,
  summary: `Thread: ${run.threadId}, Project: ${run.projectId}`,
  owner: mockRunners[i % mockRunners.length]?.name ?? 'Unassigned',
  status: (run.status === 'finished' ? 'review' : run.status === 'running' ? 'active' : 'backlog') as TaskStatus,
  tag: run.status === 'running' ? 'Active' : run.status === 'finished' ? 'Done' : 'Queue',
  progress: run.status === 'finished' ? 100 : run.status === 'running' ? 65 : 15,
}));

const files: FileItem[] = mockWorkspaceFiles.map((f, i) => ({
  name: f.path,
  detail: `${(f.sizeBytes / 1024).toFixed(1)} KB, modified ${f.modifiedAt.slice(0, 10)}`,
  size: f.sizeBytes > 1024 * 1024 ? `${(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${(f.sizeBytes / 1024).toFixed(1)} KB`,
  accent: fileAccentPalette[i % fileAccentPalette.length] ?? "cyan",
}));

const initialActivities: ActivityItem[] = mockRuns.map((run, i) => ({
  title: `${mockRunners[i % mockRunners.length]?.name ?? 'Agent'} — run.${run.status}`,
  detail: `Run on thread ${run.threadId}: ${run.status === 'finished' ? 'Completed successfully' : run.status === 'running' ? 'Executing...' : 'Waiting in queue'}`,
  time: run.createdAt.slice(11, 16),
  accent: activityAccentPalette[i % activityAccentPalette.length] ?? "cyan",
}));

function memberFromRunner(runner: Runner, index: number): Member {
  return {
    initials: runner.name.split(' ').map((word) => word[0]).join('').toUpperCase().slice(0, 2) || 'AG',
    name: runner.name,
    role: runner.capabilities ?? 'Runner registered',
    accent: accentPalette[index % accentPalette.length] ?? 'blue',
    presence: runner.status === 'online' ? 'online' : 'offline',
  };
}

function taskFromRun(run: Run, index: number, runners: Runner[]): WorkspaceTask {
  return {
    id: run.runId,
    title: `Run ${run.runId.split('_').pop()} - ${run.status}`,
    summary: `Thread: ${run.threadId}, Project: ${run.projectId}`,
    owner: runners[index % Math.max(runners.length, 1)]?.name ?? 'Unassigned',
    status: run.status === 'finished' ? 'review' : run.status === 'running' || run.status === 'starting' ? 'active' : 'backlog',
    tag: run.status === 'running' || run.status === 'starting' ? 'Active' : run.status === 'finished' ? 'Done' : 'Queue',
    progress: run.status === 'finished' ? 100 : run.status === 'running' || run.status === 'starting' ? 65 : 15,
  };
}

function activityFromRun(run: Run, index: number, runners: Runner[]): ActivityItem {
  return {
    title: `${runners[index % Math.max(runners.length, 1)]?.name ?? 'Agent'} - run.${run.status}`,
    detail: `Run on thread ${run.threadId}: ${run.status === 'finished' ? 'Completed successfully' : run.status === 'running' ? 'Executing...' : 'Waiting in queue'}`,
    time: run.createdAt.slice(11, 16),
    accent: activityAccentPalette[index % activityAccentPalette.length] ?? 'cyan',
  };
}

function SourceLabel({ source }: { source: WorkbenchSectionSource }) {
  return <span className={`gwr-source ${source.tone}`}>{source.label}</span>;
}

const styles = `
  @import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");
  @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap");

.group-workspace-react {
  --gwr-bg: #edf6ff;
  --gwr-bg-2: #f7fbff;
  --gwr-ink: #172033;
  --gwr-muted: #667085;
  --gwr-line: rgba(143, 160, 190, 0.22);
  --gwr-blue: #1769e8;
  --gwr-cyan: #08a7cf;
  --gwr-purple: #7457e8;
  --gwr-teal: #0f9f9a;
  --gwr-green: #1f9b64;
  --gwr-orange: #d97817;
  --gwr-glass: rgba(255,255,255,0.72);
  --gwr-glass-border: rgba(255,255,255,0.7);
  --gwr-shadow: 0 18px 48px rgba(26,40,80,0.14);
  position: relative;
  height: 100%;
  padding: 18px;
  overflow: hidden;
  color: var(--gwr-ink);
  background:
    radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
    radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
    linear-gradient(135deg, var(--gwr-bg-2), var(--gwr-bg));
  font-family: "Hanken Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.group-workspace-react,
.group-workspace-react * {
  box-sizing: border-box;
}

.gwr-particles {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}

.gwr-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 340px;
  gap: 18px;
  height: 100%;
  width: 100%;
}

.gwr-glass {
  background: var(--gwr-glass);
  border: 1px solid var(--gwr-glass-border);
  border-radius: 12px;
  box-shadow: var(--gwr-shadow);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
}

.gwr-side,
.gwr-right,
.gwr-main,
.gwr-feed,
.gwr-column,
.gwr-lane,
.gwr-composer {
  min-height: 0;
}

.gwr-side,
.gwr-right,
.gwr-main {
  display: flex;
  flex-direction: column;
}

.gwr-side,
.gwr-right {
  gap: 16px;
  padding: 18px;
  overflow: auto;
}

.gwr-main {
  gap: 16px;
  overflow: hidden;
}

.gwr-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 96px;
  padding: 18px 20px;
}

.gwr-title h1,
.gwr-title h2,
.gwr-title h3,
.gwr-title p,
.gwr-stat p,
.gwr-card p,
.gwr-file p,
.gwr-activity p,
.gwr-member p,
.gwr-approval p {
  margin: 0;
}

.gwr-eyebrow {
  margin: 0 0 4px;
  color: var(--gwr-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.gwr-brand-sub {
  margin: 4px 0 0;
  color: var(--gwr-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.09em;
  line-height: 1.236;
}

.gwr-title h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
  letter-spacing: 0;
}

.gwr-title h2,
.gwr-section h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.25;
}

.gwr-title h3,
.gwr-card h3,
.gwr-lane-title {
  margin: 0;
  font-size: 13px;
  line-height: 1.25;
}

.gwr-small {
  color: var(--gwr-muted);
  font-size: 12px;
  line-height: 1.45;
}

.gwr-tiny {
  color: var(--gwr-muted);
  font-size: 11px;
  line-height: 1.35;
}

.gwr-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--gwr-line);
}

.gwr-brand .gwr-title h2 {
  margin: 0;
  color: var(--gwr-ink);
  font-size: 15px;
  line-height: 1.25;
}

.gwr-brand .gwr-title .gwr-brand-sub {
  margin: 4px 0 0;
}

.gwr-mark,
.gwr-icon,
.gwr-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.gwr-mark {
  width: 38px;
  height: 38px;
  color: var(--white);
  border-radius: 10px;
  background: linear-gradient(135deg, var(--gwr-blue), var(--gwr-cyan));
  box-shadow: 0 10px 22px var(--brand-glow);
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
}

.gwr-section-head,
.gwr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.gwr-section-head {
  margin-bottom: 12px;
}

.gwr-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gwr-nav,
.gwr-member,
.gwr-file,
.gwr-activity,
.gwr-card,
.gwr-sync,
.gwr-approval {
  border: 1px solid var(--gwr-glass-border);
  border-radius: 12px;
  background: var(--gwr-glass);
}

.gwr-nav,
.gwr-member,
.gwr-file,
.gwr-activity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px;
}

.gwr-nav.is-active {
  border-color: rgba(23,105,232,0.25);
  background: rgba(23,105,232,0.12);
}

.gwr-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: var(--gwr-blue);
  background: rgba(23,105,232,0.12);
  font-size: 14px;
  font-weight: 900;
}

.gwr-accent-cyan {
  color: var(--gwr-cyan);
  background: rgba(8,167,207,0.15);
}

.gwr-accent-purple {
  color: var(--gwr-purple);
  background: rgba(116,87,232,0.15);
}

.gwr-accent-teal {
  color: var(--gwr-teal);
  background: rgba(15,159,154,0.15);
}

.gwr-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  color: var(--white);
  border: 2px solid var(--gwr-glass-border);
  border-radius: 50%;
  background: linear-gradient(135deg, var(--gwr-blue), var(--gwr-cyan));
  box-shadow: var(--gwr-shadow);
  font-size: 12px;
  font-weight: 800;
}

.gwr-avatar.purple {
  background: linear-gradient(135deg, var(--gwr-purple), #a06bff);
}

.gwr-avatar.teal {
  background: linear-gradient(135deg, var(--gwr-teal), var(--gwr-cyan));
}

.gwr-avatar.cyan {
  background: linear-gradient(135deg, var(--gwr-cyan), #39c7e9);
}

.gwr-avatar::after {
  content: "";
  position: absolute;
  right: -1px;
  bottom: 0;
  width: 9px;
  height: 9px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--gwr-green);
}

.gwr-avatar.is-busy::after {
  background: var(--gwr-orange);
}

.gwr-avatar.is-offline::after {
  background: var(--gwr-muted);
}

.gwr-truncate {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gwr-spacer {
  flex: 1 1 auto;
}

.gwr-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 24px;
  padding: 4px 9px;
  border: 1px solid rgba(23,105,232,0.2);
  border-radius: 999px;
  background: rgba(23,105,232,0.1);
  color: var(--gwr-blue);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.gwr-pill.cyan {
  border-color: rgba(8,167,207,0.25);
  background: rgba(8,167,207,0.15);
  color: var(--gwr-cyan);
}

.gwr-pill.purple {
  border-color: rgba(116,87,232,0.25);
  background: rgba(116,87,232,0.15);
  color: var(--gwr-purple);
}

.gwr-pill.green {
  border-color: rgba(31,155,100,0.25);
  background: rgba(31,155,100,0.15);
  color: var(--gwr-green);
}

.gwr-pill.amber {
  border-color: rgba(217,122,23,0.3);
  background: rgba(217,122,23,0.15);
  color: var(--gwr-orange);
}

.gwr-pill.neutral {
  border-color: rgba(102,112,133,0.25);
  background: rgba(102,112,133,0.12);
  color: var(--gwr-muted);
}

.gwr-source {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 4px 8px;
  border: 1px solid rgba(102,112,133,0.25);
  border-radius: 999px;
  background: rgba(102,112,133,0.12);
  color: var(--gwr-muted);
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

.gwr-source.green {
  border-color: rgba(31,155,100,0.25);
  background: rgba(31,155,100,0.15);
  color: var(--gwr-green);
}

.gwr-source.purple {
  border-color: rgba(116,87,232,0.25);
  background: rgba(116,87,232,0.15);
  color: var(--gwr-purple);
}

.gwr-source.amber {
  border-color: rgba(217,122,23,0.3);
  background: rgba(217,122,23,0.15);
  color: var(--gwr-orange);
}

.gwr-source.cyan {
  border-color: rgba(8,167,207,0.25);
  background: rgba(8,167,207,0.15);
  color: var(--gwr-cyan);
}

.gwr-dot {
  display: inline-flex;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--gwr-green);
  box-shadow: 0 0 0 4px rgba(31,155,100,0.2);
}

.gwr-dot.cyan {
  background: var(--gwr-cyan);
  box-shadow: 0 0 0 4px rgba(8,167,207,0.2);
}

.gwr-dot.purple {
  background: var(--gwr-purple);
  box-shadow: 0 0 0 4px rgba(116,87,232,0.2);
}

.gwr-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.gwr-button,
.gwr-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(23,105,232,0.2);
  border-radius: 8px;
  background: rgba(255,255,255,0.08);
  color: var(--gwr-ink);
  font-weight: 800;
  box-shadow: none;
  cursor: pointer;
}

.gwr-button {
  gap: 8px;
  min-height: 36px;
  padding: 9px 12px;
  font-size: 12px;
}

.gwr-icon-button {
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 13px;
}

.gwr-button.primary {
  border-color: transparent;
  color: var(--white);
  background: linear-gradient(135deg, var(--gwr-blue), var(--gwr-cyan));
  box-shadow: var(--gwr-shadow);
}

.gwr-button.warning {
  color: var(--gwr-orange);
  border-color: rgba(217,122,23,0.25);
  background: rgba(217,122,23,0.15);
}

.gwr-button:disabled,
.gwr-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.54;
  box-shadow: none;
}

.gwr-member-action {
  width: 100%;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.gwr-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.gwr-filter {
  min-height: 28px;
  padding: 6px 8px;
  border: 1px solid rgba(23,105,232,0.2);
  border-radius: 8px;
  background: var(--gwr-glass);
  color: var(--gwr-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
}

.gwr-filter.is-active {
  border-color: rgba(23,105,232,0.3);
  background: rgba(23,105,232,0.12);
  color: var(--gwr-blue);
}

.gwr-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 100%);
  min-height: 38px;
  padding: 9px 11px;
  border: 1px solid var(--gwr-glass-border);
  border-radius: 10px;
  background: rgba(255,255,255,0.08);
  color: var(--gwr-muted);
  font-size: 12px;
}

.gwr-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(92px, 1fr));
  gap: 10px;
}

.gwr-stat {
  padding: 12px;
}

.gwr-stat strong {
  display: block;
  margin-bottom: 4px;
  font-size: 20px;
  line-height: 1;
}

.gwr-confirmation {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(23,105,232,0.16);
  border-radius: 12px;
  background: rgba(255,255,255,0.08);
  box-shadow: none;
}

.gwr-confirmation.success {
  border-color: rgba(31,155,100,0.25);
  background: rgba(31,155,100,0.15);
}

.gwr-confirmation.warning {
  border-color: rgba(217,122,23,0.3);
  background: rgba(217,122,23,0.15);
}

.gwr-content {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(290px, 0.75fr);
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

.gwr-column,
.gwr-feed {
  padding: 16px;
  overflow: hidden;
}

.gwr-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  height: calc(100% - 36px);
  min-height: 0;
}

.gwr-lane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--gwr-line);
  border-radius: 12px;
  background: var(--gwr-glass);
}

.gwr-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(255,255,255,0.08);
  box-shadow: none;
}

.gwr-progress {
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(23,105,232,0.12);
}

.gwr-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gwr-blue), var(--gwr-cyan), var(--gwr-purple));
  transition: width 220ms ease;
}

.gwr-feed {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.gwr-activity-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding-right: 4px;
}

.gwr-activity {
  align-items: flex-start;
}

.gwr-composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  padding: 12px;
  border: 1px solid var(--gwr-glass-border);
  border-radius: 12px;
  background: var(--gwr-glass);
}

.gwr-composer textarea {
  width: 100%;
  min-height: 54px;
  resize: none;
  padding: 10px;
  border: 1px solid var(--gwr-line);
  border-radius: 10px;
  outline: 0;
  background: var(--gwr-glass);
  color: var(--gwr-ink);
  font: inherit;
}

.gwr-empty {
  padding: 12px;
  border: 1px dashed var(--gwr-line);
  border-radius: 10px;
  background: var(--gwr-glass);
  color: var(--gwr-muted);
  font-size: 12px;
  line-height: 1.4;
}

.gwr-approval,
.gwr-sync {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.gwr-approval {
  border-color: rgba(23,105,232,0.25);
  background: linear-gradient(135deg, rgba(23,105,232,0.1), rgba(8,167,207,0.08));
}

.gwr-checks {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.gwr-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 0;
}

.gwr-check + .gwr-check {
  border-top: 1px solid var(--gwr-line);
}

.gwr-file {
  align-items: flex-start;
}

@media (max-width: 1180px) {
  .gwr-shell {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .gwr-right {
    display: none;
  }

  .gwr-content {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 820px) {
  .group-workspace-react {
    height: auto;
    overflow: auto;
    padding: 14px;
  }

  .gwr-shell {
    display: flex;
    flex-direction: column;
    height: auto;
  }

  .gwr-top {
    align-items: flex-start;
    flex-direction: column;
  }

  .gwr-stats,
  .gwr-board {
    grid-template-columns: 1fr;
  }

  .gwr-column,
  .gwr-feed,
  .gwr-right {
    overflow: visible;
  }

  .gwr-right {
    display: flex;
  }
}

[data-theme="dark"] .group-workspace-react {
  --gwr-bg: #0f1117;
  --gwr-bg-2: #0d1117;
  --gwr-ink: #e1e4e8;
  --gwr-muted: #8b949e;
  --gwr-line: rgba(48, 54, 61, 0.4);
  --gwr-blue: #1769e8;
  --gwr-cyan: #08a7cf;
  --gwr-purple: #a78bfa;
  --gwr-teal: #4dd4c8;
  --gwr-green: #3fb950;
  --gwr-orange: #d2991d;
  --gwr-glass: rgba(22, 27, 34, 0.8);
  --gwr-glass-border: rgba(48, 54, 61, 0.6);
  --gwr-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  background:
    radial-gradient(circle at 18% 12%, rgba(8,167,207,0.1), transparent 28%),
    radial-gradient(circle at 82% 8%, rgba(116,87,232,0.1), transparent 30%),
    linear-gradient(135deg, var(--gwr-bg-2), var(--gwr-bg));
}
`;

function useParticleCanvas(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    type Particle = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      hue: number;
      alpha: number;
    };

    let width = 0;
    let height = 0;
    let frame = 0;
    let particles: Particle[] = [];
    const particleCount = 56;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const createParticle = (index: number): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 1.6 + Math.random() * 2.6,
      vx: -0.18 + Math.random() * 0.36,
      vy: -0.18 - Math.random() * 0.48,
      hue: index % 3 === 0 ? 196 : 210,
      alpha: 0.18 + Math.random() * 0.2,
    });

    const seed = () => {
      particles = Array.from({ length: particleCount }, (_, index) => createParticle(index));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.y < -16) {
          particle.y = height + 16;
          particle.x = Math.random() * width;
        }
        if (particle.x < -16) {
          particle.x = width + 16;
        }
        if (particle.x > width + 16) {
          particle.x = -16;
        }

        context.beginPath();
        context.fillStyle = `hsla(${particle.hue}, 84%, 48%, ${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        context.fill();

        particles.slice(index + 1).forEach((neighbor) => {
          const dx = particle.x - neighbor.x;
          const dy = particle.y - neighbor.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 126) {
            context.beginPath();
            context.strokeStyle = `rgba(23, 105, 232, ${(1 - distance / 126) * 0.07})`;
            context.lineWidth = 1;
            context.moveTo(particle.x, particle.y);
            context.lineTo(neighbor.x, neighbor.y);
            context.stroke();
          }
        });
      });

      frame = window.requestAnimationFrame(draw);
    };

    const handleResize = () => {
      resize();
      seed();
    };

    resize();
    seed();
    frame = window.requestAnimationFrame(draw);
    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [canvasRef]);
}

function AccentIcon({ accent, label }: { accent: FileItem["accent"]; label: string }) {
  const className = accent === "blue" ? "gwr-icon" : `gwr-icon gwr-accent-${accent}`;

  return <span className={className}>{label}</span>;
}

function MemberAvatar({ member }: { member: Member }) {
  const className = [
    "gwr-avatar",
    member.accent === "blue" ? "" : member.accent,
    member.presence === "busy" ? "is-busy" : "",
    member.presence === "offline" ? "is-offline" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={className}>{member.initials}</span>;
}

export function GroupWorkspacePageInteractive() {
  const { t } = useTranslation('groupWorkspace');

  const laneLabels: Record<TaskStatus, string> = {
    backlog: t('task.board.backlog'),
    active: t('task.board.inProgress'),
    review: t('task.board.review'),
  };

  const memberFilterOptions: Array<{ id: MemberFilter; label: string }> = [
    { id: "all", label: t('member.filter.all') },
    { id: "online", label: t('member.filter.online') },
    { id: "busy", label: t('member.filter.busy') },
    { id: "offline", label: t('member.filter.offline') },
  ];

  const presenceLabels: Record<MemberPresence, string> = {
    online: t('member.status.online'),
    busy: t('member.status.busy'),
    offline: t('member.status.offline'),
  };

  const tagLabels: Record<string, string> = {
    Active: t('task.tag.active'),
    Done: t('task.tag.done'),
    Queue: t('task.tag.queue'),
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workbenchState = useWorkbenchProjection();
  const {
    hasLiveCatalog,
    label: catalogLabel,
    message: catalogDetail,
    mode: catalogMode,
    tone: catalogTone,
  } = getWorkbenchCatalogState(workbenchState);
  const taskSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.runs.length > 0,
  });
  const [approval, setApproval] = useState<ApprovalState>("pending");
  const [taskOwner, setTaskOwner] = useState("Xavier");
  const [syncState, setSyncState] = useState<SyncState>({
    complete: false,
    fileCount: 12,
    lastSyncedAt: t('sync.checklist.notSynced'),
    progress: 82,
    revision: 0,
  });
  const [activityLog, setActivityLog] = useState<ActivityItem[]>(initialActivities);
  const [workspaceMembers, setWorkspaceMembers] = useState<Member[]>(members);
  const [hasLocalMemberChanges, setHasLocalMemberChanges] = useState(false);
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>({
    detail: t('confirm.readyDetail'),
    title: t('confirm.ready'),
    tone: "info",
  });

  useParticleCanvas(canvasRef);

  useEffect(() => {
    if (!hasLiveCatalog || workbenchState.runners.length === 0) {
      return;
    }

    setWorkspaceMembers(workbenchState.runners.map(memberFromRunner));
  }, [hasLiveCatalog, workbenchState.runners]);

  const nowLabel = () =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const showConfirmation = (nextConfirmation: Confirmation) => {
    setConfirmation(nextConfirmation);
  };

  const pushActivity = (activity: Omit<ActivityItem, "time">) => {
    setActivityLog((current) => [{ ...activity, time: nowLabel() }, ...current].slice(0, 8));
  };

  // Mock event stream feeds a simulated run lifecycle into the demo activity log.
  useEffect(() => {
    const stream = new MockEventStream();
    const unsub = stream.on((event) => {
      pushActivity({
        title: event.type,
        detail: typeof event.payload === 'object' && event.payload && 'text' in event.payload
          ? String((event.payload as Record<string, unknown>).text).trim().slice(0, 100) || '(output)'
          : JSON.stringify(event.payload).slice(0, 100),
        accent: fileAccentPalette[Math.floor(Math.random() * fileAccentPalette.length)] ?? "cyan",
      });
    });
    playRunLifecycle(stream, { stepDelayMs: 1000 });
    return () => { stream.destroy(); unsub(); };
  }, []);

  const approved = approval === "approved";
  const needsEdits = approval === "changes";
  const visibleMembers = workspaceMembers.filter((member) => memberFilter === "all" || member.presence === memberFilter);
  const onlineCount = workspaceMembers.filter((member) => member.presence === "online").length;
  const busyCount = workspaceMembers.filter((member) => member.presence === "busy").length;
  const memberSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.runners.length > 0,
    hasLocalDryRun: hasLocalMemberChanges,
  });
  const approvalLabel = approved ? t('approval.status.approved') : needsEdits ? t('approval.status.changesRequested') : t('approval.status.awaitingApproval');
  const approvalLocked = !approved;
  const syncedFiles: FileItem[] = syncState.revision
    ? [
        {
          name: `sync_receipt_r${syncState.revision}.txt`,
          detail: `Created by dry-run sync at ${syncState.lastSyncedAt}`,
          size: "2 KB",
          accent: "blue",
        },
      ]
    : [];
  const liveFiles: FileItem[] = workbenchState.artifacts.map((artifact, index) => ({
    name: artifact.path,
    detail: `${artifact.kind} artifact, ${(artifact.sizeBytes / 1024).toFixed(1)} KB, created ${artifact.createdAt.slice(0, 10)}`,
    size: artifact.sizeBytes > 1024 * 1024 ? `${(artifact.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${(artifact.sizeBytes / 1024).toFixed(1)} KB`,
    accent: fileAccentPalette[index % fileAccentPalette.length] ?? 'cyan',
  }));
  const workspaceFiles = [...(hasLiveCatalog && liveFiles.length ? liveFiles : files), ...syncedFiles];
  const fileSource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.artifacts.length > 0,
    hasLocalDryRun: syncedFiles.length > 0,
  });
  const displayedBaseTasks = hasLiveCatalog && workbenchState.runs.length
    ? workbenchState.runs.map((run, index) => taskFromRun(run, index, workbenchState.runners))
    : baseTasks;
  const displayedActivities = hasLiveCatalog && workbenchState.runs.length
    ? workbenchState.runs.map((run, index) => activityFromRun(run, index, workbenchState.runners))
    : activityLog;
  const activitySource = getWorkbenchSectionSource({
    mode: catalogMode,
    hasSectionSnapshot: hasLiveCatalog && workbenchState.runs.length > 0,
    hasLocalDryRun: !(hasLiveCatalog && workbenchState.runs.length) && activityLog.length > initialActivities.length,
  });

  const tasks = useMemo<WorkspaceTask[]>(() => {
    return displayedBaseTasks.map((task) => {
      if (task.id === "approve") {
        return {
          ...task,
          owner: taskOwner,
          progress: approval === "approved" ? 100 : approval === "changes" ? 60 : 82,
          summary:
            approval === "approved"
              ? t('task.summary.approved')
              : approval === "changes"
                ? t('task.summary.changesRequested')
                : task.summary,
        };
      }

      if (task.id === "snapshot" && syncState.complete) {
        return {
          ...task,
          progress: syncState.progress,
          summary: t('task.summary.synced', { time: syncState.lastSyncedAt }),
        };
      }

      return task;
    });
  }, [approval, displayedBaseTasks, syncState.complete, syncState.lastSyncedAt, syncState.progress, taskOwner]);

  const laneTasks = (status: TaskStatus) => tasks.filter((task) => task.status === status);

  const approveParser = () => {
    setApproval("approved");
    setSyncState((current) => ({
      ...current,
      complete: false,
      progress: Math.max(current.progress, 91),
    }));
    pushActivity({
      title: "Xavier approved parser v2",
      detail: "Local dry-run sync controls are unlocked and the review task is marked complete.",
      accent: "blue",
    });
    showConfirmation({
      title: t('confirm.approvalSaved'),
      detail: t('confirm.approvalSavedDetail'),
      tone: "success",
    });
  };

  const requestEdits = () => {
    setApproval("changes");
    setSyncState((current) => ({
      ...current,
      complete: false,
      progress: 74,
    }));
    pushActivity({
      title: "Xavier requested parser edits",
      detail: "Local dry-run sync was locked again until the requested changes are resolved.",
      accent: "purple",
    });
    showConfirmation({
      title: t('confirm.changesRequested'),
      detail: t('confirm.changesRequestedDetail'),
      tone: "warning",
    });
  };

  const assignSecurity = () => {
    const nextOwner = taskOwner === "Security-Core" ? "Xavier" : "Security-Core";
    setTaskOwner(nextOwner);
    pushActivity({
      title: `Approval assigned to ${nextOwner}`,
      detail: "Task owner changed on the review card, board, and sync checklist.",
      accent: "teal",
    });
    showConfirmation({
      title: t('confirm.reviewReassigned'),
      detail: t('confirm.reviewReassignedDetail', { owner: nextOwner }),
      tone: "info",
    });
  };

  const syncSnapshot = () => {
    if (!approved) {
      showConfirmation({
        title: t('confirm.syncLocked'),
        detail: t('confirm.syncLockedDetail'),
        tone: "warning",
      });
      return;
    }

    const syncedAt = nowLabel();
    const nextRevision = syncState.revision + 1;
    setSyncState((current) => ({
      complete: true,
      fileCount: current.fileCount + 1,
      lastSyncedAt: syncedAt,
      progress: 100,
      revision: nextRevision,
    }));
    pushActivity({
      title: "Dry-run snapshot synced",
      detail: `Local workspace files updated and dry-run receipt generated at ${syncedAt}.`,
      accent: "cyan",
    });
    showConfirmation({
      title: t('confirm.snapshotSynced'),
      detail: t('confirm.snapshotSyncedDetail', { revision: nextRevision }),
      tone: "success",
    });
  };

  const cycleMemberPresence = (memberName: string) => {
    const selectedMember = workspaceMembers.find((member) => member.name === memberName);
    if (!selectedMember) {
      return;
    }

    const nextPresence: MemberPresence =
      selectedMember.presence === "online" ? "busy" : selectedMember.presence === "busy" ? "offline" : "online";

    setWorkspaceMembers((current) =>
      current.map((member) =>
        member.name === memberName
          ? {
              ...member,
              presence: nextPresence,
            }
          : member,
      ),
    );
    setHasLocalMemberChanges(true);
    pushActivity({
      title: `${selectedMember.name} is now ${presenceLabels[nextPresence].toLowerCase()}`,
      detail: "Member presence changed locally and the member filter counters updated.",
      accent: selectedMember.accent,
    });
    showConfirmation({
      title: t('confirm.memberStatusUpdated'),
      detail: t('confirm.memberStatusUpdatedDetail', { name: selectedMember.name, status: presenceLabels[nextPresence] }),
      tone: nextPresence === "offline" ? "warning" : "info",
    });
  };

  const selectMemberFilter = (filter: MemberFilter) => {
    setMemberFilter(filter);
    showConfirmation({
      title: t('confirm.memberFilterChanged'),
      detail:
        filter === "all"
          ? t('confirm.memberFilterAll')
          : t('confirm.memberFilterSpecific', { filter: presenceLabels[filter] }),
      tone: "info",
    });
  };

  const sendNote = () => {
    const trimmedNote = noteDraft.trim();
    if (!trimmedNote) {
      showConfirmation({
        title: t('confirm.noteEmpty'),
        detail: t('confirm.noteEmptyDetail'),
        tone: "warning",
      });
      return;
    }

    pushActivity({
      title: "Collaboration note sent",
      detail: trimmedNote,
      accent: "blue",
    });
    setNoteDraft("");
    showConfirmation({
      title: t('confirm.notePosted'),
      detail: t('confirm.notePostedDetail'),
      tone: "success",
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    sendNote();
  };

  const fillComposer = (token: string, confirmationTitle: string) => {
    setNoteDraft((current) => `${current}${current ? " " : ""}${token}`);
    showConfirmation({
      title: confirmationTitle,
      detail: t('confirm.composerUpdated'),
      tone: "info",
    });
  };

  const createLocalFile = () => {
    setSyncState((current) => ({
      ...current,
      fileCount: current.fileCount + 1,
    }));
    pushActivity({
      title: "Local file placeholder added",
      detail: "Shared file count increased without contacting a backend.",
      accent: "cyan",
    });
    showConfirmation({
      title: t('confirm.filePlaceholderAdded'),
      detail: t('confirm.filePlaceholderDetail'),
      tone: "info",
    });
  };

  const exportSummary = () => {
    pushActivity({
      title: "Workspace summary prepared",
      detail: "Export is represented as a local confirmation for this preview.",
      accent: "teal",
    });
    showConfirmation({
      title: t('confirm.exportPrepared'),
      detail: t('confirm.exportPreparedDetail'),
      tone: "success",
    });
  };

  return (
    <div className="group-workspace-react">
      <style>{styles}</style>
      <canvas ref={canvasRef} className="gwr-particles" aria-hidden="true" />

      <div className="gwr-shell">
        <aside className="gwr-side gwr-glass">
          <div className="gwr-brand">
            <span className="gwr-mark">AH</span>
            <div className="gwr-truncate gwr-title">
              <h2>AGENTHUB</h2>
              <p className="gwr-brand-sub">{t('sidebar.brandSubtitle')}</p>
            </div>
          </div>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <h2>{t('sidebar.spaces')}</h2>
              <span className="gwr-pill cyan">
                <span className="gwr-dot cyan" />
                {catalogLabel}
              </span>
            </div>
            <div className="gwr-stack">
              <div className="gwr-nav is-active">
                <AccentIcon accent="blue" label="S" />
                <div className="gwr-truncate">
                  <strong>Legacy Migration</strong>
                  <p className="gwr-tiny gwr-truncate">{t('sidebar.space.localDryRunSync')}</p>
                </div>
              </div>
              <div className="gwr-nav">
                <AccentIcon accent="purple" label="R" />
                <div className="gwr-truncate">
                  <strong>Mapping Review</strong>
                  <p className="gwr-tiny gwr-truncate">2 approvals open</p>
                </div>
              </div>
              <div className="gwr-nav">
                <AccentIcon accent="cyan" label="F" />
                <div className="gwr-truncate">
                  <strong>Shared Files</strong>
                  <p className="gwr-tiny gwr-truncate">{t('sidebar.space.documents', { count: syncState.fileCount })}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <h2>{t('sidebar.members')}</h2>
              <div className="gwr-actions">
                <SourceLabel source={memberSource} />
                <span className="gwr-tiny">
                  {t('sidebar.members.onlineBusy', { online: onlineCount, busy: busyCount })}
                </span>
              </div>
            </div>
            <div className="gwr-filters" role="group" aria-label={t('member.filter.aria')}>
              {memberFilterOptions.map((option) => (
                <button
                  className={option.id === memberFilter ? "gwr-filter is-active" : "gwr-filter"}
                  key={option.id}
                  type="button"
                  onClick={() => selectMemberFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="gwr-stack">
              {visibleMembers.map((member) => (
                <button
                  className="gwr-member gwr-member-action"
                  key={member.name}
                  type="button"
                  onClick={() => cycleMemberPresence(member.name)}
                >
                  <MemberAvatar member={member} />
                  <div className="gwr-truncate">
                    <strong>{member.name}</strong>
                    <p className="gwr-tiny gwr-truncate">
                      {member.role} - {presenceLabels[member.presence]}
                    </p>
                  </div>
                </button>
              ))}
              {visibleMembers.length === 0 ? (
                <div className="gwr-empty">{t('member.empty')}</div>
              ) : null}
            </div>
          </section>

          <div className="gwr-spacer" />
          <section className="gwr-sync">
            <div className="gwr-row">
              <span className="gwr-eyebrow">{t('sidebar.workspaceHealth')}</span>
              <span className={`gwr-pill ${catalogTone}`}>
                {catalogLabel}
              </span>
            </div>
            <p className="gwr-small">{catalogDetail} {t('sidebar.lastLocalSync', { time: syncState.lastSyncedAt })}</p>
          </section>
        </aside>

        <main className="gwr-main">
          <header className="gwr-top gwr-glass">
            <div className="gwr-title">
              <p className="gwr-eyebrow">Legacy Migration Room</p>
              <h1>{t('header.title')}</h1>
              <p className="gwr-small">
                {t('header.subtitle')}
              </p>
            </div>
            <div className="gwr-actions">
              <div className="gwr-search" aria-label={t('header.searchAria')}>
                <span>{t('header.search')}</span>
                <span className="gwr-truncate">{t('header.searchPlaceholder')}</span>
              </div>
              <button className="gwr-button" type="button" onClick={exportSummary}>
                {t('header.export')}
              </button>
              <button className="gwr-button primary" type="button" onClick={assignSecurity}>
                {t('header.assignReview')}
              </button>
            </div>
          </header>

          <section className="gwr-stats">
            <div className="gwr-stat gwr-glass">
              <strong>{onlineCount}</strong>
              <p className="gwr-small">{t('stat.membersOnline')}</p>
            </div>
            <div className="gwr-stat gwr-glass">
              <strong>{tasks.length}</strong>
              <p className="gwr-small">{t('stat.sharedTasks')}</p>
            </div>
            <div className="gwr-stat gwr-glass">
              <strong>{syncState.fileCount}</strong>
              <p className="gwr-small">{t('stat.workspaceFiles')}</p>
            </div>
            <div className="gwr-stat gwr-glass">
              <strong>{syncState.progress}%</strong>
              <p className="gwr-small">{t('stat.dryRunReadiness')}</p>
            </div>
          </section>

          <section className={`gwr-confirmation gwr-glass ${confirmation.tone}`} aria-live="polite">
            <div>
              <strong>{confirmation.title}</strong>
              <p className="gwr-small">{confirmation.detail}</p>
            </div>
            <button
              className="gwr-icon-button"
              type="button"
              aria-label={t('confirm.dismiss')}
              onClick={() =>
                showConfirmation({
                  title: t('confirm.statusBarCleared'),
                  detail: t('confirm.statusBarClearedDetail'),
                  tone: "info",
                })
              }
            >
              x
            </button>
          </section>

          <section className="gwr-content">
            <div className="gwr-column gwr-glass">
              <div className="gwr-section-head">
                <div className="gwr-title">
                  <p className="gwr-eyebrow">{t('task.board')}</p>
                  <h2>{t('task.coordinationPlan')}</h2>
                </div>
                <SourceLabel source={taskSource} />
              </div>

              <div className="gwr-board">
                {(Object.keys(laneLabels) as TaskStatus[]).map((status) => (
                  <section className="gwr-lane" key={status}>
                    <div className="gwr-row">
                      <h3 className="gwr-lane-title">{laneLabels[status]}</h3>
                      <span className="gwr-pill">{laneTasks(status).length}</span>
                    </div>
                    {laneTasks(status).map((task) => (
                      <article className="gwr-card" key={task.id}>
                        <div className="gwr-row">
                          <span className={task.status === "review" ? "gwr-pill purple" : "gwr-pill cyan"}>
                            {tagLabels[task.tag] || task.tag}
                          </span>
                          <span className="gwr-tiny">{task.progress}%</span>
                        </div>
                        <h3>{task.title}</h3>
                        <p className="gwr-small">{task.summary}</p>
                        <div className="gwr-progress" aria-label={t('task.progressAria', { title: task.title })}>
                          <span style={{ width: `${task.progress}%` }} />
                        </div>
                        <div className="gwr-row">
                          <span className="gwr-tiny">{t('task.owner', { name: task.owner })}</span>
                          {task.id === "approve" ? (
                            <button className="gwr-button" type="button" onClick={assignSecurity}>
                              {t('task.reassign')}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </div>

            <aside className="gwr-feed gwr-glass">
              <div className="gwr-section-head">
                <div className="gwr-title">
                  <p className="gwr-eyebrow">{t('activity.title')}</p>
                  <h2>{t('activity.subtitle')}</h2>
                </div>
                <SourceLabel source={activitySource} />
              </div>

              <div className="gwr-activity-list">
                {displayedActivities.map((activity, index) => (
                  <div className="gwr-activity" key={`${activity.title}-${index}`}>
                    <AccentIcon accent={activity.accent} label={activity.accent.slice(0, 1).toUpperCase()} />
                    <div className="gwr-truncate">
                      <strong>{activity.title}</strong>
                      <p className="gwr-small gwr-truncate">{activity.detail}</p>
                      <span className="gwr-tiny">{activity.time}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="gwr-composer">
                <div className="gwr-row">
                  <div className="gwr-actions">
                    <button
                      className="gwr-icon-button"
                      type="button"
                      aria-label={t('composer.mentionAria')}
                      onClick={() => fillComposer("@group", t('confirm.mentionInserted'))}
                    >
                      @
                    </button>
                    <button
                      className="gwr-icon-button"
                      type="button"
                      aria-label={t('composer.attachAria')}
                      onClick={() => fillComposer("[attachment]", t('confirm.attachmentInserted'))}
                    >
                      +
                    </button>
                    <button
                      className="gwr-icon-button"
                      type="button"
                      aria-label={t('composer.taskAria')}
                      onClick={() => fillComposer("#task", t('confirm.taskMarkerInserted'))}
                    >
                      T
                    </button>
                  </div>
                  <span className="gwr-pill cyan">@group</span>
                </div>
                <textarea
                  aria-label={t('composer.messageAria')}
                  placeholder={t('composer.placeholder')}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />
                <div className="gwr-row">
                  <span className="gwr-tiny">{noteDraft.trim() ? t('composer.charactersReady', { count: noteDraft.trim().length }) : t('composer.draftEmpty')}</span>
                  <button className="gwr-button primary" type="button" disabled={!noteDraft.trim()} onClick={sendNote}>
                    {t('composer.send')}
                  </button>
                </div>
              </div>
            </aside>
          </section>
        </main>

        <aside className="gwr-right gwr-glass">
          <section className="gwr-section">
            <div className="gwr-section-head">
              <div className="gwr-title">
                <p className="gwr-eyebrow">{t('approval.title')}</p>
                <h2>{t('approval.parserReady')}</h2>
              </div>
              <span className={approved ? "gwr-pill green" : needsEdits ? "gwr-pill purple" : "gwr-pill"}>
                {approvalLabel}
              </span>
            </div>
            <div className="gwr-approval">
              <div className="gwr-row">
                <strong>{approvalLabel}</strong>
                <span className="gwr-tiny">{t('approval.owner', { name: taskOwner })}</span>
              </div>
              <p className="gwr-small">
                {approved
                  ? t('approval.detail.approved')
                  : needsEdits
                    ? t('approval.detail.changesRequested')
                    : t('approval.detail.awaitingApproval')}
              </p>
              <div className="gwr-actions">
                <button className="gwr-button warning" type="button" onClick={requestEdits}>
                  {t('approval.requestEdits')}
                </button>
                <button className="gwr-button primary" type="button" onClick={approveParser}>
                  {t('approval.approve')}
                </button>
              </div>
            </div>
          </section>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <div className="gwr-title">
                <p className="gwr-eyebrow">{t('sync.title')}</p>
                <h2>{t('sync.subtitle')}</h2>
              </div>
              <span className={`gwr-pill ${syncState.complete ? "green" : "cyan"}`}>{syncState.progress}%</span>
            </div>
            <div className="gwr-sync">
              <div className="gwr-row">
                <span className="gwr-small">{t('sync.readiness')}</span>
                <strong>{syncState.complete ? t('sync.status.synced') : approved ? t('sync.status.unlocked') : t('sync.status.locked')}</strong>
              </div>
              <div className="gwr-progress" aria-label={t('sync.readinessAria')}>
                <span style={{ width: `${syncState.progress}%` }} />
              </div>
              <button
                className="gwr-button primary"
                type="button"
                disabled={approvalLocked}
                onClick={syncSnapshot}
              >
                {syncState.complete ? t('sync.runAgain') : approved ? t('sync.run') : t('sync.approveToRun')}
              </button>
              <div className="gwr-checks">
                <div className="gwr-check">
                  <span className="gwr-dot cyan" />
                  <div>
                    <strong>{t('sync.checklist.filesIndexed')}</strong>
                    <p className="gwr-tiny">{t('sync.checklist.filesDetail', { count: syncState.fileCount })}</p>
                  </div>
                </div>
                <div className="gwr-check">
                  <span className="gwr-dot purple" />
                  <div>
                    <strong>{t('sync.checklist.assignments')}</strong>
                    <p className="gwr-tiny">{t('sync.checklist.assignmentsDetail', { owner: taskOwner })}</p>
                  </div>
                </div>
                <div className="gwr-check">
                  <span className="gwr-dot" />
                  <div>
                    <strong>{t('sync.checklist.lastSync')}</strong>
                    <p className="gwr-tiny">{t('sync.checklist.lastSyncDetail', { time: syncState.lastSyncedAt })}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <div className="gwr-title">
                <p className="gwr-eyebrow">{t('files.title')}</p>
                <h2>{t('files.subtitle')}</h2>
              </div>
              <div className="gwr-actions">
                <SourceLabel source={fileSource} />
                <button className="gwr-icon-button" type="button" aria-label={t('files.addAria')} onClick={createLocalFile}>
                  +
                </button>
              </div>
            </div>
            <div className="gwr-stack">
              {workspaceFiles.map((file) => (
                <div className="gwr-file" key={file.name}>
                  <AccentIcon accent={file.accent} label={file.name.slice(0, 1).toUpperCase()} />
                  <div className="gwr-truncate">
                    <strong>{file.name}</strong>
                    <p className="gwr-tiny gwr-truncate">{file.detail}</p>
                  </div>
                  <span className="gwr-tiny">{file.size}</span>
                </div>
              ))}
              {workspaceFiles.length === 0 ? <div className="gwr-empty">{t('files.empty')}</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default GroupWorkspacePageInteractive;
