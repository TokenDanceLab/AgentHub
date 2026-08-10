import { type ReactNode } from 'react';
import { cx } from './cx';
import { Button } from './Button';
import styles from './EmptyState.module.css';

export const EMPTY_STATE_KINDS = ['blank', 'search', 'filter', 'error', 'noPermission'] as const;
export type EmptyStateKind = (typeof EMPTY_STATE_KINDS)[number];

export interface EmptyStateCopy {
  title: string;
  description: string;
}

/** Translation-ready copy contract: every surface defines all four states. */
export type EmptyStateCopyMatrix = Record<EmptyStateKind, EmptyStateCopy>;

export function resolveEmptyStateCopy(
  matrix: EmptyStateCopyMatrix,
  kind: EmptyStateKind,
): EmptyStateCopy {
  return matrix[kind];
}

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  ariaLabel?: string;
  /** Keyboard shortcut hint displayed as a kbd badge, e.g. "Ctrl+N" */
  shortcut?: string;
}

export interface EmptyStateSuggestion {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  kind?: EmptyStateKind;
  icon?: ReactNode;
  action?: EmptyStateAction;
  suggestions?: EmptyStateSuggestion[];
  titleLevel?: 1 | 2 | 3;
  className?: string;
  contentClassName?: string;
  iconClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actionClassName?: string;
  suggestionsClassName?: string;
  suggestionClassName?: string;
}


export function EmptyState({
  title,
  description,
  kind = 'blank',
  icon,
  action,
  suggestions,
  titleLevel = 2,
  className,
  contentClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
  actionClassName,
  suggestionsClassName,
  suggestionClassName,
}: EmptyStateProps) {
  const TitleTag = `h${titleLevel}` as 'h1' | 'h2' | 'h3';

  return (
    <section
      className={cx(styles.container, className)}
      aria-label={title}
      role={kind === 'error' ? 'alert' : 'region'}
      data-empty-kind={kind}
    >
      <div className={cx(styles.content, contentClassName)}>
        {icon ? (
          <div className={cx(styles.icon, iconClassName)} aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <TitleTag className={cx(styles.title, titleClassName)}>{title}</TitleTag>
        {description ? (
          <p className={cx(styles.description, descriptionClassName)}>{description}</p>
        ) : null}
        {action ? (
          <Button
            variant="primary"
            className={actionClassName}
            type="button"
            aria-label={action.ariaLabel}
            onClick={action.onClick}
          >
            {action.icon}
            <span>{action.label}</span>
            {action.shortcut ? (
              <kbd className={styles.shortcut}>{action.shortcut}</kbd>
            ) : null}
          </Button>
        ) : null}
        {suggestions && suggestions.length > 0 ? (
          <div className={cx(styles.suggestions, suggestionsClassName)}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                className={cx(styles.suggestionChip, suggestionClassName)}
                type="button"
                onClick={suggestion.onClick}
              >
                {suggestion.icon ? <span className={styles.suggestionIcon}>{suggestion.icon}</span> : null}
                <span>{suggestion.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
