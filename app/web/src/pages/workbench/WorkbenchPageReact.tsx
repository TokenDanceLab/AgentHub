import { useEffect, useMemo, useRef, useState } from 'react';

type PanelMode = 'preview' | 'diff' | 'approval';

type Particle = {
  alpha: number;
  hue: string;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

const panelLabels: PanelMode[] = ['preview', 'diff', 'approval'];

const agents = [
  {
    initials: 'CW',
    name: 'Workbench worker',
    role: 'Refining layout, panel affordances, and visible local states',
    status: 'Coding',
    progress: 72,
  },
  {
    initials: 'VT',
    name: 'Preview tester',
    role: 'Checking responsive scan paths and visual balance',
    status: 'Visual QA',
    progress: 48,
  },
  {
    initials: 'CR',
    name: 'Coordinator',
    role: 'Watching write scope, review readiness, and handoff notes',
    status: 'Review',
    progress: 86,
  },
];

const sessions = [
  {
    title: 'Workbench polish',
    meta: 'UI worker and tester active',
    status: 'Live',
  },
  {
    title: 'Preview bridge',
    meta: 'Waiting on interface notes',
    status: 'Paused',
  },
  {
    title: 'Approval queue',
    meta: 'Ready for owner review',
    status: '3 items',
  },
];

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
    linear-gradient(135deg, rgba(247, 251, 255, 0.96), rgba(235, 242, 255, 0.92)),
    linear-gradient(90deg, rgba(25, 103, 255, 0.06) 1px, transparent 1px),
    linear-gradient(0deg, rgba(0, 173, 199, 0.05) 1px, transparent 1px);
  background-size: auto, 44px 44px, 44px 44px;
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
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
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
  padding: 16px;
}

.wb-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px 18px;
}

.wb-brand-mark,
.wb-avatar {
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
}

.wb-brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--cyan) 58%, var(--purple));
  box-shadow: 0 12px 24px rgba(25, 103, 255, 0.22);
}

