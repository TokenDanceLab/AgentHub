import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  MessageSquare,
  Play,
  CheckCircle,
  XCircle,
  GitBranch,
  Shield,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import type { AgentTeamEvent } from '@/api/hubClient';
import styles from './TeamEventTimeline.module.css';

interface TeamEventTimelineProps {
  events: AgentTeamEvent[];
  loading: boolean;
  error: string | null;
  memberNames: Record<string, string>;
}

const EVENT_META: Record<string, { icon: typeof Clock; labelKey: string; className: string }> = {
  'assignment.created': { icon: GitBranch, labelKey: 'teamRun.event.assignmentCreated', className: 'eventAssignment' },
  'assignment.dispatched': { icon: ArrowRight, labelKey: 'teamRun.event.assignmentDispatched', className: 'eventAssignment' },
  'assignment.completed': { icon: CheckCircle, labelKey: 'teamRun.event.assignmentCompleted', className: 'eventDone' },
  'assignment.failed': { icon: XCircle, labelKey: 'teamRun.event.assignmentFailed', className: 'eventFailed' },
  'assignment.cancelled': { icon: XCircle, labelKey: 'teamRun.event.assignmentCancelled', className: 'eventFailed' },
  'team.task.created': { icon: GitBranch, labelKey: 'teamRun.event.taskCreated', className: 'eventTask' },
  'team.route.decided': { icon: ArrowRight, labelKey: 'teamRun.event.routeDecided', className: 'eventRoute' },
  'team.route.rejected': { icon: XCircle, labelKey: 'teamRun.event.routeRejected', className: 'eventFailed' },
  'team.run.started': { icon: Play, labelKey: 'teamRun.event.runStarted', className: 'eventStart' },
  'team.run.completed': { icon: CheckCircle, labelKey: 'teamRun.event.runCompleted', className: 'eventDone' },
  'team.run.failed': { icon: XCircle, labelKey: 'teamRun.event.runFailed', className: 'eventFailed' },
  'agent.message': { icon: MessageSquare, labelKey: 'teamRun.event.agentMessage', className: 'eventMessage' },
  'team.approval.decided': { icon: Shield, labelKey: 'teamRun.event.approvalDecided', className: 'eventApproval' },
  'team.conflict.resolved': { icon: AlertTriangle, labelKey: 'teamRun.event.conflictResolved', className: 'eventConflict' },
};

const DEFAULT_EVENT_META = { icon: Clock, labelKey: 'teamRun.event.unknown', className: 'eventUnknown' };

function parsePayload(payload?: string | Record<string, unknown>): string {
  if (!payload) return '';
  if (typeof payload === 'string') {
    try {
      const obj = JSON.parse(payload);
      if (obj && typeof obj === 'object') {
        const parts: string[] = [];
        if (typeof obj.reason === 'string') parts.push(obj.reason);
        if (typeof obj.objective === 'string') parts.push(obj.objective);
        if (typeof obj.instructions === 'string') parts.push(obj.instructions);
        if (typeof obj.summary === 'string') parts.push(obj.summary);
        if (typeof obj.decision === 'string') parts.push(`Decision: ${obj.decision}`);
        if (typeof obj.action === 'string') parts.push(`Action: ${obj.action}`);
        return parts.slice(0, 2).join(' | ') || '';
      }
    } catch {
      return payload.length > 100 ? `${payload.slice(0, 100)}...` : payload;
    }
    return payload.length > 100 ? `${payload.slice(0, 100)}...` : payload;
  }
  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.reason === 'string') parts.push(obj.reason);
  if (typeof obj.objective === 'string') parts.push(obj.objective);
  if (typeof obj.instructions === 'string') parts.push(obj.instructions);
  if (typeof obj.summary === 'string') parts.push(obj.summary);
  return parts.slice(0, 2).join(' | ') || '';
}

export const TeamEventTimeline = memo(function TeamEventTimeline({
  events,
  loading,
  error,
  memberNames: _memberNames,
}: TeamEventTimelineProps) {
  const { t } = useTranslation();

  const sorted = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq;
      if (a.created_at && b.created_at) return a.created_at.localeCompare(b.created_at);
      return 0;
    });
    return copy;
  }, [events]);

  if (loading && events.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.hint}>{t('teamRun.loading', 'Loading...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <Clock size={32} className={styles.emptyIcon} />
          <span>{t('teamRun.noEvents', 'No events recorded for this run.')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.timeline}>
        {sorted.map((event) => {
          const meta = EVENT_META[event.type] ?? DEFAULT_EVENT_META;
          const Icon = meta.icon;
          const dotClass = styles[meta.className] ?? styles.eventUnknown;
          const details = parsePayload(event.payload);

          return (
            <div key={event.id} className={styles.eventRow}>
              <div className={styles.eventDot}>
                <div className={`${styles.dotCircle} ${dotClass}`}>
                  <Icon size={10} />
                </div>
                <div className={styles.dotLine} />
              </div>
              <div className={styles.eventContent}>
                <div className={styles.eventHeader}>
                  <span className={styles.eventType}>
                    {t(meta.labelKey, event.type)}
                  </span>
                  <span className={styles.eventSeq}>#{event.seq}</span>
                  {event.created_at && (
                    <span className={styles.eventTime}>
                      {new Date(event.created_at).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {details && (
                  <div className={styles.eventDetails}>{details}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default TeamEventTimeline;
