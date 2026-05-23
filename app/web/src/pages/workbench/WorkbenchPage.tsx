import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { mockRunners, mockRuns, mockThreads, MockEventStream, playRunLifecycle } from '@shared/index';

type PanelMode = 'preview' | 'diff' | 'approval';
type ApprovalStatus = 'idle' | 'review-requested' | 'handoff-staged' | 'approved';
type PreviewStatus = 'pending' | 'passed';
type ConfirmationTone = 'info' | 'success' | 'warning';

type Particle = {
  alpha: number;
  hue: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

type AgentCard = {
  id: string;
  initials: string;
  name: string;
  paused: boolean;
  progress: number;
  role: string;
  route: string;
  status: string;
};

type ActivityItem = {
  detail: string;
  icon: string;
  id: string;
  title: string;
};

type ConfirmationBar = {
  detail: string;
  id: string;
  message: string;
  tone: ConfirmationTone;
};

type CommandOption = {
  description: string;
  disabled?: boolean;
  icon: string;
  id: string;
  run: () => void;
  shortcut: string;
  title: string;
};

const panelLabels: PanelMode[] = ['preview', 'diff', 'approval'];

const routeOptions = ['Preview verification', 'Diff validation', 'Approval handoff', 'Responsive sweep'];

const initialAgents: AgentCard[] = mockRunners.map((runner, i) => ({
  id: runner.id,
  initials: runner.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2),
  name: runner.name,
  role: runner.capabilities ?? 'No capability info',
  status: runner.status === 'online' ? 'Coding' : 'Offline',
  route: routeOptions[i % routeOptions.length],
  paused: runner.status === 'offline',
  progress: runner.status === 'online' ? 50 + Math.floor(Math.random() * 45) : 0,
}));

const sessions = mockThreads.map((t) => ({
  title: t.title ?? t.id,
  meta: `Project ${t.projectId}`,
  status: t.status === 'active' ? 'Live' : 'Archived',
}));

const initialActivity: ActivityItem[] = mockRuns.map((run, i) => ({
  id: `mock-run-${run.runId}`,
  icon: run.status === 'running' ? 'play_circle' : run.status === 'finished' ? 'check_circle' : 'schedule',
  title: `Run ${run.runId.split('_').pop()} — ${run.status}`,
  detail: run.status === 'running'
    ? `Agent executing on thread ${run.threadId}`
    : run.status === 'finished'
      ? `Completed at ${run.finishedAt ?? 'unknown'}`
      : `Queued on thread ${run.threadId}, waiting for runner`,
}));

const approvalCopy: Record<ApprovalStatus, { label: string; detail: string }> = {
  idle: {
    label: 'Not requested',
    detail: 'Preview checks or a review request will create the first local approval checkpoint.',
  },
  'review-requested': {
    label: 'Review requested',
    detail: 'A local approval checkpoint is open and waiting on the visible checks.',
  },
  'handoff-staged': {
    label: 'Handoff staged',
    detail: 'The handoff bundle is staged locally and ready for approval.',
  },
  approved: {
    label: 'Approved',
    detail: 'The local approval state is complete; buttons now show the finished state.',
  },
};

