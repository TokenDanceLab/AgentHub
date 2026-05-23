import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { mockRunners, mockRuns, mockWorkspaceFiles, MockEventStream, playRunLifecycle } from '@shared/index';

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

const members: Member[] = mockRunners.map((runner, i) => ({
  initials: runner.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2),
  name: runner.name,
  role: runner.capabilities ?? 'No capability info',
  accent: (['blue', 'purple', 'teal', 'cyan'] as const)[i % 4],
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
  accent: (['cyan', 'purple', 'teal', 'blue'] as const)[i % 4],
}));

const initialActivities: ActivityItem[] = mockRuns.map((run, i) => ({
  title: `${mockRunners[i % mockRunners.length]?.name ?? 'Agent'} — run.${run.status}`,
  detail: `Run on thread ${run.threadId}: ${run.status === 'finished' ? 'Completed successfully' : run.status === 'running' ? 'Executing...' : 'Waiting in queue'}`,
  time: run.createdAt.slice(11, 16),
  accent: (['cyan', 'purple', 'teal'] as const)[i % 3],
}));

const laneLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  active: "In progress",
  review: "Review",
};

const memberFilterOptions: Array<{ id: MemberFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "online", label: "Online" },
  { id: "busy", label: "Busy" },
  { id: "offline", label: "Offline" },
];

const presenceLabels: Record<MemberPresence, string> = {
  online: "Online",
  busy: "Busy",
  offline: "Offline",
};

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
  min-height: 100vh;
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
  height: calc(100vh - 44px);
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
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
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
  color: #fff;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--gwr-blue), var(--gwr-cyan));
  box-shadow: 0 10px 22px rgba(23, 105, 232, 0.24);
  font-weight: 900;
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
  border: 1px solid rgba(255,255,255,0.68);
  border-radius: 12px;
  background: rgba(255,255,255,0.52);
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
  border-color: rgba(23,105,232,0.2);
  background: rgba(23,105,232,0.1);
}

.gwr-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: var(--gwr-blue);
  background: rgba(23,105,232,0.1);
  font-size: 14px;
  font-weight: 900;
}

.gwr-accent-cyan {
  color: #087f9e;
  background: rgba(8,167,207,0.11);
}

.gwr-accent-purple {
  color: #6044d7;
  background: rgba(116,87,232,0.11);
}

.gwr-accent-teal {
  color: #15746f;
  background: rgba(15,159,154,0.11);
}

.gwr-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  color: #fff;
  border: 2px solid rgba(255,255,255,0.82);
  border-radius: 50%;
  background: linear-gradient(135deg, var(--gwr-blue), var(--gwr-cyan));
  box-shadow: 0 8px 20px rgba(23,105,232,0.16);
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
  background: #25c06d;
}

.gwr-avatar.is-busy::after {
  background: #d97817;
}

.gwr-avatar.is-offline::after {
  background: #95a2b8;
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
  padding: 5px 9px;
  border: 1px solid rgba(23,105,232,0.13);
  border-radius: 999px;
  background: rgba(23,105,232,0.08);
  color: #1459c7;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.gwr-pill.cyan {
  border-color: rgba(8,167,207,0.18);
  background: rgba(8,167,207,0.1);
  color: #087f9e;
}

.gwr-pill.purple {
  border-color: rgba(116,87,232,0.18);
  background: rgba(116,87,232,0.1);
  color: #6044d7;
}

.gwr-pill.green {
  border-color: rgba(31,155,100,0.2);
  background: rgba(31,155,100,0.11);
  color: #15744b;
}

.gwr-dot {
  display: inline-flex;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--gwr-green);
  box-shadow: 0 0 0 4px rgba(31,155,100,0.12);
}

.gwr-dot.cyan {
  background: var(--gwr-cyan);
  box-shadow: 0 0 0 4px rgba(8,167,207,0.13);
}

