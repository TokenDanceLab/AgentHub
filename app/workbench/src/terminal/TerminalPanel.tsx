import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TerminalPort,
  TerminalSession,
  TerminalSessionId,
} from '@shared/platform/types';
import { DESIGN_NAV_GLYPH_STROKE_WIDTH, DesignNavIcon } from '../designIcons';
import { Tooltip } from '@shared/ui/Tooltip';
import styles from './TerminalPanel.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   TerminalPanel — capability-gated terminal host shell (tabs + empty).

   Foundation only (#1174): no real PTY, no raw process APIs.
   Host interaction goes through typed TerminalPort when provided.
   When capabilities.localTerminal is false, the panel renders nothing.
   ═══════════════════════════════════════════════════════════════════════ */

export interface TerminalPanelProps {
  /** Surface capability gate. When false/undefined, panel is hidden. */
  localTerminal?: boolean | undefined;
  /** Optional typed host port (mock or future Desktop/Tauri adapter). */
  terminal?: TerminalPort | undefined;
  /** Optional controlled session list (tests / host-driven). */
  sessions?: TerminalSession[] | undefined;
  /** Controlled active session id. */
  activeSessionId?: TerminalSessionId | null | undefined;
  onActiveSessionChange?: ((sessionId: TerminalSessionId | null) => void) | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
  labels?: TerminalPanelLabels | undefined;
}

export interface TerminalPanelLabels {
  ariaLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  newSession?: string | undefined;
  closeSession?: string | undefined;
  closePanel?: string | undefined;
  unavailable?: string | undefined;
  shellHint?: string | undefined;
  statusStarting?: string | undefined;
  statusRunning?: string | undefined;
  statusExited?: string | undefined;
  statusError?: string | undefined;
}

/** Fully-resolved labels: every key is a concrete string (exactOptional-safe). */
export type ResolvedTerminalPanelLabels = {
  [K in keyof Required<TerminalPanelLabels>]-?: string;
};

const defaultLabels: ResolvedTerminalPanelLabels = {
  ariaLabel: '本地终端',
  emptyTitle: '暂无终端会话',
  emptyDescription: '新建会话由 Desktop / Local Edge 主机托管，渲染进程不持有 PTY。',
  newSession: '新建终端',
  closeSession: '关闭会话',
  closePanel: '关闭终端面板',
  unavailable: '当前表面未启用本地终端',
  shellHint: '终端宿主端口已连接 · 等待主机输出',
  statusStarting: '启动中',
  statusRunning: '运行中',
  statusExited: '已退出',
  statusError: '错误',
};

function sessionStatusLabel(
  status: TerminalSession['status'],
  labels: ResolvedTerminalPanelLabels,
): string {
  switch (status) {
    case 'starting':
      return labels.statusStarting;
    case 'running':
      return labels.statusRunning;
    case 'exited':
      return labels.statusExited;
    case 'error':
      return labels.statusError;
    default:
      return status;
  }
}

function resolveTerminalPanelLabels(
  labelsProp?: TerminalPanelLabels | undefined,
): ResolvedTerminalPanelLabels {
  return {
    ariaLabel: labelsProp?.ariaLabel ?? defaultLabels.ariaLabel,
    emptyTitle: labelsProp?.emptyTitle ?? defaultLabels.emptyTitle,
    emptyDescription: labelsProp?.emptyDescription ?? defaultLabels.emptyDescription,
    newSession: labelsProp?.newSession ?? defaultLabels.newSession,
    closeSession: labelsProp?.closeSession ?? defaultLabels.closeSession,
    closePanel: labelsProp?.closePanel ?? defaultLabels.closePanel,
    unavailable: labelsProp?.unavailable ?? defaultLabels.unavailable,
    shellHint: labelsProp?.shellHint ?? defaultLabels.shellHint,
    statusStarting: labelsProp?.statusStarting ?? defaultLabels.statusStarting,
    statusRunning: labelsProp?.statusRunning ?? defaultLabels.statusRunning,
    statusExited: labelsProp?.statusExited ?? defaultLabels.statusExited,
    statusError: labelsProp?.statusError ?? defaultLabels.statusError,
  };
}

export function isLocalTerminalEnabled(localTerminal?: boolean | undefined): boolean {
  return localTerminal === true;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  localTerminal,
  terminal,
  sessions: controlledSessions,
  activeSessionId: controlledActiveId,
  onActiveSessionChange,
  onClose,
  className,
  labels: labelsProp,
}) => {
  const labels = useMemo(
    () => resolveTerminalPanelLabels(labelsProp),
    [labelsProp],
  );

  const [internalSessions, setInternalSessions] = useState<TerminalSession[]>([]);
  const [internalActiveId, setInternalActiveId] = useState<TerminalSessionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isControlled = controlledSessions !== undefined;
  const sessions = isControlled ? controlledSessions : internalSessions;
  const activeSessionId =
    controlledActiveId !== undefined ? controlledActiveId : internalActiveId;

  const setActive = useCallback(
    (sessionId: TerminalSessionId | null) => {
      if (controlledActiveId === undefined) {
        setInternalActiveId(sessionId);
      }
      onActiveSessionChange?.(sessionId);
    },
    [controlledActiveId, onActiveSessionChange],
  );

  useEffect(() => {
    if (!isLocalTerminalEnabled(localTerminal) || !terminal || isControlled) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const listed = await terminal.list();
        if (cancelled) return;
        setInternalSessions(listed);
        setInternalActiveId((current) => {
          if (current && listed.some((session) => session.id === current)) {
            return current;
          }
          return listed[0]?.id ?? null;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isControlled, localTerminal, terminal]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const handleSpawn = useCallback(async () => {
    if (!terminal || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await terminal.spawn({
        title: `Terminal ${sessions.length + 1}`,
        cols: 80,
        rows: 24,
      });
      if (!isControlled) {
        setInternalSessions((prev) => [...prev, session]);
      }
      setActive(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, isControlled, sessions.length, setActive, terminal]);

  const handleCloseSession = useCallback(
    async (sessionId: TerminalSessionId) => {
      if (!terminal || busy) return;
      setBusy(true);
      setError(null);
      try {
        await terminal.close(sessionId);
        if (!isControlled) {
          setInternalSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? { ...session, status: 'exited' as const }
                : session,
            ),
          );
        }
        if (activeSessionId === sessionId) {
          const remaining = sessions.filter(
            (session) => session.id !== sessionId && session.status !== 'exited',
          );
          setActive(remaining[0]?.id ?? sessions.find((s) => s.id !== sessionId)?.id ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeSessionId, busy, isControlled, sessions, setActive, terminal],
  );

  if (!isLocalTerminalEnabled(localTerminal)) {
    return null;
  }

  const rootClass = [styles.pane, className].filter(Boolean).join(' ');

  return (
    <section
      className={rootClass}
      aria-label={labels.ariaLabel}
      data-terminal-panel
      data-local-terminal="enabled"
    >
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label={labels.ariaLabel}>
          {sessions.map((session) => {
            const selected = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? styles.tabActive : styles.tab}
                data-session-id={session.id}
                data-session-status={session.status}
                onClick={() => setActive(session.id)}
              >
                <span className={styles.tabTitle}>{session.title}</span>
                <span className={styles.tabStatus}>
                  {sessionStatusLabel(session.status, labels)}
                </span>
                <Tooltip label={labels.closeSession}>
                  <span
                    className={styles.tabClose}
                    role="button"
                    tabIndex={-1}
                    aria-label={`${labels.closeSession}: ${session.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleCloseSession(session.id);
                    }}
                  >
                    ×
                  </span>
                </Tooltip>
              </button>
            );
          })}
        </div>

        <Tooltip label={labels.newSession}>
          <button
            type="button"
            className={styles.toolBtn}
            aria-label={labels.newSession}
            disabled={!terminal || busy}
            data-terminal-action="spawn"
            onClick={() => {
              void handleSpawn();
            }}
          >
            <DesignNavIcon name="plus" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </button>
        </Tooltip>

        {onClose ? (
          <Tooltip label={labels.closePanel}>
            <button
              type="button"
              className={styles.toolBtn}
              aria-label={labels.closePanel}
              data-terminal-action="close-panel"
              onClick={onClose}
            >
              <DesignNavIcon name="close" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className={styles.body} data-terminal-body>
        {sessions.length === 0 || !activeSession ? (
          <div className={styles.empty} data-terminal-empty>
            <span className={styles.emptyIcon} aria-hidden="true">
              <DesignNavIcon name="laptop" size={28} strokeWidth={1.5} />
            </span>
            <strong className={styles.emptyTitle}>{labels.emptyTitle}</strong>
            <p className={styles.emptyDescription}>{labels.emptyDescription}</p>
            {!terminal ? (
              <p className={styles.emptyDescription} data-terminal-unavailable>
                {labels.unavailable}
              </p>
            ) : (
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy}
                data-terminal-action="spawn-empty"
                data-testid="terminal-spawn-empty"
                onClick={() => {
                  void handleSpawn();
                }}
              >
                {labels.newSession}
              </button>
            )}
          </div>
        ) : (
          <div
            className={styles.viewport}
            data-terminal-viewport
            data-session-id={activeSession.id}
            tabIndex={0}
            role="log"
            aria-label={activeSession.title}
          >
            <div className={styles.viewportMeta}>
              <span>{activeSession.title}</span>
              {activeSession.cwd ? <span>{activeSession.cwd}</span> : null}
              <span>{sessionStatusLabel(activeSession.status, labels)}</span>
            </div>
            <pre className={styles.viewportHint}>{labels.shellHint}</pre>
          </div>
        )}
      </div>

      {error ? (
        <div className={styles.error} role="alert" data-terminal-error>
          {error}
        </div>
      ) : null}

      <div className={styles.status}>
        <span className={styles.statusItem}>Desktop</span>
        <span className={styles.statusItem}>
          {terminal ? 'Host port' : 'No host port'}
        </span>
        <span className={styles.statusItem}>No renderer PTY</span>
      </div>
    </section>
  );
};
