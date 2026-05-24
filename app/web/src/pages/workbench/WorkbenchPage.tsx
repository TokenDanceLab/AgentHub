import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  mockApprovals,
  mockMessages,
  mockProjects,
  mockRunners,
  mockRuns,
  mockThreads,
  mockWorkspaceFiles,
} from '@shared/index';
import styles from './WorkbenchPage.module.css';

type WorkspacePanel = 'files' | 'diff' | 'preview' | 'logs' | 'approval';

type ThreadMessage = {
  id: string;
  author: string;
  body: string;
  meta: string;
  tone: 'agent' | 'owner' | 'system';
};

type Particle = {
  alpha: number;
  hue: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

const workspacePanels: Array<{ id: WorkspacePanel; label: string }> = [
  { id: 'files', label: 'Changed Files' },
  { id: 'diff', label: 'Diff' },
  { id: 'preview', label: 'Preview' },
  { id: 'logs', label: 'Logs' },
  { id: 'approval', label: 'Approval' },
];

const fallbackMessages: ThreadMessage[] = [
  {
    id: 'm-1',
    author: 'Owner',
    body: '@Codex tighten the preview shell into a real local workbench. Keep Project, Thread, Runner status, Diff, Preview, Logs, and Approval visible.',
    meta: '10:20 - task',
    tone: 'owner',
  },
  {
    id: 'm-2',
    author: 'Codex',
    body: 'I am replacing the preview-only shell with a denser local work surface and keeping the route local. No API calls or new dependencies.',
    meta: '10:22 - running',
    tone: 'agent',
  },
  {
    id: 'm-3',
    author: 'Reviewer',
    body: 'Approval is required before apply/discard becomes active. Changed files and risk notes should stay visible in the first screen.',
    meta: '10:25 - checkpoint',
    tone: 'system',
  },
];

const diffLines = [
  ['-', 'old: separate preview shells with marketing-style chrome'],
  ['+', 'new: project/thread rail, agent run timeline, approval card'],
  ['+', 'new: changed files, diff, preview, logs, approval workspace'],
  ['+', 'new: local-only UI state with no API or package changes'],
];

function statusClass(status: string) {
  if (status === 'online' || status === 'finished' || status === 'approved') {
    return styles.good;
  }

  if (status === 'failed' || status === 'rejected') {
    return styles.bad;
  }

  if (status === 'queued' || status === 'pending' || status === 'running') {
    return styles.warn;
  }

  return styles.neutral;
}

function useParticleCanvas(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return undefined;
    }

    let width = 0;
    let height = 0;
    let frameId = 0;
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
      particles = Array.from({ length: particleCount }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1.6 + Math.random() * 2.6,
        vx: -0.18 + Math.random() * 0.36,
        vy: -0.18 - Math.random() * 0.48,
        hue: index % 3 === 0 ? 196 : 210,
        alpha: 0.18 + Math.random() * 0.2,
      }));
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
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const neighbor = particles[nextIndex];
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
        }
      });

      frameId = window.requestAnimationFrame(draw);
    };

    resize();
    frameId = window.requestAnimationFrame(draw);
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef]);
}