const workbenchStyles = `
@import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap");

.wb-react {
  --ink: #142033;
  --muted: #61708c;
  --line: rgba(139, 156, 188, 0.24);
  --blue: #1967ff;
  --cyan: #00adc7;
  --purple: #7a4dff;
  --green: #12a67a;
  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-border: rgba(255, 255, 255, 0.7);
  --glass-shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  color: var(--ink);
  font-family: "Hanken Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
    radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
    linear-gradient(135deg, #f7fbff, #edf6ff);
}

.wb-react *,
.wb-react *::before,
.wb-react *::after {
  box-sizing: border-box;
}

.wb-react button,
.wb-react input {
  font: inherit;
}

.wb-react button {
  border: 0;
}

.wb-particles {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.7;
}

.wb-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  width: 100%;
  min-height: 100vh;
  padding: 18px;
}

.wb-glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
}

.wb-icon {
  font-family: "Material Symbols Outlined";
  font-size: 20px;
  line-height: 1;
  font-variation-settings: "FILL" 0, "wght" 500, "GRAD" 0, "opsz" 24;
}

.wb-sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 18px;
}

.wb-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.wb-brand-mark,
.wb-avatar {
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 900;
}

.wb-brand-mark {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: linear-gradient(135deg, #1769e8, #08a7cf);
  box-shadow: 0 10px 22px rgba(23, 105, 232, 0.24);
}

.wb-brand h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.25;
  color: #172033;
}

.wb-title .wb-brand-sub {
  margin: 0;
  color: #667085;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.09em;
  line-height: 1.236;
}

.wb-section-label {
  margin: 4px 0 0;
  color: #667085;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.wb-primary,
.wb-secondary,
.wb-icon-button,
.wb-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 36px;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 160ms ease, background 160ms ease, color 160ms ease, border-color 160ms ease;
}

.wb-primary:hover,
.wb-secondary:hover,
.wb-icon-button:hover,
.wb-tab:hover {
  transform: translateY(-1px);
}

.wb-primary:disabled,
.wb-secondary:disabled,
.wb-icon-button:disabled,
.wb-tab:disabled,
.wb-command-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.wb-primary:disabled:hover,
.wb-secondary:disabled:hover,
.wb-icon-button:disabled:hover,
.wb-tab:disabled:hover,
.wb-command-actions button:disabled:hover {
  transform: none;
}

.wb-primary {
  width: 100%;
  color: #fff;
  font-weight: 800;
  background: linear-gradient(135deg, var(--blue), var(--cyan));
  box-shadow: 0 14px 28px rgba(25, 103, 255, 0.2);
}

.wb-secondary {
  color: #253552;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.76);
}

.wb-icon-button {
  width: 36px;
  height: 36px;
  color: #334563;
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.72);
}

.wb-nav,
.wb-session-list,
.wb-agent-list,
.wb-feed,
.wb-check-list,
.wb-command-actions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-nav {
  margin-top: 16px;
}

.wb-nav-item,
.wb-session-item,
.wb-agent-card,
.wb-message,
.wb-file-row,
.wb-preview-row,
.wb-approval-row,
.wb-empty {
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.48);
}

.wb-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  color: #485976;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.wb-nav-item.is-active {
  color: var(--blue);
  background: rgba(25, 103, 255, 0.1);
  border-color: rgba(25, 103, 255, 0.16);
}

.wb-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 2px 10px;
}

.wb-session-item {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.wb-row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wb-pill,
.wb-mini-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 800;
}

.wb-pill {
  color: #075f7a;
  background: rgba(0, 173, 199, 0.12);
  border: 1px solid rgba(0, 173, 199, 0.22);
}

.wb-pill.is-warning {
  color: #806018;
  background: rgba(255, 183, 77, 0.16);
  border-color: rgba(255, 183, 77, 0.28);
}

.wb-pill.is-success {
  color: #0d654d;
  background: rgba(18, 166, 122, 0.12);
  border-color: rgba(18, 166, 122, 0.22);
}

.wb-mini-pill {
  color: #354765;
  background: rgba(255, 255, 255, 0.62);
}

.wb-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--green);
  box-shadow: 0 0 0 5px rgba(18, 166, 122, 0.11);
}

.wb-dot.is-paused {
  background: #ffb74d;
  box-shadow: 0 0 0 5px rgba(255, 183, 77, 0.14);
}

.wb-main {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
}

.wb-topbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 66px;
  padding: 12px 14px;
}

.wb-search {
  position: relative;
  min-width: 0;
}

.wb-search .wb-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
}

.wb-search input {
  width: 100%;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.78);
  border-radius: 8px;
  outline: 0;
  padding: 0 14px 0 42px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.58);
}

.wb-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wb-work-grid {
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(420px, 1fr) minmax(360px, 430px);
  gap: 16px;
}

.wb-conversation,
.wb-inspector {
  min-height: 0;
  overflow: hidden;
}

.wb-conversation {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 18px;
}

.wb-task-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.wb-task-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.14;
  letter-spacing: 0;
}

.wb-copy,
.wb-small,
.wb-session-meta,
.wb-agent-role,
.wb-file-meta,
.wb-preview-copy,
.wb-command-description {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.wb-copy {
  max-width: 680px;
  margin: 8px 0 0;
  font-size: 15px;
  line-height: 1.55;
}

.wb-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.wb-metric {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(255, 255, 255, 0.62);
}

.wb-metric-value {
  display: block;
  color: #102449;
  font-size: 22px;
  font-weight: 800;
}

.wb-metric-label {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.wb-agent-list {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.wb-agent-card {
  padding: 12px;
}

.wb-agent-card.is-paused {
  opacity: 0.78;
}

.wb-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--blue), var(--purple));
}

.wb-agent-card:nth-child(2) .wb-avatar {
  background: linear-gradient(135deg, var(--cyan), var(--blue));
}

.wb-agent-card:nth-child(3) .wb-avatar {
  background: linear-gradient(135deg, var(--purple), #b666ff);
}

.wb-title-strong {
  font-weight: 800;
}

.wb-route {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #425574;
  font-size: 12px;
  font-weight: 800;
}

.wb-route .wb-icon {
  font-size: 17px;
  color: var(--cyan);
}

.wb-progress {
  height: 6px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(91, 111, 148, 0.16);
}

.wb-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--blue), var(--cyan));
}

.wb-progress.is-paused span {
  background: linear-gradient(90deg, #ffb74d, var(--purple));
}

.wb-agent-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.wb-agent-actions .wb-secondary {
  min-height: 32px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 800;
}

.wb-feed {
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.wb-message {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  padding: 13px;
}

.wb-message-icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: var(--blue);
  background: rgba(25, 103, 255, 0.09);
}

.wb-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  color: #143251;
  background: rgba(0, 173, 199, 0.12);
  border: 1px solid rgba(0, 173, 199, 0.2);
}

.wb-confirm.is-success {
  background: rgba(18, 166, 122, 0.12);
  border-color: rgba(18, 166, 122, 0.22);
}

.wb-confirm.is-warning {
  background: rgba(255, 183, 77, 0.14);
  border-color: rgba(255, 183, 77, 0.28);
}

.wb-confirm-text {
  display: grid;
  gap: 3px;
}

.wb-composer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.72);
}

.wb-composer input {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 0;
  outline: 0;
  color: var(--ink);
  background: transparent;
}

.wb-inspector {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.wb-inspector-head {
  display: grid;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--line);
}

.wb-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wb-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(91, 111, 148, 0.1);
}

.wb-tab {
  min-height: 34px;
  color: #50617e;
  font-size: 13px;
  font-weight: 800;
  background: transparent;
  text-transform: capitalize;
}

.wb-tab.is-active {
  color: var(--blue);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 8px 20px rgba(26, 40, 80, 0.08);
}

.wb-panel-body {
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.wb-panel-stack {
  display: grid;
  gap: 12px;
}

.wb-status-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.wb-status-item {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.44);
  border: 1px solid rgba(255, 255, 255, 0.62);
}

.wb-status-value {
  color: #102449;
  font-size: 14px;
  font-weight: 800;
}

.wb-preview-card {
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.55);
}

.wb-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
}

.wb-window-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--blue);
  opacity: 0.55;
}

.wb-window-dot:nth-child(2) {
  background: var(--cyan);
}

.wb-window-dot:nth-child(3) {
  background: var(--purple);
}

.wb-preview-stage {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.wb-preview-row,
.wb-file-row,
.wb-approval-row {
  padding: 12px;
}

.wb-preview-row,
.wb-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wb-code-diff {
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(22, 33, 56, 0.9);
  color: #e9f0ff;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.65;
}

.wb-diff-line {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  padding: 0 12px;
}

.wb-diff-line.is-add {
  background: rgba(0, 173, 199, 0.13);
}

.wb-diff-line.is-remove {
  background: rgba(122, 77, 255, 0.13);
}

.wb-approval-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
}

.wb-check {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 8px;
  color: #fff;
  background: linear-gradient(135deg, var(--green), var(--cyan));
}

.wb-check.is-pending {
  color: #61708c;
  background: rgba(91, 111, 148, 0.12);
  border: 1px solid rgba(91, 111, 148, 0.16);
}

.wb-approval-actions {
  display: grid;
  gap: 8px;
}

.wb-empty {
  display: grid;
  gap: 4px;
  padding: 14px;
  color: var(--muted);
}

.wb-command-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: start center;
  padding-top: 92px;
  background: rgba(24, 38, 64, 0.18);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.wb-command-panel {
  width: min(620px, calc(100vw - 32px));
  padding: 14px;
}

.wb-command-input {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.64);
  border: 1px solid rgba(255, 255, 255, 0.76);
}

.wb-command-input input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
}

.wb-command-actions {
  margin-top: 12px;
}

.wb-command-actions button {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  min-height: 48px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #253552;
  text-align: left;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
  cursor: pointer;
}

.wb-command-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

@media (max-width: 1120px) {
  .wb-react {
    overflow: auto;
  }

  .wb-shell {
    grid-template-columns: 1fr;
  }

  .wb-sidebar {
    display: none;
  }

  .wb-work-grid {
    grid-template-columns: 1fr;
  }

  .wb-inspector {
    min-height: 560px;
  }
}

@media (max-width: 760px) {
  .wb-shell {
    padding: 10px;
  }

  .wb-topbar {
    grid-template-columns: 1fr;
  }

  .wb-topbar-actions,
  .wb-task-head {
    flex-wrap: wrap;
  }

  .wb-metrics,
  .wb-agent-list,
  .wb-status-strip {
    grid-template-columns: 1fr;
  }

  .wb-confirm {
    align-items: stretch;
    flex-direction: column;
  }
}
`;

