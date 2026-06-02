import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserPlus,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  GitBranch,
  MessageCircle,
  Shield,
} from 'lucide-react';
import type { AgentTeamEvent } from '@/api/hubClient';

interface TeamEventTimelineProps {
  events: AgentTeamEvent[];
  loading?: boolean;
  error?: string | null;
  memberNames?: Record<string, string>;
}

const EVENT_ICON: Record<string, typeof UserPlus> = {
  'assignment.created': UserPlus,
  'assignment.dispatched': GitBranch,
  'assignment.completed': CheckCircle,
  'assignment.failed': XCircle,
  'assignment.cancelled': XCircle,
  'team.task.created': Play,
  'team.route.decided': GitBranch,
  'team.route.rejected': AlertTriangle,
  'team.run.started': Play,
  'team.run.completed': CheckCircle,
  'team.run.failed': XCircle,
  'agent.message': MessageCircle,
  'team.approval.decided': Shield,
  'team.conflict.resolved': CheckCircle,
};

function formatEventPayload(payload: string | Record<string, unknown> | undefined): string {
  if (!payload) return '';
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return typeof parsed === 'object' && parsed !== null
        ? extractSummary(parsed as Record<string, unknown>)
        : payload.slice(0, 120);
    } catch {
      return payload.length > 120 ? `${payload.slice(0, 120)}...` : payload;
    }
  }
  return extractSummary(payload);
}

function extractSummary(obj: Record<string, unknown>): string {
  const summary = obj.summary || obj.objective || obj.instructions || obj.reason || obj.message;
  if (typeof summary === 'string') return summary.length > 120 ? `${summary.slice(0, 120)}...` : summary;
  const keys = Object.keys(obj).filter((k) => k !== 'created_at' && k !== 'updated_at' && k !== 'id');
  if (keys.length === 0) return JSON.stringify(obj).slice(0, 120);
  const firstKey = keys[0]!;
  const val = obj[firstKey]!;
  return `${firstKey}: ${typeof val === 'string' ? val.slice(0, 80) : JSON.stringify(val).slice(0, 80)}`;
}

function timeString(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const TeamEventTimeline: FC<TeamEventTimelineProps> = ({
  events,
  loading,
  error,
  memberNames,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.loading', 'Loading events...')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.noEvents', 'No events recorded for this run.')}
      </div>
    );
  }

  // Sort by seq ascending
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {sorted.map((event, idx) => {
        const Icon = EVENT_ICON[event.type] ?? MessageCircle;
        const summary = formatEventPayload(event.payload);
        const isLast = idx === sorted.length - 1;

        return (
          <div key={event.id} style={{ display: 'flex', gap: 10, position: 'relative', minHeight: 36 }}>
            {/* Timeline line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: 'var(--surface-raised, #f9fafb)',
                  border: '2px solid var(--color-primary, #3b82f6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1,
                }}
              >
                <Icon size={10} style={{ color: 'var(--color-primary, #3b82f6)' }} />
              </div>
              {!isLast && (
                <div
                  style={{
                    width: 2,
                    flex: 1,
                    backgroundColor: 'var(--border-subtle, #e5e7eb)',
                    marginTop: -2,
                  }}
                />
              )}
            </div>

            {/* Event content */}
            <div
              style={{
                flex: 1,
                paddingBottom: isLast ? 0 : 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {t(`teamRun.eventType.${event.type}`, event.type)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>
                  #{event.seq}
                </span>
                {event.created_at && (
                  <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>
                    {timeString(event.created_at)}
                  </span>
                )}
              </div>
              {summary && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
                  {summary}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