export default function WorkbenchPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeThreadId, setActiveThreadId] = useState(mockThreads[0]?.id ?? 'thread-local');
  const [activePanel, setActivePanel] = useState<WorkspacePanel>('files');
  const [draft, setDraft] = useState('');
  const [approvalState, setApprovalState] = useState<'pending' | 'approved' | 'rejected'>(
    mockApprovals[0]?.status === 'approved' ? 'approved' : 'pending',
  );

  const activeProject = mockProjects[0];
  const activeThread = mockThreads.find((thread) => thread.id === activeThreadId) ?? mockThreads[0];
  const run = mockRuns.find((item) => item.threadId === activeThread?.id) ?? mockRuns[0];
  const files = mockWorkspaceFiles.slice(0, 5);
  const approval = mockApprovals[0];

  const messages = useMemo<ThreadMessage[]>(() => {
    const mapped = mockMessages
      .filter((message) => message.threadId === activeThread?.id)
      .slice(0, 4)
      .map<ThreadMessage>((message) => ({
        id: message.id,
        author: message.role === 'user' ? 'Owner' : message.role === 'agent' ? 'Agent' : 'System',
        body: message.content,
        meta: `${message.role} - mock item`,
        tone: message.role === 'user' ? 'owner' : message.role === 'agent' ? 'agent' : 'system',
      }));

    return mapped.length ? mapped : fallbackMessages;
  }, [activeThread?.id]);

  const activeRunnerCount = mockRunners.filter((runner) => runner.status === 'online').length;
  const approvalLabel =
    approvalState === 'approved' ? 'Approved' : approvalState === 'rejected' ? 'Rejected' : 'Pending approval';

  const queueDraft = () => {
    setDraft('');
  };

  useParticleCanvas(canvasRef);

  return (
    <div className={styles.workbench}>
      <canvas ref={canvasRef} className={styles.particles} aria-hidden="true" />
      <aside className={styles.leftRail} aria-label="Project and thread navigation">
        <div className={styles.brandBlock}>
          <span className={styles.brandMark}>AH</span>
          <div className={styles.brandTitle}>
            <h1>AGENTHUB</h1>
            <p>Workbench</p>
          </div>
        </div>

        <section className={styles.railSection}>
          <div className={styles.sectionHead}>
            <span>Project</span>
            <span className={`${styles.badge} ${styles.good}`}>Local</span>
          </div>
          <button className={`${styles.projectCard} ${styles.selectedCard}`} type="button">
            <span className={styles.projectIcon}>AH</span>
            <span>
              <strong>{activeProject?.name ?? 'AgentHub workspace'}</strong>
              <small>{activeProject?.description ?? 'Local preview project'}</small>
            </span>
          </button>
        </section>

        <section className={styles.railSection}>
          <div className={styles.sectionHead}>
            <span>Threads</span>
            <button className={styles.textButton} type="button">New</button>
          </div>
          <div className={styles.threadList}>
            {mockThreads.slice(0, 5).map((thread) => (
              <button
                className={thread.id === activeThread?.id ? `${styles.threadButton} ${styles.activeThread}` : styles.threadButton}
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                type="button"
              >
                <span>
                  <strong>{thread.title ?? thread.id}</strong>
                  <small>{thread.status} - {thread.projectId}</small>
                </span>
                <span className={`${styles.dot} ${thread.status === 'active' ? styles.goodDot : styles.neutralDot}`} />
              </button>
            ))}
          </div>
        </section>

        <section className={styles.railSection}>
          <div className={styles.sectionHead}>
            <span>Runner Status</span>
            <span>{activeRunnerCount}/{mockRunners.length}</span>
          </div>
          <div className={styles.runnerList}>
            {mockRunners.map((runner) => (
              <div className={styles.runnerRow} key={runner.id}>
                <span className={`${styles.dot} ${runner.status === 'online' ? styles.goodDot : styles.neutralDot}`} />
                <span>
                  <strong>{runner.name}</strong>
                  <small>{runner.capabilities ?? 'adapter ready'}</small>
                </span>
                <span className={`${styles.badge} ${statusClass(runner.status)}`}>{runner.status}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className={styles.threadSurface}>
        <header className={styles.threadHeader}>
          <div>
            <p className={styles.eyebrow}>Thread</p>
            <h2>{activeThread?.title ?? 'Local workbench thread'}</h2>
            <p>Project, messages, run progress, approval, and artifacts stay in one review path.</p>
          </div>
          <div className={styles.headerActions}>
            <span className={`${styles.statusPill} ${statusClass(run?.status ?? 'queued')}`}>
              Run {run?.status ?? 'queued'}
            </span>
            <button className={styles.primaryButton} type="button">Start Mock Run</button>
          </div>
        </header>

        <section className={styles.runSummary} aria-label="Run summary">
          <article>
            <strong>{run?.runId ?? 'run_local_preview'}</strong>
            <span>AgentRun</span>
          </article>
          <article>
            <strong>{files.length}</strong>
            <span>Changed files</span>
          </article>
          <article>
            <strong>{approvalLabel}</strong>
            <span>Approval gate</span>
          </article>
          <article>
            <strong>127.0.0.1</strong>
            <span>Preview target</span>
          </article>
        </section>

        <section className={styles.messageArea} aria-label="Thread messages and run timeline">
          <div className={styles.messages}>
            <div className={styles.cardTitle}>
              <span>IM Message Flow</span>
              <span className={styles.muted}>@Agent collaboration</span>
            </div>
            <div className={styles.messageList}>
              {messages.map((message) => (
                <article className={`${styles.message} ${styles[message.tone]}`} key={message.id}>
                  <div className={styles.avatar}>{message.author.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className={styles.messageMeta}>
                      <strong>{message.author}</strong>
                      <span>{message.meta}</span>
                    </div>
                    <p>{message.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className={styles.runTimeline} aria-label="AgentRun timeline">
            <div className={styles.cardTitle}>
              <span>AgentRun Timeline</span>
              <span className={`${styles.badge} ${statusClass(run?.status ?? 'queued')}`}>{run?.status ?? 'queued'}</span>
            </div>
            <ol>
              <li className={styles.doneStep}>
                <strong>run.queued</strong>
                <span>Thread accepted the owner request.</span>
              </li>
              <li className={run?.status === 'running' ? styles.activeStep : styles.doneStep}>
                <strong>run.started</strong>
                <span>Runner adapter attached to local workspace.</span>
              </li>
              <li className={styles.activeStep}>
                <strong>run.output.batch</strong>
                <span>Logs streaming into the workbench panel.</span>
              </li>
              <li>
                <strong>artifact.created</strong>
                <span>Diff and preview become reviewable.</span>
              </li>
            </ol>
          </aside>
        </section>

        <section className={styles.approvalCard} aria-label="Approval request">
          <div>
            <p className={styles.eyebrow}>Approval request</p>
            <h3>{approval?.summary ?? 'Apply local UI preview changes?'}</h3>
            <p>
              This gate represents Apply / Discard behavior. It is local preview state only and does not call a backend.
            </p>
          </div>
          <div className={styles.approvalActions}>
            <span className={`${styles.statusPill} ${statusClass(approvalState)}`}>{approvalLabel}</span>
            <button className={styles.secondaryButton} onClick={() => setApprovalState('rejected')} type="button">
              Reject
            </button>
            <button className={styles.primaryButton} onClick={() => setApprovalState('approved')} type="button">
              Approve
            </button>
          </div>
        </section>

        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            queueDraft();
          }}
        >
          <button className={styles.iconButton} type="button" aria-label="Attach context">+</button>
          <input
            aria-label="Message thread"
            placeholder="Message this Thread with @ClaudeCode / @Codex / @OpenCode..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className={styles.primaryButton} disabled={!draft.trim()} type="submit">Send</button>
        </form>
      </main>

      <aside className={styles.workspacePanel} aria-label="Workbench workspace">
        <header className={styles.workspaceHeader}>
          <div>
            <p className={styles.eyebrow}>Workspace</p>
            <h2>Files, Diff, Preview, Logs, Approval</h2>
          </div>
          <span className={`${styles.statusPill} ${statusClass(approvalState)}`}>{approvalLabel}</span>
        </header>

        <section className={styles.workspaceSummary} aria-label="Workspace summary">
          <article>
            <span>Changed</span>
            <strong>{files.length} files</strong>
          </article>
          <article>
            <span>Risk</span>
            <strong className={styles.warnText}>Approval needed</strong>
          </article>
        </section>

        <nav className={styles.workspaceTabs} aria-label="Workspace panels">
          {workspacePanels.map((panel) => (
            <button
              className={panel.id === activePanel ? styles.activePanelTab : styles.panelTab}
              key={panel.id}
              onClick={() => setActivePanel(panel.id)}
              type="button"
            >
              {panel.label}
            </button>
          ))}
        </nav>

        <div className={styles.panelBody}>
          {activePanel === 'files' ? (
            <section className={styles.changedFiles}>
              {files.map((file) => (
                <article className={styles.fileRow} key={file.path}>
                  <span className={styles.fileType}>{file.path.split('.').pop()?.slice(0, 2).toUpperCase() ?? 'FI'}</span>
                  <span>
                    <strong>{file.path}</strong>
                    <small>{(file.sizeBytes / 1024).toFixed(1)} KB - modified {file.modifiedAt.slice(0, 10)}</small>
                  </span>
                  <span className={`${styles.badge} ${styles.warn}`}>modified</span>
                </article>
              ))}
            </section>
          ) : null}

          {activePanel === 'diff' ? (
            <section className={styles.diffBlock} aria-label="Illustrative diff">
              {diffLines.map(([prefix, line]) => (
                <div className={prefix === '+' ? styles.addLine : styles.removeLine} key={`${prefix}-${line}`}>
                  <span>{prefix}</span>
                  <code>{line}</code>
                </div>
              ))}
            </section>
          ) : null}

          {activePanel === 'preview' ? (
            <section className={styles.previewBox}>
              <div className={styles.previewTopbar}>
                <span />
                <span />
                <span />
                <strong>localhost preview</strong>
              </div>
              <div className={styles.previewCanvas}>
                <strong>AgentHub workbench</strong>
                <p>Project rail, thread flow, AgentRun timeline, and workspace review are visible together.</p>
                <span className={`${styles.statusPill} ${styles.good}`}>Ready</span>
              </div>
            </section>
          ) : null}

          {activePanel === 'logs' ? (
            <section className={styles.logBlock} aria-label="Run logs">
              <code>[10:20:01] edge: run queued for {activeThread?.id ?? 'thread'}</code>
              <code>[10:20:04] runner: Codex adapter attached</code>
              <code>[10:20:09] stdout: inspecting app/web preview surface</code>
              <code>[10:20:16] artifact: changed files detected</code>
              <code>[10:20:21] approval: waiting for owner decision</code>
            </section>
          ) : null}

          {activePanel === 'approval' ? (
            <section className={styles.approvalPanel}>
              <article>
                <span className={`${styles.dot} ${styles.goodDot}`} />
                <div>
                  <strong>Diff is reviewable</strong>
                  <p>Changed files and illustrative patch are visible.</p>
                </div>
              </article>
              <article>
                <span className={`${styles.dot} ${styles.warnDot}`} />
                <div>
                  <strong>Apply is locked</strong>
                  <p>Owner approval is required before apply/discard.</p>
                </div>
              </article>
              <article>
                <span className={`${styles.dot} ${approvalState === 'approved' ? styles.goodDot : styles.neutralDot}`} />
                <div>
                  <strong>{approvalLabel}</strong>
                  <p>Decision state is local to this preview.</p>
                </div>
              </article>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
