import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './TokenUsagePage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   TokenUsagePage — token / cost consumption board (#1819).

   Pure presentational page fed by the shell: the Hub has no aggregate
   usage endpoint, so the shell fetches each team's runs (GET
   /web/agent-teams/:id/runs) and maps the migration-0066
   `token_usage_total` counter through. Runs recorded before the counter
   existed carry undefined — rendered as “—”, never faked as 0.
   ═══════════════════════════════════════════════════════════════════════ */

export interface TokenUsagePageRun {
  id: string;
  status: string;
  createdAt?: string | undefined;
  triggerMessage?: string | undefined;
  /** undefined = not recorded (pre-0066 run, not backfilled). */
  tokenUsageTotal?: number | undefined;
}

export interface TokenUsagePageTeam {
  id: string;
  name: string;
  runs: TokenUsagePageRun[];
}

export interface TokenUsagePageProps {
  /** undefined = shell is not Hub-connected (renders sign-in guidance). */
  teams?: TokenUsagePageTeam[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
}

/** Total of recorded tokens; runs without a counter contribute nothing. */
export function sumRecordedTokens(teams: TokenUsagePageTeam[]): number {
  let total = 0;
  for (const team of teams) {
    for (const run of team.runs) {
      if (typeof run.tokenUsageTotal === 'number') total += run.tokenUsageTotal;
    }
  }
  return total;
}

/** Compact token count for summary tiles (12.4k style). */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/** Deterministic created-at label: locale string when parseable, raw otherwise. */
export function formatUsageTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

export function TokenUsagePage({
  teams,
  loading,
  error,
  onRetry,
}: TokenUsagePageProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  if (teams === undefined) {
    return (
      <div className={styles.page} data-testid="usage-page">
        <div className={styles.placeholder} role="status">
          <h2 className={styles.placeholderTitle}>{t('usage.signedOut.title')}</h2>
          <p className={styles.placeholderBody}>{t('usage.signedOut.body')}</p>
        </div>
      </div>
    );
  }

  if (error && teams.length === 0) {
    return (
      <div className={styles.page} data-testid="usage-page">
        <div className={styles.placeholder} role="alert">
          <h2 className={styles.placeholderTitle}>{t('usage.error.title')}</h2>
          <p className={styles.placeholderBody}>{error}</p>
          {onRetry ? (
            <button
              className={styles.retryButton}
              data-testid="usage-retry"
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

  if (loading && teams.length === 0) {
    return (
      <div className={styles.page} data-testid="usage-page">
        <div className={styles.placeholder} role="status">
          <p className={styles.placeholderBody}>{t('connection.connecting')}</p>
        </div>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className={styles.page} data-testid="usage-page">
        <div className={styles.placeholder} role="status">
          <h2 className={styles.placeholderTitle}>{t('usage.empty.title')}</h2>
          <p className={styles.placeholderBody}>{t('usage.empty.body')}</p>
        </div>
      </div>
    );
  }

  const total = sumRecordedTokens(teams);

  return (
    <div className={styles.page} data-testid="usage-page">
      <header className={styles.header}>
        <h2 className={styles.title}>{t('usage.title')}</h2>
        <div className={styles.totalTile} data-testid="usage-total">
          <span className={styles.totalLabel}>{t('usage.total')}</span>
          <span className={styles.totalValue} title={String(total)}>
            {formatTokenCount(total)}
          </span>
        </div>
      </header>
      <div className={styles.teamGrid}>
        {teams.map((team) => {
          const teamTotal = sumRecordedTokens([team]);
          return (
            <section
              className={styles.teamCard}
              data-testid={`usage-team-${team.id}`}
              key={team.id}
            >
              <header className={styles.teamHeader}>
                <h3 className={styles.teamName}>{team.name}</h3>
                <span className={styles.teamMeta}>
                  {t('usage.runs', { count: team.runs.length })} ·{' '}
                  {t('usage.tokens', { count: teamTotal })}
                </span>
              </header>
              {team.runs.length > 0 ? (
                <table className={styles.runTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('usage.run.status')}</th>
                      <th scope="col">{t('usage.run.created')}</th>
                      <th className={styles.numericCol} scope="col">
                        {t('usage.run.tokens')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.runs.map((run) => (
                      <tr data-testid={`usage-run-${run.id}`} key={run.id}>
                        <td>
                          <span className={styles.status} data-status={run.status}>
                            {run.status}
                          </span>
                          {run.triggerMessage ? (
                            <span className={styles.trigger} title={run.triggerMessage}>
                              {run.triggerMessage}
                            </span>
                          ) : null}
                        </td>
                        <td>{formatUsageTimestamp(run.createdAt)}</td>
                        <td
                          className={styles.numericCol}
                          data-testid={`usage-run-tokens-${run.id}`}
                        >
                          {typeof run.tokenUsageTotal === 'number'
                            ? run.tokenUsageTotal.toLocaleString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          );
        })}
      </div>
      <p className={styles.footnote}>{t('usage.footnote')}</p>
    </div>
  );
}