.wb-brand-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.wb-brand-subtitle,
.wb-section-label {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
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
.wb-approval-row {
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
  grid-template-rows: auto auto minmax(0, 1fr) auto;
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
.wb-preview-copy {
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 8px;
  color: #253552;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
  cursor: pointer;
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
  .wb-agent-list {
    grid-template-columns: 1fr;
  }
}
`;

function useWorkbenchParticles(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
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
          radius: 1.2 + Math.random() * 2.2,
          vx: (Math.random() - 0.5) * 0.18,
          vy: -0.1 - Math.random() * 0.32,
          hue: Math.random() > 0.48 ? '0, 173, 199' : '25, 103, 255',
          alpha: 0.18 + Math.random() * 0.22,
        });
      }
    };

    const animate = () => {
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, particleIndex) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.y < -18) {
          particle.y = height + 18;
          particle.x = Math.random() * width;
        }

        if (particle.x < -18) {
          particle.x = width + 18;
        }

        if (particle.x > width + 18) {
          particle.x = -18;
        }

        context.beginPath();
        context.fillStyle = `rgba(${particle.hue},${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (let nextIndex = particleIndex + 1; nextIndex < particles.length; nextIndex += 1) {
          const nextParticle = particles[nextIndex];
          const dx = particle.x - nextParticle.x;
          const dy = particle.y - nextParticle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 118) {
            context.beginPath();
            context.strokeStyle = `rgba(25, 103, 255,${0.055 * (1 - distance / 118)})`;
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

export function WorkbenchPageReact() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activePanel, setActivePanel] = useState<PanelMode>('preview');
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);

  useWorkbenchParticles(canvasRef);

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
            </div>
          </div>
          <button
            className="wb-secondary"
            type="button"
            onClick={() => {
              setActivePanel('approval');
              setIsConfirmVisible(true);
            }}
          >
            <Icon>task_alt</Icon>
            Mark preview checked
          </button>
        </section>
      );
    }

    if (activePanel === 'diff') {
      return (
        <section className="wb-panel-stack" aria-label="Diff panel">
          <div className="wb-file-row">
            <div>
              <div className="wb-title-strong">WorkbenchPage.tsx</div>
              <div className="wb-file-meta">HTML shell layout and particle pass</div>
            </div>
            <span className="wb-mini-pill">edited</span>
          </div>
          <div className="wb-file-row">
            <div>
              <div className="wb-title-strong">WorkbenchPageReact.tsx</div>
              <div className="wb-file-meta">React landing copy with local UI states</div>
            </div>
            <span className="wb-mini-pill">new</span>
          </div>
          <div className="wb-code-diff" aria-label="Illustrative diff">
            <div className="wb-diff-line is-remove"><span>-</span><span>oversized marketing cards and broken copy</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>task surface, agent status, review tabs</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>56 subtle blue and cyan particles with faint links</span></div>
            <div className="wb-diff-line is-add"><span>+</span><span>visible command palette and confirmation bar states</span></div>
          </div>
        </section>
      );
    }

    return (
      <section className="wb-panel-stack" aria-label="Approval panel">
        <ul className="wb-check-list">
          <li className="wb-approval-row">
            <span className="wb-check"><Icon>check</Icon></span>
            <div>
              <div className="wb-title-strong">Write scope respected</div>
              <div className="wb-small">Only workbench page files are represented.</div>
            </div>
          </li>
          <li className="wb-approval-row">
            <span className="wb-check"><Icon>check</Icon></span>
            <div>
              <div className="wb-title-strong">No production calls</div>
              <div className="wb-small">Buttons change local visual state only.</div>
            </div>
          </li>
          <li className="wb-approval-row">
            <span className="wb-check"><Icon>check</Icon></span>
            <div>
              <div className="wb-title-strong">Review ready</div>
              <div className="wb-small">Preview, diff, and approval states are reachable.</div>
            </div>
          </li>
        </ul>
        <button
          className="wb-primary"
          type="button"
          onClick={() => setIsConfirmVisible(true)}
        >
          <Icon>verified</Icon>
          Approve visual direction
        </button>
        {isConfirmVisible ? (
          <div className="wb-confirm" role="status">
            <span><strong>Queued:</strong> visual review handoff is ready.</span>
            <button className="wb-secondary" type="button" onClick={() => setIsConfirmVisible(false)}>Dismiss</button>
          </div>
        ) : null}
      </section>
    );
  }, [activePanel, isConfirmVisible]);

  const requestReview = () => {
    setActivePanel('approval');
    setIsConfirmVisible(true);
  };

  return (
    <div className="wb-react">
      <style>{workbenchStyles}</style>
      <canvas ref={canvasRef} className="wb-particles" aria-hidden="true" />

      <div className="wb-shell">
        <aside className="wb-sidebar wb-glass" aria-label="Workbench navigation">
          <div className="wb-brand">
            <div className="wb-brand-mark">AH</div>
            <div>
              <h1 className="wb-brand-title">AgentHub</h1>
              <p className="wb-brand-subtitle">Workbench</p>
            </div>
          </div>

          <button className="wb-primary" type="button" onClick={() => setIsCommandOpen(true)}>
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
              <button className="wb-icon-button" type="button" aria-label="Open command palette" onClick={() => setIsCommandOpen(true)}>
                <Icon>keyboard_command_key</Icon>
              </button>
              <button className="wb-icon-button" type="button" aria-label="Notifications">
                <Icon>notifications</Icon>
              </button>
              <button className="wb-secondary" type="button" onClick={requestReview}>
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
                <button className="wb-secondary" type="button" onClick={requestReview}>
                  <Icon>play_arrow</Icon>
                  Stage handoff
                </button>
              </div>

              <div className="wb-metrics" aria-label="Task metrics">
                <div className="wb-metric">
                  <span className="wb-metric-value">6</span>
                  <span className="wb-metric-label">Open UI tasks</span>
                </div>
                <div className="wb-metric">
                  <span className="wb-metric-value">3</span>
                  <span className="wb-metric-label">Agents active</span>
                </div>
                <div className="wb-metric">
                  <span className="wb-metric-value">12m</span>
                  <span className="wb-metric-label">Last update</span>
                </div>
              </div>

              <ul className="wb-agent-list" aria-label="Agent collaboration status">
                {agents.map((agent) => (
                  <li className="wb-agent-card" key={agent.name}>
                    <div className="wb-row-between">
                      <div className="wb-avatar">{agent.initials}</div>
                      <span className="wb-mini-pill">{agent.status}</span>
                    </div>
                    <div className="wb-title-strong">{agent.name}</div>
                    <div className="wb-agent-role">{agent.role}</div>
                    <div className="wb-progress" aria-label={`${agent.progress}% complete`}>
                      <span style={{ width: `${agent.progress}%` }} />
                    </div>
                  </li>
                ))}
              </ul>

              <ol className="wb-feed" aria-label="Session activity">
                <li className="wb-message">
                  <div className="wb-message-icon"><Icon>design_services</Icon></div>
                  <div>
                    <div className="wb-title-strong">UI worker tightened the page hierarchy</div>
                    <div className="wb-small">Cards now separate navigation, conversation, and review work without stacking decorative containers inside each other.</div>
                  </div>
                </li>
                <li className="wb-message">
                  <div className="wb-message-icon"><Icon>hub</Icon></div>
                  <div>
                    <div className="wb-title-strong">Coordinator pinned the page contract</div>
                    <div className="wb-small">No real API calls, no new package dependency, and all changes stay under the workbench page directory.</div>
                  </div>
                </li>
                <li className="wb-message">
                  <div className="wb-message-icon"><Icon>rule</Icon></div>
                  <div>
                    <div className="wb-title-strong">Tester prepared review checks</div>
                    <div className="wb-small">Diff, preview, and approval affordances are visible at the same time as session progress.</div>
                  </div>
                </li>
              </ol>

              <form className="wb-composer">
                <Icon>bolt</Icon>
                <input aria-label="Draft instruction" placeholder="Draft an instruction for the next worker..." />
                <button className="wb-secondary" type="button">Queue</button>
              </form>
            </main>

            <aside className="wb-inspector wb-glass" aria-label="Review panel">
              <div className="wb-inspector-head">
                <div className="wb-panel-heading">
                  <div>
                    <div className="wb-title-strong">Diff / Preview / Approval</div>
                    <div className="wb-small">Static local UI states for the workbench shell</div>
                  </div>
                  <span className="wb-mini-pill">No API</span>
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
              setIsCommandOpen(false);
            }
          }}
        >
          <section className="wb-command-panel wb-glass" role="dialog" aria-label="Command palette">
            <label className="wb-command-input">
              <Icon>terminal</Icon>
              <input placeholder="Type a command or route work to an agent" autoFocus />
            </label>
            <div className="wb-command-actions">
              <button type="button" onClick={() => setIsCommandOpen(false)}><span>Route visual QA to tester</span><span className="wb-mini-pill">V</span></button>
              <button type="button" onClick={requestReview}><span>Create approval checkpoint</span><span className="wb-mini-pill">A</span></button>
              <button type="button" onClick={() => setActivePanel('diff')}><span>Open diff panel</span><span className="wb-mini-pill">D</span></button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default WorkbenchPageReact;
