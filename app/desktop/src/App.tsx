import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchHealth, fetchRunners, HealthResponse, Runner } from './api/edgeClient';
import { createEventStream, EventEnvelope } from './api/eventClient';

// ── Types ──────────────────────────────────────────────

interface LogEntry {
  seq: number;
  type: string;
  summary: string;
  sentAt: string;
}

// ── Styles ─────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: '#0f1117',
    color: '#e1e4e8',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderBottom: '1px solid #21262d',
    fontSize: '13px',
    flexShrink: 0,
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  dotOnline: {
    backgroundColor: '#3fb950',
    boxShadow: '0 0 4px #3fb950',
  },
  dotOffline: {
    backgroundColor: '#f85149',
    boxShadow: '0 0 4px #f85149',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '260px',
    borderRight: '1px solid #21262d',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    flexShrink: 0,
  },
  sidebarTitle: {
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#8b949e',
    borderBottom: '1px solid #21262d',
  },
  runnerItem: {
    padding: '10px 16px',
    borderBottom: '1px solid #21262d',
    fontSize: '13px',
  },
  runnerName: {
    fontWeight: 500,
    marginBottom: '2px',
  },
  runnerStatus: {
    fontSize: '12px',
    color: '#8b949e',
  },
  statusOnline: {
    color: '#3fb950',
  },
  statusOffline: {
    color: '#f85149',
  },
  eventPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  eventTitle: {
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#8b949e',
    borderBottom: '1px solid #21262d',
    flexShrink: 0,
  },
  eventList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 0',
  },
  eventRow: {
    padding: '6px 16px',
    fontSize: '12px',
    lineHeight: '1.5',
    borderBottom: '1px solid #1a1d24',
    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
  },
  eventSeq: {
    color: '#8b949e',
    marginRight: '6px',
  },
  eventType: {
    color: '#79c0ff',
    marginRight: '6px',
  },
  eventSummary: {
    color: '#e1e4e8',
    wordBreak: 'break-all',
  },
  eventTs: {
    color: '#484f58',
    fontSize: '11px',
    marginTop: '2px',
  },
  noRunners: {
    padding: '16px',
    color: '#484f58',
    fontSize: '13px',
    textAlign: 'center',
  },
  noEvents: {
    padding: '24px 16px',
    color: '#484f58',
    fontSize: '13px',
    textAlign: 'center',
  },
  errorBanner: {
    padding: '6px 16px',
    backgroundColor: '#490202',
    color: '#f85149',
    fontSize: '12px',
    borderBottom: '1px solid #f85149',
  },
};

// ── Helpers ────────────────────────────────────────────

function eventSummary(event: EventEnvelope): string {
  const p = event.payload;
  if (!p || typeof p !== 'object') return '';
  const parts: string[] = [];
  if (p.runId) parts.push(`run=${p.runId}`);
  if (p.runnerId) parts.push(`runner=${p.runnerId}`);
  if (p.stream) parts.push(`stream=${p.stream}`);
  if (p.text) parts.push(`"${(p.text as string).slice(0, 60)}"`);
  if (p.chunks) parts.push(`chunks=${p.chunks.length}`);
  if (p.status) parts.push(`status=${p.status}`);
  if (p.message) parts.push(p.message as string);
  return parts.join(' ');
}

// ── App ────────────────────────────────────────────────

export default function App() {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const eventListRef = useRef<HTMLDivElement>(null);

  // ── health polling ─────────────────────────────────

  const pollHealth = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
      setOnline(true);
      setError(null);
    } catch {
      setOnline(false);
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    pollHealth();
    const id = setInterval(pollHealth, 5000);
    return () => clearInterval(id);
  }, [pollHealth]);

  // ── runners fetch ──────────────────────────────────

  const loadRunners = useCallback(async () => {
    if (!online) return;
    try {
      const res = await fetchRunners();
      setRunners(res.items ?? []);
    } catch {
      // runners may not be available yet
    }
  }, [online]);

  useEffect(() => {
    if (online) {
      loadRunners();
      const id = setInterval(loadRunners, 5000);
      return () => clearInterval(id);
    } else {
      setRunners([]);
    }
  }, [online, loadRunners]);

  // ── WebSocket event stream ─────────────────────────

  useEffect(() => {
    const stream = createEventStream();
    const unsub = stream.subscribe((event) => {
      if (event.type === 'error') {
        setError(`Event stream error: ${event.payload?.message ?? 'unknown'}`);
        return;
      }
      setWsConnected(true);
      setError(null);
      setEvents((prev) => [
        ...prev.slice(-999), // keep max 1000 entries
        {
          seq: event.seq,
          type: event.type,
          summary: eventSummary(event),
          sentAt: event.sentAt,
        },
      ]);
    });

    // Attempt to detect WS connection status
    const connCheck = setInterval(() => {
      // If no events in 10s, consider disconnected
      setWsConnected((prev) => prev);
    }, 10000);
    // Mark disconnected after a delay if we were connected
    setTimeout(() => {
      if (!wsConnected) {
        // not yet connected, stay in neutral state
      }
    }, 3000);

    return () => {
      unsub();
      stream.close();
      clearInterval(connCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // ── auto-scroll to latest event ────────────────────

  useEffect(() => {
    if (eventListRef.current) {
      eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
    }
  }, [events]);

  // ── Render ─────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* ── Status Bar ─── */}
      <div style={styles.statusBar}>
        <span
          style={{
            ...styles.dot,
            ...(online ? styles.dotOnline : styles.dotOffline),
          }}
        />
        <span>
          {online
            ? `Local Edge: Online — ${health?.version ?? 'v1'} (${health?.edgeId ?? '?'})`
            : 'Local Edge: Offline'}
        </span>
        <span style={{ marginLeft: 'auto', color: '#484f58', fontSize: 11 }}>
          WS: {wsConnected ? 'Connected' : '—'}
        </span>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* ── Body ─── */}
      <div style={styles.main}>
        {/* ── Runner List Panel ─── */}
        <div style={styles.sidebar}>
          <div style={styles.sidebarTitle}>Runners</div>
          {runners.length === 0 ? (
            <div style={styles.noRunners}>
              {online ? 'No runners connected' : 'Waiting for Edge...'}
            </div>
          ) : (
            runners.map((r) => (
              <div key={r.id} style={styles.runnerItem}>
                <div style={styles.runnerName}>{r.name || r.id}</div>
                <div
                  style={{
                    ...styles.runnerStatus,
                    ...(r.status === 'online' || r.status === 'idle'
                      ? styles.statusOnline
                      : r.status === 'offline'
                        ? styles.statusOffline
                        : undefined),
                  }}
                >
                  {r.status}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Event Log Panel ─── */}
        <div style={styles.eventPanel}>
          <div style={styles.eventTitle}>Events</div>
          <div ref={eventListRef} style={styles.eventList}>
            {events.length === 0 ? (
              <div style={styles.noEvents}>
                {online ? 'Waiting for events...' : 'Start Edge Server to receive events'}
              </div>
            ) : (
              events.map((e, i) => (
                <div key={`${e.seq}-${i}`} style={styles.eventRow}>
                  <span style={styles.eventSeq}>[{e.seq}]</span>
                  <span style={styles.eventType}>{e.type}</span>
                  {e.summary && (
                    <span style={styles.eventSummary}>{e.summary}</span>
                  )}
                  <div style={styles.eventTs}>
                    {new Date(e.sentAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
