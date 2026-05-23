import { useEffect, useMemo, useRef, useState } from 'react';

type BoardView = 'overview' | 'tasks' | 'files';

type Task = {
  title: string;
  owner: string;
  status: 'Done' | 'Active' | 'Next';
  detail: string;
};

type FileItem = {
  name: string;
  type: string;
  status: string;
  detail: string;
};

type RunRecord = {
  id: string;
  status: string;
  detail: string;
};

const projects = [
  {
    code: 'FP',
    name: 'Frontend page preview',
    detail: 'Route preview, page polish, and visual QA for the web workspace.',
    status: 'In progress',
  },
  {
    code: 'GW',
    name: 'Group workspace shell',
    detail: 'Shared message panels, member presence, and preview entry points.',
    status: 'Review',
  },
  {
    code: 'ED',
    name: 'Edge dry-run console',
    detail: 'Local runner states and command transcript framing without live API calls.',
    status: 'Queued',
  },
];

const tasks: Task[] = [
  {
    title: 'Align glass card tokens',
    owner: 'Design systems',
    status: 'Done',
    detail: 'Blur, border, radius, and shadow match the project visual standard.',
  },
  {
    title: 'Build project detail copy',
    owner: 'Frontend pages',
    status: 'Active',
    detail: 'Overview, milestones, files, runs, and risk blocks are ready for review.',
  },
  {
    title: 'Prepare React landing copy',
    owner: 'Project worker',
    status: 'Next',
    detail: 'State changes are local only and ready for type checking.',
  },
];

const files: FileItem[] = [
  {
    name: 'ProjectPage.tsx',
    type: 'TSX',
    status: 'Edited',
    detail: 'Iframe shell preview with canvas particles and local UI interactions.',
  },
  {
    name: 'ProjectPageReact.tsx',
    type: 'TSX',
    status: 'New',
    detail: 'React component copy for later route integration and state experiments.',
  },
  {
    name: 'acceptance-notes.md',
    type: 'DOC',
    status: 'Draft',
    detail: 'Suggested validation notes for frontend coordination.',
  },
];

