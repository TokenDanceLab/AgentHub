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
