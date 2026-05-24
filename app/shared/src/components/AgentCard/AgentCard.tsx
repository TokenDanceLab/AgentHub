import type { ReactNode } from 'react';
import styles from './AgentCard.module.css';

export type AgentTone = 'blue' | 'cyan' | 'purple' | 'green';

export interface AgentCardData {
  id: string;
  name: string;
  category: string;
  icon: string;
  tone: AgentTone;
  summary: string;
  tags: string[];
  rating: number;
  installs: string;
  saves?: string;
  isFavorite?: boolean;
  isInstalled?: boolean;
}

export interface AgentCardProps {
  agent: AgentCardData;
  /** Additional class names for the card container */
  className?: string;
  /** Called when the favorite button is clicked */
  onToggleFavorite?: (agentId: string) => void;
  /** Called when the install/add button is clicked */
  onInstall?: (agentId: string) => void;
  /** Called when the details button is clicked */
  onShowDetails?: (agentId: string) => void;
  /** Override the install button label (defaults based on isInstalled) */
  installLabel?: string;
  /** Whether the install button is disabled */
  installDisabled?: boolean;
  /** Render custom elements in the card footer instead of default actions */
  footer?: ReactNode;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function AgentCard({
  agent,
  className,
  onToggleFavorite,
  onInstall,
  onShowDetails,
  installLabel,
  installDisabled,
  footer,
}: AgentCardProps) {
  const toneClass = styles[agent.tone] ?? '';

  return (
    <article
      className={cx(
        styles.card,
        agent.isInstalled && styles.installed,
        className,
      )}
    >
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <div className={cx(styles.logo, toneClass)} aria-hidden="true">
            <span className="material-symbols-outlined">{agent.icon}</span>
          </div>
          <div className={styles.titleText}>
            <h3 className={styles.name}>{agent.name}</h3>
            <p className={styles.category}>{agent.category}</p>
          </div>
        </div>
        {onToggleFavorite && (
          <button
            className={cx(styles.favoriteBtn, agent.isFavorite && styles.isFavorite)}
            onClick={() => onToggleFavorite(agent.id)}
            type="button"
            aria-label={agent.isFavorite ? `Unfavorite ${agent.name}` : `Favorite ${agent.name}`}
          >
            <span className="material-symbols-outlined">favorite</span>
          </button>
        )}
      </div>

      <p className={styles.summary}>{agent.summary}</p>

      {agent.tags.length > 0 && (
        <div className={styles.tagRow}>
          {agent.tags.map((tag, index) => {
            const tagTones = ['', styles.tagCyan, styles.tagPurple, styles.tagGreen];
            const tagTone = tagTones[index] ?? '';
            return (
              <span key={tag} className={cx(styles.tag, tagTone)}>
                {tag}
              </span>
            );
          })}
        </div>
      )}

      <div className={styles.stats}>
        <span className={styles.stat}>{agent.rating.toFixed(1)} rating</span>
        <span className={styles.stat}>{agent.installs} installs</span>
        {agent.saves && (
          <span className={styles.stat}>{agent.saves} saves</span>
        )}
      </div>

      {footer ?? (
        <div className={styles.actions}>
          {onInstall && (
            <button
              className={cx(
                styles.actionBtn,
                styles.primaryBtn,
                agent.isInstalled && styles.successBtn,
              )}
              onClick={() => onInstall(agent.id)}
              type="button"
              disabled={installDisabled}
            >
              <span className="material-symbols-outlined">
                {agent.isInstalled ? 'check_circle' : 'add'}
              </span>
              {installLabel ?? (agent.isInstalled ? 'Added' : 'Add')}
            </button>
          )}
          {onShowDetails && (
            <button
              className={cx(styles.actionBtn, styles.ghostBtn)}
              onClick={() => onShowDetails(agent.id)}
              type="button"
            >
              <span className="material-symbols-outlined">open_in_new</span>
              Details
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default AgentCard;