const runs: RunRecord[] = [
  {
    id: 'visual-preview-042',
    status: 'Pass',
    detail: 'Static layout scan completed against the local preview surface.',
  },
  {
    id: 'typecheck-next',
    status: 'Ready',
    detail: 'Recommended command: corepack.cmd pnpm typecheck.',
  },
  {
    id: 'api-wire-later',
    status: 'Deferred',
    detail: 'No live API is connected in this page copy.',
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
  .projectReactRoot {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    color: #172033;
    background:
      radial-gradient(circle at 12% 18%, rgba(37, 99, 235, 0.18), transparent 30%),
      radial-gradient(circle at 84% 8%, rgba(8, 145, 178, 0.14), transparent 28%),
      linear-gradient(135deg, #eef6ff 0%, #f8fbff 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
    gap: 12px;
    padding-bottom: 18px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  }

  .projectBrandMark,
  .projectIconTile,
  .projectFileType {
    display: grid;
    place-items: center;
    color: #ffffff;
    font-weight: 800;
    background: linear-gradient(135deg, #2563eb, #0891b2);
  }

  .projectBrandMark {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    box-shadow: 0 12px 28px rgba(37, 99, 235, 0.25);
  }

  .projectBrand h1 {
    margin: 0;
    font-size: 18px;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .projectBrand p,
  .projectMuted {
    margin: 2px 0 0;
    color: #667085;
    font-size: 12px;
    line-height: 1.45;
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
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 12px;
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
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
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
    .projectCardHeader {
      align-items: stretch;
      flex-direction: column;
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

  if (status === 'Review' || status === 'Ready') {
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
      hue: string;
    };

    const particles: Particle[] = [];
    let frameId = 0;

    const createParticle = (): Particle => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -0.16 - Math.random() * 0.22,
      radius: 1.2 + Math.random() * 2.2,
      alpha: 0.18 + Math.random() * 0.24,
      hue: Math.random() > 0.45 ? '37, 99, 235' : '8, 145, 178',
    });

    const resetParticles = () => {
      particles.length = 0;
      for (let index = 0; index < 56; index += 1) {
        particles.push(createParticle());
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
        context.fillStyle = `rgba(${particle.hue}, ${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (let inner = index + 1; inner < particles.length; inner += 1) {
          const other = particles[inner];
          const distance = Math.hypot(particle.x - other.x, particle.y - other.y);
          if (distance < 118) {
            context.beginPath();
            context.strokeStyle = `rgba(37, 99, 235, ${0.055 * (1 - distance / 118)})`;
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

export function ProjectPageReact() {
  const [activeView, setActiveView] = useState<BoardView>('overview');
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  const [riskReviewed, setRiskReviewed] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [draftCreated, setDraftCreated] = useState(false);

  const openRiskCount = riskReviewed ? 2 : 3;

  const boardTitle = useMemo(() => {
    if (activeView === 'tasks') {
      return 'Task status';
    }

    if (activeView === 'files') {
      return 'Files and run records';
    }

    return 'Project overview';
  }, [activeView]);

  return (
    <div className="projectReactRoot">
      <style>{pageStyles}</style>
      <ProjectParticles />

      <div className="projectReactShell">
        <aside className="projectSidebar projectGlass" aria-label="Project navigation">
          <div className="projectBrand">
            <div className="projectBrandMark">AH</div>
            <div>
              <h1>AgentHub</h1>
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
                <span>{view[0].toUpperCase() + view.slice(1)}</span>
              </button>
            ))}
            <button onClick={() => setIsTaskPanelOpen(true)} type="button">
              <span>NT</span>
              <span>New task</span>
            </button>
          </nav>

          <div className="projectSidebarNote">
            <strong>Project signal</strong>
            <span>
              Static design copy only. Risk review, tab switching, sync result, and task drawer are local UI states.
            </span>
          </div>
        </aside>

        <main className="projectMain">
          <header className="projectTopbar projectGlass">
            <label className="projectSearch">
              <span>Search</span>
              <input aria-label="Search projects" placeholder="Projects, tasks, files..." />
            </label>
            <div className="projectTopActions">
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
                  onClick={() => setSyncMessage('Sync simulated locally. No remote API was called.')}
                  type="button"
                >
                  {syncMessage ? 'Synced locally' : 'Simulate sync'}
                </button>
                <button
                  className="projectSecondaryButton"
                  onClick={() => setRiskReviewed((current) => !current)}
                  type="button"
                >
                  {riskReviewed ? 'Reopen risk' : 'Mark risk reviewed'}
                </button>
                <button className="projectGhostButton" onClick={() => setIsTaskPanelOpen(true)} type="button">
                  New task
                </button>
                {syncMessage ? <span className="projectSyncMessage">{syncMessage}</span> : null}
              </div>
            </div>

            <div className="projectHeroSide">
              <div className="projectProgressCard">
                <div className="projectStatusRow">
                  <span>Delivery progress</span>
                  <strong>68%</strong>
                </div>
                <div className="projectMeter" aria-label="Delivery progress 68 percent">
                  <span style={{ width: '68%' }} />
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
                      width: riskReviewed ? '72%' : '42%',
                      background: 'linear-gradient(90deg, #7c3aed, #2563eb)',
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="projectMetricGrid" aria-label="Project metrics">
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">TK</span>
              <div>
                <strong>12</strong>
                <span>Active tasks</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">M1</span>
              <div>
                <strong>4</strong>
                <span>Milestones</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">FL</span>
              <div>
                <strong>18</strong>
                <span>Shared files</span>
              </div>
            </article>
            <article className="projectMetric projectGlass">
              <span className="projectMetricIcon">RN</span>
              <div>
                <strong>7</strong>
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
                      {view[0].toUpperCase() + view.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {activeView === 'overview' ? (
                <div className="projectList">
                  {projects.map((project) => (
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
                  ))}
                </div>
              ) : null}

              {activeView === 'tasks' ? (
                <div className="projectList">
                  {tasks.map((task) => (
                    <article className={task.status === 'Done' ? 'projectTaskRow done' : 'projectTaskRow'} key={task.title}>
                      <span className="projectCheck">{task.status === 'Done' ? 'OK' : 'IN'}</span>
                      <div>
                        <strong>{task.title}</strong>
                        <p className="projectMuted">
                          {task.owner}: {task.detail}
                        </p>
                      </div>
                      <span className={`projectPill ${statusTone(task.status)}`}>{task.status}</span>
                    </article>
                  ))}
                </div>
              ) : null}

              {activeView === 'files' ? (
                <div className="projectStack">
                  <div className="projectList">
                    {files.map((file) => (
                      <article className="projectFileRow" key={file.name}>
                        <span className="projectFileType">{file.type}</span>
                        <div>
                          <strong>{file.name}</strong>
                          <p className="projectMuted">{file.detail}</p>
                        </div>
                        <span className={`projectPill ${statusTone(file.status)}`}>{file.status}</span>
                      </article>
                    ))}
                  </div>

                  <div className="projectList" aria-label="Run records">
                    {runs.map((run) => (
                      <article className="projectRunRow" key={run.id}>
                        <span className="projectRunIcon">RN</span>
                        <div>
                          <strong>{run.id}</strong>
                          <p className="projectMuted">{run.detail}</p>
                        </div>
                        <span className={`projectPill ${statusTone(run.status)}`}>{run.status}</span>
                      </article>
                    ))}
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
                  <span className={`projectPill ${riskReviewed ? 'green' : 'amber'}`}>
                    {riskReviewed ? 'Reviewed' : 'Needs review'}
                  </span>
                </div>
                <div className="projectList">
                  <article className="projectRiskRow">
                    <div>
                      <strong>No live API yet</strong>
                      <p className="projectMuted">All data is static and safe for page coordination.</p>
                    </div>
                    <span className={`projectPill ${riskReviewed ? 'green' : 'amber'}`}>
                      {riskReviewed ? 'Reviewed' : 'Open'}
                    </span>
                  </article>
                  <article className="projectRiskRow">
                    <div>
                      <strong>Parallel page edits</strong>
                      <p className="projectMuted">This worker only changes app/web/src/pages/projects.</p>
                    </div>
                    <span className="projectPill blue">Tracked</span>
                  </article>
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
            <button className="projectIconButton" onClick={() => setIsTaskPanelOpen(false)} type="button" aria-label="Close">
              X
            </button>
          </div>
          <p className="projectMuted">
            This panel is local UI only. It demonstrates how the project page will expose task creation without connecting
            a backend.
          </p>
          <div className="projectField">
            <label htmlFor="task-title">Title</label>
            <input id="task-title" defaultValue="Review project page responsive states" />
          </div>
          <div className="projectField">
            <label htmlFor="task-owner">Owner</label>
            <input id="task-owner" defaultValue="Frontend page coordinator" />
          </div>
          <div className="projectField">
            <label htmlFor="task-note">Note</label>
            <textarea id="task-note" defaultValue="Check tabs, risk toggle, sync feedback, and drawer spacing." />
          </div>
          <div className="projectButtonRow">
            <button className="projectPrimaryButton" onClick={() => setDraftCreated(true)} type="button">
              Save draft locally
            </button>
            <button className="projectSecondaryButton" onClick={() => setIsTaskPanelOpen(false)} type="button">
              Close
            </button>
          </div>
          {draftCreated ? <span className="projectSyncMessage">Draft task visible in local state only.</span> : null}
        </aside>
      ) : null}
    </div>
  );
}

export default ProjectPageReact;