function useWorkbenchParticles(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return undefined;
    }

    const particles: Particle[] = [];
    const particleCount = 56;
    let frameId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles.length = 0;

      for (let index = 0; index < particleCount; index += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 1.6 + Math.random() * 2.6,
          vx: -0.18 + Math.random() * 0.36,
          vy: -0.18 - Math.random() * 0.48,
          hue: index % 3 === 0 ? 196 : 210,
          alpha: 0.18 + Math.random() * 0.2,
        });
      }
    };

    const animate = () => {
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, particleIndex) => {
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
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (let nextIndex = particleIndex + 1; nextIndex < particles.length; nextIndex += 1) {
          const nextParticle = particles[nextIndex];
          const dx = particle.x - nextParticle.x;
          const dy = particle.y - nextParticle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 126) {
            context.beginPath();
            context.strokeStyle = `rgba(23, 105, 232, ${(1 - distance / 126) * 0.07})`;
            context.lineWidth = 1;
            context.moveTo(particle.x, particle.y);
            context.lineTo(nextParticle.x, nextParticle.y);
            context.stroke();
          }
        }
      });

      frameId = window.requestAnimationFrame(animate);
    };

    resize();
    animate();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef]);
}

function Icon({ children }: { children: string }) {
  return <span className="wb-icon" aria-hidden="true">{children}</span>;
}