.gwr-dot.purple {
  background: var(--gwr-purple);
  box-shadow: 0 0 0 4px rgba(116,87,232,0.13);
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
  border: 1px solid rgba(23,105,232,0.14);
  border-radius: 8px;
  background: rgba(255,255,255,0.62);
  color: var(--gwr-ink);
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(26,40,80,0.08);
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
  color: #fff;
  background: linear-gradient(135deg, var(--gwr-blue), var(--gwr-cyan));
  box-shadow: 0 10px 22px rgba(23,105,232,0.23);
}

.gwr-button.warning {
  color: #9a510a;
  border-color: rgba(217,122,23,0.2);
  background: rgba(217,122,23,0.1);
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
  min-height: 30px;
  padding: 7px 8px;
  border: 1px solid rgba(23,105,232,0.12);
  border-radius: 8px;
  background: rgba(255,255,255,0.48);
  color: var(--gwr-muted);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.gwr-filter.is-active {
  border-color: rgba(23,105,232,0.22);
  background: rgba(23,105,232,0.1);
  color: #1459c7;
}

.gwr-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 100%);
  min-height: 38px;
  padding: 9px 11px;
  border: 1px solid rgba(255,255,255,0.68);
  border-radius: 10px;
  background: rgba(255,255,255,0.58);
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
  background: rgba(255,255,255,0.64);
  box-shadow: 0 12px 28px rgba(26,40,80,0.1);
}

.gwr-confirmation.success {
  border-color: rgba(31,155,100,0.2);
  background: rgba(31,155,100,0.1);
}

.gwr-confirmation.warning {
  border-color: rgba(217,122,23,0.22);
  background: rgba(217,122,23,0.1);
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
  border: 1px solid rgba(143,160,190,0.14);
  border-radius: 12px;
  background: rgba(255,255,255,0.4);
}

.gwr-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(255,255,255,0.68);
  box-shadow: 0 10px 26px rgba(26,40,80,0.08);
}

.gwr-progress {
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(23,105,232,0.11);
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
  border: 1px solid rgba(255,255,255,0.68);
  border-radius: 12px;
  background: rgba(255,255,255,0.56);
}

.gwr-composer textarea {
  width: 100%;
  min-height: 54px;
  resize: none;
  padding: 10px;
  border: 1px solid rgba(143,160,190,0.18);
  border-radius: 10px;
  outline: 0;
  background: rgba(255,255,255,0.48);
  color: var(--gwr-ink);
  font: inherit;
}

