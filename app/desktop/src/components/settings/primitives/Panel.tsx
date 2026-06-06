import { type ReactNode } from 'react';
import styles from './primitives.module.css';

interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function Panel({ title, description, actions, children }: PanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelHeaderCopy}>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className={styles.panelHeaderActions}>{actions}</div> : null}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
