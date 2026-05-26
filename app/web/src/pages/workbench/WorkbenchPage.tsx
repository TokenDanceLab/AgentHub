<<<<<<< HEAD
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  EventClient,
  createPreview,
  createThreadMessage,
  decideApproval,
  getBaseUrl,
  getRunLogs,
  listApprovals,
  listArtifacts,
  listPreviews,
  listProjects,
  listRunners,
  listRuns,
  listThreadItems,
  listThreads,
  startRun,
  workbenchReducer,
  type Approval,
  type Artifact,
  type Message,
  type Preview,
  type Run,
  type ThreadItem,
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

const workspacePanels: WorkspacePanel[] = ['files', 'diff', 'preview', 'logs', 'approval'];

function statusClass(status: string) {
  if (
    status === 'online' ||
    status === 'finished' ||
    status === 'approved' ||
    status === 'connected' ||
    status === 'ready'
  ) {
    return styles.good;
  }

  if (
    status === 'failed' ||
    status === 'rejected' ||
    status === 'error' ||
    status === 'disconnected'
  ) {
    return styles.bad;
  }

  if (
    status === 'queued' ||
    status === 'pending' ||
    status === 'running' ||
    status === 'loading' ||
    status === 'waiting_approval'
  ) {
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
          if (!neighbor) continue;
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

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Edge is unavailable');
}

function withTimeout<T>(
  promise: Promise<T>,
  message = 'Edge API did not respond. Check that Edge is running on 127.0.0.1:3210.',
  timeoutMs = 2500,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
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

function messageFromApi(message: Message, seq: number) {
  return {
    version: 'v1',
    id: `local-message-${message.id}-${seq}`,
    seq,
    type: 'message.created',
    scope: { threadId: message.threadId },
    sentAt: message.createdAt,
    payload: {
      messageId: message.id,
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    },
  } as const;
}

function pickActiveRun(runs: Run[], activeThreadId?: string) {
  return runs.find((item) => item.threadId === activeThreadId) ?? runs[0];
}

function pickActiveApproval(approvals: Approval[], runId?: string) {
  return (
    approvals.find((item) => item.runId === runId && item.status === 'pending') ??
    approvals.find((item) => item.runId === runId) ??
    approvals[0]
  );
}

function pickPreview(previews: Preview[], runId?: string) {
  return previews.find((item) => item.runId === runId) ?? previews[0];
}

function itemToMessage(item: ThreadItem): ThreadMessage {
  const isOwner = item.role === 'user';
  return {
    id: item.id,
    author: isOwner ? 'Owner' : 'Agent',
    body: item.content || '(empty message)',
    meta: `${item.role} - ${item.createdAt.slice(0, 16).replace('T', ' ')}`,
    tone: isOwner ? 'owner' : 'agent',
  };
}

function artifactDiffLines(artifacts: Artifact[]) {
  if (!artifacts.length) return [];

  return artifacts.slice(0, 8).flatMap((artifact) => [
    ['+', `${artifact.kind}: ${artifact.path}`],
    [' ', `${(artifact.sizeBytes / 1024).toFixed(1)} KB created ${artifact.createdAt.slice(0, 10)}`],
  ]);
}

export default function WorkbenchPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const localSeqRef = useRef(1_000_000);
  const { t } = useTranslation('workbench');
  const [state, dispatch] = useReducer(workbenchReducer, undefined, () =>
    workbenchReducer(
      {
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
      },
      { type: 'connection.loading' },
    ),
  );
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>();
  const [activePanel, setActivePanel] = useState<WorkspacePanel>('files');
  const [draft, setDraft] = useState('');
  const [actionError, setActionError] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | undefined>();

  const workspacePanelLabels: Record<WorkspacePanel, string> = {
    files: t('workspace.tabs.files'),
    diff: t('workspace.tabs.diff'),
    preview: t('workspace.tabs.preview'),
    logs: t('workspace.tabs.logs'),
    approval: t('workspace.tabs.approval'),
  };

  const statusLabel = (status: string | undefined) =>
    t(`status.${status ?? 'idle'}`, { defaultValue: status ?? 'idle' });

  const errorMessage = (msg: string) => {
    if (msg === 'Edge is unavailable') return t('error.edgeUnavailable');
    if (msg === 'Edge event stream error') return t('error.edgeEventStream');
    if (msg.startsWith('Edge API did not respond')) return t('error.edgeApiTimeout');
    return msg;
  };

  useParticleCanvas(canvasRef);

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

        const firstThreadId = threads.items[0]?.id;
        const [threadItems, runLogs] = await Promise.all([
          firstThreadId
            ? listThreadItems(firstThreadId, { pageSize: 100 })
            : Promise.resolve(undefined),
          Promise.all(
            runs.items.slice(0, 10).map(async (run) => {
              try {
                return await getRunLogs(run.runId);
              } catch {
                return undefined;
              }
            }),
          ),
        ]);

        if (cancelled) return;

        dispatch({
          type: 'snapshot.loaded',
          snapshot: {
            projects,
            threads,
            runners,
            runs,
            threadItems,
            approvals,
            artifacts,
            previews,
            runLogs: runLogs.filter((log): log is NonNullable<typeof log> => log !== undefined),
          },
        });
        setActiveThreadId((current) => current ?? firstThreadId);
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: 'connection.error', error: formatError(error) });
        }
      }
    }

    loadSnapshot();

    const client = new EventClient({ baseUrl: getBaseUrl() });
    const offEvent = client.on((event) => {
      dispatch({ type: 'event.received', event });
    });
    const offConnection = client.onConnection((status, error) => {
      if (status === 'connected') {
        dispatch({ type: 'connection.connected' });
      } else if (status === 'disconnected') {
        dispatch({ type: 'connection.disconnected', error });
      } else {
        dispatch({ type: 'connection.error', error: error ?? 'Edge event stream error' });
      }
    });

    client.connect();

    return () => {
      cancelled = true;
      offEvent();
      offConnection();
      client.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeThreadId || !state.threads[0]?.id) return;
    setActiveThreadId(state.threads[0].id);
  }, [activeThreadId, state.threads]);

  useEffect(() => {
    if (!activeThreadId || state.connection.status === 'idle') return;

    let cancelled = false;
    listThreadItems(activeThreadId, { pageSize: 100 })
      .then((threadItems) => {
        if (!cancelled) {
          dispatch({ type: 'threadItems.loaded', threadItems });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          dispatch({ type: 'connection.error', error: formatError(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  const activeProject = state.projects[0];
  const activeThread =
    state.threads.find((thread) => thread.id === activeThreadId) ?? state.threads[0];
  const run = pickActiveRun(state.runs, activeThread?.id);
  const approval = pickActiveApproval(state.approvals, run?.runId);
  const approvalState = approval?.status ?? 'pending';
  const approvalLabel =
    approvalState === 'approved'
      ? t('approval.status.approved')
      : approvalState === 'rejected'
        ? t('approval.status.rejected')
        : t('approval.status.pending');
  const runArtifacts = state.artifacts.filter((artifact) => !run || artifact.runId === run.runId);
  const preview = pickPreview(state.previews, run?.runId);
  const runLog = run ? state.runLogs[run.runId] : undefined;
  const activeRunnerCount = state.runners.filter((runner) => runner.status === 'online').length;
  const messages = useMemo<ThreadMessage[]>(() => {
    return state.threadItems
      .filter((item) => item.threadId === activeThread?.id && item.kind === 'message')
      .slice(0, 8)
      .map(itemToMessage);
  }, [activeThread?.id, state.threadItems]);
  const diffLines = useMemo(() => artifactDiffLines(runArtifacts), [runArtifacts]);
  const isOffline = state.connection.status === 'disconnected' || state.connection.status === 'error';
  const isLoading = state.connection.status === 'loading';
  const hasSnapshotData =
    state.projects.length > 0 ||
    state.threads.length > 0 ||
    state.runners.length > 0 ||
    state.runs.length > 0 ||
    state.artifacts.length > 0 ||
    state.approvals.length > 0 ||
    state.previews.length > 0;
  const isActionLocked = isOffline || isLoading || !hasSnapshotData;
  const stateNotice = isLoading
    ? t('state.loading')
    : isOffline && hasSnapshotData
      ? t('state.offlineSnapshot')
      : isOffline
        ? t('state.offlineEmpty')
        : !hasSnapshotData
          ? t('state.empty')
          : undefined;

  const queueDraft = async () => {
    const content = draft.trim();
    if (!content || !activeThread || isActionLocked) return;

    setIsSending(true);
    setActionError(undefined);
    try {
      const message = await createThreadMessage(activeThread.id, {
        role: 'user',
        content,
      });
      localSeqRef.current += 1;
      dispatch({
        type: 'event.received',
        event: messageFromApi(message, localSeqRef.current),
      });
      setDraft('');
    } catch (error) {
      setActionError(formatError(error));
    } finally {
      setIsSending(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    queueDraft();
  };

  const startActiveRun = async () => {
    if (!activeThread || isActionLocked) return;

    setIsStartingRun(true);
    setActionError(undefined);
    try {
      const nextRun = await startRun({
        projectId: activeThread.projectId,
        threadId: activeThread.id,
      });
      localSeqRef.current += 1;
      dispatch({
        type: 'event.received',
        event: {
          version: 'v1',
          id: `local-run-${nextRun.runId}-${localSeqRef.current}`,
          seq: localSeqRef.current,
          type: 'run.queued',
          scope: {
            projectId: nextRun.projectId,
            threadId: nextRun.threadId,
            runId: nextRun.runId,
          },
          sentAt: nextRun.createdAt,
          payload: {
            runId: nextRun.runId,
            projectId: nextRun.projectId,
            threadId: nextRun.threadId,
            createdAt: nextRun.createdAt,
          },
        },
      });
    } catch (error) {
      setActionError(formatError(error));
    } finally {
      setIsStartingRun(false);
    }
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!approval) return;

    setDecidingApprovalId(approval.id);
    setActionError(undefined);
    try {
      const updated = await decideApproval(approval.id, { decision });
      localSeqRef.current += 1;
      dispatch({
        type: 'event.received',
        event: {
          version: 'v1',
          id: `local-approval-${updated.id}-${localSeqRef.current}`,
          seq: localSeqRef.current,
          type: 'approval.decided',
          scope: {
            threadId: updated.threadId,
            runId: updated.runId,
          },
          sentAt: updated.decidedAt ?? new Date().toISOString(),
          payload: {
            approvalId: updated.id,
            runId: updated.runId,
            decision: updated.status,
            decidedAt: updated.decidedAt,
          },
        },
      });
    } catch (error) {
      setActionError(formatError(error));
    } finally {
      setDecidingApprovalId(undefined);
    }
  };

  const requestPreview = async () => {
    if (!run || isActionLocked) return;

    setActionError(undefined);
    try {
      await createPreview({ runId: run.runId });
    } catch (error) {
      setActionError(formatError(error));
    }
  };

  return (
    <div className={styles.workbench}>
      <canvas ref={canvasRef} className={styles.particles} aria-hidden="true" />
      <aside className={styles.leftRail} aria-label={t('leftRail.ariaLabel')}>
        <div className={styles.brandBlock}>
          <span className={styles.brandMark}>AH</span>
          <div className={styles.brandTitle}>
            <h1>AGENTHUB</h1>
            <p>{t('leftRail.workbench')}</p>
          </div>
        </div>

        <section className={styles.railSection}>
          <div className={styles.sectionHead}>
            <span>{t('leftRail.project')}</span>
            <span className={`${styles.badge} ${statusClass(state.connection.status)}`}>
              {statusLabel(state.connection.status)}
            </span>
          </div>
          <button className={`${styles.projectCard} ${styles.selectedCard}`} type="button">
            <span className={styles.projectIcon}>AH</span>
            <span>
              <strong>{activeProject?.name ?? t('leftRail.noProject')}</strong>
              <small>{activeProject?.description ?? t('leftRail.connectEdge')}</small>
            </span>
          </button>
          {state.connection.error ? (
            <p className={styles.errorText}>{errorMessage(state.connection.error)}</p>
          ) : null}
        </section>

        <section className={styles.railSection}>
          <div className={styles.sectionHead}>
            <span>{t('leftRail.threads')}</span>
            <span>{state.threads.length}</span>
          </div>
          <div className={styles.threadList}>
            {state.threads.length ? (
              state.threads.slice(0, 5).map((thread) => (
                <button
                  className={
                    thread.id === activeThread?.id
                      ? `${styles.threadButton} ${styles.activeThread}`
                      : styles.threadButton
                  }
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  type="button"
                >
                  <span>
                    <strong>{thread.title ?? thread.id}</strong>
                    <small>
                      {statusLabel(thread.status)} - {thread.projectId}
                    </small>
                  </span>
                  <span
                    className={`${styles.dot} ${
                      thread.status === 'active' ? styles.goodDot : styles.neutralDot
                    }`}
                  />
                </button>
              ))
            ) : (
              <p className={styles.emptyNotice}>{t('leftRail.noThreads')}</p>
            )}
          </div>
        </section>

        <section className={styles.railSection}>
          <div className={styles.sectionHead}>
            <span>{t('leftRail.runners')}</span>
            <span>
              {activeRunnerCount}/{state.runners.length}
            </span>
          </div>
          <div className={styles.runnerList}>
            {state.runners.length ? (
              state.runners.map((runner) => (
                <div className={styles.runnerRow} key={runner.id}>
                  <span
                    className={`${styles.dot} ${
                      runner.status === 'online' ? styles.goodDot : styles.neutralDot
                    }`}
                  />
                  <span>
                    <strong>{runner.name}</strong>
                    <small>{runner.capabilities ?? t('runner.adapterReady')}</small>
                  </span>
                  <span className={`${styles.badge} ${statusClass(runner.status)}`}>
                    {statusLabel(runner.status)}
                  </span>
                </div>
              ))
            ) : (
              <p className={styles.emptyNotice}>{t('leftRail.noRunners')}</p>
            )}
          </div>
        </section>
      </aside>

      <main className={styles.threadSurface}>
        <header className={styles.threadHeader}>
          <div>
            <p className={styles.eyebrow}>{t('header.thread')}</p>
            <h2>{activeThread?.title ?? t('header.noThread')}</h2>
            <p>
              {isOffline
                ? t('header.edgeUnavailable')
                : t('header.subtitle')}
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={`${styles.statusPill} ${statusClass(run?.status ?? 'idle')}`}>
              {t('header.runStatus', { status: statusLabel(run?.status) })}
            </span>
            <button
              className={styles.primaryButton}
            disabled={!activeThread || isStartingRun || isActionLocked}
              onClick={startActiveRun}
              type="button"
            >
              {isStartingRun ? t('header.starting') : t('header.startRun')}
            </button>
          </div>
        </header>

        {stateNotice ? <p className={styles.stateBanner}>{stateNotice}</p> : null}
        {actionError ? <p className={styles.errorBanner}>{errorMessage(actionError)}</p> : null}

        <section className={styles.runSummary} aria-label={t('runSummary.ariaLabel')}>
          <article>
            <strong>{run?.runId ?? t('runSummary.noRun')}</strong>
            <span>AgentRun</span>
          </article>
          <article>
            <strong>{runArtifacts.length}</strong>
            <span>{t('runSummary.artifacts')}</span>
          </article>
          <article>
            <strong>{approval ? approvalLabel : t('runSummary.noApproval')}</strong>
            <span>{t('runSummary.approvalGate')}</span>
          </article>
          <article>
            <strong>{preview?.url ?? t('runSummary.noPreview')}</strong>
            <span>{t('runSummary.previewTarget')}</span>
          </article>
        </section>

        <section className={styles.messageArea} aria-label={t('messages.ariaLabel')}>
          <div className={styles.messages}>
            <div className={styles.cardTitle}>
              <span>{t('messages.title')}</span>
              <span className={styles.muted}>{t('messages.subtitle')}</span>
            </div>
            <div className={styles.messageList}>
              {messages.length ? (
                messages.map((message) => (
                  <article className={`${styles.message} ${styles[message.tone]}`} key={message.id}>
                    <div className={styles.avatar}>{message.author.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className={styles.messageMeta}>
                        <strong>{t('message.author.' + message.tone)}</strong>
                        <span>{message.meta}</span>
                      </div>
                      <p>{message.body === '(empty message)' ? t('message.empty') : message.body}</p>
                    </div>
                  </article>
                ))
              ) : (
                <p className={styles.emptyNotice}>{t('messages.empty')}</p>
              )}
            </div>
          </div>

          <aside className={styles.runTimeline} aria-label={t('timeline.ariaLabel')}>
            <div className={styles.cardTitle}>
              <span>{t('timeline.title')}</span>
              <span className={`${styles.badge} ${statusClass(run?.status ?? 'idle')}`}>
                {statusLabel(run?.status)}
              </span>
            </div>
            <ol>
              <li className={run ? styles.doneStep : undefined}>
                <strong>run.queued</strong>
                <span>{run ? t('timeline.queuedDone') : t('timeline.queuedWaiting')}</span>
              </li>
              <li className={run?.startedAt ? styles.doneStep : undefined}>
                <strong>run.started</strong>
                <span>{run?.startedAt ?? t('timeline.startedWaiting')}</span>
              </li>
              <li className={runLog ? styles.activeStep : undefined}>
                <strong>run.output.batch</strong>
                <span>{runLog ? t('timeline.logsAvailable') : t('timeline.noLogs')}</span>
              </li>
              <li className={runArtifacts.length ? styles.doneStep : undefined}>
                <strong>artifact.created</strong>
                <span>
                  {runArtifacts.length ? t('timeline.artifactsAvailable') : t('timeline.noArtifacts')}
                </span>
              </li>
            </ol>
          </aside>
        </section>

        <section className={styles.approvalCard} aria-label={t('approval.ariaLabel')}>
          <div>
            <p className={styles.eyebrow}>{t('approval.title')}</p>
            <h3>{approval?.summary ?? t('approval.empty')}</h3>
            <p>
              {approval
                ? t('approval.description')
                : t('approval.noPending')}
            </p>
          </div>
          <div className={styles.approvalActions}>
            <span className={`${styles.statusPill} ${statusClass(approvalState)}`}>
              {approval ? approvalLabel : t('status.idle')}
            </span>
            <button
              className={styles.secondaryButton}
            disabled={!approval || approval.status !== 'pending' || decidingApprovalId === approval.id || isActionLocked}
              onClick={() => decide('rejected')}
              type="button"
            >
              {t('approval.reject')}
            </button>
            <button
              className={styles.primaryButton}
            disabled={!approval || approval.status !== 'pending' || decidingApprovalId === approval.id || isActionLocked}
              onClick={() => decide('approved')}
              type="button"
            >
              {t('approval.approve')}
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
          <button className={styles.iconButton} type="button" aria-label={t('composer.attach')}>
            +
          </button>
          <textarea
            aria-label={t('composer.threadAriaLabel')}
            disabled={!activeThread || isSending || isActionLocked}
            placeholder={isActionLocked ? t('composer.lockedPlaceholder') : t('composer.placeholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={1}
          />
          <button className={styles.primaryButton} disabled={!draft.trim() || isSending || isActionLocked} type="submit">
            {isSending ? t('composer.sending') : t('composer.send')}
          </button>
        </form>
      </main>

      <aside className={styles.workspacePanel} aria-label={t('workspace.ariaLabel')}>
        <header className={styles.workspaceHeader}>
          <div>
            <p className={styles.eyebrow}>{t('workspace.title')}</p>
            <h2>{t('workspace.subtitle')}</h2>
          </div>
          <span className={`${styles.statusPill} ${statusClass(approvalState)}`}>
            {approval ? approvalLabel : t('status.idle')}
          </span>
        </header>

        <section className={styles.workspaceSummary} aria-label={t('workspace.summary.ariaLabel')}>
          <article>
            <span>{t('workspace.summary.artifacts')}</span>
            <strong>{t('workspace.summary.artifactCount', { count: runArtifacts.length })}</strong>
          </article>
          <article>
            <span>{t('workspace.summary.risk')}</span>
            <strong className={approval?.status === 'pending' ? styles.warnText : undefined}>
              {approval?.status === 'pending' ? t('workspace.summary.approvalNeeded') : t('workspace.summary.noPendingGate')}
            </strong>
          </article>
        </section>

        <nav className={styles.workspaceTabs} aria-label={t('workspace.tabs.ariaLabel')}>
          {workspacePanels.map((panel) => (
            <button
              className={panel === activePanel ? styles.activePanelTab : styles.panelTab}
              key={panel}
              onClick={() => setActivePanel(panel)}
              type="button"
            >
              {workspacePanelLabels[panel]}
            </button>
          ))}
        </nav>

        <div className={styles.panelBody}>
          {activePanel === 'files' ? (
            <section className={styles.changedFiles}>
              {runArtifacts.length ? (
                runArtifacts.map((artifact) => (
                  <article className={styles.fileRow} key={artifact.id}>
                    <span className={styles.fileType}>
                      {artifact.path.split('.').pop()?.slice(0, 2).toUpperCase() ?? 'FI'}
                    </span>
                    <span>
                      <strong>{artifact.path}</strong>
                      <small>
                        {t('workspace.files.fileInfo', {
                          size: (artifact.sizeBytes / 1024).toFixed(1),
                          date: artifact.createdAt.slice(0, 10),
                        })}
                      </small>
                    </span>
                    <span className={`${styles.badge} ${styles.warn}`}>{artifact.kind}</span>
                  </article>
                ))
              ) : (
                <p className={styles.emptyNotice}>{t('workspace.empty.artifacts')}</p>
              )}
            </section>
          ) : null}

          {activePanel === 'diff' ? (
            <section className={styles.diffBlock} aria-label={t('workspace.diff.ariaLabel')}>
              {diffLines.length ? (
                diffLines.map(([prefix, line], index) => (
                  <div
                    className={prefix === '+' ? styles.addLine : prefix === '-' ? styles.removeLine : styles.neutralLine}
                    key={`${prefix}-${line}-${index}`}
                  >
                    <span>{prefix}</span>
                    <code>{line}</code>
                  </div>
                ))
              ) : (
                <p className={styles.emptyNotice}>{t('workspace.empty.diffArtifacts')}</p>
              )}
            </section>
          ) : null}

          {activePanel === 'preview' ? (
            <section className={styles.previewBox}>
              <div className={styles.previewTopbar}>
                <span />
                <span />
                <span />
                <strong>{preview?.url ?? t('workspace.preview.unavailable')}</strong>
              </div>
              <div className={styles.previewCanvas}>
                <strong>{preview?.status === 'ready' ? t('workspace.preview.ready') : t('workspace.preview.notReady')}</strong>
                <p>{preview?.url ?? t('workspace.preview.hint')}</p>
                {run && !preview ? (
                  <button className={styles.secondaryButton} disabled={isActionLocked} onClick={requestPreview} type="button">
                    {t('workspace.preview.request')}
                  </button>
                ) : null}
                {preview?.url ? (
                  <a className={styles.previewLink} href={preview.url} target="_blank" rel="noreferrer">
                    {t('workspace.preview.open')}
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {activePanel === 'logs' ? (
            <section className={styles.logBlock} aria-label={t('workspace.logs.ariaLabel')}>
              {runLog?.stdout || runLog?.stderr ? (
                <>
                  {runLog.stdout ? <code>{runLog.stdout}</code> : null}
                  {runLog.stderr ? <code>{runLog.stderr}</code> : null}
                </>
              ) : (
                <code>{t('workspace.empty.logs')}</code>
              )}
            </section>
          ) : null}

          {activePanel === 'approval' ? (
            <section className={styles.approvalPanel}>
              <article>
                <span
                  className={`${styles.dot} ${
                    runArtifacts.length ? styles.goodDot : styles.neutralDot
                  }`}
                />
                <div>
                  <strong>{t('workspace.approval.artifacts')}</strong>
                  <p>
                    {runArtifacts.length
                      ? t('workspace.approval.artifactsAvailable')
                      : t('workspace.approval.noArtifacts')}
                  </p>
                </div>
              </article>
              <article>
                <span
                  className={`${styles.dot} ${
                    approval?.status === 'pending' ? styles.warnDot : styles.neutralDot
                  }`}
                />
                <div>
                  <strong>{t('workspace.approval.applyGate')}</strong>
                  <p>
                    {approval?.status === 'pending'
                      ? t('workspace.approval.ownerApprovalRequired')
                      : t('workspace.approval.noPendingRequest')}
                  </p>
                </div>
              </article>
              <article>
                <span
                  className={`${styles.dot} ${
                    approvalState === 'approved' ? styles.goodDot : styles.neutralDot
                  }`}
                />
                <div>
                  <strong>{approval ? approvalLabel : t('status.idle')}</strong>
                  <p>{t('workspace.approval.decisionSource')}</p>
                </div>
              </article>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
=======
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, Pill, Avatar, SearchInput, ProgressBar, Card } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './WorkbenchPage.module.css';

/* ── Types ────────────────────────────────────────────────── */

type PanelMode = 'preview' | 'diff' | 'approval';
type ApprovalStatus = 'idle' | 'review-requested' | 'handoff-staged' | 'approved';
type PreviewStatus = 'pending' | 'passed';
type ConfirmationTone = 'info' | 'success' | 'warning';

interface AgentCard {
  id: string;
  initials: string;
  name: string;
  paused: boolean;
  progress: number;
  role: string;
  route: string;
  status: string;
}

interface ActivityItem {
  detail: string;
  icon: string;
  id: string;
  title: string;
}

interface ConfirmationBar {
  detail: string;
  id: string;
  message: string;
  tone: ConfirmationTone;
}

interface CommandOption {
  description: string;
  disabled?: boolean;
  icon: string;
  id: string;
  run: () => void;
  shortcut: string;
  title: string;
}

interface WorkbenchSession {
  title: string;
  meta: string;
  status: 'Live' | 'Archived';
}

/* ── Constants ────────────────────────────────────────────── */

const panelLabels: PanelMode[] = ['preview', 'diff', 'approval'];

const routeOptions = [
  'Preview verification',
  'Diff validation',
  'Approval handoff',
  'Responsive sweep',
];

const mockRunnerNames = [
  { id: 'worker-01', name: 'Workbench worker', capabilities: 'Refining layout and state affordances' },
  { id: 'worker-02', name: 'Preview tester', capabilities: 'Checking responsive surfaces' },
  { id: 'worker-03', name: 'Coordinator', capabilities: 'Watching write boundaries' },
];

const initialAgents: AgentCard[] = mockRunnerNames.map((runner, i) => ({
  id: runner.id,
  initials: runner.name.split(' ').map((w) => w[0]!).join('').toUpperCase().slice(0, 2),
  name: runner.name,
  role: runner.capabilities ?? 'No capability info',
  status: 'Coding',
  route: routeOptions[i % routeOptions.length]!,
  paused: false,
  progress: 50 + Math.floor(Math.random() * 45),
}));

const sessions: WorkbenchSession[] = [
  { title: 'Workbench polish', meta: 'UI worker and tester active', status: 'Live' },
  { title: 'Preview bridge', meta: 'Waiting on interface notes', status: 'Archived' },
  { title: 'Approval queue', meta: 'Ready for owner review', status: 'Archived' },
  { title: 'Responsive sweep', meta: 'All breakpoints checked', status: 'Live' },
];

const initialActivity: ActivityItem[] = [
  { id: 'ui-1', icon: 'design_services', title: 'UI worker tightened the page hierarchy', detail: 'Cards now separate navigation, conversation, and review work without stacking decorative containers inside each other.' },
  { id: 'ui-2', icon: 'hub', title: 'Coordinator pinned the page contract', detail: 'No real API calls, no new package dependency, and all changes stay under the workbench page directory.' },
  { id: 'ui-3', icon: 'rule', title: 'Tester prepared review checks', detail: 'Diff, preview, and approval affordances are visible at the same time as session progress.' },
];

const navItems = [
  { icon: 'view_quilt', label: 'Workbench', active: true },
  { icon: 'forum', label: 'Sessions' },
  { icon: 'account_tree', label: 'Agent graph' },
  { icon: 'folder_open', label: 'Projects' },
];

/* ── Component ────────────────────────────────────────────── */

export function WorkbenchPage() {
  const { t } = useTranslation();

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

  /* ── Activity helpers ─────────────────────────────────── */

  const pushActivity = useCallback((icon: string, title: string, detail: string) => {
    activityIdRef.current += 1;
    setActivityFeed((current) => [
      { id: `local-${activityIdRef.current}`, icon, title, detail },
      ...current,
    ].slice(0, 8));
  }, []);

  const showConfirmation = useCallback((tone: ConfirmationTone, message: string, detail: string) => {
    confirmationIdRef.current += 1;
    setConfirmation({ id: `confirm-${confirmationIdRef.current}`, tone, message, detail });
  }, []);

  /* ── Command palette ──────────────────────────────────── */

  const openCommandPanel = useCallback(() => {
    setCommandQuery('');
    setIsCommandOpen(true);
  }, []);

  const closeCommandPanel = useCallback(() => {
    setIsCommandOpen(false);
    setCommandQuery('');
  }, []);

  /* ── Actions ──────────────────────────────────────────── */

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
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) return;

    const currentRouteIndex = routeOptions.indexOf(targetAgent.route);
    const nextRoute = routeOptions[(currentRouteIndex + 1 + routeOptions.length) % routeOptions.length]!;

    setAgents((current) => current.map((agent) =>
      agent.id === agentId
        ? { ...agent, paused: false, route: nextRoute, status: 'Rerouted', progress: Math.min(agent.progress + 4, 96) }
        : agent,
    ));

    pushActivity('alt_route', `${targetAgent.name} rerouted`, `${source} moved this agent to ${nextRoute}.`);
    showConfirmation('info', 'Agent route updated', `${targetAgent.name} is now assigned to ${nextRoute}.`);
  }, [agents, pushActivity, showConfirmation]);

  const toggleAgentPause = useCallback((agentId: string) => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) return;

    const nextPaused = !targetAgent.paused;
    setAgents((current) => current.map((agent) =>
      agent.id === agentId
        ? { ...agent, paused: nextPaused, status: nextPaused ? agent.status : agent.status === 'Paused' ? 'Coding' : agent.status }
        : agent,
    ));

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
    const trimmed = draftInstruction.trim();
    if (!trimmed) {
      showConfirmation('warning', 'Instruction is empty', 'Add a short local instruction before queueing it.');
      return;
    }
    setDraftInstruction('');
    pushActivity('bolt', 'Instruction queued', trimmed);
    showConfirmation('success', 'Instruction queued locally', 'The activity stream has the new note; nothing was sent to a server.');
  }, [draftInstruction, pushActivity, showConfirmation]);

  /* ── Derived ──────────────────────────────────────────── */

  const activeAgentCount = agents.filter((a) => !a.paused).length;
  const hasApproved = approvalStatus === 'approved';
  const canApprove = previewStatus === 'passed' && !hasApproved;
  const stagedCount = approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 1 : 0;

  const approvalLabel = useMemo<Record<ApprovalStatus, { label: string; detail: string }>>(() => ({
    idle: { label: t('wb.approval.notRequested'), detail: t('wb.approval.notRequestedDetail') },
    'review-requested': { label: t('wb.approval.reviewRequested'), detail: t('wb.approval.reviewRequestedDetail') },
    'handoff-staged': { label: t('wb.approval.handoffStaged'), detail: t('wb.approval.handoffStagedDetail') },
    approved: { label: t('wb.approval.approvedStatus'), detail: t('wb.approval.approvedDetail') },
  }), [t]);

  /* ── Command options ──────────────────────────────────── */

  const commandOptions = useMemo<CommandOption[]>(() => [
    {
      id: 'route-qa', icon: 'alt_route', title: 'Route visual QA to tester',
      description: 'Moves the preview tester to the next local route and records activity.',
      shortcut: 'V', run: () => rerouteAgent('preview-tester', 'Command palette'),
    },
    {
      id: 'review-checkpoint', icon: 'rate_review', title: 'Create approval checkpoint',
      description: 'Switches to approval and appends a review request.',
      shortcut: 'A', disabled: hasApproved, run: () => requestReview('Command palette'),
    },
    {
      id: 'open-diff', icon: 'difference', title: 'Open diff panel',
      description: 'Shows the local diff panel and writes a visible trace.',
      shortcut: 'D', run: openDiffPanel,
    },
    {
      id: 'stage-handoff', icon: 'outbox', title: 'Stage handoff',
      description: 'Marks the local handoff as staged for owner review.',
      shortcut: 'H', disabled: hasApproved, run: () => stageHandoff('Command palette'),
    },
    {
      id: 'pause-primary', icon: agents[0]?.paused ? 'play_circle' : 'pause_circle',
      title: agents[0]?.paused ? 'Resume workbench worker' : 'Pause workbench worker',
      description: 'Toggles the primary agent card between active and paused.',
      shortcut: 'P', run: () => toggleAgentPause(agents[0]?.id ?? ''),
    },
  ], [agents, hasApproved, openDiffPanel, rerouteAgent, requestReview, stageHandoff, toggleAgentPause]);

  const filteredCommands = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return commandOptions;
    return commandOptions.filter((o) =>
      `${o.title} ${o.description} ${o.shortcut}`.toLowerCase().includes(q),
    );
  }, [commandOptions, commandQuery]);

  /* ── Keyboard ─────────────────────────────────────────── */

  useEffect(() => {
    if (!isCommandOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCommandPanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeCommandPanel, isCommandOpen]);

  useEffect(() => {
    const handleGlobal = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPanel();
      }
    };
    window.addEventListener('keydown', handleGlobal);
    return () => window.removeEventListener('keydown', handleGlobal);
  }, [openCommandPanel]);

  /* ── Panel Content ────────────────────────────────────── */

  const panelContent = useMemo(() => {
    if (activePanel === 'preview') {
      return (
        <section className={styles.panelStack} aria-label="Preview panel">
          <div className={styles.previewCard}>
            <div className={styles.previewToolbar}>
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.previewToolbarText}>localhost preview</span>
            </div>
            <div className={styles.previewStage}>
              <div className={styles.previewRow}>
                <div>
                  <div className={styles.previewRowTitle}>{t('wb.preview.title1')}</div>
                  <div className={styles.previewRowDesc}>{t('wb.preview.desc1')}</div>
                </div>
                <Icon name="web_asset" />
              </div>
              <div className={styles.previewRow}>
                <div>
                  <div className={styles.previewRowTitle}>{t('wb.preview.title2')}</div>
                  <div className={styles.previewRowDesc}>{t('wb.preview.desc2')}</div>
                </div>
                <Icon name="auto_awesome" />
              </div>
              <div className={styles.previewRow}>
                <div>
                  <div className={styles.previewRowTitle}>{t('wb.preview.title3')}</div>
                  <div className={styles.previewRowDesc}>
                    {previewStatus === 'passed' ? t('wb.preview.checkedDesc') : t('wb.preview.pendingDesc')}
                  </div>
                </div>
                <Pill variant={previewStatus === 'passed' ? 'green' : 'amber'}>
                  {previewStatus === 'passed' ? t('wb.preview.checked') : t('wb.preview.pending')}
                </Pill>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={previewStatus === 'passed'}
            onClick={markPreviewChecked}
          >
            <Icon name={previewStatus === 'passed' ? 'check_circle' : 'task_alt'} />
            {previewStatus === 'passed' ? t('wb.preview.checkedLabel') : t('wb.preview.markChecked')}
          </Button>
        </section>
      );
    }

    if (activePanel === 'diff') {
      return (
        <section className={styles.panelStack} aria-label="Diff panel">
          <div className={styles.fileRow}>
            <div>
              <div className={styles.fileRowTitle}>{t('wb.diff.file1')}</div>
              <div className={styles.fileRowDesc}>{t('wb.diff.desc1')}</div>
            </div>
            <Pill>new</Pill>
          </div>
          <div className={styles.fileRow}>
            <div>
              <div className={styles.fileRowTitle}>{t('wb.diff.file2')}</div>
              <div className={styles.fileRowDesc}>{t('wb.diff.desc2')}</div>
            </div>
            <Pill>source</Pill>
          </div>
          <div className={styles.codeDiff} aria-label="Illustrative diff">
            <div className={`${styles.diffLine} ${styles.diffRemove}`}>
              <span className={styles.diffSign}>-</span>
              <span className={styles.diffText}>buttons only flipped a couple of local booleans</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>active preview, diff, and approval panel state</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>command palette writes activity and confirmation state</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>agent pause, resume, and reroute controls are visible</span>
            </div>
            <div className={`${styles.diffLine} ${styles.diffAdd}`}>
              <span className={styles.diffSign}>+</span>
              <span className={styles.diffText}>preview checks unlock the approval action path</span>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={hasApproved}
            onClick={() => stageHandoff('Diff panel')}
          >
            <Icon name="outbox" />
            {approvalStatus === 'handoff-staged' ? t('wb.diff.alreadyStaged') : t('wb.diff.stageHandoff')}
          </Button>
        </section>
      );
    }

    return (
      <section className={styles.panelStack} aria-label="Approval panel">
        <div className={styles.statusStrip} aria-label="Approval summary">
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>{t('wb.approval.preview')}</span>
            <span className={styles.statusValue}>{previewStatus === 'passed' ? t('wb.preview.checked') : t('wb.preview.pending')}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>{t('wb.approval.approval')}</span>
            <span className={styles.statusValue}>{approvalLabel[approvalStatus].label}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>{t('wb.approval.handoff')}</span>
            <span className={styles.statusValue}>{stagedCount ? t('wb.approval.staged') : t('wb.approval.open')}</span>
          </div>
        </div>

        {approvalStatus === 'idle' && previewStatus === 'pending' ? (
          <div className={styles.emptyState} role="status">
            <span className={styles.emptyTitle}>{t('wb.approval.noCheckpoint')}</span>
            <span>{t('wb.approval.noCheckpointHint')}</span>
          </div>
        ) : null}

        <div className={styles.panelStack}>
          <div className={styles.approvalRow}>
            <span className={previewStatus === 'passed' ? styles.checkPassed : styles.checkPending}>
              <Icon name={previewStatus === 'passed' ? 'check' : 'pending'} size={16} />
            </span>
            <div>
              <div className={styles.approvalRowTitle}>{t('wb.approval.check1')}</div>
              <div className={styles.approvalRowDesc}>
                {previewStatus === 'passed' ? t('wb.approval.check1Passed') : t('wb.approval.check1Pending')}
              </div>
            </div>
          </div>
          <div className={styles.approvalRow}>
            <span className={approvalStatus !== 'idle' ? styles.checkPassed : styles.checkPending}>
              <Icon name={approvalStatus !== 'idle' ? 'check' : 'pending'} size={16} />
            </span>
            <div>
              <div className={styles.approvalRowTitle}>{t('wb.approval.check2')}</div>
              <div className={styles.approvalRowDesc}>{approvalLabel[approvalStatus].detail}</div>
            </div>
          </div>
          <div className={styles.approvalRow}>
            <span className={approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? styles.checkPassed : styles.checkPending}>
              <Icon name={approvalStatus === 'handoff-staged' || approvalStatus === 'approved' ? 'check' : 'pending'} size={16} />
            </span>
            <div>
              <div className={styles.approvalRowTitle}>{t('wb.approval.check3')}</div>
              <div className={styles.approvalRowDesc}>
                {approvalStatus === 'handoff-staged' || approvalStatus === 'approved'
                  ? t('wb.approval.check3Staged')
                  : t('wb.approval.check3Open')}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.approvalActions}>
          <Button variant="secondary" disabled={hasApproved} onClick={() => requestReview('Approval panel')}>
            <Icon name="rate_review" />
            {t('wb.requestReview')}
          </Button>
          <Button variant="secondary" disabled={hasApproved} onClick={() => stageHandoff('Approval panel')}>
            <Icon name="outbox" />
            {t('wb.stageHandoff')}
          </Button>
          <Button variant="primary" disabled={!canApprove} onClick={approveWork}>
            <Icon name={hasApproved ? 'verified' : 'check_circle'} />
            {hasApproved ? t('wb.approval.approved') : t('wb.approval.approve')}
          </Button>
        </div>
      </section>
    );
  }, [
    activePanel, approvalLabel, approvalStatus, approveWork, canApprove, hasApproved,
    markPreviewChecked, previewStatus, requestReview, stageHandoff, stagedCount, t,
  ]);

  /* ── Sidebar bottom: sessions ──────────────────────────── */

  const sidebarBottom = (
    <ul className={styles.sessionList}>
      {sessions.map((session) => (
        <li className={styles.sessionItem} key={session.title}>
          <div className={styles.sessionTop}>
            <span className={styles.sessionTitle}>{session.title}</span>
            {session.status === 'Live' ? (
              <span className={styles.liveDot} />
            ) : (
              <Pill>{session.status}</Pill>
            )}
          </div>
          <span className={styles.sessionMeta}>{session.meta}</span>
        </li>
      ))}
    </ul>
  );

  /* ── Render ────────────────────────────────────────────── */

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />

      <WebLayout
        brandName={t('wb.brand')}
        brandSubtitle={t('wb.subtitle')}
        navItems={navItems.map((item) => ({
          ...item,
          label: item.label === 'Workbench' ? t('wb.nav.workbench')
            : item.label === 'Sessions' ? t('wb.nav.sessions')
            : item.label === 'Agent graph' ? t('wb.nav.agents')
            : t('wb.nav.projects'),
        }))}
        sectionLabels={[{ text: t('wb.sessions.label'), count: sessions.length }]}
        sidebarBottom={sidebarBottom}
        sidebarAction={
          <Button variant="primary" size="md" onClick={openCommandPanel}>
            <Icon name="add_task" />
            {t('wb.newItem')}
          </Button>
        }
        topbarLeft={
          <SearchInput placeholder={t('wb.search')} />
        }
        topbarRight={
          <>
            <Pill>
              <span className={styles.liveDot} />
              {t('wb.previewOnly')}
            </Pill>
            <Button variant="icon" aria-label="Open command palette" onClick={openCommandPanel}>
              <Icon name="keyboard_command_key" />
            </Button>
            <Button variant="icon" aria-label="Notifications" onClick={noteLocalNotifications}>
              <Icon name="notifications" />
            </Button>
            <Button variant="secondary" disabled={hasApproved} onClick={() => requestReview('Top bar')}>
              <Icon name="verified" />
              {t('wb.requestReview')}
            </Button>
          </>
        }
        drawer={
          <>
            <div className={styles.inspectorHead}>
              <div className={styles.panelHeading}>
                <div>
                  <div className={styles.panelTitle}>{t('wb.inspector.title')}</div>
                  <div className={styles.panelSubtitle}>{t('wb.inspector.subtitle')}</div>
                </div>
                <Pill>{approvalLabel[approvalStatus].label}</Pill>
              </div>
              <div className={styles.tabBar} role="tablist" aria-label="Review views">
                {panelLabels.map((panel) => (
                  <button
                    key={panel}
                    type="button"
                    role="tab"
                    aria-selected={activePanel === panel}
                    className={activePanel === panel ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setActivePanel(panel)}
                  >
                    {t(`wb.panel.${panel}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.panelBody}>{panelContent}</div>
          </>
        }
      >
        <main className={styles.conversation}>
          <div className={styles.taskHead}>
            <div className={styles.taskBody}>
              <Pill>{t('wb.taskPill')}</Pill>
              <h2 className={styles.taskTitle}>{t('wb.taskTitle')}</h2>
              <p className={styles.taskCopy}>{t('wb.taskDescription')}</p>
            </div>
            <Button variant="secondary" disabled={hasApproved} onClick={() => stageHandoff('Task header')}>
              <Icon name="play_arrow" />
              {approvalStatus === 'handoff-staged' ? t('wb.handoffStaged') : t('wb.stageHandoff')}
            </Button>
          </div>

          {confirmation ? (
            <div
              className={`${styles.confirmBar} ${confirmation.tone === 'success' ? styles.confirmSuccess : confirmation.tone === 'warning' ? styles.confirmWarning : styles.confirmInfo}`}
              role="status"
            >
              <div className={styles.confirmText}>
                <span className={styles.confirmStrong}>{confirmation.message}</span>
                <span className={styles.confirmDetail}>{confirmation.detail}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setConfirmation(null)}>
                {t('wb.confirm.dismiss')}
              </Button>
            </div>
          ) : null}

          <div className={styles.metrics} aria-label="Task metrics">
            <div className={styles.metric}>
              <span className={styles.metricValue}>{6 - stagedCount}</span>
              <span className={styles.metricLabel}>{t('wb.metrics.openTasks')}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>{activeAgentCount}</span>
              <span className={styles.metricLabel}>{t('wb.metrics.agentsActive')}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>{previewStatus === 'passed' ? '0m' : '12m'}</span>
              <span className={styles.metricLabel}>{t('wb.metrics.lastUpdate')}</span>
            </div>
          </div>

          <ul className={styles.agentList} aria-label="Agent collaboration status">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className={agent.paused ? `${styles.agentCard} ${styles.agentCardPaused}` : styles.agentCard}
              >
                <div className={styles.agentTop}>
                  <Avatar initials={agent.initials} />
                  <Pill>{agent.paused ? t('wb.status.paused') : agent.status}</Pill>
                </div>
                <div className={styles.agentName}>{agent.name}</div>
                <div className={styles.agentRole}>{agent.role}</div>
                <div className={styles.agentRoute}>
                  <Icon name="alt_route" size={17} />
                  <span>{agent.route}</span>
                </div>
                <ProgressBar value={agent.progress} paused={agent.paused} />
                <div className={styles.agentActions}>
                  <Button variant="secondary" size="sm" onClick={() => toggleAgentPause(agent.id)}>
                    <Icon name={agent.paused ? 'play_circle' : 'pause_circle'} size={16} />
                    {agent.paused ? t('wb.agent.resume') : t('wb.agent.pause')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => rerouteAgent(agent.id)}>
                    <Icon name="swap_calls" size={16} />
                    {t('wb.agent.reroute')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <ol className={styles.feed} aria-label="Session activity">
            {activityFeed.length ? activityFeed.map((activity) => (
              <li className={styles.message} key={activity.id}>
                <div className={styles.messageIcon}>
                  <Icon name={activity.icon} />
                </div>
                <div>
                  <div className={styles.messageTitle}>{activity.title}</div>
                  <div className={styles.messageDetail}>{activity.detail}</div>
                </div>
              </li>
            )) : (
              <li className={styles.emptyState}>
                <span className={styles.emptyTitle}>No local activity yet</span>
                <span>Use a command, agent control, or approval action to add entries.</span>
              </li>
            )}
          </ol>

          <form className={styles.composer} onSubmit={queueInstruction}>
            <Icon name="bolt" />
            <input
              className={styles.composerInput}
              aria-label={t('wb.composer.placeholder')}
              placeholder={t('wb.composer.placeholder')}
              value={draftInstruction}
              onChange={(e) => setDraftInstruction(e.target.value)}
            />
            <Button variant="secondary" size="sm" disabled={!draftInstruction.trim()} type="submit">
              {t('wb.composer.queue')}
            </Button>
          </form>
        </main>
      </WebLayout>

      {isCommandOpen ? (
        <div
          className={styles.commandOverlay}
          role="presentation"
          onClick={(e) => { if (e.currentTarget === e.target) closeCommandPanel(); }}
        >
          <section className={styles.commandPanel} role="dialog" aria-label="Command palette">
            <Card variant="glass" padding="normal">
              <label className={styles.commandInput}>
                <Icon name="terminal" />
                <input
                  className={styles.commandInputField}
                  placeholder={t('wb.command.placeholder')}
                  autoFocus
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                />
              </label>
              <div className={styles.commandActions}>
                {filteredCommands.length ? filteredCommands.map((option) => (
                  <button
                    key={option.id}
                    className={styles.commandOption}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => { option.run(); closeCommandPanel(); }}
                  >
                    <Icon name={option.icon} size={18} />
                    <span className={styles.commandCopy}>
                      <span className={styles.commandTitle}>{option.title}</span>
                      <span className={styles.commandDesc}>{option.description}</span>
                    </span>
                    <Pill>{option.shortcut}</Pill>
                  </button>
                )) : (
                  <div className={styles.emptyState} role="status">
                    <span className={styles.emptyTitle}>{t('wb.command.noResults')}</span>
                    <span>{t('wb.command.noResultsHint')}</span>
                  </div>
                )}
              </div>
            </Card>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default WorkbenchPage;
>>>>>>> origin/dev/delicious233
