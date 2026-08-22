// SubagentStreamOverlay — #1406 Phase 2 / #1478 Phase C
// Fixed-position corner stack of subagent stream chips/cards.
// Consumes SubagentStreamStore via useSyncExternalStore.
// No WS/REST protocol changes — pure consumer of existing frames + Phase A store.

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import {
  getSubagentStreamStore,
  type TeamSubagentStreamEvent,
} from './SubagentStreamStore';
import { SubagentTranscript } from './SubagentTranscript';
import { SubagentSessionDialog } from './SubagentSessionDialog';
import { Icon } from '@shared/ui/Icon';
import { Tooltip } from '@shared/ui/Tooltip';
import styles from './SubagentStreamOverlay.module.css';

// ── Status derivation ───────────────────────────────────────────────────────

type StreamStatus = 'running' | 'thinking' | 'tool_call' | 'streaming' | 'done' | 'failed';

interface StreamEntry {
  /** agent_task_id from the store key. */
  taskId: string;
  /** Sorted event array. */
  events: readonly TeamSubagentStreamEvent[];
  /** Derived status from latest event. */
  status: StreamStatus;
  /** Latest text_delta content (for chip preview). */
  latestText: string;
  /** Agent display name fallback (extracted from payload or taskId). */
  displayName: string;
  /** agent_instance_id from events. */
  agentInstanceId: string;
  /** Timestamp of latest event. */
  updatedAt: string;
}

function deriveStatus(eventType: string): StreamStatus {
  const et = eventType.toLowerCase();
  if (et.includes('think')) return 'thinking';
  if (et.includes('tool') || et.includes('function')) return 'tool_call';
  if (et.includes('text') || et.includes('delta') || et.includes('stream') || et.includes('output'))
    return 'streaming';
  if (et.includes('done') || et.includes('result') || et.includes('complete')) return 'done';
  if (et.includes('fail') || et.includes('error') || et.includes('cancel')) return 'failed';
  return 'running';
}

function statusLabel(status: StreamStatus): string {
  switch (status) {
    case 'running':   return '运行中…';   // 运行中…
    case 'thinking':  return '思考中…';   // 思考中…
    case 'tool_call': return '调用工具…'; // 调用工具…
    case 'streaming':  return '输出中…';   // 输出中…
    case 'done':      return '完成 ✓';        // 完成 ✓
    case 'failed':    return '失败 ✗';        // 失败 ✗
  }
}

function isActiveStatus(status: StreamStatus): boolean {
  return status === 'running' || status === 'thinking' || status === 'tool_call' || status === 'streaming';
}

// ── Store subscription bridge ───────────────────────────────────────────────

function subscribeToStore(cb: () => void): () => void {
  return getSubagentStreamStore().subscribe(cb);
}

function getStoreSnapshot(): Record<string, TeamSubagentStreamEvent[]> {
  return getSubagentStreamStore().state.byTaskId;
}

function getServerSnapshot(): Record<string, TeamSubagentStreamEvent[]> {
  return {};
}

function useSubagentStreamMap(): Record<string, TeamSubagentStreamEvent[]> {
  return useSyncExternalStore(subscribeToStore, getStoreSnapshot, getServerSnapshot);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function taskShortCode(taskId: string): string {
  // Derive a readable short code from the task ID.
  const parts = taskId.split(/[-_]/);
  if (parts.length >= 2) {
    const suffix = parts[parts.length - 1]!;
    return suffix.length <= 8 ? `#${suffix}` : `#${suffix.slice(0, 6)}`;
  }
  return `#${taskId.slice(0, 6)}`;
}

function extractDisplayName(events: readonly TeamSubagentStreamEvent[], taskId: string): string {
  // Try to extract a display name from payload or member_id.
  for (const event of events) {
    if (event.member_id && event.member_id.trim()) {
      return event.member_id;
    }
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload?.display_name && typeof payload.display_name === 'string') {
      return payload.display_name;
    }
    if (payload?.agent_name && typeof payload.agent_name === 'string') {
      return payload.agent_name;
    }
  }
  return taskShortCode(taskId);
}

