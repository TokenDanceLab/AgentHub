import React, { type ReactNode } from 'react';
import styles from './EmptyState.module.css';

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

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function EmptyState({
  title,
  description,
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
    <section className={cx(styles.container, className)} aria-label={title}>
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
          <button
            className={cx(styles.action, actionClassName)}
            type="button"
            aria-label={action.ariaLabel}
            onClick={action.onClick}
          >
            {action.icon}
            <span>{action.label}</span>
            {action.shortcut ? (
              <kbd className={styles.shortcut}>{action.shortcut}</kbd>
            ) : null}
          </button>
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
