// SubagentTranscript — #1406 Phase 3
// Renders a list of TeamSubagentStreamEvent as a readable transcript
// with per-type icons, colors, Chinese labels, and formatted payload.
// Empty state shows "等待 agent 启动…" when no events exist.

import React, { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { TeamSubagentStreamEvent } from './SubagentStreamStore';
import { Icon } from '@shared/ui/Icon';
import styles from './SubagentTranscript.module.css';

// ── Event category ──────────────────────────────────────────────────────────

type EventCategory = 'thinking' | 'tool_call' | 'text_delta' | 'result' | 'error' | 'cancel' | 'other';

interface CategoryConfig {
  labelKey: string;
  icon: string;
  colorClass: string;
}

const CATEGORY_MAP: Record<EventCategory, CategoryConfig> = {
  thinking:   { labelKey: 'subagentStream.cat.thinking',   icon: 'psychology',    colorClass: styles.transcriptThinking! },
  tool_call:  { labelKey: 'subagentStream.cat.toolCall',   icon: 'build',         colorClass: styles.transcriptToolCall! },
  text_delta: { labelKey: 'subagentStream.cat.textDelta',  icon: 'edit_note',     colorClass: styles.transcriptTextDelta! },
  result:     { labelKey: 'subagentStream.cat.result',     icon: 'check_circle',  colorClass: styles.transcriptResult! },
  error:      { labelKey: 'subagentStream.cat.error',      icon: 'error',         colorClass: styles.transcriptError! },
  cancel:     { labelKey: 'subagentStream.cat.cancel',     icon: 'cancel',        colorClass: styles.transcriptCancel! },
  other:      { labelKey: 'subagentStream.cat.other',      icon: 'circle',        colorClass: styles.transcriptOther! },
};

function classifyEvent(eventType: string): EventCategory {
  const et = eventType.toLowerCase();
  if (et.includes('think')) return 'thinking';
  if (et.includes('tool') || et.includes('function')) return 'tool_call';
  if (et.includes('text') || et.includes('delta') || et.includes('stream') || et.includes('output'))
    return 'text_delta';
  if (et.includes('done') || et.includes('result') || et.includes('complete')) return 'result';
  if (et.includes('fail') || et.includes('error')) return 'error';
  if (et.includes('cancel')) return 'cancel';
  return 'other';
}

// ── Payload formatting ──────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function formatPayload(event: TeamSubagentStreamEvent): ReactNode {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return null;

  const category = classifyEvent(event.event_type);

  switch (category) {
    case 'thinking': {
      const text = payload.text ?? payload.content ?? payload.thought ?? payload.reasoning;
      if (typeof text === 'string' && text.trim()) {
        return <span className={styles.payloadThinking}>{truncate(text, 200)}</span>;
      }
      return null;
    }
    case 'text_delta': {
      const text = payload.text ?? payload.delta ?? payload.content ?? payload.message;
      if (typeof text === 'string' && text.trim()) {
        return <span className={styles.payloadText}>{truncate(text, 300)}</span>;
      }
      return null;
    }
    case 'tool_call': {
      const toolName = payload.tool_name ?? payload.name ?? payload.function;
      const toolInput = payload.input ?? payload.arguments;
      return (
        <span className={styles.payloadTool}>
          <code className={styles.toolName}>
            {typeof toolName === 'string' ? toolName : 'tool'}
          </code>
          {typeof toolInput === 'string' && toolInput.trim()
            ? <span className={styles.toolInput}> {truncate(toolInput, 120)}</span>
            : null}
        </span>
      );
    }
    case 'result': {
      const summary = payload.summary ?? payload.result ?? payload.content ?? payload.output;
      if (typeof summary === 'string' && summary.trim()) {
        return <span className={styles.payloadResult}>{truncate(summary, 200)}</span>;
      }
      return null;
    }
    case 'error': {
      const errMsg = payload.error ?? payload.message ?? payload.reason;
      if (typeof errMsg === 'string' && errMsg.trim()) {
        return <span className={styles.payloadError}>{truncate(errMsg, 200)}</span>;
      }
      return null;
    }
    case 'cancel': {
      const reason = payload.reason ?? payload.message;
      if (typeof reason === 'string' && reason.trim()) {
        return <span className={styles.payloadCancel}>{truncate(reason, 120)}</span>;
      }
      return null;
    }
    default: {
      // Generic JSON dump for unrecognized events.
      try {
        return <span className={styles.payloadGeneric}>{truncate(JSON.stringify(payload), 160)}</span>;
      } catch {
        return null;
      }
    }
  }
}

// ── Transcript entry ────────────────────────────────────────────────────────

interface TranscriptEntry {
  event: TeamSubagentStreamEvent;
  category: EventCategory;
  config: CategoryConfig;
}

function buildEntries(events: readonly TeamSubagentStreamEvent[]): TranscriptEntry[] {
  return events.map((event) => {
    const category = classifyEvent(event.event_type);
    return { event, category, config: CATEGORY_MAP[category] };
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export interface SubagentTranscriptProps {
  /** Sorted event array from SubagentStreamStore.byTaskId[id]. */
  events: readonly TeamSubagentStreamEvent[];
  /** Show empty hint when events array is empty. Default true. */
  showEmpty?: boolean;
}

export function SubagentTranscript({
  events,
  showEmpty = true,
}: SubagentTranscriptProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const entries = useMemo(() => buildEntries(events), [events]);

  // ── Empty state ──
  if (entries.length === 0) {
    if (!showEmpty) return <></>;
    return (
      <div className={styles.emptyState} role="status">
        <Icon
          name="hourglass_empty"
          size={18}
          {...(styles.emptyIcon !== undefined ? { className: styles.emptyIcon } : {})}
        />
        <span className={styles.emptyText}>{t('subagentStream.emptyWaiting')}</span>
      </div>
    );
  }

  // ── Rendered transcript ──
  // A11y (#1823): this log rides inside the SubagentStreamOverlay live
  // region and receives entries at token rate while the subagent streams.
  // While the newest entry is an in-flight category the log drops to
  // aria-live="off" (the #11 transcript pattern); when the agent completes
  // the region returns to 'polite' and the accumulated content is announced
  // at most once (SR-dependent).
  const lastCategory = entries.length > 0 ? entries[entries.length - 1]!.category : 'other';
  const isStreaming = lastCategory === 'thinking' || lastCategory === 'tool_call' || lastCategory === 'text_delta';
  return (
    <div
      className={styles.transcript}
      role="log"
      aria-label={t('subagentStream.transcriptLabel')}
      aria-live={isStreaming ? 'off' : 'polite'}
      aria-busy={isStreaming}
    >
      {entries.map(({ event, category, config }) => (
        <div
          key={event.event_seq}
          className={`${styles.entry} ${config.colorClass}`}
          data-event-category={category}
        >
          {/* ── Entry header ── */}
          <div className={styles.entryHeader}>
            <Icon
              name={config.icon}
              size={16}
              {...(styles.entryIcon !== undefined ? { className: styles.entryIcon } : {})}
            />
            <span className={styles.entryLabel}>{t(config.labelKey)}</span>
            <span className={styles.entrySeq}>#{event.event_seq}</span>
          </div>

          {/* ── Entry body ── */}
          <div className={styles.entryBody}>
            {formatPayload(event)}
          </div>
        </div>
      ))}
    </div>
  );
}