function extractLatestText(events: readonly TeamSubagentStreamEvent[]): string {
  // Walk events backwards to find latest text_delta content.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    const et = event.event_type.toLowerCase();
    if (et.includes('text') || et.includes('delta') || et.includes('stream') || et.includes('output')) {
      const payload = event.payload as Record<string, unknown> | undefined;
      const text = payload?.text ?? payload?.content ?? payload?.delta ?? payload?.message;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return '';
}

function buildStreamEntries(
  byTaskId: Record<string, TeamSubagentStreamEvent[]>,
): StreamEntry[] {
  const entries: StreamEntry[] = [];
  for (const [taskId, events] of Object.entries(byTaskId)) {
    if (!events || events.length === 0) continue;
    const latest = events[events.length - 1]!;
    const status = deriveStatus(latest.event_type);
    entries.push({
      taskId,
      events,
      status,
      latestText: extractLatestText(events),
      displayName: extractDisplayName(events, taskId),
      agentInstanceId: latest.agent_instance_id,
      updatedAt: latest.created_at,
    });
  }
  // Sort: active first (running/thinking > tool/streaming > done > failed), then by time desc.
  return entries.sort((a, b) => {
    const statusOrder: Record<StreamStatus, number> = {
      thinking: 0, running: 1, tool_call: 2, streaming: 3, done: 4, failed: 5,
    };
    const orderA = statusOrder[a.status];
    const orderB = statusOrder[b.status];
    if (orderA !== orderB) return orderA - orderB;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ── Status color ────────────────────────────────────────────────────────────

function statusColor(status: StreamStatus): string {
  switch (status) {
    case 'running':   return styles.colorBlue!;
    case 'thinking':  return styles.colorPurple!;
    case 'tool_call': return styles.colorOrange!;
    case 'streaming':  return styles.colorGreen!;
    case 'done':      return styles.colorGreen!;
    case 'failed':    return styles.colorRed!;
  }
}

// ── Single chip/card ────────────────────────────────────────────────────────

interface SubagentStreamChipProps {
  entry: StreamEntry;
  defaultExpanded: boolean;
  /** Open the full-session drill-down dialog for this entry. */
  onOpenSession: (taskId: string) => void;
}

function SubagentStreamChip({ entry, defaultExpanded, onOpenSession }: SubagentStreamChipProps): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [manualToggle, setManualToggle] = useState(false);
  const prevStatusRef = useRef(entry.status);
  const hasDoneOrFailed = entry.status === 'done' || entry.status === 'failed';
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  // Auto-expand when active; auto-collapse on done/failed after 3s if no manual toggle.
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = entry.status;

    if (isActiveStatus(entry.status)) {
      if (!manualToggle && !expanded) {
        setExpanded(true);
      }
    } else if (hasDoneOrFailed && prev !== entry.status) {
      // Transitioned to done/failed — auto-collapse after 3s unless user toggled.
      if (manualToggle) return;
      const timer = setTimeout(() => setExpanded(false), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [entry.status, hasDoneOrFailed, expanded, manualToggle]);

  const toggle = useCallback(() => {
    setManualToggle(true);
    setExpanded((v) => !v);
  }, []);

  const avatarLetter = (entry.displayName[0] ?? '?').toUpperCase();

  return (
    <div
      className={`${styles.chip} ${expanded ? styles.chipExpanded : ''} ${statusColor(entry.status)}`}
      data-stream-status={entry.status}
    >
      {/* ── Chip header (always visible) ── */}
      <div className={styles.chipHeaderRow}>
        <button
          type="button"
          className={styles.chipHeader}
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={`${entry.displayName}: ${statusLabel(entry.status)}`}
        >
          <span className={`${styles.avatar} ${isActiveStatus(entry.status) ? styles.avatarPulse : ''}`}>
            {avatarLetter}
          </span>
          <span className={styles.chipBody}>
            <span className={styles.chipLabel}>{entry.displayName}</span>
            <span className={`${styles.chipStatus} ${statusColor(entry.status)}`}>
              {statusLabel(entry.status)}
            </span>
          </span>
          {entry.latestText && !expanded ? (
            <span className={styles.chipPreview}>{truncate(entry.latestText, 40)}</span>
          ) : null}
          <Icon name={expanded ? 'expand_more' : 'expand_less'} size={16} />
        </button>
        {/* Drill-down: open the full-session dialog (#1406 follow-up) */}
        <Tooltip label={t('subagentStream.openSession')}>
          <button
            type="button"
            className={styles.chipExpandBtn}
            onClick={() => onOpenSession(entry.taskId)}
            aria-label={t('subagentStream.openSession')}
          >
            <Icon name="open_in_full" size={14} />
          </button>
        </Tooltip>
      </div>

      {/* ── Expanded transcript (#1406 Phase 3) ── */}
      {expanded ? (
        <SubagentTranscript events={entry.events} />
      ) : null}
    </div>
  );
}

// ── Overlay container ───────────────────────────────────────────────────────

export interface SubagentStreamOverlayProps {
  /** Max chips to show before stacking. Default 3. */
  maxVisible?: number;
  /** Corner position. Default 'bottom-right'. */
  position?: 'bottom-right' | 'bottom-left';
}

export function SubagentStreamOverlay({
  maxVisible = 3,
  position = 'bottom-right',
}: SubagentStreamOverlayProps): React.ReactElement | null {
  const byTaskId = useSubagentStreamMap();
  const entries = useMemo(() => buildStreamEntries(byTaskId), [byTaskId]);
  // Which sub-session is open in the drill-down dialog (null = closed).
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const visibleEntries = entries.slice(0, maxVisible);
  const stackedCount = entries.length - visibleEntries.length;
  const dialogEntry = dialogTaskId != null
    ? entries.find((entry) => entry.taskId === dialogTaskId) ?? null
    : null;
  // A11y (#1823): the whole overlay is a live region, but streaming chips
  // mutate it at token rate — while any entry is active the region drops to
  // aria-live="off" (the #11 transcript pattern) so screen readers are not
  // bombarded; when the last active entry completes the region returns to
  // 'polite' and the terminal state is announced at most once.
  const anyActive = entries.some((entry) => isActiveStatus(entry.status));

  return (
    <>
      <div
        className={`${styles.overlay} ${position === 'bottom-left' ? styles.positionLeft : styles.positionRight}`}
        role="region"
        aria-label="Subagent stream status"
        aria-live={anyActive ? 'off' : 'polite'}
        aria-busy={anyActive}
      >
        {stackedCount > 0 ? (
          <div className={styles.stackedBadge}>
            +{stackedCount} more
          </div>
        ) : null}
        {visibleEntries.map((entry) => (
          <SubagentStreamChip
            key={entry.taskId}
            entry={entry}
            defaultExpanded={isActiveStatus(entry.status)}
            onOpenSession={setDialogTaskId}
          />
        ))}
      </div>
      <SubagentSessionDialog
        open={dialogEntry != null}
        onClose={() => setDialogTaskId(null)}
        agentName={dialogEntry?.displayName ?? ''}
        events={dialogEntry?.events ?? []}
      />
    </>
  );
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
