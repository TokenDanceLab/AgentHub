import styles from './ProjectCard.module.css';

export type ProjectStatus = 'in progress' | 'done' | 'review' | 'pending' | 'idle';

export interface ProjectCardProps {
  id: string;
  name: string;
  description?: string;
  agentCount?: number;
  lastActive?: string;
  status?: ProjectStatus;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

const statusLabel: Record<ProjectStatus, string> = {
  'in progress': 'In progress',
  done: 'Done',
  review: 'Review',
  pending: 'Pending',
  idle: 'Idle',
};

export function ProjectCard({
  id,
  name,
  description,
  agentCount,
  lastActive,
  status = 'pending',
  className,
}: ProjectCardProps) {
  return (
    <article className={cx(styles.card, className)}>
      <div className={styles.icon} aria-hidden="true">
        {name.slice(0, 2).toUpperCase()}
      </div>
      <div className={styles.info}>
        <h3 className={styles.name}>{name}</h3>
        {description && <p className={styles.description}>{description}</p>}
        <div className={styles.meta}>
          {agentCount !== undefined && (
            <span>{agentCount} agent{agentCount === 1 ? '' : 's'}</span>
          )}
          {lastActive && <span>{lastActive}</span>}
        </div>
      </div>
      <span className={cx(styles.badge, styles[status])}>
        {statusLabel[status]}
      </span>
    </article>
  );
}

export default ProjectCard;
