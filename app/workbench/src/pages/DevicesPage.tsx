import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './DevicesPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   DevicesPage — device / execution-target management (#1819).

   Pure presentational page: the shell owns the real data (Hub execution
   target inventory + ping mutation) and feeds it through props. Health
   states mirror the Hub `health_state` vocabulary; mismatch/stale/offline
   rows carry an actionable repair hint instead of a dead badge.
   ═══════════════════════════════════════════════════════════════════════ */

export interface DevicesPageTarget {
  id: string;
  name: string;
  targetType: string;
  healthState: string;
  isOnline: boolean;
  trustLevel?: string | undefined;
  endpoint?: string | undefined;
  workspaceRoot?: string | undefined;
  deviceId?: string | undefined;
  lastSeenAt?: string | undefined;
}

export interface DevicesPageProps {
  /** undefined = shell is not Hub-connected (renders sign-in guidance). */
  targets?: DevicesPageTarget[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  /** Target currently being pinged (its row shows the busy state). */
  pingingTargetId?: string | null | undefined;
  onPingTarget?: ((targetId: string) => void) | undefined;
}

const HEALTH_STATES = ['healthy', 'online', 'degraded', 'offline', 'mismatch', 'stale'] as const;

/** Normalize an arbitrary Hub health_state into a display bucket. */
export function resolveDevicesHealthBucket(healthState: string): string {
  return (HEALTH_STATES as readonly string[]).includes(healthState) ? healthState : 'unknown';
}

export interface DevicesSummary {
  total: number;
  online: number;
  healthy: number;
}

/** Counters for the page header line. Healthy = healthy|online buckets. */
export function summarizeDevices(targets: DevicesPageTarget[]): DevicesSummary {
  let online = 0;
  let healthy = 0;
  for (const target of targets) {
    if (target.isOnline) online += 1;
    const bucket = resolveDevicesHealthBucket(target.healthState);
    if (bucket === 'healthy' || bucket === 'online') healthy += 1;
  }
  return { total: targets.length, online, healthy };
}

/** Deterministic last-seen label: locale string when parseable, raw otherwise. */
export function formatDevicesLastSeen(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

function healthClass(bucket: string): string {
  switch (bucket) {
    case 'healthy':
    case 'online':
      return styles.healthOk ?? '';
    case 'degraded':
    case 'stale':
      return styles.healthWarn ?? '';
    case 'offline':
    case 'mismatch':
      return styles.healthBad ?? '';
    default:
      return styles.healthUnknown ?? '';
  }
}

/** Repair guidance only exists for states the user can actually act on. */
function repairKey(bucket: string): string | undefined {
  switch (bucket) {
    case 'mismatch':
      return 'devices.repair.mismatch';
    case 'stale':
      return 'devices.repair.stale';
    case 'offline':
      return 'devices.repair.offline';
    case 'degraded':
      return 'devices.repair.degraded';
    default:
      return undefined;
  }
}

export function DevicesPage({
  targets,
  loading,
  error,
  onRetry,
  pingingTargetId,
  onPingTarget,
}: DevicesPageProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  if (targets === undefined) {
    return (
      <div className={styles.page} data-testid="devices-page">
        <div className={styles.placeholder} role="status">
          <h2 className={styles.placeholderTitle}>{t('devices.signedOut.title')}</h2>
          <p className={styles.placeholderBody}>{t('devices.signedOut.body')}</p>
        </div>
      </div>
    );
  }

  if (error && targets.length === 0) {
    return (
      <div className={styles.page} data-testid="devices-page">
        <div className={styles.placeholder} role="alert">
          <h2 className={styles.placeholderTitle}>{t('devices.error.title')}</h2>
          <p className={styles.placeholderBody}>{error}</p>
          {onRetry ? (
            <button
              className={styles.retryButton}
              data-testid="devices-retry"
              onClick={onRetry}
              type="button"
            >
              {t('connection.retry')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (loading && targets.length === 0) {
    return (
      <div className={styles.page} data-testid="devices-page">
        <div className={styles.placeholder} role="status">
          <p className={styles.placeholderBody}>{t('connection.connecting')}</p>
        </div>
      </div>
    );
  }

  if (targets.length === 0) {
    return (
      <div className={styles.page} data-testid="devices-page">
        <div className={styles.placeholder} role="status">
          <h2 className={styles.placeholderTitle}>{t('devices.empty.title')}</h2>
          <p className={styles.placeholderBody}>{t('devices.empty.body')}</p>
        </div>
      </div>
    );
  }

  const summary = summarizeDevices(targets);

  return (
    <div className={styles.page} data-testid="devices-page">
      <header className={styles.header}>
        <h2 className={styles.title}>{t('devices.title')}</h2>
        <p className={styles.summary} data-testid="devices-summary">
          {t('devices.summary', {
            online: summary.online,
            total: summary.total,
            healthy: summary.healthy,
          })}
        </p>
      </header>
      <ul className={styles.list}>
        {targets.map((target) => {
          const bucket = resolveDevicesHealthBucket(target.healthState);
          const hint = repairKey(bucket);
          const pinging = pingingTargetId === target.id;
          const lastSeen = formatDevicesLastSeen(target.lastSeenAt);
          return (
            <li
              className={styles.row}
              data-health={bucket}
              data-testid={`devices-row-${target.id}`}
              key={target.id}
            >
              <div className={styles.rowMain}>
                <div className={styles.rowTitleLine}>
                  <span className={styles.rowName}>{target.name || target.id}</span>
                  <span
                    className={`${styles.healthBadge} ${healthClass(bucket)}`}
                    data-testid={`devices-health-${target.id}`}
                  >
                    {t(`devices.health.${bucket}`)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={target.isOnline ? styles.onlineDotOn : styles.onlineDotOff}
                    data-testid={`devices-online-${target.id}`}
                  />
                </div>
                <dl className={styles.fields}>
                  <div className={styles.field}>
                    <dt>{t('devices.field.type')}</dt>
                    <dd>{target.targetType}</dd>
                  </div>
                  <div className={styles.field}>
                    <dt>{t('devices.field.endpoint')}</dt>
                    <dd>{target.endpoint ?? target.id}</dd>
                  </div>
                  {target.workspaceRoot ? (
                    <div className={styles.field}>
                      <dt>{t('devices.field.workspace')}</dt>
                      <dd>{target.workspaceRoot}</dd>
                    </div>
                  ) : null}
                  {target.trustLevel ? (
                    <div className={styles.field}>
                      <dt>{t('devices.field.trust')}</dt>
                      <dd>{target.trustLevel}</dd>
                    </div>
                  ) : null}
                  <div className={styles.field}>
                    <dt>{t('devices.field.lastSeen')}</dt>
                    <dd>{lastSeen ?? t('devices.field.never')}</dd>
                  </div>
                </dl>
                {hint ? (
                  <p className={styles.repairHint} data-testid={`devices-repair-${target.id}`}>
                    {t(hint)}
                  </p>
                ) : null}
              </div>
              {onPingTarget ? (
                <button
                  className={styles.pingButton}
                  data-testid={`devices-ping-${target.id}`}
                  disabled={pinging}
                  onClick={() => onPingTarget(target.id)}
                  type="button"
                >
                  {pinging ? t('devices.pinging') : t('devices.ping')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
