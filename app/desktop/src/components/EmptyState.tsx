import styles from './EmptyState.module.css';

interface Suggestion {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  suggestions?: Suggestion[];
}

export default function EmptyState({ title, description, action, suggestions }: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
        {action && (
          <button className={styles.action} onClick={action.onClick}>
            {action.label}
          </button>
        )}
        {suggestions && suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map((s, i) => (
              <button key={i} className={styles.suggestionChip} onClick={s.onClick}>
                {s.icon && <span className={styles.suggestionIcon}>{s.icon}</span>}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
