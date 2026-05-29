import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  GitBranch,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useRuns } from '@/api/runQueries';
import { useThreads } from '@/api/threadQueries';
import { useHealth } from '@/hooks/useHealth';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import type { ThreadInfo } from '@shared/types';
import styles from './HomeDashboard.module.css';

interface Props {
  onNewThread: () => void;
  onSelectThread: (threadId: string) => void;
  onQuickStart: (prompt: string) => void;
  onOpenTeamRuns?: () => void;
  permissionCount?: number;
}

const QUICK_START_KEYS = [
  'home.quickStart1',
  'home.quickStart2',
  'home.quickStart3',
] as const;

function isRunActive(status: string): boolean {
  return ['queued', 'running', 'streaming', 'waiting_for_input'].includes(status);
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getRecentThreads(threads: ThreadInfo[], limit: number): ThreadInfo[] {
  return [...threads]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}

export default function HomeDashboard({
  onNewThread,
  onSelectThread,
  onQuickStart,
  onOpenTeamRuns,
  permissionCount = 0,
}: Props) {
  const { t } = useTranslation();
  const { online, health } = useHealth();
  const { data: runData } = useRuns();
  const { data: threadData } = useThreads();

  const runs = runData?.items ?? [];
  const threads = threadData?.items ?? [];

  const activeRunCount = useMemo(() => runs.filter((r) => isRunActive(r.status)).length, [runs]);
  const recentThreads = useMemo(() => getRecentThreads(threads, 5), [threads]);

  const edgeVersion = health?.version;
  const hubConnected = health?.checks?.hub?.status === 'ok';
  const hasIssues = !online || (edgeVersion && !hubConnected);

  let healthStatus: 'green' | 'yellow' | 'red' = 'green';
  if (!online) {
    healthStatus = 'red';
  } else if (hasIssues) {
    healthStatus = 'yellow';
  }

  return (
    <div className={styles.root}>
      {/* Top stats row */}
      <div className={styles.statsGrid}>
        {/* Active Runs */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <Activity size={14} />
            {t('home.activeRuns')}
          </div>
          <div className={styles.statValue}>{activeRunCount}</div>
          <button
            type="button"
            className={styles.statFooter}
            onClick={() => {} /* navigated via settings */}
            title={t('home.viewAllRuns')}
          >
            {t('home.viewAllRuns')}
          </button>
        </div>

        {/* Pending Approvals */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <ShieldCheck size={14} />
            {t('home.pendingApprovals')}
          </div>
          <div className={styles.statValue}>{permissionCount}</div>
          <button type="button" className={styles.statFooter} onClick={() => {}}>
            {t('home.reviewApprovals')}
          </button>
        </div>

        {/* TeamRuns */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <GitBranch size={14} />
            {t('home.activeTeamRuns')}
          </div>
          <div className={styles.statValue}>{t('home.teamRunConsole')}</div>
          <button
            type="button"
            className={styles.statFooter}
            onClick={onOpenTeamRuns}
          >
            {t('home.openTeamRuns')}
          </button>
        </div>

        {/* Target Health */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {t('home.targetHealth')}
          </div>
          <div className={styles.healthStatus}>
            <span
              className={`${styles.healthDot} ${
                healthStatus === 'green'
                  ? styles.healthDotGreen
                  : healthStatus === 'yellow'
                    ? styles.healthDotYellow
                    : styles.healthDotRed
              }`}
            />
            <span className={styles.statValue}>
              {online ? edgeVersion ?? t('home.online') : t('home.offline')}
            </span>
          </div>
          <span className={styles.statLabel}>
            {online ? t('home.edgeConnected') : t('home.edgeDisconnected')}
          </span>
        </div>
      </div>

      {/* Recent Threads */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{t('home.recentThreads')}</h2>
          {threads.length > 5 && (
            <button type="button" className={styles.sectionLink}>
              {t('home.viewAll')}
            </button>
          )}
        </div>

        {recentThreads.length > 0 ? (
          <div className={styles.threadList}>
            {recentThreads.map((thread) => (
              <button
                key={thread.threadId}
                type="button"
                className={styles.threadItem}
                onClick={() => onSelectThread(thread.threadId)}
              >
                <span className={styles.threadItemIcon}>
                  <MessageSquareText size={16} />
                </span>
                <span className={styles.threadItemBody}>
                  <span className={styles.threadItemTitle}>
                    {thread.title || t('thread.untitled')}
                  </span>
                  <span className={styles.threadItemMeta}>
                    {thread.projectId && `${thread.projectId} `}
                    {thread.status}
                  </span>
                </span>
                <span className={styles.threadItemTime}>
                  {formatTimestamp(thread.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>{t('home.noRecentThreads')}</div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className={styles.ctaSection}>
        <button
          type="button"
          className={styles.ctaButton}
          onClick={onNewThread}
        >
          <Plus size={16} />
          {t('home.newThread')}
        </button>

        <div className={styles.quickStart}>
          <span className={styles.quickStartLabel}>
            <Zap size={12} />
            {' '}{t('home.quickStartLabel')}
          </span>
          <div className={styles.quickStartChips}>
            {QUICK_START_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.chip}
                onClick={() => onQuickStart(t(key))}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