export function WorkbenchPageInteractive() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activityIdRef = useRef(initialActivity.length);
  const confirmationIdRef = useRef(0);
  const [activePanel, setActivePanel] = useState<PanelMode>('preview');
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>(initialActivity);
  const [agents, setAgents] = useState<AgentCard[]>(initialAgents);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('idle');
  const [commandQuery, setCommandQuery] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationBar | null>(null);
  const [draftInstruction, setDraftInstruction] = useState('');
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('pending');

  useWorkbenchParticles(canvasRef);

  const pushActivity = useCallback((icon: string, title: string, detail: string) => {
    activityIdRef.current += 1;
    const nextActivity: ActivityItem = {
      id: `local-${activityIdRef.current}`,
      icon,
      title,
      detail,
    };

    setActivityFeed((current) => [nextActivity, ...current].slice(0, 8));
  }, []);

  const showConfirmation = useCallback((tone: ConfirmationTone, message: string, detail: string) => {
    confirmationIdRef.current += 1;
    setConfirmation({
      id: `confirm-${confirmationIdRef.current}`,
      tone,
      message,
      detail,
    });
  }, []);

  const openCommandPanel = useCallback(() => {
    setCommandQuery('');
    setIsCommandOpen(true);
  }, []);

  const closeCommandPanel = useCallback(() => {
    setIsCommandOpen(false);
    setCommandQuery('');
  }, []);

  const requestReview = useCallback((source = 'Toolbar') => {
    setApprovalStatus((current) => (current === 'approved' ? current : 'review-requested'));
    setActivePanel('approval');
    pushActivity('rate_review', 'Review requested', `${source} opened a local approval checkpoint for this workbench state.`);
    showConfirmation('info', 'Review checkpoint created', 'The approval panel is active and ready for local QA notes.');
  }, [pushActivity, showConfirmation]);

  const stageHandoff = useCallback((source = 'Task header') => {
    setApprovalStatus((current) => (current === 'approved' ? current : 'handoff-staged'));
    setActivePanel('approval');
    pushActivity('outbox', 'Handoff staged', `${source} staged the visible preview, diff, and approval notes for owner review.`);
    showConfirmation('info', 'Handoff staged locally', 'The handoff is visible in the activity stream; no external service was called.');
  }, [pushActivity, showConfirmation]);

  const approveWork = useCallback(() => {
    if (previewStatus !== 'passed') {
      setActivePanel('preview');
      pushActivity('block', 'Approval blocked', 'Preview must be checked before the local approval state can complete.');
      showConfirmation('warning', 'Preview check required', 'Mark the preview checked first, then return to approval.');
      return;
    }

    setApprovalStatus('approved');
    setActivePanel('approval');
    pushActivity('verified', 'Approval completed', 'The local approval state is now complete and action buttons reflect the final state.');
    showConfirmation('success', 'Approved locally', 'This is a visible local state only; no handoff was sent to a real API.');
  }, [previewStatus, pushActivity, showConfirmation]);

  const markPreviewChecked = useCallback(() => {
    if (previewStatus === 'passed') {
      setActivePanel('approval');
      return;
    }

    setPreviewStatus('passed');
    setApprovalStatus((current) => (current === 'idle' ? 'review-requested' : current));
    setActivePanel('approval');
    pushActivity('task_alt', 'Preview checked', 'Preview checks passed locally, so the review panel switched to approval.');
    showConfirmation('success', 'Preview checked', 'The preview status is complete and approval actions are now available.');
  }, [previewStatus, pushActivity, showConfirmation]);

  const rerouteAgent = useCallback((agentId: string, source = 'Agent controls') => {
    const targetAgent = agents.find((agent) => agent.id === agentId);

    if (!targetAgent) {
      return;
    }

    const currentRouteIndex = routeOptions.indexOf(targetAgent.route);
    const nextRoute = routeOptions[(currentRouteIndex + 1 + routeOptions.length) % routeOptions.length];

    setAgents((current) => current.map((agent) => {
      if (agent.id !== agentId) {
        return agent;
      }

      return {
        ...agent,
        paused: false,
        route: nextRoute,
        status: 'Rerouted',
        progress: Math.min(agent.progress + 4, 96),
      };
    }));

    pushActivity('alt_route', `${targetAgent.name} rerouted`, `${source} moved this agent to ${nextRoute}.`);
    showConfirmation('info', 'Agent route updated', `${targetAgent.name} is now assigned to ${nextRoute}.`);
  }, [agents, pushActivity, showConfirmation]);

  const toggleAgentPause = useCallback((agentId: string) => {
    const targetAgent = agents.find((agent) => agent.id === agentId);

    if (!targetAgent) {
      return;
    }

    const nextPaused = !targetAgent.paused;
    setAgents((current) => current.map((agent) => (
      agent.id === agentId
        ? {
          ...agent,
          paused: nextPaused,
          status: nextPaused ? agent.status : agent.status === 'Paused' ? 'Coding' : agent.status,
        }
        : agent
    )));

    pushActivity(
      nextPaused ? 'pause_circle' : 'play_circle',
      nextPaused ? `${targetAgent.name} paused` : `${targetAgent.name} resumed`,
      nextPaused
        ? 'The local agent card now shows a paused state and keeps its current route visible.'
        : 'The local agent card returned to active work without calling a scheduler.',
    );
    showConfirmation(
      nextPaused ? 'warning' : 'success',
      nextPaused ? 'Agent paused' : 'Agent resumed',
      `${targetAgent.name} is ${nextPaused ? 'paused' : 'active'} in this local workbench state.`,
    );
  }, [agents, pushActivity, showConfirmation]);

  const openDiffPanel = useCallback(() => {
    setActivePanel('diff');
    pushActivity('difference', 'Diff panel opened', 'The inspector is showing the local illustrative diff view.');
    showConfirmation('info', 'Diff panel active', 'Review the local file summary before staging a handoff.');
  }, [pushActivity, showConfirmation]);

  const noteLocalNotifications = useCallback(() => {
    pushActivity('notifications', 'Notification drawer checked', 'There are no remote notifications in this local preview.');
    showConfirmation('info', 'No remote notifications', 'This button only updates local visible state in the activity stream.');
  }, [pushActivity, showConfirmation]);

  const queueInstruction = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedInstruction = draftInstruction.trim();

    if (!trimmedInstruction) {
      showConfirmation('warning', 'Instruction is empty', 'Add a short local instruction before queueing it.');
      return;
    }

    setDraftInstruction('');
    pushActivity('bolt', 'Instruction queued', trimmedInstruction);
    showConfirmation('success', 'Instruction queued locally', 'The activity stream has the new note; nothing was sent to a server.');
  }, [draftInstruction, pushActivity, showConfirmation]);

  const activeAgentCount = agents.filter((agent) => !agent.paused).length;
  const hasApproved = approvalStatus === 'approved';
  const canApprove = previewStatus === 'passed' && !hasApproved;
  const stagedCount = approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 1 : 0;

  const commandOptions = useMemo<CommandOption[]>(() => [
    {
      id: 'route-qa',
      icon: 'alt_route',
      title: 'Route visual QA to tester',
      description: 'Moves the preview tester to the next local route and records activity.',
      shortcut: 'V',
      run: () => rerouteAgent('preview-tester', 'Command palette'),
    },
    {
      id: 'review-checkpoint',
      icon: 'rate_review',
      title: 'Create approval checkpoint',
      description: 'Switches to approval and appends a review request.',
      shortcut: 'A',
      disabled: hasApproved,
      run: () => requestReview('Command palette'),
    },
    {
      id: 'open-diff',
      icon: 'difference',
      title: 'Open diff panel',
      description: 'Shows the local diff panel and writes a visible trace.',
      shortcut: 'D',
      run: openDiffPanel,
    },
    {
      id: 'stage-handoff',
      icon: 'outbox',
      title: 'Stage handoff',
      description: 'Marks the local handoff as staged for owner review.',
      shortcut: 'H',
      disabled: hasApproved,
      run: () => stageHandoff('Command palette'),
    },
    {
      id: 'pause-primary',
      icon: agents[0]?.paused ? 'play_circle' : 'pause_circle',
      title: agents[0]?.paused ? 'Resume workbench worker' : 'Pause workbench worker',
      description: 'Toggles the primary agent card between active and paused.',
      shortcut: 'P',
      run: () => toggleAgentPause(agents[0]?.id ?? ''),
    },
  ], [agents, hasApproved, openDiffPanel, rerouteAgent, requestReview, stageHandoff, toggleAgentPause]);

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();

    if (!query) {
      return commandOptions;
    }

    return commandOptions.filter((option) => (
      `${option.title} ${option.description} ${option.shortcut}`.toLowerCase().includes(query)
    ));
  }, [commandOptions, commandQuery]);

  useEffect(() => {
    if (!isCommandOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCommandPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeCommandPanel, isCommandOpen]);

  // Mock event stream — drives activity feed with simulated runner events.
  useEffect(() => {
    const stream = new MockEventStream();
    const unsub = stream.on((event) => {
      pushActivity(
        event.type.includes('output') ? 'terminal' :
        event.type.includes('finished') ? 'check_circle' :
        event.type.includes('failed') ? 'error' :
        event.type.includes('started') ? 'play_circle' :
        event.type.includes('queued') ? 'schedule' : 'info',
        event.type,
        typeof event.payload === 'object' && event.payload && 'text' in event.payload
          ? String((event.payload as Record<string, unknown>).text).trim().slice(0, 100) || '(binary output)'
          : JSON.stringify(event.payload).slice(0, 100),
      );
    });
    playRunLifecycle(stream, { stepDelayMs: 800 });
    return () => {
      stream.destroy();
      unsub();
    };
  }, [pushActivity]);

  const panelContent = useMemo(() => {
    if (activePanel === 'preview') {
      return (
        <section className="wb-panel-stack" aria-label="Preview panel">
          <div className="wb-preview-card">
            <div className="wb-preview-toolbar">
              <span className="wb-window-dot" />
              <span className="wb-window-dot" />
              <span className="wb-window-dot" />
              <span className="wb-small">localhost preview</span>
            </div>
            <div className="wb-preview-stage">
              <div className="wb-preview-row">
                <div>
                  <div className="wb-title-strong">Workbench shell</div>
                  <div className="wb-preview-copy">Top bar, sessions, collaboration status, and review panel stay in one scan path.</div>
                </div>
                <Icon>web_asset</Icon>
              </div>
              <div className="wb-preview-row">
                <div>
                  <div className="wb-title-strong">Glass tokens aligned</div>
                  <div className="wb-preview-copy">Cards share one blur, shadow, radius, and border recipe.</div>
                </div>
                <Icon>auto_awesome</Icon>
              </div>
              <div className="wb-preview-row">
                <div>
                  <div className="wb-title-strong">Preview check</div>
                  <div className="wb-preview-copy">{previewStatus === 'passed' ? 'Checked locally and ready for approval.' : 'Pending local confirmation before approval.'}</div>
                </div>
                <span className={previewStatus === 'passed' ? 'wb-pill is-success' : 'wb-pill is-warning'}>
                  {previewStatus === 'passed' ? 'Checked' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
          <button
            className="wb-secondary"
            disabled={previewStatus === 'passed'}
            type="button"
            onClick={markPreviewChecked}
          >
            <Icon>{previewStatus === 'passed' ? 'check_circle' : 'task_alt'}</Icon>
            {previewStatus === 'passed' ? 'Preview checked' : 'Mark preview checked'}
          </button>
        </section>
      );
    }

    if (activePanel === 'diff') {
      return (
        <section className="wb-panel-stack" aria-label="Diff panel">
          <div className="wb-file-row">
            <div>
              <div className="wb-title-strong">WorkbenchPageInteractive.tsx</div>
              <div className="wb-file-meta">Local state wiring for tabs, commands, agents, and approval</div>
            </div>
            <span className="wb-mini-pill">new</span>
          </div>
          <div className="wb-file-row">
            <div>
              <div className="wb-title-strong">WorkbenchPageReact.tsx</div>
              <div className="wb-file-meta">Reference layout copied as the visual baseline</div>
            </div>
            <span className="wb-mini-pill">source</span>
          </div>
          <div className="wb-code-diff" aria-label="Illustrative diff">
            <div className="wb-diff-line is-remove"><span>-</span><span>buttons only flipped a couple of local booleans</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>active preview, diff, and approval panel state</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>command palette writes activity and confirmation state</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>agent pause, resume, and reroute controls are visible</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>preview checks unlock the approval action path</span></div>
          </div>
          <button className="wb-secondary" disabled={hasApproved} type="button" onClick={() => stageHandoff('Diff panel')}>
            <Icon>outbox</Icon>
            {approvalStatus === 'handoff-staged' ? 'Handoff already staged' : 'Stage handoff from diff'}
          </button>
        </section>
      );
    }

    return (
      <section className="wb-panel-stack" aria-label="Approval panel">
        <div className="wb-status-strip" aria-label="Approval summary">
          <div className="wb-status-item">
            <span className="wb-small">Preview</span>
            <span className="wb-status-value">{previewStatus === 'passed' ? 'Checked' : 'Pending'}</span>
          </div>
          <div className="wb-status-item">
            <span className="wb-small">Approval</span>
            <span className="wb-status-value">{approvalCopy[approvalStatus].label}</span>
          </div>
          <div className="wb-status-item">
            <span className="wb-small">Handoff</span>
            <span className="wb-status-value">{stagedCount ? 'Staged' : 'Open'}</span>
          </div>
        </div>

        {approvalStatus === 'idle' && previewStatus === 'pending' ? (
          <div className="wb-empty" role="status">
            <strong>No approval checkpoint yet</strong>
            <span>Check the preview or request review to light up this panel.</span>
          </div>
        ) : null}

        <ul className="wb-check-list">
          <li className="wb-approval-row">
            <span className={previewStatus === 'passed' ? 'wb-check' : 'wb-check is-pending'}>
              <Icon>{previewStatus === 'passed' ? 'check' : 'pending'}</Icon>
            </span>
            <div>
              <div className="wb-title-strong">Preview checked</div>
              <div className="wb-small">{previewStatus === 'passed' ? 'Preview has been marked checked and is ready for approval.' : 'Open Preview and mark it checked before approving.'}</div>
            </div>
          </li>
          <li className="wb-approval-row">
            <span className={approvalStatus !== 'idle' ? 'wb-check' : 'wb-check is-pending'}>
              <Icon>{approvalStatus !== 'idle' ? 'check' : 'pending'}</Icon>
            </span>
            <div>
              <div className="wb-title-strong">Review checkpoint</div>
              <div className="wb-small">{approvalCopy[approvalStatus].detail}</div>
            </div>
          </li>
          <li className="wb-approval-row">
            <span className={approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 'wb-check' : 'wb-check is-pending'}>
              <Icon>{approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 'check' : 'pending'}</Icon>
            </span>
            <div>
              <div className="wb-title-strong">Handoff staged</div>
              <div className="wb-small">{approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 'The handoff confirmation is visible in the activity stream.' : 'Stage handoff when the owner-facing notes are ready.'}</div>
            </div>
          </li>
        </ul>

        <div className="wb-approval-actions">
          <button className="wb-secondary" disabled={hasApproved} type="button" onClick={() => requestReview('Approval panel')}>
            <Icon>rate_review</Icon>
            Request review
          </button>
          <button className="wb-secondary" disabled={hasApproved} type="button" onClick={() => stageHandoff('Approval panel')}>
            <Icon>outbox</Icon>
            Stage handoff
          </button>
          <button className="wb-primary" disabled={!canApprove} type="button" onClick={approveWork}>
            <Icon>{hasApproved ? 'verified' : 'check_circle'}</Icon>
            {hasApproved ? 'Approved' : 'Approve'}
          </button>
        </div>
      </section>
    );
  }, [
    activePanel,
    approvalStatus,
    approveWork,
    canApprove,
    hasApproved,
    markPreviewChecked,
    previewStatus,
    requestReview,
    stageHandoff,
    stagedCount,
  ]);

  return (
    <div className="wb-react">
      <style>{workbenchStyles}</style>
      <canvas ref={canvasRef} className="wb-particles" aria-hidden="true" />

      <div className="wb-shell">
        <aside className="wb-sidebar wb-glass" aria-label="Workbench navigation">
          <div className="wb-brand">
            <span className="wb-brand-mark">AH</span>
            <div className="wb-title">
              <h2>AGENTHUB</h2>
              <p className="wb-brand-sub">Workbench</p>
            </div>
          </div>

          <button className="wb-primary" type="button" onClick={openCommandPanel}>
            <Icon>add_task</Icon>
            New work item
          </button>

          <nav className="wb-nav" aria-label="Primary">
            <a className="wb-nav-item is-active" href="#workbench"><Icon>view_quilt</Icon>Workbench</a>
            <a className="wb-nav-item" href="#sessions"><Icon>forum</Icon>Sessions</a>
            <a className="wb-nav-item" href="#agents"><Icon>account_tree</Icon>Agent graph</a>
            <a className="wb-nav-item" href="#projects"><Icon>folder_open</Icon>Projects</a>
          </nav>

          <div className="wb-section-label">
            <span>Active sessions</span>
            <span>{sessions.length}</span>
          </div>

          <ul className="wb-session-list">
            {sessions.map((session) => (
              <li className="wb-session-item" key={session.title}>
                <div className="wb-row-between">
                  <span className="wb-title-strong">{session.title}</span>
                  {session.status === 'Live' ? <span className="wb-dot" /> : <span className="wb-mini-pill">{session.status}</span>}
                </div>
                <span className="wb-session-meta">{session.meta}</span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="wb-main">
          <header className="wb-topbar wb-glass">
            <label className="wb-search">
              <Icon>search</Icon>
              <input type="search" placeholder="Search tasks, files, agents" />
            </label>
            <div className="wb-topbar-actions">
              <span className="wb-pill"><span className="wb-dot" />Local preview only</span>
              <button className="wb-icon-button" type="button" aria-label="Open command palette" onClick={openCommandPanel}>
                <Icon>keyboard_command_key</Icon>
              </button>
              <button className="wb-icon-button" type="button" aria-label="Notifications" onClick={noteLocalNotifications}>
                <Icon>notifications</Icon>
              </button>
              <button className="wb-secondary" disabled={hasApproved} type="button" onClick={() => requestReview('Top bar')}>
                <Icon>verified</Icon>
                Request review
              </button>
            </div>
          </header>

          <div className="wb-work-grid">
            <main className="wb-conversation wb-glass">
              <div className="wb-task-head">
                <div>
                  <span className="wb-pill">Frontend coordination</span>
                  <h2 className="wb-task-title">Shape the multi-agent workbench surface</h2>
                  <p className="wb-copy">
                    A focused planning surface for parallel workers: sessions stay visible, agent progress is explicit, and review panels sit beside the work instead of hiding behind navigation.
                  </p>
                </div>
                <button className="wb-secondary" disabled={hasApproved} type="button" onClick={() => stageHandoff('Task header')}>
                  <Icon>play_arrow</Icon>
                  {approvalStatus === 'handoff-staged' ? 'Handoff staged' : 'Stage handoff'}
                </button>
              </div>

              {confirmation ? (
                <div className={`wb-confirm is-${confirmation.tone}`} role="status">
                  <div className="wb-confirm-text">
                    <strong>{confirmation.message}</strong>
                    <span className="wb-small">{confirmation.detail}</span>
                  </div>
                  <button className="wb-secondary" type="button" onClick={() => setConfirmation(null)}>Dismiss</button>
                </div>
              ) : null}

              <div className="wb-metrics" aria-label="Task metrics">
                <div className="wb-metric">
                  <span className="wb-metric-value">{6 - stagedCount}</span>
                  <span className="wb-metric-label">Open UI tasks</span>
                </div>
                <div className="wb-metric">
                  <span className="wb-metric-value">{activeAgentCount}</span>
                  <span className="wb-metric-label">Agents active</span>
                </div>
                <div className="wb-metric">
                  <span className="wb-metric-value">{previewStatus === 'passed' ? '0m' : '12m'}</span>
                  <span className="wb-metric-label">Last update</span>
                </div>
              </div>

              <ul className="wb-agent-list" aria-label="Agent collaboration status">
                {agents.map((agent) => (
                  <li className={agent.paused ? 'wb-agent-card is-paused' : 'wb-agent-card'} key={agent.id}>
                    <div className="wb-row-between">
                      <div className="wb-avatar">{agent.initials}</div>
                      <span className="wb-mini-pill">{agent.paused ? 'Paused' : agent.status}</span>
                    </div>
                    <div className="wb-title-strong">{agent.name}</div>
                    <div className="wb-agent-role">{agent.role}</div>
                    <div className="wb-route">
                      <Icon>alt_route</Icon>
                      <span>{agent.route}</span>
                    </div>
                    <div className={agent.paused ? 'wb-progress is-paused' : 'wb-progress'} aria-label={`${agent.progress}% complete`}>
                      <span style={{ width: `${agent.progress}%` }} />
                    </div>
                    <div className="wb-agent-actions">
                      <button className="wb-secondary" type="button" onClick={() => toggleAgentPause(agent.id)}>
                        <Icon>{agent.paused ? 'play_circle' : 'pause_circle'}</Icon>
                        {agent.paused ? 'Resume' : 'Pause'}
                      </button>
                      <button className="wb-secondary" type="button" onClick={() => rerouteAgent(agent.id)}>
                        <Icon>swap_calls</Icon>
                        Reroute
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <ol className="wb-feed" aria-label="Session activity">
                {activityFeed.length ? activityFeed.map((activity) => (
                  <li className="wb-message" key={activity.id}>
                    <div className="wb-message-icon"><Icon>{activity.icon}</Icon></div>
                    <div>
                      <div className="wb-title-strong">{activity.title}</div>
                      <div className="wb-small">{activity.detail}</div>
                    </div>
                  </li>
                )) : (
                  <li className="wb-empty">
                    <strong>No local activity yet</strong>
                    <span>Use a command, agent control, or approval action to add entries.</span>
                  </li>
                )}
              </ol>

              <form className="wb-composer" onSubmit={queueInstruction}>
                <Icon>bolt</Icon>
                <input
                  aria-label="Draft instruction"
                  placeholder="Draft an instruction for the next worker..."
                  value={draftInstruction}
                  onChange={(event) => setDraftInstruction(event.target.value)}
                />
                <button className="wb-secondary" disabled={!draftInstruction.trim()} type="submit">Queue</button>
              </form>
            </main>

            <aside className="wb-inspector wb-glass" aria-label="Review panel">
              <div className="wb-inspector-head">
                <div className="wb-panel-heading">
                  <div>
                    <div className="wb-title-strong">Diff / Preview / Approval</div>
                    <div className="wb-small">Static local UI states for the workbench shell</div>
                  </div>
                  <span className="wb-mini-pill">{approvalCopy[approvalStatus].label}</span>
                </div>
                <div className="wb-tabs" role="tablist" aria-label="Review views">
                  {panelLabels.map((panel) => (
                    <button
                      aria-pressed={activePanel === panel}
                      className={activePanel === panel ? 'wb-tab is-active' : 'wb-tab'}
                      key={panel}
                      onClick={() => setActivePanel(panel)}
                      type="button"
                    >
                      {panel}
                    </button>
                  ))}
                </div>
              </div>
              <div className="wb-panel-body">{panelContent}</div>
            </aside>
          </div>
        </section>
      </div>

      {isCommandOpen ? (
        <div
          className="wb-command-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              closeCommandPanel();
            }
          }}
        >
          <section className="wb-command-panel wb-glass" role="dialog" aria-label="Command palette">
            <label className="wb-command-input">
              <Icon>terminal</Icon>
              <input
                placeholder="Type a command or route work to an agent"
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
              />
            </label>
            <div className="wb-command-actions">
              {filteredCommands.length ? filteredCommands.map((option) => (
                <button
                  disabled={option.disabled}
                  key={option.id}
                  type="button"
                  onClick={() => {
                    option.run();
                    closeCommandPanel();
                  }}
                >
                  <Icon>{option.icon}</Icon>
                  <span className="wb-command-copy">
                    <span className="wb-title-strong">{option.title}</span>
                    <span className="wb-command-description">{option.description}</span>
                  </span>
                  <span className="wb-mini-pill">{option.shortcut}</span>
                </button>
              )) : (
                <div className="wb-empty" role="status">
                  <strong>No local commands found</strong>
                  <span>Try preview, diff, approval, route, pause, or handoff.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default WorkbenchPageInteractive;