.gwr-empty {
  padding: 12px;
  border: 1px dashed rgba(143,160,190,0.32);
  border-radius: 10px;
  background: rgba(255,255,255,0.34);
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
  border-color: rgba(23,105,232,0.16);
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

@media (max-width: 1160px) {
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

@media (max-width: 840px) {
  .group-workspace-react {
    min-height: 100vh;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [approval, setApproval] = useState<ApprovalState>("pending");
  const [taskOwner, setTaskOwner] = useState("Xavier");
  const [syncState, setSyncState] = useState<SyncState>({
    complete: false,
    fileCount: 12,
    lastSyncedAt: "Not synced",
    progress: 82,
    revision: 0,
  });
  const [activityLog, setActivityLog] = useState<ActivityItem[]>(initialActivities);
  const [workspaceMembers, setWorkspaceMembers] = useState<Member[]>(members);
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>({
    detail: "Local controls are wired for review, sync, assignment, member presence, and notes.",
    title: "Interactive workspace ready",
    tone: "info",
  });

  useParticleCanvas(canvasRef);

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

  // Mock event stream — feeds simulated run lifecycle into activity log.
  useEffect(() => {
    const stream = new MockEventStream();
    const unsub = stream.on((event) => {
      pushActivity({
        title: event.type,
        detail: typeof event.payload === 'object' && event.payload && 'text' in event.payload
          ? String((event.payload as Record<string, unknown>).text).trim().slice(0, 100) || '(output)'
          : JSON.stringify(event.payload).slice(0, 100),
        accent: (['cyan', 'purple', 'teal', 'blue'] as const)[Math.floor(Math.random() * 4)],
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
  const approvalLabel = approved ? "Approved" : needsEdits ? "Changes requested" : "Awaiting approval";
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
  const workspaceFiles = [...files, ...syncedFiles];

  const tasks = useMemo<WorkspaceTask[]>(() => {
    return baseTasks.map((task) => {
      if (task.id === "approve") {
        return {
          ...task,
          owner: taskOwner,
          progress: approval === "approved" ? 100 : approval === "changes" ? 60 : 82,
          summary:
            approval === "approved"
              ? "Approved for dry-run sync. Snapshot action is unlocked."
              : approval === "changes"
                ? "Reviewer requested one visible edit before approval."
                : task.summary,
        };
      }

      if (task.id === "snapshot" && syncState.complete) {
        return {
          ...task,
          progress: syncState.progress,
          summary: `Dry-run snapshot synced at ${syncState.lastSyncedAt}.`,
        };
      }

      return task;
    });
  }, [approval, syncState.complete, syncState.lastSyncedAt, syncState.progress, taskOwner]);

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
      detail: "Sync controls are unlocked and the review task is marked complete.",
      accent: "blue",
    });
    showConfirmation({
      title: "Approval saved",
      detail: "Parser v2 is approved. The snapshot sync button is now enabled.",
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
      detail: "Sync was locked again until the requested changes are resolved.",
      accent: "purple",
    });
    showConfirmation({
      title: "Changes requested",
      detail: "Approval state changed and sync is locked while the review is open.",
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
      title: "Review reassigned",
      detail: `Parser v2 is now assigned to ${nextOwner}.`,
      tone: "info",
    });
  };

  const syncSnapshot = () => {
    if (!approved) {
      showConfirmation({
        title: "Sync is locked",
        detail: "Approve parser v2 before syncing the shared snapshot.",
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
      detail: `Workspace files updated and sync receipt generated at ${syncedAt}.`,
      accent: "cyan",
    });
    showConfirmation({
      title: "Snapshot synced",
      detail: `Files, progress, and last sync time now reflect revision ${nextRevision}.`,
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
    pushActivity({
      title: `${selectedMember.name} is now ${presenceLabels[nextPresence].toLowerCase()}`,
      detail: "Member presence changed locally and the member filter counters updated.",
      accent: selectedMember.accent,
    });
    showConfirmation({
      title: "Member status updated",
      detail: `${selectedMember.name} switched to ${presenceLabels[nextPresence]}.`,
      tone: nextPresence === "offline" ? "warning" : "info",
    });
  };

  const selectMemberFilter = (filter: MemberFilter) => {
    setMemberFilter(filter);
    showConfirmation({
      title: "Member filter changed",
      detail:
        filter === "all"
          ? "Showing every workspace member."
          : `Showing only members marked ${presenceLabels[filter].toLowerCase()}.`,
      tone: "info",
    });
  };

  const sendNote = () => {
    const trimmedNote = noteDraft.trim();
    if (!trimmedNote) {
      showConfirmation({
        title: "Note is empty",
        detail: "Write a collaboration note before sending it to the activity flow.",
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
      title: "Note posted",
      detail: "The note was added to the activity flow and the composer was cleared.",
      tone: "success",
    });
  };

  const fillComposer = (token: string, confirmationTitle: string) => {
    setNoteDraft((current) => `${current}${current ? " " : ""}${token}`);
    showConfirmation({
      title: confirmationTitle,
      detail: "Composer content was updated locally.",
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
      title: "File placeholder added",
      detail: "The file counter changed locally for this interactive preview.",
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
      title: "Export prepared",
      detail: "No file was downloaded. The action is captured in the activity flow.",
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
              <p className="gwr-brand-sub">Group Workspace</p>
            </div>
          </div>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <h2>Spaces</h2>
              <span className="gwr-pill cyan">
                <span className="gwr-dot cyan" />
                Live
              </span>
            </div>
            <div className="gwr-stack">
              <div className="gwr-nav is-active">
                <AccentIcon accent="blue" label="S" />
                <div className="gwr-truncate">
                  <strong>Legacy Migration</strong>
                  <p className="gwr-tiny gwr-truncate">Cross-system sync</p>
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
                  <p className="gwr-tiny gwr-truncate">{syncState.fileCount} documents</p>
                </div>
              </div>
            </div>
          </section>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <h2>Members</h2>
              <span className="gwr-tiny">
                {onlineCount} online / {busyCount} busy
              </span>
            </div>
            <div className="gwr-filters" role="group" aria-label="Filter members by status">
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
                <div className="gwr-empty">No members match this status filter. Pick another filter or cycle a member status.</div>
              ) : null}
            </div>
          </section>

          <div className="gwr-spacer" />
          <section className="gwr-sync">
            <div className="gwr-row">
              <span className="gwr-eyebrow">Workspace Health</span>
              <span className={`gwr-pill ${syncState.complete ? "green" : "cyan"}`}>
                {syncState.complete ? "Synced" : "Stable"}
              </span>
            </div>
            <p className="gwr-small">Local UI state only. Last sync: {syncState.lastSyncedAt}.</p>
          </section>
        </aside>

        <main className="gwr-main">
          <header className="gwr-top gwr-glass">
            <div className="gwr-title">
              <p className="gwr-eyebrow">Legacy Migration Room</p>
              <h1>Shared operations cockpit</h1>
              <p className="gwr-small">
                Members, tasks, files, approvals, and sync status stay visible in one working surface.
              </p>
            </div>
            <div className="gwr-actions">
              <div className="gwr-search" aria-label="Search workspace">
                <span>Search</span>
                <span className="gwr-truncate">tasks, files, members</span>
              </div>
              <button className="gwr-button" type="button" onClick={exportSummary}>
                Export
              </button>
              <button className="gwr-button primary" type="button" onClick={assignSecurity}>
                Assign review
              </button>
            </div>
          </header>

          <section className="gwr-stats">
            <div className="gwr-stat gwr-glass">
              <strong>{onlineCount}</strong>
              <p className="gwr-small">Online members</p>
            </div>
            <div className="gwr-stat gwr-glass">
              <strong>{tasks.length}</strong>
              <p className="gwr-small">Shared tasks</p>
            </div>
            <div className="gwr-stat gwr-glass">
              <strong>{syncState.fileCount}</strong>
              <p className="gwr-small">Workspace files</p>
            </div>
            <div className="gwr-stat gwr-glass">
              <strong>{syncState.progress}%</strong>
              <p className="gwr-small">Sync readiness</p>
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
              aria-label="Dismiss confirmation"
              onClick={() =>
                showConfirmation({
                  title: "Status bar cleared",
                  detail: "The next local action will appear here.",
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
                  <p className="gwr-eyebrow">Shared Task Board</p>
                  <h2>Current coordination plan</h2>
                </div>
                <span className="gwr-pill purple">Auto assigned</span>
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
                            {task.tag}
                          </span>
                          <span className="gwr-tiny">{task.progress}%</span>
                        </div>
                        <h3>{task.title}</h3>
                        <p className="gwr-small">{task.summary}</p>
                        <div className="gwr-progress" aria-label={`${task.title} progress`}>
                          <span style={{ width: `${task.progress}%` }} />
                        </div>
                        <div className="gwr-row">
                          <span className="gwr-tiny">Owner: {task.owner}</span>
                          {task.id === "approve" ? (
                            <button className="gwr-button" type="button" onClick={assignSecurity}>
                              Reassign
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
                  <p className="gwr-eyebrow">Activity Flow</p>
                  <h2>Workspace pulse</h2>
                </div>
                <span className={`gwr-pill ${syncState.complete ? "green" : "cyan"}`}>
                  <span className="gwr-dot" />
                  {syncState.complete ? "Synced" : "Live"}
                </span>
              </div>

              <div className="gwr-activity-list">
                {activityLog.map((activity, index) => (
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
                      aria-label="Mention member"
                      onClick={() => fillComposer("@group", "Mention inserted")}
                    >
                      @
                    </button>
                    <button
                      className="gwr-icon-button"
                      type="button"
                      aria-label="Attach file"
                      onClick={() => fillComposer("[attachment]", "Attachment marker inserted")}
                    >
                      +
                    </button>
                    <button
                      className="gwr-icon-button"
                      type="button"
                      aria-label="Create task"
                      onClick={() => fillComposer("#task", "Task marker inserted")}
                    >
                      T
                    </button>
                  </div>
                  <span className="gwr-pill cyan">@group</span>
                </div>
                <textarea
                  aria-label="Workspace message"
                  placeholder="Send a coordination note to this workspace..."
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <div className="gwr-row">
                  <span className="gwr-tiny">{noteDraft.trim() ? `${noteDraft.trim().length} characters ready` : "Draft is empty."}</span>
                  <button className="gwr-button primary" type="button" disabled={!noteDraft.trim()} onClick={sendNote}>
                    Send note
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
                <p className="gwr-eyebrow">Approval</p>
                <h2>Parser v2 ready</h2>
              </div>
              <span className={approved ? "gwr-pill green" : needsEdits ? "gwr-pill purple" : "gwr-pill"}>
                {approvalLabel}
              </span>
            </div>
            <div className="gwr-approval">
              <div className="gwr-row">
                <strong>{approvalLabel}</strong>
                <span className="gwr-tiny">Owner: {taskOwner}</span>
              </div>
              <p className="gwr-small">
                {approved
                  ? "Parser diff is approved. Sync controls are now visible and enabled."
                  : needsEdits
                    ? "A requested-edit state is visible on the review card and board."
                    : "Parser diff is staged, security checks passed, and sync remains locked until approval."}
              </p>
              <div className="gwr-actions">
                <button className="gwr-button warning" type="button" onClick={requestEdits}>
                  Request edits
                </button>
                <button className="gwr-button primary" type="button" onClick={approveParser}>
                  Approve
                </button>
              </div>
            </div>
          </section>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <div className="gwr-title">
                <p className="gwr-eyebrow">Sync Status</p>
                <h2>Shared snapshot</h2>
              </div>
              <span className={`gwr-pill ${syncState.complete ? "green" : "cyan"}`}>{syncState.progress}%</span>
            </div>
            <div className="gwr-sync">
              <div className="gwr-row">
                <span className="gwr-small">Dry-run readiness</span>
                <strong>{syncState.complete ? "Complete" : approved ? "Unlocked" : "Locked"}</strong>
              </div>
              <div className="gwr-progress" aria-label="Dry-run readiness">
                <span style={{ width: `${syncState.progress}%` }} />
              </div>
              <button
                className="gwr-button primary"
                type="button"
                disabled={approvalLocked}
                onClick={syncSnapshot}
              >
                {syncState.complete ? "Sync again" : approved ? "Sync snapshot" : "Approve to sync"}
              </button>
              <div className="gwr-checks">
                <div className="gwr-check">
                  <span className="gwr-dot cyan" />
                  <div>
                    <strong>Files indexed</strong>
                    <p className="gwr-tiny">{syncState.fileCount} workspace files available.</p>
                  </div>
                </div>
                <div className="gwr-check">
                  <span className="gwr-dot purple" />
                  <div>
                    <strong>Assignments visible</strong>
                    <p className="gwr-tiny">Review owner is {taskOwner}.</p>
                  </div>
                </div>
                <div className="gwr-check">
                  <span className="gwr-dot" />
                  <div>
                    <strong>Last sync</strong>
                    <p className="gwr-tiny">{syncState.lastSyncedAt}.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="gwr-section">
            <div className="gwr-section-head">
              <div className="gwr-title">
                <p className="gwr-eyebrow">Shared Files</p>
                <h2>Workspace documents</h2>
              </div>
              <button className="gwr-icon-button" type="button" aria-label="Add file" onClick={createLocalFile}>
                +
              </button>
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
              {workspaceFiles.length === 0 ? <div className="gwr-empty">No files are visible in this workspace.</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default GroupWorkspacePageInteractive;
