import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Cpu,
  HardDrive,
  Clock,
  Zap,
  WifiOff,
} from 'lucide-react';
import { SkeletonLine } from '@/components/Skeleton';
import styles from './LiveStats.module.css';

export interface LiveStatsData {
  /** Number of active runs. */
  activeRuns: number;
  /** Number of registered agents. */
  agents: number;
  /** Current memory usage in MB (approximate). */
  memoryMB: number;
  /** Edge uptime in seconds. */
  uptimeSec: number;
  /** CPU usage percentage (0–100). */
  cpuPercent: number;
}

interface Props {
  online: boolean;
  loading: boolean;
  stats: LiveStatsData | null;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

const SKELETON_ITEMS = Array.from({ length: 5 });

export default memo(function LiveStats({ online, loading, stats }: Props) {
  const { t } = useTranslation();

  // ── Loading skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.root} role="status" aria-label="Loading stats" aria-busy="true">
        {SKELETON_ITEMS.map((_, i) => (
          <div key={i} className={styles.statItem}>
            <SkeletonLine width={14} height={14} />
            <SkeletonLine width={`${40 + i * 10}%`} height="12px" />
          </div>
        ))}
      </div>
    );
  }

  // ── Offline / no data ───────────────────────────────────────────────
  if (!online || !stats) {
    return (
      <div className={`${styles.root} ${styles.offline}`} role="status">
        <WifiOff size={14} className={styles.offlineIcon} aria-hidden="true" />
        <span className={styles.offlineText}>{t('event.emptyOffline')}</span>
      </div>
    );
  }

  // ── Linear stats bar ────────────────────────────────────────────────
  const rows: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    {
      icon: <Activity size={14} />,
      label: t('run.status.RUNNING'),
      value: String(stats.activeRuns),
    },
    {
      icon: <Zap size={14} />,
      label: t('agent.title'),
      value: String(stats.agents),
    },
    {
      icon: <Cpu size={14} />,
      label: 'CPU',
      value: `${stats.cpuPercent}%`,
    },
    {
      icon: <HardDrive size={14} />,
      label: t('liveStats.memory'),
      value: formatMemory(stats.memoryMB),
    },
    {
      icon: <Clock size={14} />,
      label: t('liveStats.uptime'),
      value: formatUptime(stats.uptimeSec),
    },
  ];

  return (
    <div className={styles.root} role="status" aria-label={t('liveStats.title')}>
      {rows.map((row) => (
        <div key={row.label} className={styles.statItem} title={`${row.label}: ${row.value}`}>
          <span className={styles.statIcon} aria-hidden="true">
            {row.icon}
          </span>
          <span className={styles.statValue}>{row.value}</span>
          <span className={styles.statLabel}>{row.label}</span>
        </div>
      ))}
    </div>
  );
});
