import React from 'react';
import styles from './PersonPanel.module.css';

interface PersonAction {
  label: string;
  onClick?: () => void;
}

interface PersonProject {
  name: string;
}

interface PersonPanelProps {
  name: string;
  role?: string;
  status?: string;
  avatar?: string;
  avatarColor?: string;
  actions?: PersonAction[];
  projects?: PersonProject[];
  onAction?: (action: string) => void;
}

export function PersonPanel({
  name,
  role,
  status,
  avatar,
  avatarColor,
  actions,
  projects,
  onAction,
}: PersonPanelProps) {
  const initials = avatar || name.slice(0, 1).toUpperCase();
  const avatarBg = avatarColor || 'var(--td-plum)';

  return (
    <div className={styles.panel}>
      {/* Person card */}
      <div className={styles.card}>
        <div className={styles.avatar} style={{ background: avatarBg }}>
          {initials}
        </div>
        <h3>{name}</h3>
        {role && <p>{role}</p>}
        {status && <span className={styles.status}>{status}</span>}
      </div>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                action.onClick?.();
                onAction?.(action.label);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Shared projects */}
      {projects && projects.length > 0 && (
        <div className={styles.projects}>
          {projects.map((project) => (
            <span key={project.name}>{project.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
